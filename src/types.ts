import type { Worker } from "worker_threads";

export type WorkerID = string & {};
export interface WorkerData<T = any> {
  worker_id: WorkerID;
  type: "map" | "reduce";
  data: T;
}

export interface MapperData<T, M> {
  worker_id: WorkerID;
  batch: T[];

  fn: (data: T) => M | Promise<M>;
}
export interface ReducerData<T, M> {
  worker_id: WorkerID;
  batch: T[];

  fn: (
    batch: T[],
    progress: (p: { index: number; total: number }) => void
  ) => M | Promise<M>;
}
export type KeyFn<T> = (data: T) => string | number;
export type SortFn<T> = (a: T, b: T) => number;
export type ProgressData = { index: number; total: number };
export type ProgressFn = (p: ProgressData) => void;
export type MapperFn<T, M> = (data: T) => M | Promise<M>;
export type ReducerFn<T, R> = (
  batch: T[],
  progress: ProgressFn
) => R | Promise<R>;
export interface MapRedWorker {
  create(workerData: WorkerData): Worker;
}
