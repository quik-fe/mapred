import { MapReducer } from "../src/main";

const mapReducer = new MapReducer({
  // Map: Generate random points and check if they are inside unit circle
  mapper(points: number) {
    let inside = 0;
    for (let i = 0; i < points; i++) {
      const x = Math.random() * 2 - 1;
      const y = Math.random() * 2 - 1;
      if (x * x + y * y <= 1) inside++;
    }
    return { inside, total: points };
  },

  // Reduce: Calculate π from all results
  reducer(results) {
    const total = results.reduce((a, b) => a + b.inside, 0);
    const points = results.reduce((a, b) => a + b.total, 0);
    return 4 * (total / points);
  },
});

mapReducer.events.on("progress", (progress) => {
  const { mapper, reduce } = progress;
  const percentage = (mapper.index / mapper.total) * 100;
  const info = `${percentage.toFixed(2)}% [${mapper.index}/${mapper.total}] [${
    reduce.index
  }/${reduce.total}]`;

  process.stdout.write(`\r${info}`);
});
mapReducer.events.on("error", (error) => {
  console.log(error);
  process.exit(1);
});

mapReducer.mapReduce(new Array(10_000).fill(1_000_000)).then((result) => {
  console.log("");
  console.log("π ≈", result[0].result);
});

// console.log((mapReducer as any).make_reducer_worker_code());
