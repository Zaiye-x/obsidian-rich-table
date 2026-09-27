import { TableData, serialize } from "./model";
export interface Block { start: number; end: number; source: string; id: string | null }
export function blocks(markdown: string): Block[] {
  const lines = markdown.match(/[^\n]*\n|[^\n]+$/g) || [], result: Block[] = [];
  let offset = 0, open: { char: string; length: number; rich: boolean; start: number } | null = null;
  for (const line of lines) {
    const content = line.replace(/\r?\n$/, "");
    if (!open) {
      const m = /^ {0,3}(`{3,}|~{3,})(.*)$/.exec(content);
      if (m) open = { char: m[1][0], length: m[1].length, rich: m[2].trim() === "rich-table", start: offset + line.length };
    } else {
      const m = /^ {0,3}(`{3,}|~{3,})\s*$/.exec(content);
      if (m && m[1][0] === open.char && m[1].length >= open.length) {
        if (open.rich) {
          const source = markdown.slice(open.start, offset).trim();
          let id: string | null = null;
          try { const data = JSON.parse(source); if (typeof data?.id === "string") id = data.id; } catch { /* preserve malformed blocks */ }
          result.push({ start: open.start, end: offset, source, id });
        }
        open = null;
      }
    }
    offset += line.length;
  }
  return result;
}
export function locate(markdown: string, id: string, baseline?: string): Block {
  const matches = blocks(markdown).filter(b => b.id === id);
  if (matches.length !== 1) throw new Error(matches.length ? "同一笔记存在重复表格 ID，无法安全保存。请先修复重复 ID。" : "原表格已被删除或修改，无法保存。可导出 JSON 保留草稿。");
  const block = matches[0];
  if (baseline !== undefined && block.source !== baseline.trim()) throw new Error("这张表格已在别处修改。为避免覆盖，保存已停止；请导出 JSON 保留草稿后重新打开。");
  return block;
}
export function replacement(markdown: string, baseline: string, table: TableData): { block: Block; text: string } {
  const block = locate(markdown, table.id, baseline), newline = markdown.includes("\r\n") ? "\r\n" : "\n";
  return { block, text: serialize(table).replace(/\n/g, newline) + newline };
}
export function replaceBlock(markdown: string, baseline: string, table: TableData): string {
  const { block, text } = replacement(markdown, baseline, table);
  return markdown.slice(0, block.start) + text + markdown.slice(block.end);
}
