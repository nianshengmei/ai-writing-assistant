/** 宽松解析模型返回的 JSON（容忍 ```json 包裹与前后废话） */
export function parseJsonLoose<T>(text: string): T | null {
  if (!text) return null;
  const cleaned = text.replace(/```json|```/g, "").trim();
  const start = cleaned.indexOf("{");
  const end = cleaned.lastIndexOf("}");
  if (start < 0 || end < 0) return null;
  try {
    return JSON.parse(cleaned.slice(start, end + 1)) as T;
  } catch {
    return null;
  }
}

/** 宽松解析 JSON 数组 */
export function parseJsonArrayLoose<T>(text: string): T[] | null {
  if (!text) return null;
  const cleaned = text.replace(/```json|```/g, "").trim();
  const start = cleaned.indexOf("[");
  const end = cleaned.lastIndexOf("]");
  if (start < 0 || end < 0) return null;
  try {
    const v = JSON.parse(cleaned.slice(start, end + 1));
    return Array.isArray(v) ? (v as T[]) : null;
  } catch {
    return null;
  }
}
