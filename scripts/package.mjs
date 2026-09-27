import { copyFile, mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";

const root = fileURLToPath(new URL("../", import.meta.url));
const manifest = JSON.parse(await readFile(join(root, "manifest.json"), "utf8"));
if (!/^[a-z0-9-]+$/.test(manifest.id) || !/^\d+\.\d+\.\d+$/.test(manifest.version))
  throw new Error("插件 ID 或版本号无效。");
const files = [
  "main.js", "styles.css", "manifest.json", "README.md",
  "docs/verification.md", "examples/富表格示例.md"
];
const dist = join(root, "dist");
await mkdir(dist, { recursive: true });
const stage = await mkdtemp(join(tmpdir(), "obsidian-rich-table-package-"));
const archive = join(dist, `${manifest.id}-${manifest.version}.zip`);
try {
  for (const file of files) {
    const target = join(stage, manifest.id, file);
    await mkdir(dirname(target), { recursive: true });
    await copyFile(join(root, file), target);
  }
  // Build a new archive in our own staging directory to avoid stale entries.
  const temporaryArchive = join(stage, "release.zip");
  execFileSync("zip", ["-q", temporaryArchive, ...files.map(file => `${manifest.id}/${file}`)], {
    cwd: stage, stdio: "inherit"
  });
  await copyFile(temporaryArchive, archive);
  console.log(`安装包已生成：${archive}`);
} finally {
  await rm(stage, { recursive: true, force: true });
}
