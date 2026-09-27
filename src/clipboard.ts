import { createTable, dimensions, MAX_COLS, MAX_ROWS, owners, TableData } from "./model";

export function parseTSV(raw: string): string[][] {
  const s = raw.replace(/\r\n?/g, "\n"), rows: string[][] = [];
  let row: string[] = [], field = "", quoted = false;
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (quoted) {
      if (ch === '"' && s[i + 1] === '"') { field += '"'; i++; }
      else if (ch === '"') quoted = false;
      else field += ch;
    } else if (ch === '"' && field === "") quoted = true;
    else if (ch === "\t") { row.push(field); field = ""; }
    else if (ch === "\n") { row.push(field); rows.push(row); row = []; field = ""; }
    else field += ch;
    if (rows.length > MAX_ROWS || row.length > MAX_COLS) throw new Error("粘贴内容超出 200 行或 50 列。");
  }
  if (quoted) throw new Error("粘贴文本中存在未闭合的引号。");
  if (field !== "" || row.length || !s.endsWith("\n")) { row.push(field); rows.push(row); }
  if (!rows.length) rows.push([""]);
  return rows;
}
function cellText(el: Element): string {
  const copy = el.cloneNode(true) as Element;
  copy.querySelectorAll("script,style,iframe,object").forEach(n => n.remove());
  copy.querySelectorAll("br").forEach(n => n.replaceWith("\n"));
  copy.querySelectorAll("p,div").forEach(n => n.append("\n"));
  return (copy.textContent || "").replace(/\u00a0/g, " ").replace(/\n$/, "");
}
export function fromClipboard(html: string, plain: string): TableData {
  if (html) {
    const doc = new DOMParser().parseFromString(html, "text/html"), table = doc.querySelector("table");
    if (table) {
      const rows = [...table.querySelectorAll("tr")].filter(tr => tr.closest("table") === table);
      if (!rows.length) throw new Error("剪贴板中的表格没有行。");
      dimensions(rows.length, 1);
      const occupied: boolean[][] = [], anchors: { r: number; c: number; rs: number; cs: number; text: string }[] = [];
      let width = 0, height = rows.length;
      rows.forEach((row, r) => {
        let c = 0;
        for (const el of [...row.children].filter(e => /^(TD|TH)$/.test(e.tagName))) {
          while (occupied[r]?.[c]) c++;
          const rs = Number(el.getAttribute("rowspan") || 1), cs = Number(el.getAttribute("colspan") || 1);
          if (!Number.isInteger(rs) || !Number.isInteger(cs) || rs < 1 || cs < 1) throw new Error("剪贴板中的合并跨度无效。");
          dimensions(r + rs, c + cs);
          for (let y = r; y < r + rs; y++) {
            occupied[y] ??= [];
            for (let x = c; x < c + cs; x++) {
              if (occupied[y][x]) throw new Error("剪贴板表格存在重叠合并。");
              occupied[y][x] = true;
            }
          }
          anchors.push({ r, c, rs, cs, text: cellText(el) });
          width = Math.max(width, c + cs); height = Math.max(height, r + rs); c += cs;
        }
      });
      const t = createTable(height, width);
      for (const a of anchors) Object.assign(t.cells[a.r][a.c], { text: a.text, rowspan: a.rs, colspan: a.cs });
      owners(t); return t;
    }
  }
  const rows = parseTSV(plain), width = Math.max(...rows.map(r => r.length));
  const t = createTable(rows.length, width);
  rows.forEach((row, r) => row.forEach((value, c) => t.cells[r][c].text = value));
  return t;
}
export function toTSV(t: TableData): string {
  const escape = (s: string) => /[\t\n"]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  return t.cells.map(row => row.map(c => escape(c.text)).join("\t")).join("\n");
}
export function toMarkdown(t: TableData): string {
  const value = (r: number) => "| " + t.cells[r].map(c => {
    const content = [
      c.text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
        .replace(/\\/g, "\\\\").replace(/\|/g, "\\|").replace(/\n/g, "<br>"),
      ...c.images.map(p => `![${p.alt.replace(/[[\]|]/g, "")}](<${encodeURI(p.path).replace(/[<>]/g, s => encodeURIComponent(s))}>)`)
    ];
    return content.filter(Boolean).join("<br>");
  }).join(" | ") + " |";
  return [value(0), "| " + t.columns.map(() => "---").join(" | ") + " |",
    ...t.cells.slice(1).map((_, i) => value(i + 1))].join("\n");
}
