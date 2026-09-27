import test from "node:test";
import assert from "node:assert/strict";
import { buildSync } from "esbuild";
import { JSDOM } from "jsdom";
import vm from "node:vm";
import { createTable, serialize } from "../src/model";

const compiled = buildSync({ entryPoints: ["src/editor.ts"], bundle: true, external: ["obsidian"], format: "cjs", platform: "node", write: false }).outputFiles[0].text;
function setup(saveError = false) {
  const dom = new JSDOM("<body></body>", { pretendToBeVisual: true }), doc = dom.window.document;
  const notices: string[] = [], saves: any[] = [], modals: any[] = [], menus: any[] = [];
  dom.window.HTMLElement.prototype.scrollIntoView = function () {};
  class Modal {
    app: unknown; scope = { register() {} };
    modalEl = doc.createElement("section"); contentEl = doc.createElement("div");
    constructor(app: unknown) { this.app = app; this.modalEl.append(this.contentEl); modals.push(this); }
    setTitle() {}
    open() { doc.body.append(this.modalEl); this.onOpen(); }
    close() { this.onClose(); this.modalEl.remove(); }
    onOpen() {}
    onClose() {}
  }
  class Notice { constructor(text: string) { notices.push(text); } }
  class Menu {
    items: { title: string; action: () => void }[] = [];
    constructor() { menus.push(this); }
    addItem(configure: (item: any) => void) {
      const value = { title: "", action: () => {} };
      const item = {
        setTitle: (title: string) => { value.title = title; return item; },
        onClick: (action: () => void) => { value.action = action; return item; }
      };
      configure(item); this.items.push(value); return this;
    }
    showAtPosition() {}
    showAtMouseEvent() {}
  }
  const setIcon = (parent: HTMLElement, name: string) => {
    const icon = doc.createElement("span"); icon.dataset.icon = name; parent.replaceChildren(icon);
  };
  const module = { exports: {} as any };
  vm.runInNewContext(compiled, {
    module, exports: module.exports, require: () => ({ Modal, Notice, Menu, setIcon }),
    structuredClone, crypto, DOMParser: dom.window.DOMParser, setTimeout, URL, Blob
  });
  const initial = createTable(3, 3);
  initial.cells[0][0].text = "原始"; initial.cells[0][1].text = "第二格";
  const storage = { image: () => null, async save(t: any) { if (saveError) throw new Error("冲突：拒绝覆盖"); saves.push(t); } };
  const editor = new module.exports.TableEditor({}, initial, storage); editor.open();
  const click = (label: string, root = doc.body) => {
    const button = [...root.querySelectorAll("button")].find(b => b.textContent === label || b.getAttribute("aria-label") === label);
    assert.ok(button, `missing button: ${label}`); button.click();
  };
  const clickMenu = (label: string) => {
    const item = menus.at(-1)?.items.find((entry: any) => entry.title === label);
    assert.ok(item, `missing menu item: ${label}`); item.action();
  };
  const cell = (r = 0, c = 0) => doc.querySelector<HTMLElement>(`td[data-row="${r}"][data-col="${c}"]`)!;
  const rowHeader = (r: number) => doc.querySelector<HTMLElement>(`tbody th[data-row="${r}"]`)!;
  const columnHeader = (c: number) => doc.querySelector<HTMLElement>(`thead th[data-col="${c}"]`)!;
  const key = (target: HTMLElement, key: string, options: object = {}) => target.dispatchEvent(new dom.window.KeyboardEvent("keydown", { key, bubbles: true, cancelable: true, ...options }));
  const pointer = (target: EventTarget, type: string, pointerId = 1) => {
    const event = new dom.window.MouseEvent(type, { button: 0, bubbles: true, cancelable: true });
    Object.defineProperty(event, "pointerId", { value: pointerId });
    target.dispatchEvent(event);
  };
  const dragAxis = (source: HTMLElement, target: HTMLElement, axis: "row" | "col", after = true, onOver?: () => void) => {
    const dataTransfer = { effectAllowed: "", dropEffect: "", setData() {} };
    Object.defineProperty(target, "getBoundingClientRect", {
      configurable: true,
      value: () => ({ top: 0, left: 0, width: 40, height: 40, right: 40, bottom: 40, x: 0, y: 0, toJSON() {} })
    });
    const dispatch = (node: HTMLElement, type: string) => {
      const event = new dom.window.MouseEvent(type, {
        bubbles: true, cancelable: true,
        clientX: axis === "col" && after ? 30 : 10,
        clientY: axis === "row" && after ? 30 : 10
      });
      Object.defineProperty(event, "dataTransfer", { value: dataTransfer });
      node.dispatchEvent(event);
    };
    dispatch(source, "dragstart"); dispatch(target, "dragover"); onOver?.(); dispatch(target, "drop"); dispatch(source, "dragend"); dispatch(target, "click");
  };
  const start = () => { cell().click(); key(cell(), "Enter"); return doc.querySelector<HTMLTextAreaElement>("textarea")!; };
  return { dom, doc, editor, initial, saves, notices, modals, menus, click, clickMenu, cell, rowHeader, columnHeader, key, pointer, dragAxis, start };
}
test("cell text commit, Tab navigation and native focus survive DOM replacement", () => {
  const h = setup(), input = h.start(); input.value = "中文\n换行";
  h.key(input, "Tab");
  assert.equal(h.editor.data.cells[0][0].text, "中文\n换行");
  assert.equal(h.doc.activeElement, h.cell(0, 1));
  assert.equal(h.doc.querySelector("textarea"), null);
  assert.equal(h.saves.length, 0);
});
test("editor actions use compact icon controls and consistent toolbar groups", () => {
  const h = setup(), groups = h.doc.querySelectorAll(".rt-toolbar .rt-tool-group");
  assert.equal(groups.length, 3);
  assert.equal(h.doc.querySelectorAll(".rt-toolbar .rt-toolbar-action").length, 8);
  assert.equal(h.doc.querySelectorAll(".rt-toolbar .rt-button-icon").length, 8);
  assert.equal(h.doc.querySelector('button[aria-label="撤销"]')?.textContent, "");
  assert.equal(h.doc.querySelector('button[aria-label="更多"]')?.textContent, "");
  assert.equal(h.doc.querySelectorAll(".rt-heading .rt-action-button .rt-button-icon").length, 2);
});
test("composition keystrokes do not move selection or truncate text", () => {
  const h = setup(), input = h.start(); input.value = "中文输入";
  h.key(input, "Enter", { isComposing: true }); h.key(input, "Tab", { isComposing: true });
  assert.equal(h.doc.querySelector("textarea"), input);
  h.key(input, "Escape"); assert.equal(h.editor.data.cells[0][0].text, "中文输入");
  assert.equal(h.doc.querySelectorAll("section").length, 1);
});
test("range selection and merge/split retain content, undo restores originals", () => {
  const h = setup(); h.cell().click(); h.key(h.cell(), "ArrowRight", { shiftKey: true });
  h.click("合并"); assert.equal(h.cell().getAttribute("colspan"), "2");
  assert.equal(h.editor.data.cells[0][0].text, "原始\n第二格");
  h.click("撤销"); assert.equal(h.editor.data.cells[0][1].text, "第二格");
  h.click("重做"); h.click("拆分");
  assert.equal(h.cell().getAttribute("colspan"), "1");
});
test("mouse drag selects a rectangle and toolbar controls merge and split", () => {
  const h = setup();
  h.pointer(h.cell(0, 0), "pointerdown");
  h.pointer(h.cell(1, 1), "pointerover");
  h.pointer(h.doc, "pointerup");
  assert.equal(h.doc.querySelectorAll("td.rt-selected").length, 4);
  assert.match(h.doc.querySelector(".rt-count")!.textContent!, /A1 : B2/);
  assert.equal(h.cell(0, 0).getAttribute("rowspan"), "1");
  h.click("合并");
  assert.equal(h.cell(0, 0).getAttribute("rowspan"), "2");
  assert.equal(h.cell(0, 0).getAttribute("colspan"), "2");
  h.click("拆分");
  assert.equal(h.cell(0, 0).getAttribute("rowspan"), "1");
  assert.equal(h.cell(0, 0).getAttribute("colspan"), "1");
});
test("visible row and column actions insert after the active cell and select the addition", () => {
  const h = setup(), rowIds = [...h.editor.data.rowIds], columnIds = h.editor.data.columns.map((column: any) => column.id);
  h.cell(1, 1).click(); h.click("新增行");
  assert.equal(h.editor.data.cells.length, 4);
  assert.deepEqual(h.editor.data.rowIds.filter((_: string, index: number) => index !== 2), rowIds);
  assert.equal(h.doc.querySelector("td.rt-selected")?.getAttribute("data-row"), "2");
  assert.match(h.doc.querySelector(".rt-count")!.textContent!, /B3 · 4 行 × 3 列/);
  h.click("新增列");
  assert.equal(h.editor.data.columns.length, 4);
  assert.deepEqual(h.editor.data.columns.filter((_: any, index: number) => index !== 2).map((column: any) => column.id), columnIds);
  assert.equal(h.doc.querySelector("td.rt-selected")?.getAttribute("data-col"), "2");
  assert.match(h.doc.querySelector(".rt-count")!.textContent!, /C3 · 4 行 × 4 列/);
  h.click("撤销"); h.click("撤销");
  assert.equal(JSON.stringify(h.editor.data.rowIds), JSON.stringify(rowIds));
  assert.equal(JSON.stringify(h.editor.data.columns.map((column: any) => column.id)), JSON.stringify(columnIds));
});
test("more actions insert above and left of the selected cell", () => {
  const h = setup(), rowId = h.editor.data.rowIds[1], columnId = h.editor.data.columns[1].id;
  h.cell(1, 1).click(); h.click("更多"); h.clickMenu("在上方插入行");
  assert.equal(h.editor.data.rowIds[2], rowId);
  assert.match(h.doc.querySelector(".rt-count")!.textContent!, /B2 · 4 行 × 3 列/);
  h.click("更多"); h.clickMenu("在左侧插入列");
  assert.equal(h.editor.data.columns[2].id, columnId);
  assert.match(h.doc.querySelector(".rt-count")!.textContent!, /B2 · 4 行 × 4 列/);
});
test("row headers support contiguous selection and vertical drag reordering", () => {
  const h = setup(), ids = [...h.editor.data.rowIds];
  h.rowHeader(0).click();
  h.rowHeader(1).dispatchEvent(new h.dom.window.MouseEvent("click", { bubbles: true, shiftKey: true }));
  assert.equal(h.doc.querySelectorAll("tbody th.rt-axis-selected").length, 2);
  h.dragAxis(h.rowHeader(0), h.rowHeader(2), "row", true, () => {
    assert.equal(h.doc.querySelectorAll("tr.rt-drop-after").length, 1);
  });
  assert.equal(JSON.stringify(h.editor.data.rowIds), JSON.stringify([ids[2], ids[0], ids[1]]));
  assert.equal(h.doc.querySelectorAll("tbody th.rt-axis-selected").length, 2);
  assert.match(h.doc.querySelector(".rt-count")!.textContent!, /A2 : C3/);
  h.click("撤销");
  assert.equal(JSON.stringify(h.editor.data.rowIds), JSON.stringify(ids));
});
test("column headers drag horizontally and keep widths with their columns", () => {
  const h = setup(), columns = h.editor.data.columns.map((column: any) => ({ ...column }));
  h.editor.data.columns.forEach((column: any, index: number) => column.width = 120 + index);
  h.columnHeader(0).click();
  h.dragAxis(h.columnHeader(0), h.columnHeader(2), "col", true, () => {
    assert.ok(h.doc.querySelectorAll(".rt-drop-right").length >= 1);
  });
  assert.equal(JSON.stringify(h.editor.data.columns), JSON.stringify([columns[1], columns[2], columns[0]].map((column, index) => ({ ...column, width: index === 0 ? 121 : index === 1 ? 122 : 120 }))));
  assert.equal(h.doc.querySelector("thead th.rt-axis-selected")?.getAttribute("data-col"), "2");
  assert.match(h.doc.querySelector(".rt-count")!.textContent!, /C1 : C3/);
});
test("selected axes can move from the menu and keyboard without dragging", () => {
  const h = setup(), rowIds = [...h.editor.data.rowIds], columnIds = h.editor.data.columns.map((column: any) => column.id);
  h.rowHeader(1).click(); h.click("更多"); h.clickMenu("上移选中行");
  assert.equal(JSON.stringify(h.editor.data.rowIds), JSON.stringify([rowIds[1], rowIds[0], rowIds[2]]));
  h.key(h.rowHeader(0), "ArrowDown", { altKey: true });
  assert.equal(JSON.stringify(h.editor.data.rowIds), JSON.stringify(rowIds));
  h.columnHeader(1).click(); h.click("更多"); h.clickMenu("右移选中列");
  assert.equal(JSON.stringify(h.editor.data.columns.map((column: any) => column.id)), JSON.stringify([columnIds[0], columnIds[2], columnIds[1]]));
  h.key(h.columnHeader(2), "ArrowLeft", { altKey: true });
  assert.equal(JSON.stringify(h.editor.data.columns.map((column: any) => column.id)), JSON.stringify(columnIds));
});
test("template change and local formats survive commit and reopen data", () => {
  const h = setup(); h.click("彩色表头"); h.click("斜体");
  assert.equal(h.editor.data.template, "header"); assert.equal(h.editor.data.cells[0][0].style.italic, true);
  h.click("学术三线表"); assert.equal(h.editor.data.cells[0][0].style.italic, true);
});
test("closing dirty editor allows continue and discard without persistence", () => {
  const h = setup(), input = h.start(); input.value = "未保存";
  h.editor.close(); assert.equal(h.modals.length, 2);
  assert.ok(h.doc.querySelector(".rt-confirm-modal.rt-root"));
  assert.equal(h.doc.querySelector(".rt-confirm-message")?.textContent, "关闭前保存这次修改；放弃后将无法恢复。");
  assert.deepEqual([...h.doc.querySelectorAll(".rt-confirm-actions button")].map(button => button.textContent), ["放弃修改", "继续编辑", "保存并关闭"]);
  assert.ok(h.doc.querySelector(".rt-confirm-discard"));
  h.click("继续编辑"); assert.equal(h.doc.querySelectorAll("section").length, 1);
  h.editor.close(); h.click("放弃修改"); assert.equal(h.doc.querySelectorAll("section").length, 0); assert.equal(h.saves.length, 0);
});
test("save includes active cell input and closes only after successful persistence", async () => {
  const h = setup(), input = h.start(); input.value = "保存值"; h.click("保存并关闭");
  await new Promise<void>(resolve => setImmediate(resolve));
  assert.equal(h.saves[0].cells[0][0].text, "保存值");
  assert.equal(h.doc.querySelectorAll("section").length, 0);
});
test("save conflict leaves the draft and editor available", async () => {
  const h = setup(true), input = h.start(); input.value = "保留草稿"; h.click("保存并关闭");
  await new Promise<void>(resolve => setImmediate(resolve));
  assert.equal(h.editor.data.cells[0][0].text, "保留草稿");
  assert.equal(h.doc.querySelectorAll("section").length, 1);
  assert.match(h.notices[0], /拒绝覆盖/);
  assert.equal(h.editor.contentEl.inert, false);
});
test("clipboard event pastes spreadsheet region and produces one undo step", () => {
  const h = setup(), before = serialize(h.editor.data);
  const event = new h.dom.window.Event("paste", { bubbles: true, cancelable: true });
  Object.defineProperty(event, "clipboardData", { value: { files: [], getData: (type: string) => type === "text/plain" ? "001\t甲\n002\t乙" : "" } });
  h.cell().dispatchEvent(event);
  assert.equal(h.editor.data.cells[1][1].text, "乙"); assert.equal(h.editor.data.cells[0][0].text, "001");
  h.click("撤销"); assert.equal(serialize(h.editor.data), before);
});
