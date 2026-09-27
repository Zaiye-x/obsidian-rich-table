import { owners, Point, TableData } from "./model";
import { applyStyle, cellStyle } from "./templates";
export interface RenderOptions {
  grid?: boolean;
  resolveImage?: (path: string) => string | null;
  onCell?: (el: HTMLTableCellElement, p: Point) => void;
  onColumn?: (el: HTMLTableCellElement, c: number) => void;
  onRow?: (el: HTMLTableCellElement, r: number) => void;
}
export function element<K extends keyof HTMLElementTagNameMap>(doc: Document, tag: K, cls = "", text = ""): HTMLElementTagNameMap[K] {
  const el = doc.createElement(tag); el.className = cls; if (text) el.textContent = text; return el;
}
export const colLabel = (index: number): string => {
  let result = "", n = index + 1;
  while (n > 0) { n--; result = String.fromCharCode(65 + n % 26) + result; n = Math.floor(n / 26); }
  return result;
};
export function renderTable(doc: Document, t: TableData, options: RenderOptions = {}): HTMLTableElement {
  const table = element(doc, "table", "rt-table"), map = owners(t);
  table.setAttribute("aria-label", t.title);
  if (options.grid) table.setAttribute("role", "grid");
  const group = element(doc, "colgroup");
  if (options.grid) { const col = element(doc, "col"); col.style.width = "44px"; group.append(col); }
  for (const c of t.columns) { const col = element(doc, "col"); col.style.width = `${c.width}px`; group.append(col); }
  table.append(group);
  table.style.width = `${t.columns.reduce((n, c) => n + c.width, options.grid ? 44 : 0)}px`;
  if (options.grid) {
    const head = element(doc, "thead"), row = element(doc, "tr");
    row.append(element(doc, "th", "rt-axis rt-corner", "#"));
    t.columns.forEach((_, c) => {
      const th = element(doc, "th", "rt-axis", colLabel(c)); th.scope = "col"; row.append(th); options.onColumn?.(th, c);
    });
    head.append(row); table.append(head);
  }
  const body = element(doc, "tbody");
  t.cells.forEach((row, r) => {
    const tr = element(doc, "tr");
    if (options.grid) {
      const th = element(doc, "th", "rt-axis", String(r + 1)); th.scope = "row"; tr.append(th); options.onRow?.(th, r);
    }
    row.forEach((cell, c) => {
      if (map[r][c].r !== r || map[r][c].c !== c) return;
      const td = element(doc, "td", "rt-cell");
      td.rowSpan = cell.rowspan; td.colSpan = cell.colspan;
      td.dataset.row = String(r); td.dataset.col = String(c);
      if (options.grid) {
        td.setAttribute("role", "gridcell"); td.tabIndex = -1;
        td.setAttribute("aria-label", `${colLabel(c)}${r + 1} ${cell.text.slice(0, 120) || (cell.images.length ? "图片" : "空白")}`);
      }
      applyStyle(td, cellStyle(t, r, c));
      td.append(element(doc, "div", "rt-cell-text", cell.text));
      for (const p of cell.images) {
        const src = options.resolveImage?.(p.path);
        if (src) {
          const img = element(doc, "img", "rt-picture");
          img.src = src; img.alt = p.alt; img.style.width = `${p.width}px`; img.draggable = false;
          img.addEventListener("error", () => {
            img.replaceWith(element(doc, "span", "rt-missing", `图片不可用：${p.path}`));
          }, { once: true });
          td.append(img);
        } else td.append(element(doc, "span", "rt-missing", `图片：${p.path}`));
      }
      tr.append(td); options.onCell?.(td, { r, c });
    });
    body.append(tr);
  });
  table.append(body); return table;
}
export function toHTML(doc: Document, t: TableData): string {
  const table = renderTable(doc, t, { resolveImage: path => encodeURI(path).replace(/[<>"]/g, c => encodeURIComponent(c)) });
  table.querySelectorAll("[style]").forEach(el => {
    el.setAttribute("style", (el.getAttribute("style") || "")
      .replace(/var\(--rt-text\)/g, "#24252b").replace(/var\(--rt-bg\)/g, "#ffffff")
      .replace(/var\(--rt-line\)/g, "#dcdde3").replace(/var\(--rt-stripe\)/g, "#f4f4f8"));
  });
  const title = element(doc, "h2", "", t.title).outerHTML;
  return `<!doctype html><html lang="zh-CN"><head><meta charset="UTF-8"><title>Rich Table</title><style>
body{font-family:system-ui,sans-serif;padding:32px;color:#24252b;background:#fff}
table{border-collapse:collapse;table-layout:fixed}td{padding:10px 12px;overflow-wrap:anywhere}
.rt-cell-text{white-space:pre-wrap;min-height:1.5em}img{max-width:100%;height:auto;display:block}
</style></head><body>${title}${table.outerHTML}</body></html>`;
}
