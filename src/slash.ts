import {
  App, Editor, EditorPosition, EditorSuggest, EditorSuggestContext,
  EditorSuggestTriggerInfo, TFile
} from "obsidian";
import { matchRichTableSlash } from "./slash-match";

const suggestion = {
  title: "插入富表格",
  description: "创建可粘贴 Excel、合并单元格和设置样式的表格"
};

export class RichTableSlashSuggest extends EditorSuggest<typeof suggestion> {
  constructor(
    app: App,
    private choose: (editor: Editor, file: TFile, position: EditorPosition) => void
  ) {
    super(app);
    this.setInstructions([
      { command: "↑↓", purpose: "选择" },
      { command: "↵", purpose: "插入" },
      { command: "esc", purpose: "关闭" }
    ]);
  }

  onTrigger(cursor: EditorPosition, editor: Editor, file: TFile | null): EditorSuggestTriggerInfo | null {
    if (!file) return null;
    const match = matchRichTableSlash(editor.getLine(cursor.line), cursor.ch);
    if (!match) return null;
    return {
      start: { line: cursor.line, ch: match.startCh },
      end: cursor,
      query: match.query
    };
  }

  getSuggestions(context: EditorSuggestContext): typeof suggestion[] {
    const query = context.query.trim().toLowerCase();
    if (!query) return [suggestion];
    const aliases = ["插入富表格", "富表格", "表格", "rich table", "table", "rt"];
    return aliases.some(alias => alias.includes(query)) ? [suggestion] : [];
  }

  renderSuggestion(value: typeof suggestion, el: HTMLElement): void {
    const title = el.ownerDocument.createElement("div");
    title.className = "rt-slash-title";
    title.textContent = value.title;
    const description = el.ownerDocument.createElement("small");
    description.className = "rt-slash-description";
    description.textContent = value.description;
    el.append(title, description);
  }

  selectSuggestion(_value: typeof suggestion): void {
    const context = this.context;
    if (!context) return;
    context.editor.replaceRange("", context.start, context.end);
    this.close();
    this.choose(context.editor, context.file, context.start);
  }
}
