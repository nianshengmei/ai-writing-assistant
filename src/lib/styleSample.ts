/** 风格提炼的素材采样与对话抽取（纯本地计算，不耗模型调用） */

export interface ChapterSpan {
  title: string;
  start: number;
}

const CHAPTER_RE = /^[ \t]*(第[0-9零一二三四五六七八九十百千万两]+[章节卷回][\s\S]{0,40}?)[ \t]*$/gm;

/** 按章节标题切分；没有章节标记时返回 null */
export function splitChapters(text: string): ChapterSpan[] | null {
  const spans: ChapterSpan[] = [];
  CHAPTER_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = CHAPTER_RE.exec(text)) !== null) {
    spans.push({ title: m[1].trim().slice(0, 50), start: m.index });
  }
  if (spans.length < 3) return null;
  return spans;
}

/**
 * 截取前 budget 字，并对齐到章节边界（避免把最后一章切半）。
 */
export function headSample(text: string, budget: number): { text: string; truncated: boolean; detectedChapters: number | null } {
  const chapters = splitChapters(text);
  if (text.length <= budget) {
    return { text, truncated: false, detectedChapters: chapters?.length ?? null };
  }
  let cut = budget;
  if (chapters) {
    // 找 budget 之前最后一个章节起点（且不少于 budget 的 30%，防止太短）
    for (let i = chapters.length - 1; i >= 1; i--) {
      if (chapters[i].start <= budget && chapters[i].start >= budget * 0.3) {
        cut = chapters[i].start;
        break;
      }
    }
  }
  return { text: text.slice(0, cut).trimEnd(), truncated: true, detectedChapters: chapters?.length ?? null };
}

/**
 * 截取后 budget 字，并对齐到章节边界（从某个章节起点开始，避免把开头一章切半）。
 */
export function tailSample(text: string, budget: number): { text: string; truncated: boolean; detectedChapters: number | null } {
  const chapters = splitChapters(text);
  if (text.length <= budget) {
    return { text, truncated: false, detectedChapters: chapters?.length ?? null };
  }
  let cut = text.length - budget;
  if (chapters) {
    // 找 cut 之后第一个章节起点（且不晚于 cut + budget 的 30%）
    for (const c of chapters) {
      if (c.start >= cut && c.start <= cut + budget * 0.3) {
        cut = c.start;
        break;
      }
    }
  }
  return { text: text.slice(cut).trimStart(), truncated: true, detectedChapters: chapters?.length ?? null };
}

/** 去掉引号内空白并规整 */
function normalizeQuote(s: string): string {
  return s.replace(/\s+/g, "").trim();
}

/**
 * 通过标点（引号）从原文抽取对话行。
 * 匹配成对中文引号 “…” / 「…」 / “…"，取包含该引号的整行（对话 + 说话人标签）。
 * 均匀取样，返回最多 maxCount 条。
 */
export function extractDialogues(text: string, maxCount = 8): string[] {
  const lines = text.split(/\n+/);
  const dialogueLines: string[] = [];
  const seen = new Set<string>();
  for (const raw of lines) {
    const line = raw.trim();
    if (line.length < 8 || line.length > 300) continue;
    // 行内需包含成对引号
    const ok =
      /["“][^"”]{4,200}["”]/.test(line) ||
      /「[^」]{4,200}」/.test(line) ||
      /『[^』]{4,200}』/.test(line);
    if (!ok) continue;
    const key = normalizeQuote(line).slice(0, 60);
    if (seen.has(key)) continue;
    seen.add(key);
    dialogueLines.push(line);
  }
  if (dialogueLines.length <= maxCount) return dialogueLines;
  // 均匀取样
  const picked: string[] = [];
  const step = dialogueLines.length / maxCount;
  for (let i = 0; i < maxCount; i++) {
    picked.push(dialogueLines[Math.floor(i * step)]);
  }
  return picked;
}

/** 把分段文本按 chunkSize 切块 */
export function chunkText(text: string, chunkSize = 8000): string[] {
  const chunks: string[] = [];
  for (let i = 0; i < text.length; i += chunkSize) chunks.push(text.slice(i, i + chunkSize));
  return chunks;
}
