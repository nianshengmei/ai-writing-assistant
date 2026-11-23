import type { OutlineEntry, ProjectDoc } from "./types";
import { isTauri } from "./env";
import { backend } from "./library";

function buildText(project: ProjectDoc, entries: OutlineEntry[], contents: Map<string, string>, format: "txt" | "md"): string {
  const head =
    format === "md"
      ? `# ${project.title}\n\n> ${project.description}\n\n`
      : `${project.title}\n\n${project.description ? project.description + "\n\n" : ""}`;
  const body = entries
    .map((e) => {
      const c = contents.get(e.chId) ?? "";
      const t = format === "md" ? `## ${e.title}\n\n` : `${e.title}\n\n`;
      return t + c + "\n\n";
    })
    .join("");
  return head + body;
}

export async function exportWork(
  project: ProjectDoc,
  entries: OutlineEntry[],
  contents: Map<string, string>,
  format: "txt" | "md",
): Promise<string> {
  const text = buildText(project, entries, contents, format);
  const filename = `${project.title}.${format === "md" ? "md" : "txt"}`;

  if (isTauri()) {
    const path = await backend.pickSavePath(filename);
    if (!path) return "已取消导出";
    await backend.exportText(path, text);
    return `已保存到 ${path}`;
  }

  const blob = new Blob([text], { type: "text/plain;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
  return "已触发浏览器下载";
}
