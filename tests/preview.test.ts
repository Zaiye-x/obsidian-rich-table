import test from "node:test";
import assert from "node:assert/strict";
import { buildSync } from "esbuild";
import { JSDOM } from "jsdom";
import vm from "node:vm";
import { createTable } from "../src/model";

const compiled = buildSync({
  entryPoints: ["src/preview.ts"], bundle: true, external: ["obsidian"],
  format: "cjs", platform: "node", write: false
}).outputFiles[0].text;

test("preview edit action stays clear of host controls and does not bubble", () => {
  const dom = new JSDOM("<main><div id='preview'></div></main>"), doc = dom.window.document;
  const module = { exports: {} as any };
  const setIcon = (parent: HTMLElement, name: string) => {
    const icon = doc.createElement("span"); icon.dataset.icon = name; parent.replaceChildren(icon);
  };
  vm.runInNewContext(compiled, { module, exports: module.exports, require: () => ({ setIcon }) });
  const preview = doc.querySelector<HTMLElement>("#preview")!, table = createTable(2, 2);
  table.title = "季度经营概览";
  const bubbled = { pointerdown: 0, mousedown: 0, click: 0 };
  for (const type of Object.keys(bubbled) as (keyof typeof bubbled)[])
    preview.addEventListener(type, () => bubbled[type]++);
  let edits = 0;
  module.exports.renderPreview(preview, table, () => null, () => edits++);
  const heading = preview.querySelector(".rt-preview-heading")!, edit = preview.querySelector<HTMLButtonElement>(".rt-edit-button")!;
  assert.equal(heading.firstElementChild?.textContent, "季度经营概览");
  assert.equal(edit.textContent, "编辑表格");
  assert.equal(edit.getAttribute("aria-label"), "编辑表格");
  assert.ok(edit.querySelector("[data-icon='pencil']"));
  assert.equal(edit.querySelector(".rt-button-icon")?.getAttribute("aria-hidden"), "true");
  for (const type of Object.keys(bubbled)) edit.dispatchEvent(new dom.window.MouseEvent(type, { bubbles: true }));
  assert.deepEqual(bubbled, { pointerdown: 0, mousedown: 0, click: 0 });
  assert.equal(edits, 1);
});
