import { mkdir, writeFile, copyFile } from "node:fs/promises";
import { createTable, serialize, merge } from "../src/model";
async function main() {
const table = createTable(7, 4, "finance");
table.title = "季度经营概览";
const rows = [
  ["经营指标", "Q2 实际", "Q3 实际", "Q4 目标"],
  ["客户收入", "1,280,000", "1,520,000", "1,800,000"],
  ["续约收入", "860,000", "920,000", "1,050,000"],
  ["增购收入", "240,000", "380,000", "480,000"],
  ["新增客户", "18", "24", "30"],
  ["客户满意度", "92%", "94%", "96%"],
  ["说明：示例数据，仅用于体验表格编辑。", "", "", ""]
];
rows.forEach((row, r) => row.forEach((value, c) => table.cells[r][c].text = value));
table.columns[0].width = 230;
merge(table, { r0: 6, c0: 0, r1: 6, c1: 3 });
const other = createTable(3, 3, "three-line"); other.title = "研究记录";
[["方案", "观察", "结论"], ["方案 A", "结构清晰", "保留"], ["方案 B", "需要验证", "待补充"]]
  .forEach((row, r) => row.forEach((v, c) => other.cells[r][c].text = v));
const content = `# 富表格体验\n\n点击表格右上角的“编辑”，体验模板、合并、行列与图片。数据仅保存在当前笔记。\n\n\`\`\`rich-table\n${serialize(table)}\n\`\`\`\n\n## 第二张表格\n\n两张表格具有独立 ID，编辑其中一张不会影响另一张。\n\n\`\`\`rich-table\n${serialize(other)}\n\`\`\`\n`;
await mkdir("examples", { recursive: true });
await writeFile("examples/富表格示例.md", content);
if (process.argv.includes("--vault")) {
  await mkdir("test-vault/.obsidian/plugins/obsidian-rich-table", { recursive: true });
  for (const f of ["main.js", "styles.css", "manifest.json"])
    await copyFile(f, `test-vault/.obsidian/plugins/obsidian-rich-table/${f}`);
  await writeFile("test-vault/富表格体验.md", content);
  await writeFile("test-vault/.obsidian/community-plugins.json", JSON.stringify(["obsidian-rich-table"]));
  await writeFile("test-vault/.obsidian/app.json", JSON.stringify({ livePreview: true, attachmentFolderPath: "附件" }));
}
}
void main().catch(error => { console.error(error); process.exitCode = 1; });
