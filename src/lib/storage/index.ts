import Dexie, { type Table } from "dexie";

// 可重建的导航索引（数据源永远在磁盘文件，索引丢了可扫描重建）
export interface IdxWork {
  id: string;
  title: string;
  updatedAt: number;
}

export interface IdxChapter {
  workId: string;
  chId: string;
  order: number;
  title: string;
  approved: boolean;
  wordCount: number;
}

export interface IdxGeneration {
  workId: string;
  genId: string;
  chId: string;
  status: string;
  createdAt: number;
  preview: string;
}

export class IndexDB extends Dexie {
  idxWorks!: Table<IdxWork, string>;
  idxChapters!: Table<IdxChapter, [string, string]>;
  idxGenerations!: Table<IdxGeneration, [string, string]>;

  constructor() {
    super("ai-writing-index");
    this.version(1).stores({
      idxWorks: "id",
      idxChapters: "[workId+chId], workId",
      idxGenerations: "[workId+genId], workId, [workId+chId]",
    });
  }
}

export const indexDB = new IndexDB();

export async function clearWorkIndex(workId: string): Promise<void> {
  await indexDB.idxChapters.where("workId").equals(workId).delete();
  await indexDB.idxGenerations.where("workId").equals(workId).delete();
}
