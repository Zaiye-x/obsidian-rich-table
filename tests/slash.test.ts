import test from "node:test";
import assert from "node:assert/strict";
import { buildSync } from "esbuild";
import { JSDOM } from "jsdom";
import vm from "node:vm";

const compiled = buildSync({
  entryPoints: ["src/slash.ts"], bundle: true, external: ["obsidian"],
  format: "cjs", platform: "node", write: false
}).outputFiles[0].text;

test("slash suggestion removes trigger text and opens the shared insert flow", () => {
  let closed = false;
  class EditorSuggest {
    context: any = null;
    constructor(_app: unknown) {}
    setInstructions() {}
    close() { closed = true; }
  }
  const module = { exports: {} as any };
  vm.runInNewContext(compiled, {
    module, exports: module.exports, require: () => ({ EditorSuggest })
  });

  const replacements: any[] = [], choices: any[] = [];
  const editor = {
    getLine: () => " /表格",
    replaceRange: (...args: any[]) => replacements.push(args)
  };
  const file = { path: "note.md" };
  const suggest = new module.exports.RichTableSlashSuggest({}, (...args: any[]) => choices.push(args));
  const trigger = suggest.onTrigger({ line: 0, ch: 4 }, editor, file);
  assert.equal(JSON.stringify(trigger), JSON.stringify({
    start: { line: 0, ch: 1 }, end: { line: 0, ch: 4 }, query: "表格"
  }));
  assert.equal(suggest.getSuggestions({ ...trigger, editor, file }).length, 1);

  const dom = new JSDOM("<div id='item'></div>");
  const item = dom.window.document.querySelector<HTMLElement>("#item")!;
  suggest.renderSuggestion(suggest.getSuggestions({ ...trigger, editor, file })[0], item);
  assert.match(item.textContent!, /插入富表格/);

  suggest.context = { ...trigger, editor, file };
  suggest.selectSuggestion({});
  assert.equal(replacements[0][0], "");
  assert.equal(JSON.stringify(replacements[0].slice(1)), JSON.stringify([trigger.start, trigger.end]));
  assert.equal(choices[0][0], editor);
  assert.equal(choices[0][1], file);
  assert.equal(JSON.stringify(choices[0][2]), JSON.stringify(trigger.start));
  assert.equal(closed, true);
});
