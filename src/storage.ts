import { App, MarkdownView, TFile, normalizePath } from "obsidian";
import { Picture, TableData, uid, validPath } from "./model";
import { locate, replaceBlock, replacement } from "./source";
export class NoteStorage {
  constructor(readonly app: App, readonly file: TFile, public baseline: string) {}
  private editor() {
    const active = this.app.workspace.getActiveViewOfType(MarkdownView);
    if (active?.file === this.file) return active.editor;
    for (const leaf of this.app.workspace.getLeavesOfType("markdown")) {
      if (leaf.view instanceof MarkdownView && leaf.view.file === this.file) return leaf.view.editor;
    }
    return null;
  }
  async fresh(id: string): Promise<string> {
    const content = this.editor()?.getValue() ?? await this.app.vault.read(this.file);
    return locate(content, id, this.baseline).source;
  }
  async save(table: TableData): Promise<void> {
    if (this.app.vault.getAbstractFileByPath(this.file.path) !== this.file) throw new Error("笔记已删除；请导出 JSON 保留草稿。");
    const editor = this.editor();
    if (editor) {
      const content = editor.getValue(), { block, text } = replacement(content, this.baseline, table);
      editor.transaction({ changes: [{ from: editor.offsetToPos(block.start), to: editor.offsetToPos(block.end), text }] });
    } else await this.app.vault.process(this.file, content => replaceBlock(content, this.baseline, table));
  }
  image(path: string): string | null {
    if (!validPath(path)) return null;
    const f = this.app.vault.getAbstractFileByPath(path);
    return f instanceof TFile ? this.app.vault.getResourcePath(f) : null;
  }
  async importImage(file: File): Promise<Picture> {
    if (file.size > 10 * 1024 * 1024) throw new Error("单张图片不能超过 10 MB。");
    const buffer = await file.arrayBuffer(), bytes = new Uint8Array(buffer);
    const head = String.fromCharCode(...bytes.slice(0, 12));
    let ext = "";
    if (bytes[0] === 0x89 && head.slice(1, 4) === "PNG") ext = "png";
    else if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) ext = "jpg";
    else if (head.startsWith("GIF87a") || head.startsWith("GIF89a")) ext = "gif";
    else if (head.startsWith("RIFF") && head.slice(8, 12) === "WEBP") ext = "webp";
    if (!ext) throw new Error("仅支持 PNG、JPEG、WebP 或 GIF 图片。");
    const path = normalizePath(await this.app.fileManager.getAvailablePathForAttachment(`rich-table-${uid()}.${ext}`, this.file.path));
    await this.app.vault.createBinary(path, buffer);
    return { path, alt: file.name || "表格图片", width: 180 };
  }
}
