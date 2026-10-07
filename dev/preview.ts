import { TableEditor } from "../src/editor";
import { createTable, parse, serialize } from "../src/model";
import { renderPreview } from "../src/preview";
import { addFavoriteColor, FavoriteColorController, readFavoriteColors, removeFavoriteColor } from "../src/colors";
const initial = createTable(5, 4, "finance"); initial.title = "季度经营概览";
[["经营指标", "Q2 实际", "Q3 实际", "Q4 目标"], ["客户收入", "1,280,000", "1,520,000", "1,800,000"],
  ["续约收入", "860,000", "920,000", "1,050,000"], ["新增客户", "18", "24", "30"], ["客户满意度", "92%", "94%", "96%"]]
  .forEach((row, r) => row.forEach((text, c) => initial.cells[r][c].text = text));
let data = parse(localStorage.getItem("rich-table-preview") || serialize(initial));
const images = new Map<string, string>();
let favoriteColors = (() => {
  try { return readFavoriteColors(JSON.parse(localStorage.getItem("rich-table-colors") || "null")); }
  catch { return readFavoriteColors(undefined); }
})();
const colors: FavoriteColorController = {
  get: () => favoriteColors,
  add(kind, color) {
    favoriteColors = addFavoriteColor(favoriteColors, kind, color);
    localStorage.setItem("rich-table-colors", JSON.stringify(favoriteColors));
  },
  remove(kind, color) {
    favoriteColors = removeFavoriteColor(favoriteColors, kind, color);
    localStorage.setItem("rich-table-colors", JSON.stringify(favoriteColors));
  }
};
function openEditor() {
  const storage = {
    image: (path: string) => images.get(path) || null,
    async save(t: typeof data) { data = t; localStorage.setItem("rich-table-preview", serialize(t)); show(); },
    async importImage(file: File) { const path = `attachments/${file.name}`; images.set(path, URL.createObjectURL(file)); return { path, alt: file.name, width: 140 }; }
  };
  new TableEditor({} as any, data, storage as any, colors).open();
}
function show() {
  const preview = document.querySelector<HTMLElement>("#preview")!;
  renderPreview(preview, data, path => images.get(path) || null, openEditor);
  const codeButton = document.createElement("button");
  codeButton.type = "button"; codeButton.className = "mock-code-button";
  codeButton.textContent = "</>"; codeButton.title = "Obsidian 代码按钮"; codeButton.setAttribute("aria-label", "Obsidian 代码按钮");
  preview.append(codeButton);
}
document.querySelector("#edit")!.addEventListener("click", openEditor);
document.querySelector("#theme")!.addEventListener("click", () => document.body.classList.toggle("theme-dark"));
show();
