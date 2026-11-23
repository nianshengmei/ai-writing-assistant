"use client";

import { useState } from "react";
import HomeView from "@/components/HomeView";
import ProjectView from "@/components/ProjectView";

export default function Page() {
  const [workId, setWorkId] = useState<string | null>(null);

  if (workId) {
    return <ProjectView workId={workId} onBack={() => setWorkId(null)} />;
  }
  return <HomeView onOpen={setWorkId} />;
}
