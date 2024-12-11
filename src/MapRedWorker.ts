import { Worker } from "worker_threads";
import { MapperFn, MapRedWorker, ReducerFn, WorkerData } from "./types";
import { make_worker_env } from "./worker";
import { toDataUrl } from "./misc";

function serialize_func(func: Function) {
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

export class FuncWorker<T, M, R> implements MapRedWorker {
  constructor(
    readonly config: {
      reduce: ReducerFn<M, R>;
      map: MapperFn<T, M>;
    }
  ) {}

  protected make_worker_code() {
    const { map, reduce } = this.config;
    return `
${make_worker_env()};

const mapFn = (${serialize_func(map)});
const reduceFn = (${serialize_func(reduce)});

define({ mapFn, reduceFn });
  `.trim();
  }

  create(workerData: WorkerData) {
    const code = this.make_worker_code();
    const worker = new Worker(toDataUrl(code), {
      workerData,
    });
    return worker;
  }
}

export class ScriptWorker<T, M, R> implements MapRedWorker {
  constructor(readonly filename: string | URL) {}

  create(workerData: WorkerData): Worker {
    const { filename } = this;
    const is_ts = filename.toString().endsWith(".ts");
    const worker = new Worker(filename, {
      workerData,
      execArgv: is_ts ? ["--require", "ts-node/register"] : undefined,
    });
    return worker;
  }
}
