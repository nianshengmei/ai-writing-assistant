"use client";

import { useState } from "react";
import HomeView from "@/components/HomeView";
import ProjectView from "@/components/ProjectView";
import BackgroundLayer from "@/components/BackgroundLayer";

export default function Page() {
  const [workId, setWorkId] = useState<string | null>(null);

  return (
    <>
      <BackgroundLayer />
      {workId ? <ProjectView workId={workId} onBack={() => setWorkId(null)} /> : <HomeView onOpen={setWorkId} />}
    </>
  );
}
