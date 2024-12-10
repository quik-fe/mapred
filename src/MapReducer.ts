import { Worker } from "worker_threads";
import { cpus } from "os";
import { EventEmitter } from "eventemitter3";
import {
  KeyFn,
  MapperFn,
  ProgressData,
  ReducerData,
  ReducerFn,
  SortFn,
  WorkerData,
  WorkerID,
} from "./types";
import { getFirstKeyOfType, IdGen, toDataUrl } from "./misc";

const worker_polyfill = `
/**
 * noop
 */
`;

async function port_handlers(worker_id: number) {
  // NOTE: 这个需要写在函数体里面，因为顶层导入有可能被打包重命名
  const { parentPort } = await new Function(
    "x",
    `return import("worker_threads")`
  )();
  if (!parentPort) {
    throw new Error("No parent port");
  }
  const pt0 = parentPort;
  return {
    onError(err: unknown) {
      pt0.postMessage({
        type: "error",
        worker_id,
        message: err instanceof Error ? err.message : String(err),
        stack: err instanceof Error ? err.stack : undefined,
      });
    },
    onProgress(message: { index: number; total: number }) {
      pt0.postMessage({
        type: "progress",
        worker_id,
        index: message.index,
        total: message.total,
      });
    },
    onDone(message: { result: any[] }) {
      pt0.postMessage({
        type: "result",
        worker_id,
        result: message.result,
      });
    },
  };
}

export async function mapper_worker<T, M>(data: WorkerData<T, M>) {
  let { batch, worker_id, fn } = data;

  if (typeof fn === "string") {
    const build = new Function("fn", `return (${fn});`);
    fn = build(fn);
  }

  const { onError, onProgress, onDone } = await port_handlers(worker_id);
  const results = [] as M[];
  const progress = {
    index: 0,
    total: batch.length,
  };
  for (const data of batch) {
    try {
      const result = await fn(data);
      results.push(result);
      progress.index++;
      onProgress(progress);
    } catch (error) {
      onError(error);
    }
  }
  onDone({ result: results });
  process.exit();
}

export async function reducer_worker<T>(data: ReducerData<T>) {
  let { batch, worker_id, fn } = data;

  if (typeof fn === "string") {
    const build = new Function("fn", `return (${fn});`);
    fn = build(fn);
  }

  const { onError, onProgress, onDone } = await port_handlers(worker_id);
  try {
    const results = await fn(batch, onProgress);
    onDone({ result: results });
  } catch (error) {
    onError(error);
  } finally {
    process.exit();
  }
}

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
  protected mapper: MapperFn<T, M>;
  protected reducer: ReducerFn<M, R>;

  protected worker_infos = new Map<
    WorkerID,
    {
      id: WorkerID;
      workerData: WorkerData<T, M>;
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
    mapper,
    reducer,

    poll_size = cpus().length,
  }: {
    keyFn?: KeyFn<T>;
    sortFn?: SortFn<M>;
    reducer: ReducerFn<M, R>;
    mapper: MapperFn<T, M>;

    poll_size?: number;
  }) {
    this.keyFn = keyFn;
    this.sortFn = sortFn;
    this.mapper = mapper;
    this.reducer = reducer;

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
        data.mapper.total += info.workerData.batch.length;
      } else {
        data.reduce.index += info.progress.index;
        data.reduce.total += info.workerData.batch.length;
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
    workerData: WorkerData<T, M>
  ) {
    const worker_info = {
      id: worker_id,
      workerData,
      worker,
      progress: {
        index: 0,
        total: workerData.batch.length,
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
      const { worker, workerData } = this.create_mapper_worker(batch, id);
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
      const { worker, workerData } = this.create_reducer_worker(
        group.items,
        id
      );
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

  protected make_worker_code_base(code: string) {
    return `
import { Worker, parentPort, workerData } from "worker_threads";
${worker_polyfill};
${port_handlers.toString()};
${code}
  `.trim();
  }

  protected make_reducer_worker_code() {
    return this.make_worker_code_base(
      `(${reducer_worker.toString()})(workerData);`
    );
  }

  protected make_mapper_worker_code() {
    return this.make_worker_code_base(
      `(${mapper_worker.toString()})(workerData);`
    );
  }

  protected serialize_func(func: Function) {
    const serialized = func.toString();
    if (serialized.startsWith("function")) {
      return serialized;
    }
    if (serialized.startsWith("(")) {
      return serialized;
    }
    if (serialized.startsWith("async")) {
      return serialized;
    }
    // object attribute
    return `function ${serialized}`;
  }

  protected create_worker(workerData: any, code: string) {
    const worker = new Worker(toDataUrl(code), {
      workerData,
    });
    return { worker, workerData };
  }

  protected create_mapper_worker(batch: T[], worker_id: WorkerID) {
    return this.create_worker(
      {
        batch,
        worker_id,
        fn: this.serialize_func(this.mapper),
      },
      this.make_mapper_worker_code()
    );
  }

  protected create_reducer_worker(batch: M[], worker_id: WorkerID) {
    return this.create_worker(
      {
        batch,
        worker_id,
        fn: this.serialize_func(this.reducer),
      },
      this.make_reducer_worker_code()
    );
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
