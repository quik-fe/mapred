import { Worker } from "worker_threads";
import { cpus } from "os";
import { EventEmitter } from "eventemitter3";
import { KeyFn, ProgressData, SortFn, WorkerID, WorkerData } from "./types";
import { getFirstKeyOfType, IdGen } from "./misc";
import { MapRedWorker } from "./types";

export class MapReducer<T, M, R> {
  static defaultSortFn(a: any, b: any) {
    // 字符串排序
    if (typeof a === "string" && typeof b === "string") {
      return a.localeCompare(b);
    }

    // 数字排序
    if (typeof a === "number" && typeof b === "number") {
      return a - b;
    }

    // 对象排序：优先按数字键值排序，其次按字符串键值排序
    if (typeof a === "object" && typeof b === "object") {
      const key =
        getFirstKeyOfType(a, "number") || getFirstKeyOfType(a, "string");
      if (!key) {
        return 0;
      }

      if (typeof a[key] === "number" && typeof b[key] === "number") {
        return a[key] - b[key];
      } else if (typeof a[key] === "string" && typeof b[key] === "string") {
        return a[key].localeCompare(b[key]);
      }

      return 0;
    }

    return 0; // 默认相等
  }

  protected idg = new IdGen();

  protected poll_size: number;

  protected keyFn: KeyFn<T>;
  protected sortFn: SortFn<M>;
  protected worker: MapRedWorker;

  protected worker_infos = new Map<
    WorkerID,
    {
      id: WorkerID;
      workerData: WorkerData<T[]>;
      worker: Worker;
      progress: ProgressData;
    }
  >();

  events = new EventEmitter<{
    progress: (p: {
      mapper: ProgressData;
      reduce: ProgressData;
      workers: {
        progress: ProgressData;
        worker_id: WorkerID;
      }[];
    }) => void;
    result: (result: M[], worker_id: WorkerID) => void;
    error: (error: Error, worker_id: WorkerID) => void;
    done: (
      result: {
        key: keyof any;
        result: Awaited<R>;
      }[]
    ) => void;
  }>();

  constructor({
    keyFn = () => "task",
    sortFn = MapReducer.defaultSortFn,
    worker,

    poll_size = cpus().length,
  }: {
    keyFn?: KeyFn<T>;
    sortFn?: SortFn<M>;
    worker: MapRedWorker;

    poll_size?: number;
  }) {
    this.keyFn = keyFn;
    this.sortFn = sortFn;
    this.worker = worker;

    this.poll_size = poll_size;
  }

  protected emitProgress() {
    const data = {
      mapper: {
        index: 0,
        total: 0,
      },
      reduce: {
        index: 0,
        total: 0,
      },
      workers: [] as any[],
    };

    for (const info of this.worker_infos.values()) {
      const is_mapper = info.id.endsWith("_mapper");

      if (is_mapper) {
        data.mapper.index += info.progress.index;
        data.mapper.total += info.workerData.data.length;
      } else {
        data.reduce.index += info.progress.index;
        data.reduce.total += info.workerData.data.length;
      }

      data.workers.push({
        progress: info.progress,
        worker_id: info.id,
      });
    }

    this.events.emit("progress", data);
  }

  protected warp_worker<RET>(
    worker: Worker,
    worker_id: WorkerID,
    workerData: WorkerData<any[]>
  ) {
    const worker_info = {
      id: worker_id,
      workerData,
      worker,
      progress: {
        index: 0,
        total: workerData.data.length,
      },
    };
    this.worker_infos.set(worker_id, worker_info);

    const task = new Promise<RET>((resolve, reject) => {
      worker.on("message", (data) => {
        switch (data.type) {
          case "error":
            // NOT reject
            this.events.emit("error", new Error(data.message), worker_id);
            break;
          case "progress":
            worker_info.progress = {
              index: data.index,
              total: data.total,
            };
            this.emitProgress();
            break;
          case "result":
            this.events.emit("result", data.result, worker_id);
            resolve(data.result);
            process.nextTick(() => {
              worker.terminate();
            });
            break;
        }
      });
      worker.once("error", reject);
      worker.once("exit", (code) => {
        if (code !== 0) {
          reject(new Error(`Worker stopped with exit code ${code}`));
        }
      });
    });

    return { worker, task };
  }

  async mapReduce(data: T[]) {
    const batches = this.split(data);
    const mappers = batches.map((batch) => {
      const id = this.idg.next() + "_mapper";
      const workerData = {
        data: batch,
        worker_id: id,
        type: "map",
      } as const;
      const worker = this.worker.create(workerData);
      return this.warp_worker<M[]>(worker, id, workerData);
    });
    const mapped = await Promise.all(
      mappers.map(async (m, index) => ({
        batch: batches[index],
        result: await m.task,
      }))
    );
    const grouped = this.combine(mapped);
    const reducers = grouped.map((group) => {
      const id = this.idg.next() + "_reducer";
      const workerData = {
        data: group.items,
        worker_id: id,
        type: "reduce",
      } as const;
      const worker = this.worker.create(workerData);
      return this.warp_worker<R>(worker, id, workerData);
    });
    const result = await Promise.all(
      reducers.map(async (r, index) => ({
        key: grouped[index].key,
        result: await r.task,
      }))
    );
    this.events.emit("done", result);
    return result;
  }

  protected combine(mapped: { batch: T[]; result: M[] }[]) {
    const flat_data = mapped.flatMap(({ batch, result }) => {
      return batch.flatMap((data, i) => ({
        data,
        result: result[i],
      }));
    });

    const grouped = new Map<keyof any, M[]>();
    for (const { data, result } of flat_data) {
      const key = this.keyFn(data);
      if (!grouped.has(key)) {
        grouped.set(key, []);
      }
      grouped.get(key)!.push(result);
    }

    // sort
    for (const [key, group] of grouped) {
      const sorted = group.sort(this.sortFn);
      grouped.set(key, sorted);
    }
    return Array.from(grouped.entries()).map(([key, items]) => ({
      key,
      items,
    }));
  }

  protected split(data: T[]): T[][] {
    const batch_size = Math.ceil(data.length / this.poll_size);
    const batches = [] as T[][];
    for (let i = 0; i < data.length; i += batch_size) {
      batches.push(data.slice(i, i + batch_size));
    }
    return batches;
  }
}
