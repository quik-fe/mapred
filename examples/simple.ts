import { MapReducer } from "../src/main";

const mapperFn = (num: number) => {
  return num * num;
};

const reducerFn = async (
  batch: number[],
  progress: (p: { index: number; total: number }) => void
) => {
  const result = batch.reduce((acc, curr) => acc + curr, 0);
  progress({ index: batch.length, total: batch.length });
  return [result]; // 返回一个数组以符合框架要求
};

const data = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];

const mapReducer = new MapReducer({
  mapper: mapperFn,
  reducer: reducerFn,
});

mapReducer.events.on("progress", (progress) => {
  console.log(
    `Mapper Progress: ${progress.mapper.index}/${progress.mapper.total}`,
    `Reducer Progress: ${progress.reduce.index}/${progress.reduce.total}`
  );
});

mapReducer.events.on("result", (result, worker_id) => {
  console.log(`Worker ${worker_id} Done.`);
});

mapReducer.events.on("error", (error, worker_id) => {
  console.error(`Worker ${worker_id} Error:`, error);
});

mapReducer.events.on("done", (result) => {
  console.log("MapReduce Done, Final Result:", result);
});

(async () => {
  try {
    const finalResult = await mapReducer.mapReduce(data);
    console.log("Final Result:", finalResult);
  } catch (error) {
    console.error("Error during MapReduce:", error);
  }
})();
