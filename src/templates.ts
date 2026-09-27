import { Border, combineStyle, Style, TableData, Template } from "./model";
export const templateNames: Record<Template, string> = {
  grid: "基础网格", "three-line": "学术三线表", header: "彩色表头", stripe: "斑马纹", finance: "财务报表"
};
const line = (width = 1, color = "var(--rt-line)"): Border => ({ width, color, style: "solid" });
export function cellStyle(t: TableData, r: number, c: number): Style {
  const cell = t.cells[r][c], bottom = r + cell.rowspan === t.cells.length;
  let base: Style = {
    fontSize: 14, color: "var(--rt-text)", background: "var(--rt-bg)", align: "left", vertical: "middle",
    borders: { top: { ...line(), style: "none" }, right: { ...line(), style: "none" },
      bottom: { ...line(), style: "none" }, left: { ...line(), style: "none" } }
  };
  if (t.template === "grid") base.borders = { top: line(), right: line(), bottom: line(), left: line() };
  if (t.template === "three-line") {
    if (r === 0) base = combineStyle(base, { bold: true, borders: { top: line(2, "var(--rt-text)"), bottom: line(1.5, "var(--rt-text)") } });
    if (bottom) base = combineStyle(base, { borders: { bottom: line(2, "var(--rt-text)") } });
  }
  if (t.template === "header") {
    base = combineStyle(base, { borders: { bottom: line() } });
    if (r === 0) base = combineStyle(base, { background: "#5041a5", color: "#ffffff", bold: true });
  }
  if (t.template === "stripe" || t.template === "finance" || t.stripe)
    if (r % 2 === 1) base.background = "var(--rt-stripe)";
  if (t.template === "stripe" && r === 0) base.bold = true;
  if (t.template === "finance") {
    base.align = c === 0 ? "left" : "right";
    if (r === 0) base = combineStyle(base, { bold: true, borders: { bottom: line(2, "var(--rt-text)") } });
    if (bottom) base = combineStyle(base, { bold: true, borders: { top: line(), bottom: line(2, "var(--rt-text)") } });
  }
  return combineStyle(base, t.style, r === 0 ? t.headerStyle : {}, cell.style);
}
export function applyStyle(el: HTMLElement, style: Style): void {
  el.style.fontSize = `${style.fontSize || 14}px`;
  el.style.color = style.color || "";
  el.style.backgroundColor = style.background || "";
  el.style.fontWeight = style.bold ? "700" : "400";
  el.style.fontStyle = style.italic ? "italic" : "normal";
  el.style.textDecoration = style.underline ? "underline" : "none";
  el.style.textAlign = style.align || "left";
  el.style.verticalAlign = style.vertical || "middle";
  for (const side of ["top", "right", "bottom", "left"] as const) {
    const b = style.borders?.[side];
    if (b) el.style.setProperty(`border-${side}`, `${b.width}px ${b.style} ${b.color}`);
  }
}
