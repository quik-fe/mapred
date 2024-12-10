export interface WorkerData<T, M> {
  batch: T[];
  worker_id: number;

  fn: (data: T) => M | Promise<M>;
}
export interface ReducerData<T> {
  batch: T[];
  worker_id: number;

  fn: (
    batch: T[],
    progress: (p: { index: number; total: number }) => void
  ) => T[] | Promise<T[]>;
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
export type WorkerID = string & {};
