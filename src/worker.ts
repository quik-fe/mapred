import type { ReducerData, MapperData, WorkerID, WorkerData } from "./types";
import type * as WorkerThreads from "worker_threads";

type WorkerThreadsModule = typeof WorkerThreads;

// Webpack hack
declare function __non_webpack_require__(module: string): any;

export function worker_threads(): Promise<WorkerThreadsModule> {
  return typeof __non_webpack_require__ === "function"
    ? new Function("", `return __non_webpack_require__("worker_threads")`)()
    : typeof require === "function"
    ? new Function("require", `return require("worker_threads")`)(require)
    : new Function("", `return import("worker_threads")`)();
}

export const worker_polyfill = `
/**
 * noop
 */
`;

export async function message_channel(worker_id: WorkerID) {
  // NOTE: 这个需要写在函数体里面，因为顶层导入有可能被打包重命名
  const { parentPort } = await worker_threads();
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
    onDone(message: { result: any }) {
      pt0.postMessage({
        type: "result",
        worker_id,
        result: message.result,
      });
    },
  };
}

export async function mapper_main<T, M>(data: MapperData<T, M>) {
  const { batch, worker_id, fn } = data;
  const { onError, onProgress, onDone } = await message_channel(worker_id);
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

export async function reducer_main<T, M>(data: ReducerData<T, M>) {
  const { batch, worker_id, fn } = data;
  const { onError, onProgress, onDone } = await message_channel(worker_id);
  try {
    const results = await fn(batch, onProgress);
    onDone({ result: results });
  } catch (error) {
    onError(error);
  } finally {
    process.exit();
  }
}

export async function define<T, M, R>({
  map,
  reduce,
}: {
  map: MapperData<T, M>["fn"];
  reduce: ReducerData<M, R>["fn"];
}) {
  const { workerData } = await worker_threads();
  const { worker_id, data, type } = workerData as WorkerData;

  switch (type) {
    case "map": {
      await mapper_main<T, M>({ worker_id, batch: data, fn: map });
      break;
    }
    case "reduce": {
      await reducer_main<M, R>({ worker_id, batch: data, fn: reduce });
      break;
    }
    default: {
      throw new Error("Unknown type");
    }
  }
}

export function make_worker_env() {
  return `
${worker_polyfill};

${worker_threads.toString()};

${message_channel.toString()};

${reducer_main.toString()};

${mapper_main.toString()};

${define.toString()};
  `;
}
