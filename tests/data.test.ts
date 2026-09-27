import test from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import { changeAxis, clone, createTable, expandedRect, History, merge, owners, parse, paste, rect, serialize, split } from "../src/model";
import { fromClipboard, parseTSV, toMarkdown, toTSV } from "../src/clipboard";
import { blocks, locate, replaceBlock } from "../src/source";
import { renderTable, toHTML } from "../src/renderer";
import { cellStyle } from "../src/templates";
import { matchRichTableSlash } from "../src/slash-match";
const dom = new JSDOM("");
Object.assign(globalThis, { DOMParser: dom.window.DOMParser });
const doc = dom.window.document;

test("serialization retains literal markup, Unicode, multiline, zeroes and images", () => {
  const t = createTable(2, 2); t.cells[0][0].text = "0012\n中文 <script>alert(1)</script>";
  t.cells[1][1].images.push({ path: "附件/a.png", alt: "例图", width: 120 });
  assert.deepEqual(parse(serialize(t)), t);
  const el = renderTable(doc, t);
  assert.equal(el.querySelector("script"), null);
  assert.match(el.textContent!, /<script>/);
});
test("reject unsupported versions, malformed grids and unsafe paths", () => {
  for (const update of [
    (t: any) => t.schemaVersion = 2,
    (t: any) => t.cells[0].pop(),
    (t: any) => t.cells[0][0].rowspan = 300,
    (t: any) => t.cells[0][0].rowspan = 1.5,
    (t: any) => t.cells[0][0].images.push({ path: "../outside.png", width: 100, alt: "" }),
    (t: any) => t.style.background = "url(javascript:alert(1))",
    (t: any) => t.rowIds[1] = t.rowIds[0]
  ]) { const t = createTable(2, 2); update(t); assert.throws(() => parse(serialize(t))); }
});
test("merge retains all text and pictures in row-major order; split does not duplicate", () => {
  const t = createTable(3, 3);
  t.cells[0][0].text = "甲"; t.cells[0][1].text = "乙"; t.cells[1][0].text = "丙";
  t.cells[1][1].images.push({ path: "image.png", alt: "", width: 100 });
  merge(t, { r0: 0, c0: 0, r1: 1, c1: 1 });
  assert.equal(t.cells[0][0].text, "甲\n乙\n丙"); assert.equal(t.cells[0][0].images.length, 1);
  assert.deepEqual(owners(t)[1][1], { r: 0, c: 0 });
  split(t, rect({ r: 1, c: 1 }));
  assert.equal(t.cells[0][0].rowspan, 1); assert.equal(t.cells[1][1].images.length, 0);
});
test("partially selected merges expand to include their whole area", () => {
  const t = createTable(4, 4); merge(t, { r0: 0, c0: 1, r1: 2, c1: 2 });
  assert.deepEqual(expandedRect(t, rect({ r: 1, c: 1 })), { r0: 0, c0: 1, r1: 2, c1: 2 });
});
test("oversized merges reject before modifying any source cell", () => {
  for (const kind of ["text", "images"]) {
    const t = createTable(1, 2);
    for (const cell of t.cells[0]) {
      if (kind === "text") cell.text = "字".repeat(100000);
      else cell.images = Array.from({ length: 51 }, () => ({ path: "a.png", alt: "", width: 100 }));
    }
    const before = serialize(t);
    assert.throws(() => merge(t, { r0: 0, c0: 0, r1: 0, c1: 1 }), /单格上限/);
    assert.equal(serialize(t), before);
    assert.doesNotThrow(() => parse(before));
  }
});
test("color validation accepts CSS hex lengths and rejects invalid lengths", () => {
  const t = createTable(1, 1);
  for (const value of ["#abc", "#abcd", "#ABCDEF", "#abcdef80"]) {
    t.style.color = value; assert.equal(parse(serialize(t)).style.color, value);
  }
  for (const value of ["#ab", "#abcde", "#abcdef0", "#abcdef000"]) {
    t.style.color = value; assert.throws(() => parse(serialize(t)), /颜色/);
  }
});
test("deleting a merged anchor row retains content in surviving row", () => {
  const t = createTable(4, 3); t.cells[0][0].text = "保留"; merge(t, { r0: 0, c0: 0, r1: 2, c1: 1 });
  changeAxis(t, "row", 0, 1);
  assert.equal(t.cells[0][0].text, "保留"); assert.equal(t.cells[0][0].rowspan, 2);
  assert.deepEqual(owners(t)[1][1], { r: 0, c: 0 });
});
test("deleting a merged anchor column retains text and span", () => {
  const t = createTable(3, 4); t.cells[1][0].text = "保留"; merge(t, { r0: 1, c0: 0, r1: 2, c1: 2 });
  changeAxis(t, "col", 0, 1);
  assert.equal(t.cells[1][0].text, "保留"); assert.equal(t.cells[1][0].colspan, 2); owners(t);
});
test("insertion inside a merge expands it while adjacent insertion shifts anchors", () => {
  const t = createTable(3, 3); t.cells[0][0].text = "x"; merge(t, { r0: 0, c0: 0, r1: 1, c1: 1 });
  changeAxis(t, "row", 1); changeAxis(t, "col", 1);
  assert.equal(t.cells[0][0].rowspan, 3); assert.equal(t.cells[0][0].colspan, 3);
  changeAxis(t, "row", 0); assert.equal(t.cells[1][0].text, "x"); owners(t);
});
test("last row/column cannot be removed, and maximum dimensions are enforced", () => {
  const t = createTable(1, 1);
  assert.throws(() => changeAxis(t, "row", 0, 1)); assert.equal(t.cells.length, 1);
  assert.throws(() => createTable(201, 2)); assert.throws(() => createTable(2, 51));
});
test("TSV handles quoted multiline text, escaped quotes, empty values and leading zeroes", () => {
  assert.deepEqual(parseTSV('001\t"两行\n文本"\t"有""引号"\r\n\t\t'), [["001", "两行\n文本", '有"引号'], ["", "", ""]]);
  const t = fromClipboard("", '001\t"两行\n文本"\n\t末行\t');
  assert.deepEqual(fromClipboard("", toTSV(t)).cells.map(r => r.map(c => c.text)), t.cells.map(r => r.map(c => c.text)));
});
test("slash command triggers at line start or after whitespace", () => {
  assert.deepEqual(matchRichTableSlash("/", 1), { startCh: 0, query: "" });
  assert.deepEqual(matchRichTableSlash("正文 /表格", 6), { startCh: 3, query: "表格" });
  assert.deepEqual(matchRichTableSlash("  /rt", 5), { startCh: 2, query: "rt" });
});
test("slash command ignores URLs, paths and stale cursor positions", () => {
  assert.equal(matchRichTableSlash("https://example.com", 8), null);
  assert.equal(matchRichTableSlash("folder/table", 12), null);
  assert.equal(matchRichTableSlash("正文/", 3), null);
  assert.equal(matchRichTableSlash("/", 2), null);
});
test("slash command stops at whitespace and limits query length", () => {
  assert.equal(matchRichTableSlash("/表格 后续", 6), null);
  assert.equal(matchRichTableSlash("/" + "a".repeat(21), 22), null);
});
test("HTML spreadsheet paste keeps rowspans, empty cells, line breaks and drops scripts", () => {
  const t = fromClipboard('<table><tr><td rowspan="2">001</td><td>甲<br>乙<script>bad()</script></td></tr><tr><td></td></tr></table>', "");
  assert.equal(t.cells[0][0].rowspan, 2); assert.equal(t.cells[0][1].text, "甲\n乙");
  assert.equal(t.cells[1][1].text, ""); owners(t);
});
test("HTML colspan and multiple rows preserve matrix positions", () => {
  const t = fromClipboard('<table><tr><td colspan="2">标题</td></tr><tr><td>A</td><td>B</td></tr></table>', "");
  assert.equal(t.columns.length, 2); assert.equal(t.cells[1][1].text, "B");
  assert.throws(() => fromClipboard('<table><tr><td colspan="51">x</td></tr></table>', ""));
});
test("paste expands the grid, preserves surrounding content and merges", () => {
  const t = createTable(2, 2); t.cells[0][0].text = "原内容";
  const f = fromClipboard('<table><tr><td colspan="2">标题</td></tr><tr><td>A</td><td>B</td></tr></table>', "");
  paste(t, f, { r: 1, c: 1 }); assert.equal(t.cells.length, 3); assert.equal(t.columns.length, 3);
  assert.equal(t.cells[0][0].text, "原内容"); assert.equal(t.cells[2][2].text, "B"); owners(t);
});
test("paste over a merge fails without changing the history state", () => {
  const t = createTable(3, 3); merge(t, { r0: 0, c0: 0, r1: 1, c1: 1 });
  const h = new History(t), before = serialize(h.value);
  assert.throws(() => h.change(t => paste(t, createTable(1, 1), { r: 1, c: 1 })));
  assert.equal(serialize(h.value), before); assert.equal(h.canUndo, false);
});
test("undo/redo restores structure and formatting; new edit clears redo", () => {
  const h = new History(createTable(2, 2));
  h.change(t => { t.cells[0][0].text = "changed"; t.template = "finance"; });
  h.change(t => merge(t, { r0: 0, c0: 0, r1: 1, c1: 1 }));
  h.undo(); assert.equal(h.value.cells[0][0].rowspan, 1); h.redo(); assert.equal(h.value.cells[0][0].rowspan, 2);
  h.undo(); h.change(t => t.title = "new"); assert.equal(h.canRedo, false);
});
test("style precedence is cell > header > table > template", () => {
  const t = createTable(2, 2, "header"); t.style.bold = false; t.headerStyle.bold = true; t.cells[0][0].style.bold = false;
  assert.equal(cellStyle(t, 0, 0).bold, false); assert.equal(cellStyle(t, 0, 1).bold, true);
});
const fence = (t: ReturnType<typeof createTable>) => `\`\`\`rich-table\n${serialize(t)}\n\`\`\``;
test("save replaces only second table and preserves intervening note edits", () => {
  const a = createTable(1, 1), b = createTable(1, 1), baseline = serialize(b);
  const note = `前文有新改动\n${fence(a)}\n中间\n${fence(b)}\n结尾`;
  b.cells[0][0].text = "updated";
  const next = replaceBlock(note, baseline, b);
  assert.ok(next.startsWith(`前文有新改动\n${fence(a)}\n中间`)); assert.ok(next.endsWith("\n结尾"));
  assert.equal(parse(blocks(next)[1].source).cells[0][0].text, "updated");
});
test("save refuses conflicting source, duplicate IDs, and missing blocks", () => {
  const t = createTable(1, 1), baseline = serialize(t);
  const updated = clone(t); updated.title = "external";
  assert.throws(() => replaceBlock(fence(updated), baseline, t), /别处修改/);
  assert.throws(() => locate(`${fence(t)}\n${fence(t)}`, t.id), /重复/);
  assert.throws(() => locate("", t.id), /删除/);
});
test("fence scanner ignores examples inside longer fences and preserves CRLF", () => {
  const t = createTable(1, 1);
  const note = `\`\`\`\`markdown\n${fence(t)}\n\`\`\`\`\n${fence(t)}`.replace(/\n/g, "\r\n");
  assert.equal(blocks(note).length, 1);
  const baseline = blocks(note)[0].source; t.title = "updated";
  const next = replaceBlock(note, baseline, t); assert.equal(next.replace(/\r\n/g, "").includes("\n"), false);
});
test("render and export correctly encode text and preserve merged cells", () => {
  const t = createTable(2, 2); t.cells[0][0].text = '<img src=x onerror="alert(1)">'; t.cells[1][0].text = "a|b\nc";
  merge(t, { r0: 0, c0: 0, r1: 0, c1: 1 });
  const html = toHTML(doc, t), parsed = new JSDOM(html);
  assert.equal(parsed.window.document.querySelector("img"), null);
  assert.equal(parsed.window.document.querySelector("td")!.colSpan, 2);
  assert.match(toMarkdown(t), /a\\\|b<br>c/);
});
test("random structural sequences preserve valid merged grid invariants", () => {
  const t = createTable(8, 6);
  for (let i = 0; i < 40; i++) {
    const r = i % (t.cells.length - 1), c = i % (t.columns.length - 1);
    merge(t, { r0: r, c0: c, r1: r + 1, c1: c + 1 });
    changeAxis(t, i % 2 ? "row" : "col", 1);
    changeAxis(t, i % 2 ? "row" : "col", 0, 1);
    assert.doesNotThrow(() => parse(serialize(t)));
  }
});
