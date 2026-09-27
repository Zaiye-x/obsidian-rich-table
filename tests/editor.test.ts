import test from "node:test";
import assert from "node:assert/strict";
import { buildSync } from "esbuild";
import { JSDOM } from "jsdom";
import vm from "node:vm";
import { createTable, serialize } from "../src/model";

const compiled = buildSync({ entryPoints: ["src/editor.ts"], bundle: true, external: ["obsidian"], format: "cjs", platform: "node", write: false }).outputFiles[0].text;
function setup(saveError = false) {
  const dom = new JSDOM("<body></body>", { pretendToBeVisual: true }), doc = dom.window.document;
  const notices: string[] = [], saves: any[] = [], modals: any[] = [];
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
  const module = { exports: {} as any };
  vm.runInNewContext(compiled, {
    module, exports: module.exports, require: () => ({ Modal, Notice, Menu: class {} }),
    structuredClone, crypto, DOMParser: dom.window.DOMParser, setTimeout, URL, Blob
  });
  const initial = createTable(3, 3);
  initial.cells[0][0].text = "原始"; initial.cells[0][1].text = "第二格";
  const storage = { image: () => null, async save(t: any) { if (saveError) throw new Error("冲突：拒绝覆盖"); saves.push(t); } };
  const editor = new module.exports.TableEditor({}, initial, storage); editor.open();
  const click = (label: string, root = doc.body) => {
    const button = [...root.querySelectorAll("button")].find(b => b.textContent === label);
    assert.ok(button, `missing button: ${label}`); button.click();
  };
  const cell = (r = 0, c = 0) => doc.querySelector<HTMLElement>(`td[data-row="${r}"][data-col="${c}"]`)!;
  const key = (target: HTMLElement, key: string, options: object = {}) => target.dispatchEvent(new dom.window.KeyboardEvent("keydown", { key, bubbles: true, cancelable: true, ...options }));
  const pointer = (target: EventTarget, type: string, pointerId = 1) => {
    const event = new dom.window.MouseEvent(type, { button: 0, bubbles: true, cancelable: true });
    Object.defineProperty(event, "pointerId", { value: pointerId });
    target.dispatchEvent(event);
  };
  const start = () => { cell().click(); key(cell(), "Enter"); return doc.querySelector<HTMLTextAreaElement>("textarea")!; };
  return { dom, doc, editor, initial, saves, notices, modals, click, cell, key, pointer, start };
}
test("cell text commit, Tab navigation and native focus survive DOM replacement", () => {
  const h = setup(), input = h.start(); input.value = "中文\n换行";
  h.key(input, "Tab");
  assert.equal(h.editor.data.cells[0][0].text, "中文\n换行");
  assert.equal(h.doc.activeElement, h.cell(0, 1));
  assert.equal(h.doc.querySelector("textarea"), null);
  assert.equal(h.saves.length, 0);
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
test("template change and local formats survive commit and reopen data", () => {
  const h = setup(); h.click("彩色表头"); h.click("斜体");
  assert.equal(h.editor.data.template, "header"); assert.equal(h.editor.data.cells[0][0].style.italic, true);
  h.click("学术三线表"); assert.equal(h.editor.data.cells[0][0].style.italic, true);
});
test("closing dirty editor allows continue and discard without persistence", () => {
  const h = setup(), input = h.start(); input.value = "未保存";
  h.editor.close(); assert.equal(h.modals.length, 2);
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
