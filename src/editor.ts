import { App, Menu, Modal, Notice, setIcon } from "obsidian";
import { changeAxis, clone, expandedRect, History, merge, owners, parse, paste, Picture, Point, rect, Rect, selected, serialize, split, TableData } from "./model";
import { fromClipboard, toMarkdown, toTSV } from "./clipboard";
import { colLabel, element, renderTable, toHTML } from "./renderer";
import { NoteStorage } from "./storage";
import { PanelHost, renderPanel, Scope } from "./panel";
import { button, download, field } from "./ui";

function toolbarAction(parent: HTMLElement, iconName: string, label: string, title: string, action: () => void): HTMLButtonElement {
  const control = button(parent, label, action, "rt-toolbar-action");
  const icon = element(parent.ownerDocument, "span", "rt-button-icon");
  icon.setAttribute("aria-hidden", "true"); setIcon(icon, iconName);
  control.prepend(icon); control.title = title;
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
    button(actions, "导出", () => this.exportMenu(actions));
    button(actions, "保存并关闭", () => void this.save(), "mod-cta");
    top.append(actions); root.append(top);
    const toolbar = element(this.doc, "div", "rt-toolbar");
    this.undoButton = button(toolbar, "撤销", () => this.undo());
    this.undoButton.title = "⌘/Ctrl Z（单元格编辑完成后）";
    this.redoButton = button(toolbar, "重做", () => this.undo(true));
    const structure = element(this.doc, "div", "rt-structure-actions");
    toolbarAction(structure, "rows-3", "新增行", "在当前选区下方新增一行", () => this.insertAxis("row", "after"));
    toolbarAction(structure, "columns-3", "新增列", "在当前选区右侧新增一列", () => this.insertAxis("col", "after"));
    let moreButton!: HTMLButtonElement;
    moreButton = toolbarAction(structure, "ellipsis", "更多", "更多行列操作", () => this.structureMenu(moreButton));
    toolbar.append(structure);
    button(toolbar, "合并", () => this.change(t => merge(t, this.area)));
    button(toolbar, "拆分", () => this.change(t => split(t, this.area)));
    button(toolbar, "插入图片", () => this.pickImage());
    this.count = element(this.doc, "span", "rt-count"); toolbar.append(this.count); root.append(toolbar);
    const body = element(this.doc, "div", "rt-editor-body");
    this.grid = element(this.doc, "div", "rt-grid-wrap"); this.grid.tabIndex = -1;
    this.panel = element(this.doc, "aside", "rt-panel"); this.panel.setAttribute("aria-label", "表格样式设置");
    body.append(this.grid, this.panel); root.append(body);
    const foot = element(this.doc, "div", "rt-footer");
    foot.append(element(this.doc, "span", "rt-hint", "按住鼠标拖动框选 · 双击或 Enter 编辑 · Tab 换格 · 可粘贴 Excel 或拖入图片"));
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
        th.tabIndex = 0; th.setAttribute("aria-label", `选择第 ${r + 1} 行`);
        const choose = () => { this.commitCell(); this.anchor = { r, c: 0 }; this.end = { r, c: this.data.columns.length - 1 }; this.paint(); this.drawPanel(); };
        th.addEventListener("click", choose);
        th.addEventListener("keydown", e => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); choose(); } });
      },
      onColumn: (th, c) => {
        th.tabIndex = 0; th.setAttribute("aria-label", `选择 ${colLabel(c)} 列`);
        const choose = () => { this.commitCell(); this.anchor = { r: 0, c }; this.end = { r: this.data.cells.length - 1, c }; this.paint(); this.drawPanel(); };
        th.addEventListener("click", choose);
        th.addEventListener("keydown", e => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); choose(); } });
        const handle = element(this.doc, "span", "rt-resize"); handle.setAttribute("aria-hidden", "true");
        handle.addEventListener("click", e => e.stopPropagation());
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
  private structureMenu(el?: HTMLElement, event?: MouseEvent): void {
    this.commitCell();
    const menu = new Menu(), area = this.area;
    const actions: [string, () => void][] = [
      ["在上方插入行", () => this.insertAxis("row", "before")],
      ["在下方插入行", () => this.insertAxis("row", "after")],
      ["在左侧插入列", () => this.insertAxis("col", "before")],
      ["在右侧插入列", () => this.insertAxis("col", "after")],
      ["删除选中行", () => this.change(t => changeAxis(t, "row", area.r0, area.r1 - area.r0 + 1))],
      ["删除选中列", () => this.change(t => changeAxis(t, "col", area.c0, area.c1 - area.c0 + 1))],
      ["合并选区", () => this.change(t => merge(t, area))],
      ["拆分选区", () => this.change(t => split(t, area))],
      ["清空内容（可撤销）", () => this.change(t => { for (const p of selected(t, area)) { t.cells[p.r][p.c].text = ""; t.cells[p.r][p.c].images = []; } })]
    ];
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
