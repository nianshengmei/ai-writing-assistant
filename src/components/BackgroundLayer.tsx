"use client";

import { useEffect, useState } from "react";
import { getSkin, SKIN_EVENT } from "@/lib/skin";
import type { SkinConfig } from "@/lib/types";

/** 全局自定义背景层：贴在内容之下，dim 控制暗化以保障可读性 */
export default function BackgroundLayer() {
  const [skin, setSkin] = useState<SkinConfig | null>(null);

  useEffect(() => {
    const load = () => {
      getSkin().then(setSkin).catch(() => undefined);
    };
    load();
    window.addEventListener(SKIN_EVENT, load);
    return () => window.removeEventListener(SKIN_EVENT, load);
  }, []);

  if (!skin?.background) return null;
  const dim = Math.min(Math.max(skin.dim ?? 0.45, 0), 0.85);

  return (
    <div className="pointer-events-none fixed inset-0 -z-10">
      <div
        className="absolute inset-0 bg-cover bg-center"
        style={{ backgroundImage: `url("${skin.background}")` }}
      />
      <div className="absolute inset-0 bg-black" style={{ opacity: dim }} />
    </div>
  );
}
