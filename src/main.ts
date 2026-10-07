import { Editor, EditorPosition, MarkdownView, Modal, Notice, Plugin, PluginSettingTab, Setting, TFile } from "obsidian";
import { createTable, parse, serialize, Template, TEMPLATES } from "./model";
import { TableEditor } from "./editor";
import { NoteStorage } from "./storage";
import { element } from "./renderer";
import { button, numeric, select } from "./ui";
import { templateNames } from "./templates";
import { blocks } from "./source";
import { RichTableSlashSuggest } from "./slash";
import { renderPreview } from "./preview";
import {
  addFavoriteColor,
  defaultFavoriteColors,
  FavoriteColorController,
  FavoriteColorKind,
  FavoriteColors,
  readFavoriteColors,
  removeFavoriteColor
} from "./colors";
interface Settings { rows: number; cols: number; template: Template; favoriteColors: FavoriteColors }
const defaults = (): Settings => ({ rows: 5, cols: 4, template: "grid", favoriteColors: defaultFavoriteColors() });
export default class RichTablePlugin extends Plugin {
  settings: Settings = defaults();
  private colorController: FavoriteColorController = {
    get: () => this.settings.favoriteColors,
    add: (kind, color) => this.updateFavoriteColor(kind, color, false),
    remove: (kind, color) => this.updateFavoriteColor(kind, color, true)
  };
  async onload(): Promise<void> {
    const saved = await this.loadData();
    if (saved) {
      if (Number.isInteger(saved.rows) && saved.rows >= 1 && saved.rows <= 200) this.settings.rows = saved.rows;
      if (Number.isInteger(saved.cols) && saved.cols >= 1 && saved.cols <= 50) this.settings.cols = saved.cols;
      if (TEMPLATES.includes(saved.template)) this.settings.template = saved.template;
    }
    this.settings.favoriteColors = readFavoriteColors(saved?.favoriteColors);
    this.addCommand({
      id: "insert-rich-table", name: "插入富表格",
      editorCallback: (editor, view) => { if (view.file) this.openInsert(editor, view.file); }
    });
    this.addRibbonIcon("table-2", "插入富表格", () => {
      const view = this.app.workspace.getActiveViewOfType(MarkdownView);
      if (!view?.file) { new Notice("请先打开一篇 Markdown 笔记。"); return; }
      this.openInsert(view.editor, view.file);
    });
    this.registerEditorSuggest(new RichTableSlashSuggest(this.app, (editor, file, position) =>
      this.openInsert(editor, file, position)));
    this.addCommand({
      id: "edit-rich-table", name: "编辑光标所在的富表格",
      editorCallback: (editor, view) => {
        const offset = editor.posToOffset(editor.getCursor());
        const block = blocks(editor.getValue()).find(b => b.start <= offset && b.end >= offset);
        if (!block || !view.file) { new Notice("请把光标放在 rich-table 代码块中，或点击表格的“编辑”按钮。"); return; }
        this.openEditor(view.file, block.source);
      }
    });
    this.registerMarkdownCodeBlockProcessor("rich-table", (source, el, context) => {
      try {
        const data = parse(source), file = this.app.vault.getAbstractFileByPath(context.sourcePath);
        if (!(file instanceof TFile)) throw new Error("找不到表格所在笔记。");
        const storage = new NoteStorage(this.app, file, source);
        renderPreview(el, data, path => storage.image(path), () => this.openEditor(file, source));
      } catch (error) {
        el.classList.add("rt-root", "rt-preview");
        el.append(element(el.ownerDocument, "p", "rt-error", `无法显示富表格：${error instanceof Error ? error.message : error}`));
        const details = element(el.ownerDocument, "details"); details.append(element(el.ownerDocument, "summary", "", "查看原始数据"));
        details.append(element(el.ownerDocument, "pre", "", source)); el.append(details);
      }
    });
    this.addSettingTab(new TableSettings(this));
  }
  private openInsert(editor: Editor, file: TFile, position: EditorPosition = editor.getCursor()): void {
    const setup = new Modal(this.app); setup.setTitle("插入富表格");
    let rows = this.settings.rows, cols = this.settings.cols, template = this.settings.template;
    numeric(setup.contentEl, "行数", rows, 1, 200, n => rows = n);
    numeric(setup.contentEl, "列数", cols, 1, 50, n => cols = n);
    select(setup.contentEl, "初始样式", templateNames, template, v => template = v as Template);
    button(setup.contentEl, "创建表格", () => {
      try {
        const table = createTable(rows, cols, template), source = serialize(table);
        editor.replaceRange(`\n\`\`\`rich-table\n${source}\n\`\`\`\n`, position);
        setup.close(); this.openEditor(file, source);
      } catch (error) { new Notice(String(error)); }
    }, "mod-cta");
    setup.open();
  }
  private async openEditor(file: TFile, source: string): Promise<void> {
    try {
      const data = parse(source), storage = new NoteStorage(this.app, file, source);
      await storage.fresh(data.id);
      new TableEditor(this.app, data, storage, this.colorController).open();
    } catch (error) { new Notice(error instanceof Error ? error.message : String(error), 7000); }
  }
  private updateFavoriteColor(kind: FavoriteColorKind, color: string, remove: boolean): void {
    const current = this.settings.favoriteColors;
    const next = remove ? removeFavoriteColor(current, kind, color) : addFavoriteColor(current, kind, color);
    if (next === current) return;
    this.settings.favoriteColors = next;
    void this.saveData(this.settings).catch(error =>
      new Notice(`常用颜色保存失败：${error instanceof Error ? error.message : String(error)}`, 7000));
  }
}
class TableSettings extends PluginSettingTab {
  constructor(private plugin: RichTablePlugin) { super(plugin.app, plugin); }
  display(): void {
    this.containerEl.replaceChildren();
    this.containerEl.append(element(this.containerEl.ownerDocument, "h2", "", "Rich Table"));
    for (const [key, title, max] of [["rows", "默认行数", 200], ["cols", "默认列数", 50]] as const) {
      new Setting(this.containerEl).setName(title).setDesc(`1–${max}`).addText(input => input
        .setValue(String(this.plugin.settings[key]))
        .onChange(async value => {
          const n = Number(value);
          if (!Number.isInteger(n) || n < 1 || n > max) return;
          this.plugin.settings[key] = n; await this.plugin.saveData(this.plugin.settings);
        }));
    }
    new Setting(this.containerEl).setName("默认模板").addDropdown(drop => drop.addOptions(templateNames)
      .setValue(this.plugin.settings.template).onChange(async value => {
        this.plugin.settings.template = value as Template; await this.plugin.saveData(this.plugin.settings);
      }));
    this.containerEl.append(element(this.containerEl.ownerDocument, "p", "", "表格数据保存在笔记的 rich-table 代码块中，图片保存在本地附件目录。首版支持桌面端。"));
  }
}
