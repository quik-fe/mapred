# `@quik-fe/mapred`

A lightweight multi-threaded MapReduce implementation based on Node.js Worker Threads.

## Features

- Auto utilize multi-cores for parallel computing
- Support async mapper/reducer functions
- Built-in progress tracking and error handling 
- Type-safe (TypeScript)
- Zero dependencies

## Install

```bash
npm install @quik-fe/mapred
```

## Constructor Options

```typescript
new FuncWorker<T,M,R>({
  // Required: Map function that processes each input item
  mapper: (data: T) => M | Promise<M>,
  // Required: Reduce function that combines mapped results
  reducer: (batch: M[], progress: ProgressFn) => R | Promise<R>,
});

new ScriptWorker("./your_worker_script.js|ts");

new MapReducer({
  // Required: threads worker define.
  worker: MapRedWorker,
  
  // Optional: Group results by key before reducing (default: () => "task")
  keyFn?: (data: T) => string | number,
  
  // Optional: Sort mapped results before reducing (default: basic type sorting)
  sortFn?: (a: M, b: M) => number,
  
  // Optional: Number of worker threads (default: CPU cores)
  poll_size?: number
})
```

## Quick Start

```typescript
import { MapReducer } from '@quik-fe/mapred'

// 1. Define mapper and reducer
const map = (x: number) => x * 2
const reduce = (nums: number[]) => nums.reduce((a, b) => a + b)

// 2. Create instance
const worker = new FuncWorker({ map, reduce })
const mr = new MapReducer({ worker })

// 3. Run computation
const result = await mr.mapReduce([1,2,3,4,5])
```

## Example: Calculate π

```typescript
const worker = new FuncWorker({
  // Map: Generate random points and check if they are inside unit circle
  mapper: async (points: number) => {
    let inside = 0;
    for(let i = 0; i < points; i++) {
      const x = Math.random() * 2 - 1;
      const y = Math.random() * 2 - 1;
      if(x * x + y * y <= 1) inside++;
    }
    return { inside, total: points };
  },

  // Reduce: Calculate π from all results
  reducer: async (results) => {
    const total = results.reduce((a, b) => a + b.inside, 0);
    const points = results.reduce((a, b) => a + b.total, 0);
    return 4 * (total / points);
  }
});
const mapReducer = new MapReducer({worker});

const result = await mapReducer.mapReduce(new Array(1000).fill(10000));
console.log('π ≈', result[0].result);
```

## Example: Script Worker
worker.ts
```ts
import {define} from "@quik-fe/mapred";

define({
  map: (x: number) => x * 2,
  reduce: (nums: number[]) => nums.reduce((a, b) => a + b)
});
```
main.ts
```ts
import { MapReducer, ScriptWorker } from '@quik-fe/mapred';
const worker = new ScriptWorker("./worker.ts");
const mr = new MapReducer({ worker })
const result = await mr.mapReduce([1,2,3,4,5])
```


## License

MIT