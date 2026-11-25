/** 外观皮肤：背景图存 config.json（随数据目录同步），主题由 next-themes 存 localStorage */
import { loadConfig, saveConfig } from "./library";
import type { SkinConfig } from "./types";

/** 皮肤变更后广播此事件，BackgroundLayer 监听并即时刷新 */
export const SKIN_EVENT = "skin-changed";

export async function getSkin(): Promise<SkinConfig> {
  try {
    const c = await loadConfig();
    return c.skin ?? {};
  } catch {
    return {};
  }
}

export async function saveSkin(patch: Partial<SkinConfig>): Promise<SkinConfig> {
  const c = await loadConfig();
  const skin: SkinConfig = { ...(c.skin ?? {}), ...patch };
  await saveConfig({ ...c, skin });
  if (typeof window !== "undefined") window.dispatchEvent(new Event(SKIN_EVENT));
  return skin;
}

/** 图片压缩：最长边 1920px，JPEG 质量 0.82，返回 data URL */
export async function compressImage(file: File): Promise<string> {
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const el = new Image();
      el.onload = () => resolve(el);
      el.onerror = () => reject(new Error("图片解析失败"));
      el.src = url;
    });
    const MAX = 1920;
    const scale = Math.min(1, MAX / Math.max(img.width, img.height));
    const w = Math.max(1, Math.round(img.width * scale));
    const h = Math.max(1, Math.round(img.height * scale));
    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    canvas.getContext("2d")!.drawImage(img, 0, 0, w, h);
    return canvas.toDataURL("image/jpeg", 0.82);
  } finally {
    URL.revokeObjectURL(url);
  }
}
