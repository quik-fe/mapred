const { MapReducer } = require("../dist/main.js");

const mapReducer = new MapReducer({
  // Map: Generate random points and check if they are inside unit circle
  mapper: async (
    /**
     * @type {number[]}
     */
    points
  ) => {
    let inside = 0;
    for (let i = 0; i < points; i++) {
      const x = Math.random() * 2 - 1;
      const y = Math.random() * 2 - 1;
      if (x * x + y * y <= 1) inside++;
    }
    return { inside, total: points };
  },

  // Reduce: Calculate π from all results
  reducer: async (results) => {
    const total = results.reduce((a, b) => a + b.inside, 0);
    const points = results.reduce((a, b) => a + b.total, 0);
    return 4 * (total / points);
  },
});

mapReducer.mapReduce(new Array(10_000).fill(1_000_000)).then((result) => {
  console.log("π ≈", result[0].result);
});
