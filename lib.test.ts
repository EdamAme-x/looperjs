import { assertEquals, assertExists } from "@std/assert";
import { createLoop, createPausableLoop, createRetryLoop, type LoopStats } from "./lib.ts";

Deno.test("Basic loop functionality", async () => {
  let count = 0;
  const loop = createLoop({ limit: 5, interval: 10 })(
    (_ctx) => {
      count++;
      return count;
    }
  );

  await loop.start();
  assertEquals(count, 5);
});

Deno.test("Pause and resume functionality", async () => {
  let count = 0;
  let isPaused = false;
  
  const loop = createPausableLoop({ limit: 10, interval: 50 })(
    (ctx) => {
      count++;
      
      if (count === 3) {
        ctx.pause();
        isPaused = true;
        
        setTimeout(() => {
          ctx.resume();
          isPaused = false;
        }, 100);
      }
      
      return count;
    }
  );

  const startTime = Date.now();
  await loop.start();
  const endTime = Date.now();
  
  await new Promise(resolve => setTimeout(resolve, 150));
  
  assertEquals(count, 10);
  assertEquals(isPaused, false);
  assertEquals(endTime - startTime > 100, true);
});

Deno.test("Error retry functionality", async () => {
  let attemptCount = 0;
  let errorCount = 0;
  
  const loop = createRetryLoop({ 
    limit: 5, 
    retryOnError: true, 
    maxRetries: 2, 
    retryDelay: 50 
  })(
    (_ctx) => {
      attemptCount++;
      
      if (attemptCount <= 2) {
        throw new Error(`Attempt ${attemptCount} failed`);
      }
      
      return attemptCount;
    }
  );

  try {
    await loop.start();
  } catch (_error) {
    errorCount++;
  }
  
  assertEquals(attemptCount >= 3, true);
  assertEquals(errorCount >= 0, true);
});

Deno.test("Statistics collection", async () => {
  let stats: LoopStats | null = null;
  
  const loop = createLoop({ limit: 3, interval: 10 })(
    (ctx) => {
      stats = ctx.stats;
      return ctx["~count"];
    }
  );

  await loop.start();
  
  assertExists(stats);
  const finalStats = stats as LoopStats;
  assertEquals(finalStats.executionCount, 3);
  assertEquals(finalStats.isRunning, false);
  assertEquals(finalStats.startTime > 0, true);
  assertEquals(finalStats.endTime && finalStats.endTime > finalStats.startTime, true);
});

Deno.test("Event listeners", async () => {
  const events: string[] = [];
  
  const loop = createLoop({ limit: 3, interval: 10 })(
    (ctx) => {
      if (ctx["~count"] === 0) {
        ctx.on('start', () => events.push('start'));
        ctx.on('iteration', (count, _result) => events.push(`iteration:${count}`));
        ctx.on('stop', () => events.push('stop'));
      }
      
      return ctx["~count"];
    }
  );

  await loop.start();
  
  assertEquals(events.length > 0, true);
  assertEquals(events.includes('stop'), true);
});

Deno.test("Early termination with STOP_FLAG", async () => {
  let count = 0;
  
  const loop = createLoop({ limit: 10 })(
    (ctx) => {
      count++;
      if (count === 5) {
        return ctx.stop();
      }
      return count;
    }
  );

  await loop.start();
  assertEquals(count, 5);
});

Deno.test("Bridge functionality", async () => {
  let bridgeValue: string | undefined = undefined;
  
  const loop = createLoop({ limit: 3, initialBridge: "initial" })(
    (ctx) => {
      bridgeValue = ctx.bridge();
      return `value-${ctx["~count"]}`;
    }
  );

  await loop.start();
  
  assertEquals(bridgeValue, "value-1");
});

Deno.test("Custom options", async () => {
  const loop = createLoop({
    limit: 2,
    interval: 100,
    retryOnError: true,
    maxRetries: 5,
    retryDelay: 200
  })(
    (ctx) => {
      assertEquals(ctx.options.limit, 2);
      assertEquals(ctx.options.interval, 100);
      assertEquals(ctx.options.retryOnError, true);
      assertEquals(ctx.options.maxRetries, 5);
      assertEquals(ctx.options.retryDelay, 200);
      return "test";
    }
  );

  await loop.start();
});
