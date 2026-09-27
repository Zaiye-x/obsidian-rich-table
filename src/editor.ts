import { App, Menu, Modal, Notice, setIcon } from "obsidian";
import { changeAxis, clone, expandedRect, History, merge, moveAxis, owners, parse, paste, Picture, Point, rect, Rect, selected, serialize, split, TableData } from "./model";
import { fromClipboard, toMarkdown, toTSV } from "./clipboard";
import { colLabel, element, renderTable, toHTML } from "./renderer";
import { NoteStorage } from "./storage";
import { PanelHost, renderPanel, Scope } from "./panel";
import { button, download, field } from "./ui";

type Axis = "row" | "col";
interface AxisRange { from: number; count: number }

function iconAction(parent: HTMLElement, iconName: string, label: string, title: string, action: () => void, cls = "rt-toolbar-action", iconOnly = false): HTMLButtonElement {
  const control = button(parent, iconOnly ? "" : label, action, cls);
  const icon = element(parent.ownerDocument, "span", "rt-button-icon");
  icon.setAttribute("aria-hidden", "true"); setIcon(icon, iconName);
  control.prepend(icon); control.title = title; control.setAttribute("aria-label", label);
  if (iconOnly) control.classList.add("rt-icon-only");
  return control;
}

class ConfirmClose extends Modal {
  constructor(app: App, private choose: (choice: "save" | "discard") => void) { super(app); }
  onOpen(): void {
    this.setTitle("保留表格修改？");
    this.contentEl.append(element(this.contentEl.ownerDocument, "p", "", "这些修改尚未写入笔记。"));
    const actions = element(this.contentEl.ownerDocument, "div", "rt-actions");
    button(actions, "继续编辑", () => this.close());
    button(actions, "放弃修改", () => { this.close(); this.choose("discard"); });
    button(actions, "保存并关闭", () => { this.close(); this.choose("save"); }, "mod-cta");
    this.contentEl.append(actions);
  }
}
export class TableEditor extends Modal {
  history: History;
  styleScope: Scope = "selection";
  private anchor: Point = { r: 0, c: 0 };
  private end: Point = { r: 0, c: 0 };
  private initial: string;
  private grid!: HTMLDivElement;
  private panel!: HTMLElement;
  private status!: HTMLElement;
  private count!: HTMLElement;
  private undoButton!: HTMLButtonElement;
  private redoButton!: HTMLButtonElement;
  private titleInput!: HTMLInputElement;
  private editor: { input: HTMLTextAreaElement; p: Point; text: HTMLElement } | null = null;
  private allowClose = false;
  private closingPrompt = false;
  private busy = false;
  private dragCleanup?: () => void;
  private selectionDrag: { pointerId: number; last: Point; moved: boolean } | null = null;
  private selectionDragCleanup?: () => void;
  private suppressCellClick = false;
  private suppressAxisClickUntil = 0;
  private axisDrag: (AxisRange & { axis: Axis; boundary: number | null }) | null = null;
  constructor(app: App, data: TableData, private storage: NoteStorage) {
    super(app); this.history = new History(clone(data)); this.initial = serialize(data);
  }
  get data(): TableData { return this.history.value; }
  get area(): Rect { return expandedRect(this.data, rect(this.anchor, this.end)); }
  private get doc(): Document { return this.contentEl.ownerDocument; }
  onOpen(): void {
    this.modalEl.classList.add("rt-modal");
    this.setTitle("编辑富表格");
    const root = this.contentEl; root.classList.add("rt-editor", "rt-root");
    const top = element(this.doc, "div", "rt-heading");
    const title = field(top, "表格标题"); this.titleInput = element(this.doc, "input", "rt-title");
    this.titleInput.value = this.data.title; this.titleInput.maxLength = 500;
    this.titleInput.addEventListener("change", () => this.change(t => t.title = this.titleInput.value));
    title.append(this.titleInput);
    const actions = element(this.doc, "div", "rt-actions");
    let exportButton!: HTMLButtonElement;
    exportButton = iconAction(actions, "download", "导出", "导出表格", () => this.exportMenu(exportButton), "rt-action-button");
    iconAction(actions, "save", "保存并关闭", "保存表格并关闭", () => void this.save(), "rt-action-button mod-cta");
    top.append(actions); root.append(top);
    const toolbar = element(this.doc, "div", "rt-toolbar");
    const historyActions = element(this.doc, "div", "rt-tool-group");
    this.undoButton = iconAction(historyActions, "undo-2", "撤销", "撤销（⌘/Ctrl Z）", () => this.undo(), "rt-toolbar-action", true);
    this.undoButton.title = "⌘/Ctrl Z（单元格编辑完成后）";
    this.redoButton = iconAction(historyActions, "redo-2", "重做", "重做（⌘/Ctrl Shift Z）", () => this.undo(true), "rt-toolbar-action", true);
    const structureActions = element(this.doc, "div", "rt-tool-group");
    iconAction(structureActions, "rows-3", "新增行", "在当前选区下方新增一行", () => this.insertAxis("row", "after"));
    iconAction(structureActions, "columns-3", "新增列", "在当前选区右侧新增一列", () => this.insertAxis("col", "after"));
    let moreButton!: HTMLButtonElement;
    moreButton = iconAction(structureActions, "ellipsis", "更多", "更多行列操作", () => this.structureMenu(moreButton), "rt-toolbar-action", true);
    const cellActions = element(this.doc, "div", "rt-tool-group rt-tool-group-last");
    iconAction(cellActions, "merge", "合并", "合并选中单元格", () => this.change(t => merge(t, this.area)));
    iconAction(cellActions, "split", "拆分", "拆分选中单元格", () => this.change(t => split(t, this.area)));
    iconAction(cellActions, "image-plus", "插入图片", "向当前单元格插入图片", () => this.pickImage());
    toolbar.append(historyActions, structureActions, cellActions);
    this.count = element(this.doc, "span", "rt-count"); toolbar.append(this.count); root.append(toolbar);
    const body = element(this.doc, "div", "rt-editor-body");
    this.grid = element(this.doc, "div", "rt-grid-wrap"); this.grid.tabIndex = -1;
    this.panel = element(this.doc, "aside", "rt-panel"); this.panel.setAttribute("aria-label", "表格样式设置");
    body.append(this.grid, this.panel); root.append(body);
    const foot = element(this.doc, "div", "rt-footer");
    foot.append(element(this.doc, "span", "rt-hint", "拖动框选 · 拖动行号/列标调整位置 · 双击或 Enter 编辑 · Tab 换格 · 可粘贴 Excel 或图片"));
    this.status = element(this.doc, "span", "rt-status", "尚未修改"); this.status.setAttribute("role", "status"); foot.append(this.status); root.append(foot);
    this.grid.addEventListener("keydown", e => this.keydown(e));
    this.grid.addEventListener("paste", e => this.onPaste(e));
    this.grid.addEventListener("copy", e => this.onCopy(e));
    this.grid.addEventListener("dragover", e => {
      if ([...e.dataTransfer?.types || []].includes("Files")) { e.preventDefault(); if (e.dataTransfer) e.dataTransfer.dropEffect = "copy"; }
    });
    this.grid.addEventListener("drop", e => {
      const files = [...e.dataTransfer?.files || []]; if (!files.length) return;
      e.preventDefault();
      const td = (e.target as HTMLElement).closest<HTMLTableCellElement>("td[data-row]");
      if (td) this.selectCell({ r: Number(td.dataset.row), c: Number(td.dataset.col) }, false, false);
      void this.importImages(files);
    });
    // The Obsidian Modal Escape handler runs on its scope; consume it while
    // an in-cell editor is active, leaving the window open.
    this.scopeEscape();
    this.refresh();
  }
  private scopeEscape(): void {
    // Modal.scope is the Obsidian keyboard scope, distinct from styleScope.
    this.scope.register([], "Escape", () => {
      if (this.editor) { this.commitCell(); this.focusCell(); }
      else this.close();
      return false;
    });
    this.scope.register(["Mod"], "s", () => { void this.save(); return false; });
    this.contentEl.addEventListener("keydown", e => {
      if (e.key === "Escape" && this.editor) {
        e.preventDefault(); e.stopPropagation(); this.commitCell(); this.focusCell();
      }
    }, true);
  }
  change(fn: (t: TableData) => void, after?: () => void): boolean {
    if (this.busy) return false;
    this.commitCell();
    try {
      const changed = this.history.change(fn);
      if (changed) after?.();
      this.clamp(); this.refresh(); return changed;
    } catch (e) { this.fail(e); return false; }
  }
  private fail(error: unknown): void {
    const message = error instanceof Error ? error.message : String(error);
    this.status.textContent = message; this.status.classList.add("rt-error"); new Notice(message, 7000);
  }
  private clamp(): void {
    for (const p of [this.anchor, this.end]) { p.r = Math.max(0, Math.min(p.r, this.data.cells.length - 1)); p.c = Math.max(0, Math.min(p.c, this.data.columns.length - 1)); }
  }
  private refresh(): void {
    const x = this.grid.scrollLeft, y = this.grid.scrollTop;
    this.titleInput.value = this.data.title;
    this.grid.replaceChildren(renderTable(this.doc, this.data, {
      grid: true, resolveImage: path => this.storage.image(path),
      onCell: (td, p) => {
        td.addEventListener("pointerdown", e => this.beginSelectionDrag(e, p));
        td.addEventListener("pointerover", e => this.extendSelectionDrag(e, p));
        td.addEventListener("click", e => {
          if (this.suppressCellClick) { this.suppressCellClick = false; return; }
          if (this.editor?.input.contains(e.target as Node)) return;
          this.selectCell(p, e.shiftKey);
        });
        td.addEventListener("dblclick", () => this.startCell(p));
        td.addEventListener("contextmenu", e => {
          e.preventDefault(); this.commitCell();
          const area = this.area;
          if (p.r < area.r0 || p.r > area.r1 || p.c < area.c0 || p.c > area.c1) this.selectCell(p, false);
          this.structureMenu(undefined, e);
        });
      },
      onRow: (th, r) => {
        th.tabIndex = 0; th.draggable = true; th.dataset.row = String(r);
        th.setAttribute("aria-label", `选择并拖动第 ${r + 1} 行`); th.setAttribute("aria-keyshortcuts", "Alt+ArrowUp Alt+ArrowDown");
        th.title = "点击选择；上下拖动调整位置；Alt+↑/↓移动";
        th.addEventListener("click", e => {
          if (Date.now() < this.suppressAxisClickUntil) { this.suppressAxisClickUntil = 0; return; }
          this.selectAxis("row", r, e.shiftKey);
        });
        th.addEventListener("keydown", e => this.axisKeydown(e, "row", r));
        th.addEventListener("contextmenu", e => {
          e.preventDefault();
          const range = this.axisRange("row");
          if (!range || r < range.from || r >= range.from + range.count) this.selectAxis("row", r, false, false);
          this.structureMenu(undefined, e);
        });
        th.addEventListener("dragstart", e => this.beginAxisDrag(e, "row", r));
        th.addEventListener("dragover", e => this.overAxisDrag(e, "row", r, th));
        th.addEventListener("drop", e => this.dropAxis(e, "row"));
        th.addEventListener("dragend", () => this.finishAxisDrag());
      },
      onColumn: (th, c) => {
        th.tabIndex = 0; th.draggable = true; th.dataset.col = String(c);
        th.setAttribute("aria-label", `选择并拖动 ${colLabel(c)} 列`); th.setAttribute("aria-keyshortcuts", "Alt+ArrowLeft Alt+ArrowRight");
        th.title = "点击选择；左右拖动调整位置；Alt+←/→移动";
        th.addEventListener("click", e => {
          if (Date.now() < this.suppressAxisClickUntil) { this.suppressAxisClickUntil = 0; return; }
          this.selectAxis("col", c, e.shiftKey);
        });
        th.addEventListener("keydown", e => this.axisKeydown(e, "col", c));
        th.addEventListener("contextmenu", e => {
          if ((e.target as HTMLElement).closest(".rt-resize")) return;
          e.preventDefault();
          const range = this.axisRange("col");
          if (!range || c < range.from || c >= range.from + range.count) this.selectAxis("col", c, false, false);
          this.structureMenu(undefined, e);
        });
        th.addEventListener("dragstart", e => this.beginAxisDrag(e, "col", c));
        th.addEventListener("dragover", e => this.overAxisDrag(e, "col", c, th));
        th.addEventListener("drop", e => this.dropAxis(e, "col"));
        th.addEventListener("dragend", () => this.finishAxisDrag());
        const handle = element(this.doc, "span", "rt-resize"); handle.setAttribute("aria-hidden", "true"); handle.draggable = false;
        handle.addEventListener("click", e => e.stopPropagation());
        handle.addEventListener("dragstart", e => e.preventDefault());
        handle.addEventListener("pointerdown", e => this.resize(e, c, th)); th.append(handle);
      }
    }));
    this.grid.scrollLeft = x; this.grid.scrollTop = y;
    this.paint(); this.drawPanel(); this.updateStatus();
  }
  private updateStatus(): void {
    this.undoButton.disabled = !this.history.canUndo; this.redoButton.disabled = !this.history.canRedo;
    this.status.classList.remove("rt-error");
    this.status.textContent = serialize(this.data) === this.initial ? "尚未修改" : "有未保存的修改";
  }
  private drawPanel(): void {
    const host: PanelHost = {
      data: this.data, area: this.area, scope: this.styleScope,
      setScope: s => { this.styleScope = s; this.drawPanel(); },
      change: fn => this.change(fn), addImage: () => this.pickImage()
    };
    const scroll = this.panel.scrollTop; renderPanel(this.panel, host); this.panel.scrollTop = scroll;
  }
  private paint(): void {
    const s = this.area, active = owners(this.data)[this.anchor.r][this.anchor.c];
    for (const td of this.grid.querySelectorAll<HTMLTableCellElement>("td[data-row]")) {
      const r = Number(td.dataset.row), c = Number(td.dataset.col), on = r >= s.r0 && r <= s.r1 && c >= s.c0 && c <= s.c1;
      td.classList.toggle("rt-selected", on); td.classList.toggle("rt-active", r === active.r && c === active.c);
      td.setAttribute("aria-selected", String(on)); td.tabIndex = r === active.r && c === active.c ? 0 : -1;
    }
    const rowsSelected = s.c0 === 0 && s.c1 === this.data.columns.length - 1;
    const columnsSelected = s.r0 === 0 && s.r1 === this.data.cells.length - 1;
    for (const th of this.grid.querySelectorAll<HTMLTableCellElement>("tbody th[data-row]")) {
      const on = rowsSelected && Number(th.dataset.row) >= s.r0 && Number(th.dataset.row) <= s.r1;
      th.classList.toggle("rt-axis-selected", on); th.setAttribute("aria-selected", String(on));
    }
    for (const th of this.grid.querySelectorAll<HTMLTableCellElement>("thead th[data-col]")) {
      const on = columnsSelected && Number(th.dataset.col) >= s.c0 && Number(th.dataset.col) <= s.c1;
      th.classList.toggle("rt-axis-selected", on); th.setAttribute("aria-selected", String(on));
    }
    this.count.textContent = `${colLabel(s.c0)}${s.r0 + 1}${s.r0 === s.r1 && s.c0 === s.c1 ? "" : ` : ${colLabel(s.c1)}${s.r1 + 1}`} · ${this.data.cells.length} 行 × ${this.data.columns.length} 列`;
  }
  private selectCell(p: Point, extend = false, focus = true): void {
    if (this.busy) return;
    this.commitCell();
    if (!extend) this.anchor = { ...owners(this.data)[p.r][p.c] };
    this.end = { ...p }; this.paint(); this.drawPanel();
    if (focus) this.focusCell(p);
  }
  private beginSelectionDrag(event: PointerEvent, p: Point): void {
    if (this.busy || event.button !== 0 || this.editor?.input.contains(event.target as Node)) return;
    this.selectionDragCleanup?.();
    this.selectCell(p, event.shiftKey);
    const pointerId = event.pointerId;
    this.selectionDrag = { pointerId, last: { ...p }, moved: false };
    this.grid.classList.add("is-selecting");
    const finish = (e: PointerEvent) => {
      if (!this.selectionDrag || e.pointerId !== pointerId) return;
      const moved = this.selectionDrag.moved;
      cleanup();
      if (moved) { this.drawPanel(); this.focusCell(this.end); }
      this.suppressCellClick = true;
      this.doc.defaultView?.setTimeout(() => { this.suppressCellClick = false; }, 0);
    };
    const cleanup = () => {
      this.doc.removeEventListener("pointerup", finish);
      this.doc.removeEventListener("pointercancel", finish);
      this.grid.classList.remove("is-selecting");
      this.selectionDrag = null;
      this.selectionDragCleanup = undefined;
    };
    this.selectionDragCleanup = cleanup;
    this.doc.addEventListener("pointerup", finish);
    this.doc.addEventListener("pointercancel", finish);
  }
  private extendSelectionDrag(event: PointerEvent, p: Point): void {
    const drag = this.selectionDrag;
    if (!drag || event.pointerId !== drag.pointerId || (drag.last.r === p.r && drag.last.c === p.c)) return;
    drag.last = { ...p }; drag.moved = true;
    this.end = { ...p };
    this.paint();
  }
  private td(p: Point): HTMLTableCellElement | null {
    const owner = owners(this.data)[p.r][p.c];
    return this.grid.querySelector(`td[data-row="${owner.r}"][data-col="${owner.c}"]`);
  }
  private focusCell(p = this.anchor): void { this.td(p)?.focus({ preventScroll: true }); }
  private axisHeader(axis: Axis, index: number): HTMLTableCellElement | null {
    return this.grid.querySelector(axis === "row" ? `tbody th[data-row="${index}"]` : `thead th[data-col="${index}"]`);
  }
  private axisRange(axis: Axis): AxisRange | null {
    const area = this.area;
    if (axis === "row" && area.c0 === 0 && area.c1 === this.data.columns.length - 1)
      return { from: area.r0, count: area.r1 - area.r0 + 1 };
    if (axis === "col" && area.r0 === 0 && area.r1 === this.data.cells.length - 1)
      return { from: area.c0, count: area.c1 - area.c0 + 1 };
    return null;
  }
  private selectAxis(axis: Axis, index: number, extend = false, focus = true): void {
    if (this.busy) return;
    this.commitCell();
    const current = this.axisRange(axis);
    if (axis === "row") {
      const start = extend && current ? this.anchor.r : index;
      this.anchor = { r: start, c: 0 }; this.end = { r: index, c: this.data.columns.length - 1 };
    } else {
      const start = extend && current ? this.anchor.c : index;
      this.anchor = { r: 0, c: start }; this.end = { r: this.data.cells.length - 1, c: index };
    }
    this.paint(); this.drawPanel();
    if (focus) this.axisHeader(axis, index)?.focus({ preventScroll: true });
  }
  private axisKeydown(event: KeyboardEvent, axis: Axis, index: number): void {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault(); event.stopPropagation(); this.selectAxis(axis, index, event.shiftKey); return;
    }
    const direction = axis === "row"
      ? (event.key === "ArrowUp" ? -1 : event.key === "ArrowDown" ? 1 : 0)
      : (event.key === "ArrowLeft" ? -1 : event.key === "ArrowRight" ? 1 : 0);
    if (direction) {
      event.preventDefault(); event.stopPropagation();
      if (!event.altKey) {
        const n = axis === "row" ? this.data.cells.length : this.data.columns.length;
        this.selectAxis(axis, Math.max(0, Math.min(n - 1, index + direction)), event.shiftKey);
        return;
      }
      const range = this.axisRange(axis);
      if (!range || index < range.from || index >= range.from + range.count) this.selectAxis(axis, index, false, false);
      this.moveAxisStep(axis, direction as -1 | 1);
    }
  }
  private beginAxisDrag(event: DragEvent, axis: Axis, index: number): void {
    if (this.busy || (event.target as HTMLElement).closest(".rt-resize")) { event.preventDefault(); return; }
    const current = this.axisRange(axis);
    if (!current || index < current.from || index >= current.from + current.count) this.selectAxis(axis, index, false, false);
    const range = this.axisRange(axis);
    if (!range) { event.preventDefault(); return; }
    this.axisDrag = { axis, ...range, boundary: null };
    this.suppressAxisClickUntil = Date.now() + 5000; this.clearAxisDrop();
    this.grid.classList.add("is-axis-dragging", `is-dragging-${axis}`);
    if (event.dataTransfer) {
      event.dataTransfer.effectAllowed = "move";
      event.dataTransfer.setData("text/plain", axis === "row" ? `行 ${range.from + 1}` : `列 ${colLabel(range.from)}`);
    }
    this.status.textContent = axis === "row" ? "上下拖动行号以调整位置" : "左右拖动列标以调整位置";
  }
  private overAxisDrag(event: DragEvent, axis: Axis, index: number, header: HTMLTableCellElement): void {
    const drag = this.axisDrag;
    if (!drag || drag.axis !== axis) return;
    event.preventDefault(); event.stopPropagation();
    if (event.dataTransfer) event.dataTransfer.dropEffect = "move";
    const box = header.getBoundingClientRect();
    const before = axis === "row" ? event.clientY < box.top + box.height / 2 : event.clientX < box.left + box.width / 2;
    drag.boundary = index + (before ? 0 : 1);
    this.clearAxisDrop();
    if (drag.boundary >= drag.from && drag.boundary <= drag.from + drag.count) return;
    const cls = axis === "row"
      ? (before ? "rt-drop-before" : "rt-drop-after")
      : (before ? "rt-drop-left" : "rt-drop-right");
    if (axis === "row") header.closest("tr")?.classList.add(cls);
    else {
      header.classList.add(cls);
      for (const cell of this.grid.querySelectorAll<HTMLElement>(`td[data-col="${index}"]`)) cell.classList.add(cls);
    }
  }
  private dropAxis(event: DragEvent, axis: Axis): void {
    const drag = this.axisDrag;
    if (!drag || drag.axis !== axis) return;
    event.preventDefault(); event.stopPropagation();
    const { from, count, boundary } = drag;
    this.finishAxisDrag();
    if (boundary === null || (boundary >= from && boundary <= from + count)) return;
    this.reorderAxis(axis, from, count, boundary);
  }
  private clearAxisDrop(): void {
    for (const node of this.grid.querySelectorAll(".rt-drop-before, .rt-drop-after, .rt-drop-left, .rt-drop-right"))
      node.classList.remove("rt-drop-before", "rt-drop-after", "rt-drop-left", "rt-drop-right");
  }
  private finishAxisDrag(): void {
    const active = this.axisDrag !== null;
    this.clearAxisDrop(); this.grid.classList.remove("is-axis-dragging", "is-dragging-row", "is-dragging-col");
    this.axisDrag = null; if (active) this.updateStatus();
    if (active) this.suppressAxisClickUntil = Date.now() + 500;
  }
  private startCell(p = this.anchor, initial?: string): void {
    if (this.busy) return;
    this.commitCell(); p = owners(this.data)[p.r][p.c];
    this.anchor = { ...p }; this.end = { ...p }; this.paint();
    const td = this.td(p); if (!td) return;
    const text = td.querySelector<HTMLElement>(".rt-cell-text")!;
    text.hidden = true;
    const input = element(this.doc, "textarea", "rt-cell-input");
    input.setAttribute("aria-label", `编辑 ${colLabel(p.c)}${p.r + 1}`);
    input.maxLength = 200000;
    input.value = initial ?? this.data.cells[p.r][p.c].text;
    td.prepend(input); this.editor = { input, p, text };
    input.addEventListener("blur", () => this.commitCell());
    input.focus(); if (initial === undefined) input.select(); else input.setSelectionRange(input.value.length, input.value.length);
  }
  private commitCell(): void {
    if (!this.editor) return;
    const { input, p, text } = this.editor; this.editor = null;
    const value = input.value;
    this.history.change(t => { t.cells[p.r][p.c].text = value; });
    text.textContent = value; text.hidden = false;
    text.parentElement?.setAttribute("aria-label", `${colLabel(p.c)}${p.r + 1} ${value.slice(0, 120) || "空白"}`);
    input.remove(); this.updateStatus();
  }
  private undo(redo = false): void {
    if (this.busy) return;
    this.commitCell(); if (redo) this.history.redo(); else this.history.undo();
    this.clamp(); this.refresh(); this.focusCell();
  }
  private keydown(e: KeyboardEvent): void {
    if (this.busy || e.isComposing) return;
    const mod = e.metaKey || e.ctrlKey;
    if (this.editor) {
      if (e.key === "Tab" || (e.key === "Enter" && mod)) {
        e.preventDefault(); this.commitCell();
        if (e.key === "Tab") this.moveTab(e.shiftKey); else this.focusCell();
      }
      return;
    }
    // Row/column header activation has its own handler.
    if ((e.target as HTMLElement).closest("th") && ["Enter", " "].includes(e.key)) return;
    if (mod && e.key.toLowerCase() === "z") { e.preventDefault(); this.undo(e.shiftKey); return; }
    if (mod && e.key.toLowerCase() === "y") { e.preventDefault(); this.undo(true); return; }
    if (mod && e.key.toLowerCase() === "s") { e.preventDefault(); void this.save(); return; }
    if (mod && e.key.toLowerCase() === "a") {
      e.preventDefault(); this.anchor = { r: 0, c: 0 }; this.end = { r: this.data.cells.length - 1, c: this.data.columns.length - 1 }; this.paint(); this.drawPanel(); return;
    }
    if (e.key === "Enter" || e.key === "F2") { e.preventDefault(); this.startCell(); return; }
    if (e.key === "Tab") { e.preventDefault(); this.moveTab(e.shiftKey); return; }
    if (e.key === "Delete" || e.key === "Backspace") {
      e.preventDefault(); this.change(t => { for (const p of selected(t, this.area)) { t.cells[p.r][p.c].text = ""; t.cells[p.r][p.c].images = []; } }); this.focusCell(); return;
    }
    if (e.key.startsWith("Arrow")) {
      e.preventDefault(); const p = { ...(e.shiftKey ? this.end : this.anchor) }, cell = this.data.cells[p.r][p.c];
      if (e.key === "ArrowDown") p.r += e.shiftKey ? 1 : cell.rowspan;
      if (e.key === "ArrowUp") p.r--;
      if (e.key === "ArrowRight") p.c += e.shiftKey ? 1 : cell.colspan;
      if (e.key === "ArrowLeft") p.c--;
      p.r = Math.max(0, Math.min(p.r, this.data.cells.length - 1)); p.c = Math.max(0, Math.min(p.c, this.data.columns.length - 1));
      this.selectCell(p, e.shiftKey); this.td(p)?.scrollIntoView({ block: "nearest", inline: "nearest" }); return;
    }
    if (e.key.length === 1 && !mod && !e.altKey) { e.preventDefault(); this.startCell(this.anchor, e.key); }
  }
  private moveTab(back: boolean): void {
    const map = owners(this.data), list: Point[] = [];
    this.data.cells.forEach((row, r) => row.forEach((_, c) => { if (map[r][c].r === r && map[r][c].c === c) list.push({ r, c }); }));
    const owner = map[this.anchor.r][this.anchor.c], i = list.findIndex(p => p.r === owner.r && p.c === owner.c);
    const next = list[Math.max(0, Math.min(list.length - 1, i + (back ? -1 : 1)))];
    this.selectCell(next); this.td(next)?.scrollIntoView({ block: "nearest", inline: "nearest" });
  }
  private insertAxis(axis: "row" | "col", side: "before" | "after"): void {
    const area = this.area, active = owners(this.data)[this.anchor.r][this.anchor.c];
    const index = axis === "row"
      ? (side === "before" ? area.r0 : area.r1 + 1)
      : (side === "before" ? area.c0 : area.c1 + 1);
    let target: Point | null = null;
    const changed = this.change(t => changeAxis(t, axis, index), () => {
      target = axis === "row" ? { r: index, c: active.c } : { r: active.r, c: index };
      this.anchor = { ...target }; this.end = { ...target };
    });
    if (!changed || !target) return;
    this.focusCell(target); this.td(target)?.scrollIntoView({ block: "nearest", inline: "nearest" });
  }
  private reorderAxis(axis: Axis, from: number, count: number, boundary: number): void {
    const to = boundary > from ? boundary - count : boundary;
    if (to === from) return;
    const changed = this.change(t => moveAxis(t, axis, from, count, to), () => {
      if (axis === "row") {
        this.anchor = { r: to, c: 0 }; this.end = { r: to + count - 1, c: this.data.columns.length - 1 };
      } else {
        this.anchor = { r: 0, c: to }; this.end = { r: this.data.cells.length - 1, c: to + count - 1 };
      }
    });
    if (!changed) return;
    const header = this.axisHeader(axis, to);
    header?.focus({ preventScroll: true }); header?.scrollIntoView({ block: "nearest", inline: "nearest" });
  }
  private moveAxisStep(axis: Axis, direction: -1 | 1): void {
    const range = this.axisRange(axis);
    if (!range) { this.fail(new Error(axis === "row" ? "请先点击行号选择整行。" : "请先点击列标选择整列。")); return; }
    const n = axis === "row" ? this.data.cells.length : this.data.columns.length;
    if ((direction < 0 && range.from === 0) || (direction > 0 && range.from + range.count === n)) return;
    const boundary = direction < 0 ? range.from - 1 : range.from + range.count + 1;
    this.reorderAxis(axis, range.from, range.count, boundary);
  }
  private structureMenu(el?: HTMLElement, event?: MouseEvent): void {
    this.commitCell();
    const menu = new Menu(), area = this.area, rowRange = this.axisRange("row"), colRange = this.axisRange("col");
    const actions: [string, () => void][] = [];
    if (rowRange?.from) actions.push(["上移选中行", () => this.moveAxisStep("row", -1)]);
    if (rowRange && rowRange.from + rowRange.count < this.data.cells.length) actions.push(["下移选中行", () => this.moveAxisStep("row", 1)]);
    if (colRange?.from) actions.push(["左移选中列", () => this.moveAxisStep("col", -1)]);
    if (colRange && colRange.from + colRange.count < this.data.columns.length) actions.push(["右移选中列", () => this.moveAxisStep("col", 1)]);
    actions.push(
      ["在上方插入行", () => this.insertAxis("row", "before")],
      ["在下方插入行", () => this.insertAxis("row", "after")],
      ["在左侧插入列", () => this.insertAxis("col", "before")],
      ["在右侧插入列", () => this.insertAxis("col", "after")],
      ["删除选中行", () => this.change(t => changeAxis(t, "row", area.r0, area.r1 - area.r0 + 1))],
      ["删除选中列", () => this.change(t => changeAxis(t, "col", area.c0, area.c1 - area.c0 + 1))],
      ["合并选区", () => this.change(t => merge(t, area))],
      ["拆分选区", () => this.change(t => split(t, area))],
      ["清空内容（可撤销）", () => this.change(t => { for (const p of selected(t, area)) { t.cells[p.r][p.c].text = ""; t.cells[p.r][p.c].images = []; } })]
    );
    actions.forEach(([title, fn]) => menu.addItem(item => item.setTitle(title).onClick(fn)));
    if (event) menu.showAtMouseEvent(event);
    else { const box = el!.getBoundingClientRect(); menu.showAtPosition({ x: box.left, y: box.bottom }); }
  }
  private onPaste(e: ClipboardEvent): void {
    if (!e.clipboardData || this.busy) return;
    const files = [...e.clipboardData.files];
    if (files.length) { e.preventDefault(); void this.importImages(files); return; }
    const html = e.clipboardData.getData("text/html"), plain = e.clipboardData.getData("text/plain");
    if (this.editor && !/<table[\s>]/i.test(html) && !plain.includes("\t")) return;
    e.preventDefault();
    try { const fragment = fromClipboard(html, plain); this.change(t => paste(t, fragment, this.anchor)); this.focusCell(); }
    catch (error) { this.fail(error); }
  }
  private onCopy(e: ClipboardEvent): void {
    if (this.editor || !e.clipboardData) return;
    const area = this.area, sub = clone(this.data);
    sub.cells = sub.cells.slice(area.r0, area.r1 + 1).map(row => row.slice(area.c0, area.c1 + 1));
    sub.rowIds = sub.rowIds.slice(area.r0, area.r1 + 1); sub.columns = sub.columns.slice(area.c0, area.c1 + 1);
    e.preventDefault(); e.clipboardData.setData("text/plain", toTSV(sub));
    e.clipboardData.setData("text/html", renderTable(this.doc, sub).outerHTML);
  }
  private resize(event: PointerEvent, c: number, th: HTMLElement): void {
    if (this.busy) return;
    event.preventDefault(); event.stopPropagation(); this.commitCell(); this.dragCleanup?.();
    const start = event.clientX, original = this.data.columns[c].width;
    const table = th.closest("table")!, col = table.querySelectorAll("col")[c + 1] as HTMLTableColElement;
    const total = this.data.columns.reduce((n, x) => n + x.width, 44);
    let width = original;
    const move = (e: PointerEvent) => {
      width = Math.max(60, Math.min(1000, Math.round(original + e.clientX - start)));
      col.style.width = `${width}px`; table.style.width = `${total + width - original}px`;
    };
    const cleanup = () => {
      this.doc.removeEventListener("pointermove", move); this.doc.removeEventListener("pointerup", end); this.doc.removeEventListener("pointercancel", cancel);
      this.dragCleanup = undefined;
    };
    const end = () => { cleanup(); this.change(t => t.columns[c].width = width); };
    const cancel = () => { cleanup(); this.refresh(); };
    this.dragCleanup = cleanup;
    this.doc.addEventListener("pointermove", move); this.doc.addEventListener("pointerup", end, { once: true }); this.doc.addEventListener("pointercancel", cancel, { once: true });
  }
  private pickImage(): void {
    this.commitCell();
    const input = element(this.doc, "input"); input.type = "file"; input.accept = "image/png,image/jpeg,image/webp,image/gif"; input.multiple = true;
    input.addEventListener("change", () => { void this.importImages([...input.files || []]); }); input.click();
  }
  private async importImages(files: File[]): Promise<void> {
    if (this.busy) return;
    this.commitCell(); const p = owners(this.data)[this.anchor.r][this.anchor.c];
    if (this.data.cells[p.r][p.c].images.length + files.length > 100) { this.fail(new Error("每个单元格最多 100 张图片。")); return; }
    this.busy = true; this.contentEl.inert = true; this.status.textContent = "正在保存图片到附件目录…";
    try {
      const imported: Picture[] = [];
      for (const f of files) imported.push(await this.storage.importImage(f));
      this.history.change(t => t.cells[p.r][p.c].images.push(...imported)); this.refresh();
    } catch (error) { this.fail(error); }
    finally { this.busy = false; this.contentEl.inert = false; }
  }
  private exportMenu(el: HTMLElement): void {
    this.commitCell();
    const menu = new Menu();
    const name = (this.data.title || "表格").replace(/[\\/:*?"<>|]/g, "-").slice(0, 80);
    menu.addItem(item => item.setTitle("导出 HTML（保留格式）").onClick(() => download(this.doc, `${name}.html`, toHTML(this.doc, this.data), "text/html")));
    menu.addItem(item => item.setTitle("导出 Markdown（去样式，合并内容放左上格）").onClick(() => download(this.doc, `${name}.md`, toMarkdown(this.data), "text/markdown")));
    menu.addItem(item => item.setTitle("导出 JSON（完整保留草稿）").onClick(() => download(this.doc, `${name}.json`, serialize(this.data), "application/json")));
    const box = el.getBoundingClientRect(); menu.showAtPosition({ x: box.left, y: box.bottom });
  }
  private async save(): Promise<void> {
    if (this.busy) return;
    this.commitCell();
    this.busy = true; this.contentEl.inert = true; this.status.textContent = "正在保存…";
    try {
      const table = parse(serialize(this.data)); await this.storage.save(table);
      this.allowClose = true; this.busy = false; super.close(); new Notice("富表格已保存");
    } catch (error) { this.fail(error); }
    finally { this.busy = false; this.contentEl.inert = false; }
  }
  close(): void {
    if (this.allowClose) { super.close(); return; }
    if (this.busy) { new Notice("操作进行中，请稍候。"); return; }
    this.commitCell();
    if (serialize(this.data) === this.initial) { super.close(); return; }
    if (this.closingPrompt) return;
    this.closingPrompt = true;
    const confirm = new ConfirmClose(this.app, choice => {
      if (choice === "save") void this.save();
      else { this.allowClose = true; super.close(); }
    });
    confirm.onClose = () => { this.closingPrompt = false; };
    confirm.open();
  }
  onClose(): void { this.dragCleanup?.(); this.selectionDragCleanup?.(); this.contentEl.replaceChildren(); }
}
