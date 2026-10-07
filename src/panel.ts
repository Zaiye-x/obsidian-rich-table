import { BorderSide, combineStyle, selected, Style, TableData, Template, Rect } from "./model";
import { renderTable, element } from "./renderer";
import { cellStyle, templateNames } from "./templates";
import { button, field, numeric, select } from "./ui";
import { FAVORITE_COLOR_LIMIT, FavoriteColorKind, FavoriteColors } from "./colors";
export type Scope = "table" | "header" | "selection";
export interface PanelHost {
  data: TableData; area: Rect; scope: Scope;
  favoriteColors: FavoriteColors;
  setScope(scope: Scope): void;
  change(fn: (t: TableData) => void): void;
  addFavoriteColor(kind: FavoriteColorKind, color: string): void;
  removeFavoriteColor(kind: FavoriteColorKind, color: string): void;
  addImage(): void;
}

function colorName(color: string): string {
  return color.toUpperCase();
}

function renderColorField(
  parent: HTMLElement,
  host: PanelHost,
  key: "color" | "background",
  label: string,
  fallback: string,
  current: Style,
  patch: (style: Style) => void
): void {
  const doc = parent.ownerDocument, kind: FavoriteColorKind = key === "color" ? "text" : "background";
  const group = element(doc, "div", "rt-color-field");
  const heading = element(doc, "div", "rt-color-heading");
  heading.append(element(doc, "span", "rt-field-label", label));
  const controls = element(doc, "div", "rt-color-controls");
  const input = element(doc, "input");
  input.type = "color";
  input.value = /^#[a-f0-9]{6}$/i.test(current[key] || "") ? current[key]! : fallback;
  input.setAttribute("aria-label", `选择${label}`);
  input.title = `选择${label}`;
  input.addEventListener("change", () => patch({ [key]: input.value }));
  controls.append(input);
  const favorites = host.favoriteColors[kind], normalized = input.value.toLowerCase();
  const add = button(controls, "+", () => host.addFavoriteColor(kind, input.value), "rt-color-add");
  add.setAttribute("aria-label", `将 ${colorName(input.value)} 添加到常用${label}`);
  const exists = favorites.includes(normalized);
  add.disabled = exists || favorites.length >= FAVORITE_COLOR_LIMIT;
  add.title = exists ? "当前颜色已在常用色中"
    : favorites.length >= FAVORITE_COLOR_LIMIT ? `每组最多保存 ${FAVORITE_COLOR_LIMIT} 个常用色`
      : "添加到常用色";
  heading.append(controls); group.append(heading);
  const list = element(doc, "div", "rt-color-favorites");
  list.setAttribute("role", "group"); list.setAttribute("aria-label", `常用${label}`);
  for (const color of favorites) {
    const item = element(doc, "span", "rt-color-favorite");
    const swatch = button(item, "", () => patch({ [key]: color }), "rt-color-swatch");
    swatch.style.setProperty("--rt-favorite-color", color);
    swatch.setAttribute("aria-label", `应用常用${label} ${colorName(color)}`);
    swatch.setAttribute("aria-pressed", String(normalized === color));
    swatch.title = `${colorName(color)} · 点击应用`;
    const remove = button(item, "×", () => host.removeFavoriteColor(kind, color), "rt-color-remove");
    remove.setAttribute("aria-label", `移除常用${label} ${colorName(color)}`);
    remove.title = `移除 ${colorName(color)}`;
    item.append(swatch, remove); list.append(item);
  }
  group.append(list); parent.append(group);
}

export function renderPanel(parent: HTMLElement, host: PanelHost): void {
  parent.replaceChildren();
  const doc = parent.ownerDocument, t = host.data, first = selected(t, host.area)[0];
  const current = cellStyle(t, first.r, first.c);
  const patch = (style: Style) => host.change(draft => {
    if (host.scope === "table") draft.style = combineStyle(draft.style, style);
    else if (host.scope === "header") draft.headerStyle = combineStyle(draft.headerStyle, style);
    else for (const p of selected(draft, host.area)) draft.cells[p.r][p.c].style = combineStyle(draft.cells[p.r][p.c].style, style);
  });
  parent.append(element(doc, "h3", "", "表格样式"));
  const templates = element(doc, "div", "rt-templates");
  for (const [id, name] of Object.entries(templateNames)) {
    const b = button(templates, name, () => host.change(t => t.template = id as Template), "rt-template");
    b.classList.toggle("is-active", t.template === id); b.setAttribute("aria-pressed", String(t.template === id));
    const sample = { ...t, template: id as Template };
    // Small semantic preview made of strokes, not a separate data table.
    const preview = element(doc, "span", `rt-swatch rt-swatch-${id}`);
    preview.setAttribute("aria-hidden", "true");
    for (let i = 0; i < 3; i++) preview.append(element(doc, "i"));
    b.prepend(preview);
  }
  parent.append(templates);
  select(parent, "格式作用于", { selection: "当前选区", header: "首行表头", table: "整个表格" }, host.scope, v => host.setScope(v as Scope));
  parent.append(element(doc, "p", "rt-hint", "局部样式优先于表头和整表；切换模板保留局部设置。"));
  const formats = element(doc, "div", "rt-format-buttons");
  for (const [key, label] of [["bold", "加粗"], ["italic", "斜体"], ["underline", "下划线"]] as const) {
    const b = button(formats, label, () => patch({ [key]: !current[key] }));
    b.setAttribute("aria-pressed", String(!!current[key]));
  }
  parent.append(formats);
  numeric(parent, "字号", current.fontSize || 14, 8, 72, n => patch({ fontSize: n }));
  select(parent, "水平对齐", { left: "左对齐", center: "居中", right: "右对齐" }, current.align || "left", v => patch({ align: v as Style["align"] }));
  select(parent, "垂直对齐", { top: "顶部", middle: "中间", bottom: "底部" }, current.vertical || "middle", v => patch({ vertical: v as Style["vertical"] }));
  for (const [key, label, fallback] of [["color", "文字颜色", "#24252b"], ["background", "背景颜色", "#ffffff"]] as const)
    renderColorField(parent, host, key, label, fallback, current, patch);
  parent.append(element(doc, "h4", "", "边框"));
  const borderPosition = select(parent, "边框位置", { all: "所有边框", outer: "选区外框", top: "上边框", bottom: "下边框", left: "左边框", right: "右边框", none: "清除边框" }, "all", () => {});
  const borderLine = select(parent, "线型", { solid: "实线", dashed: "虚线" }, "solid", () => {});
  const borderWidth = numeric(parent, "粗细", 1, 0, 8, () => {});
  borderWidth.step = "0.5";
  const borderLabel = field(parent, "边框颜色"), borderColor = element(doc, "input");
  borderColor.type = "color"; borderColor.value = "#b7b7c5"; borderLabel.append(borderColor);
  button(parent, "应用边框", () => host.change(draft => {
    const area = host.scope === "table" ? { r0: 0, c0: 0, r1: draft.cells.length - 1, c1: draft.columns.length - 1 }
      : host.scope === "header" ? { r0: 0, c0: 0, r1: 0, c1: draft.columns.length - 1 } : host.area;
    for (const p of selected(draft, area)) {
      const cell = draft.cells[p.r][p.c], borders: Style["borders"] = {};
      const sides: BorderSide[] = ["top", "right", "bottom", "left"];
      for (const side of sides) {
        const outer = side === "top" ? p.r === area.r0 : side === "bottom" ? p.r + cell.rowspan - 1 === area.r1
          : side === "left" ? p.c === area.c0 : p.c + cell.colspan - 1 === area.c1;
        if (borderPosition.value === "all" || borderPosition.value === "none" || borderPosition.value === side || (borderPosition.value === "outer" && outer))
          borders[side] = { color: borderColor.value, width: Math.max(0, Math.min(8, Number(borderWidth.value) || 0)), style: borderPosition.value === "none" ? "none" : borderLine.value as "solid" | "dashed" };
      }
      cell.style = combineStyle(cell.style, { borders });
    }
  }), "rt-full");
  const stripeLabel = field(parent, "叠加隔行底色"), checkbox = element(doc, "input");
  checkbox.type = "checkbox"; checkbox.checked = t.stripe;
  checkbox.addEventListener("change", () => host.change(t => t.stripe = checkbox.checked)); stripeLabel.append(checkbox);
  numeric(parent, "当前列宽", t.columns[first.c].width, 60, 1000, n => host.change(t => t.columns[first.c].width = n));
  button(parent, "清除自定义样式", () => host.change(t => {
    t.style = {}; t.headerStyle = {}; t.stripe = false;
    t.cells.forEach(row => row.forEach(cell => cell.style = {}));
  }), "rt-full");
  parent.append(element(doc, "h4", "", "单元格图片"));
  button(parent, "插入图片…", () => host.addImage(), "rt-full");
  t.cells[first.r][first.c].images.forEach((image, index) => {
    const box = element(doc, "div", "rt-image-setting");
    box.append(element(doc, "p", "rt-hint", image.alt || image.path));
    numeric(box, "图片宽度", image.width, 24, 1000, width => host.change(t => t.cells[first.r][first.c].images[index].width = width));
    button(box, "移除图片引用", () => host.change(t => { t.cells[first.r][first.c].images.splice(index, 1); }));
    parent.append(box);
  });
}
