export const MAX_ROWS = 200;
export const MAX_COLS = 50;
export const TEMPLATES = ["grid", "three-line", "header", "stripe", "finance"] as const;
export type Template = typeof TEMPLATES[number];
export type BorderSide = "top" | "right" | "bottom" | "left";
export interface Border { color: string; width: number; style: "solid" | "dashed" | "none" }
export interface Style {
  fontSize?: number; color?: string; background?: string;
  bold?: boolean; italic?: boolean; underline?: boolean;
  align?: "left" | "center" | "right"; vertical?: "top" | "middle" | "bottom";
  borders?: Partial<Record<BorderSide, Border>>;
}
export interface Picture { path: string; alt: string; width: number }
export interface Cell { text: string; images: Picture[]; rowspan: number; colspan: number; style: Style }
export interface TableData {
  schemaVersion: 1; id: string; title: string; template: Template;
  rowIds: string[]; columns: { id: string; width: number }[];
  cells: Cell[][]; style: Style; headerStyle: Style; stripe: boolean;
}
export interface Point { r: number; c: number }
export interface Rect { r0: number; c0: number; r1: number; c1: number }
export const clone = <T>(v: T): T => structuredClone(v);
export const uid = (): string => crypto.randomUUID();
export const blank = (): Cell => ({ text: "", images: [], rowspan: 1, colspan: 1, style: {} });
export function dimensions(rows: number, cols: number): void {
  if (!Number.isInteger(rows) || !Number.isInteger(cols) || rows < 1 || cols < 1 || rows > MAX_ROWS || cols > MAX_COLS)
    throw new Error(`表格须为 1–${MAX_ROWS} 行、1–${MAX_COLS} 列。`);
}
export function createTable(rows = 5, cols = 4, template: Template = "grid"): TableData {
  dimensions(rows, cols);
  return {
    schemaVersion: 1, id: uid(), title: "未命名表格", template,
    rowIds: Array.from({ length: rows }, uid),
    columns: Array.from({ length: cols }, () => ({ id: uid(), width: 160 })),
    cells: Array.from({ length: rows }, () => Array.from({ length: cols }, blank)),
    style: {}, headerStyle: {}, stripe: false
  };
}
export const rect = (a: Point, b: Point = a): Rect => ({
  r0: Math.min(a.r, b.r), c0: Math.min(a.c, b.c), r1: Math.max(a.r, b.r), c1: Math.max(a.c, b.c)
});
export function owners(t: TableData): Point[][] {
  const map: Point[][] = t.cells.map(row => new Array(row.length));
  for (let r = 0; r < t.cells.length; r++) for (let c = 0; c < t.columns.length; c++) {
    const cell = t.cells[r][c];
    if (map[r][c]) {
      if (cell.rowspan !== 1 || cell.colspan !== 1 || cell.text || cell.images.length)
        throw new Error("合并区域包含隐藏内容或交叉合并，请修复源数据。");
      continue;
    }
    if (r + cell.rowspan > t.cells.length || c + cell.colspan > t.columns.length)
      throw new Error("合并区域超出表格。");
    for (let y = r; y < r + cell.rowspan; y++) for (let x = c; x < c + cell.colspan; x++) {
      if (map[y][x]) throw new Error("合并区域发生重叠。");
      map[y][x] = { r, c };
    }
  }
  return map;
}
export function expandedRect(t: TableData, selection: Rect): Rect {
  const out = { ...selection }, map = owners(t);
  let changed = true;
  while (changed) {
    const before = JSON.stringify(out);
    for (let r = out.r0; r <= out.r1; r++) for (let c = out.c0; c <= out.c1; c++) {
      const p = map[r][c], cell = t.cells[p.r][p.c];
      out.r0 = Math.min(out.r0, p.r); out.c0 = Math.min(out.c0, p.c);
      out.r1 = Math.max(out.r1, p.r + cell.rowspan - 1);
      out.c1 = Math.max(out.c1, p.c + cell.colspan - 1);
    }
    changed = JSON.stringify(out) !== before;
  }
  return out;
}
export function selected(t: TableData, area: Rect): Point[] {
  const map = owners(t), result: Point[] = [], seen = new Set<string>();
  for (let r = area.r0; r <= area.r1; r++) for (let c = area.c0; c <= area.c1; c++) {
    const p = map[r][c], key = `${p.r},${p.c}`;
    if (!seen.has(key)) { seen.add(key); result.push(p); }
  }
  return result;
}
export function merge(t: TableData, area: Rect): void {
  const s = expandedRect(t, area), points = selected(t, s);
  const first = clone(t.cells[s.r0][s.c0]);
  first.text = points.map(p => t.cells[p.r][p.c].text).filter(Boolean).join("\n");
  first.images = points.flatMap(p => clone(t.cells[p.r][p.c].images));
  if (first.text.length > 200000 || first.images.length > 100)
    throw new Error("合并后超过单格上限（20 万字符或 100 张图片），请缩小选区。");
  first.rowspan = s.r1 - s.r0 + 1; first.colspan = s.c1 - s.c0 + 1;
  for (let r = s.r0; r <= s.r1; r++) for (let c = s.c0; c <= s.c1; c++) t.cells[r][c] = blank();
  t.cells[s.r0][s.c0] = first;
}
export function split(t: TableData, area: Rect): void {
  for (const p of selected(t, area)) {
    t.cells[p.r][p.c].rowspan = 1; t.cells[p.r][p.c].colspan = 1;
  }
}
// Rebuild anchors after a structural change. If a merged anchor is deleted,
// transfer its content to the first surviving coordinate in that merge.
export function changeAxis(t: TableData, axis: "row" | "col", index: number, remove = 0): void {
  const n = axis === "row" ? t.cells.length : t.columns.length;
  if (!Number.isInteger(index) || index < 0 || index > n || remove < 0 || index + remove > n)
    throw new Error("行列范围无效。");
  const next = n + (remove ? -remove : 1);
  dimensions(axis === "row" ? next : t.cells.length, axis === "col" ? next : t.columns.length);
  const map = owners(t), anchors: { p: Point; cell: Cell }[] = [];
  for (let r = 0; r < t.cells.length; r++) for (let c = 0; c < t.columns.length; c++)
    if (map[r][c].r === r && map[r][c].c === c) anchors.push({ p: { r, c }, cell: clone(t.cells[r][c]) });
  if (axis === "row") t.rowIds.splice(index, remove, ...(remove ? [] : [uid()]));
  else t.columns.splice(index, remove, ...(remove ? [] : [{ id: uid(), width: 160 }]));
  t.cells = t.rowIds.map(() => t.columns.map(blank));
  for (const { p, cell } of anchors) {
    const start = axis === "row" ? p.r : p.c;
    const span = axis === "row" ? cell.rowspan : cell.colspan;
    let s = start, count = span;
    if (remove) {
      const survivors = Array.from({ length: span }, (_, i) => start + i)
        .filter(i => i < index || i >= index + remove)
        .map(i => i >= index + remove ? i - remove : i);
      if (!survivors.length) continue;
      s = survivors[0]; count = survivors.length;
    } else if (index <= start) s++;
    else if (index < start + span) count++;
    if (axis === "row") { p.r = s; cell.rowspan = count; }
    else { p.c = s; cell.colspan = count; }
    t.cells[p.r][p.c] = cell;
  }
  owners(t);
}
export function paste(t: TableData, fragment: TableData, at: Point): void {
  const height = fragment.cells.length, width = fragment.columns.length;
  dimensions(Math.max(t.cells.length, at.r + height), Math.max(t.columns.length, at.c + width));
  const end: Rect = { r0: at.r, c0: at.c, r1: at.r + height - 1, c1: at.c + width - 1 };
  const map = owners(t);
  for (let r = at.r; r <= Math.min(end.r1, t.cells.length - 1); r++)
    for (let c = at.c; c <= Math.min(end.c1, t.columns.length - 1); c++) {
      const p = map[r][c], cell = t.cells[p.r][p.c];
      if (cell.rowspan > 1 || cell.colspan > 1) throw new Error("粘贴区域含有合并单元格，请先拆分。");
    }
  while (t.cells.length <= end.r1) changeAxis(t, "row", t.cells.length);
  while (t.columns.length <= end.c1) changeAxis(t, "col", t.columns.length);
  for (let r = 0; r < height; r++) for (let c = 0; c < width; c++)
    t.cells[at.r + r][at.c + c] = clone(fragment.cells[r][c]);
}
export function combineStyle(...styles: Style[]): Style {
  return styles.reduce<Style>((out, s) => ({ ...out, ...s, borders: { ...out.borders, ...s.borders } }), {});
}
export function serialize(t: TableData): string { return JSON.stringify(t, null, 2); }
function object(v: unknown): Record<string, unknown> {
  if (!v || typeof v !== "object" || Array.isArray(v)) throw new Error("表格数据格式错误。");
  return v as Record<string, unknown>;
}
function text(v: unknown, max = 200000): string {
  if (typeof v !== "string" || v.length > max) throw new Error("文本字段无效或过长。");
  return v;
}
function number(v: unknown, min: number, max: number): number {
  if (typeof v !== "number" || !Number.isFinite(v) || v < min || v > max) throw new Error("数字字段超出允许范围。");
  return v;
}
function int(v: unknown, min: number, max: number): number {
  const n = number(v, min, max); if (!Number.isInteger(n)) throw new Error("行列跨度须为整数。"); return n;
}
const color = (v: unknown): string => {
  const s = text(v, 100);
  if (!/^#(?:[0-9a-f]{3}|[0-9a-f]{4}|[0-9a-f]{6}|[0-9a-f]{8})$/i.test(s) && !/^var\(--[a-z-]+\)$/.test(s) && s !== "transparent")
    throw new Error("颜色格式无效。");
  return s;
};
export function validPath(v: string): boolean {
  return !!v && !/^(?:[a-z]+:|\/)/i.test(v) && !v.includes("\\") && !v.split("/").some(p => p === ".." || p === ".") && !/[\x00-\x1f]/.test(v);
}
function readStyle(v: unknown): Style {
  const o = object(v), s: Style = {};
  if (o.fontSize !== undefined) s.fontSize = number(o.fontSize, 8, 72);
  for (const key of ["color", "background"] as const) if (o[key] !== undefined) s[key] = color(o[key]);
  for (const key of ["bold", "italic", "underline"] as const) if (o[key] !== undefined) {
    if (typeof o[key] !== "boolean") throw new Error("格式开关无效。"); s[key] = o[key];
  }
  if (o.align !== undefined) {
    if (!["left", "center", "right"].includes(String(o.align))) throw new Error("水平对齐值无效。");
    s.align = o.align as Style["align"];
  }
  if (o.vertical !== undefined) {
    if (!["top", "middle", "bottom"].includes(String(o.vertical))) throw new Error("垂直对齐值无效。");
    s.vertical = o.vertical as Style["vertical"];
  }
  if (o.borders !== undefined) {
    const b = object(o.borders); s.borders = {};
    for (const side of ["top", "right", "bottom", "left"] as const) if (b[side] !== undefined) {
      const value = object(b[side]);
      if (!["solid", "dashed", "none"].includes(String(value.style))) throw new Error("边框样式无效。");
      s.borders[side] = { color: color(value.color), width: number(value.width, 0, 8), style: value.style as Border["style"] };
    }
  }
  return s;
}
export function parse(source: string): TableData {
  if (source.length > 20_000_000) throw new Error("表格数据超过 20 MB。");
  const o = object(JSON.parse(source));
  if (o.schemaVersion !== 1) throw new Error("不支持此表格版本，请更新插件。");
  if (!Array.isArray(o.cells) || !Array.isArray(o.columns) || !Array.isArray(o.rowIds)) throw new Error("缺少行列数据。");
  dimensions(o.cells.length, o.columns.length);
  if (o.rowIds.length !== o.cells.length || !TEMPLATES.includes(o.template as Template)) throw new Error("行数或模板无效。");
  const t: TableData = {
    schemaVersion: 1, id: text(o.id, 100), title: text(o.title, 500), template: o.template as Template,
    rowIds: o.rowIds.map(v => text(v, 100)),
    columns: o.columns.map(v => { const c = object(v); return { id: text(c.id, 100), width: number(c.width, 60, 1000) }; }),
    cells: o.cells.map(row => {
      if (!Array.isArray(row) || row.length !== (o.columns as unknown[]).length) throw new Error("表格行长度不一致。");
      return row.map(v => {
        const c = object(v);
        if (!Array.isArray(c.images) || c.images.length > 100) throw new Error("图片列表无效。");
        return {
          text: text(c.text), style: readStyle(c.style),
          rowspan: int(c.rowspan, 1, MAX_ROWS), colspan: int(c.colspan, 1, MAX_COLS),
          images: c.images.map(v => {
            const p = object(v), path = text(p.path, 2000);
            if (!validPath(path)) throw new Error("图片必须使用 Vault 内的相对路径。");
            return { path, alt: text(p.alt, 2000), width: number(p.width, 24, 1000) };
          })
        };
      });
    }),
    style: readStyle(o.style), headerStyle: readStyle(o.headerStyle), stripe: o.stripe === true
  };
  if (!t.id || new Set(t.rowIds).size !== t.rowIds.length || new Set(t.columns.map(c => c.id)).size !== t.columns.length)
    throw new Error("表格或行列 ID 无效。");
  owners(t); return t;
}
export class History {
  private past: string[] = [];
  private future: string[] = [];
  constructor(public value: TableData) {}
  change(fn: (draft: TableData) => void): boolean {
    const before = serialize(this.value), draft = clone(this.value);
    fn(draft); owners(draft);
    if (serialize(draft) === before) return false;
    this.past.push(before); if (this.past.length > 60) this.past.shift();
    this.future = []; this.value = draft; return true;
  }
  undo(): void {
    const previous = this.past.pop(); if (!previous) return;
    // Snapshots originate from our own state. Preserve key order so undoing
    // back to the initial snapshot also clears the unsaved indicator.
    this.future.push(serialize(this.value)); this.value = JSON.parse(previous) as TableData;
  }
  redo(): void {
    const next = this.future.pop(); if (!next) return;
    this.past.push(serialize(this.value)); this.value = JSON.parse(next) as TableData;
  }
  get canUndo(): boolean { return this.past.length > 0; }
  get canRedo(): boolean { return this.future.length > 0; }
}
