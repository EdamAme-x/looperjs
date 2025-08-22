interface LoopOptions<T> {
  limit?: number;
  interval?: number;
  initialBridge?: T | undefined;
  retryOnError?: boolean;
  maxRetries?: number;
  retryDelay?: number;
}

export interface LoopStats {
  startTime: number;
  endTime?: number;
  executionCount: number;
  errorCount: number;
  retryCount: number;
  totalExecutionTime: number;
  averageExecutionTime: number;
  isRunning: boolean;
  isPaused: boolean;
}

interface LoopEvents<T> {
  start: () => void;
  stop: () => void;
  pause: () => void;
  resume: () => void;
  error: (error: Error, attempt: number) => void;
  retry: (error: Error, attempt: number) => void;
  iteration: (count: number, result: T | undefined) => void;
}

interface LoopContext<T> {
  options: Readonly<LoopOptions<T>>;
  "~count": number;
  bridge: () => T | undefined;
  stop: () => typeof STOP_FLAG;
  pause: () => void;
  resume: () => void;
  stats: LoopStats;
  on: <K extends keyof LoopEvents<T>>(
    event: K,
    listener: LoopEvents<T>[K]
  ) => void;
  off: <K extends keyof LoopEvents<T>>(
    event: K,
    listener: LoopEvents<T>[K]
  ) => void;
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const STOP_FLAG = Symbol("stop");

export const createLoop = <T>(options: Readonly<LoopOptions<T>> = {}) => {
  const defaultOptions = {
    limit: options.limit || Infinity,
    interval: options.interval || 0,
    initialBridge: options.initialBridge as T | undefined,
    retryOnError: options.retryOnError || false,
    maxRetries: options.maxRetries || 3,
    retryDelay: options.retryDelay || 1000,
  };

  return <A extends unknown[]>(
    loopFn: (
      ctx: LoopContext<T>,
      ...args: A
    ) =>
      | void
      | typeof STOP_FLAG
      | T
      | undefined
      | Promise<void | typeof STOP_FLAG | T | undefined>
  ) => {
    const baseCtx: LoopContext<T> = {
      options: defaultOptions,
      "~count": 0,
      bridge: () => defaultOptions.initialBridge,
      stop: () => STOP_FLAG,
      pause: () => {},
      resume: () => {},
      stats: {
        startTime: 0,
        executionCount: 0,
        errorCount: 0,
        retryCount: 0,
        totalExecutionTime: 0,
        averageExecutionTime: 0,
        isRunning: false,
        isPaused: false,
      },
      on: () => {},
      off: () => {},
    };

    return {
      start: async (...args: A): Promise<void> => {
        const ctx: LoopContext<T> = { ...baseCtx };
        const events = new Map<keyof LoopEvents<T>, Set<(...args: unknown[]) => void>>();
        
        ctx.on = <K extends keyof LoopEvents<T>>(
          event: K,
          listener: LoopEvents<T>[K]
        ) => {
          if (!events.has(event)) {
            events.set(event, new Set());
          }
          events.get(event)!.add(listener as (...args: unknown[]) => void);
        };

        ctx.off = <K extends keyof LoopEvents<T>>(
          event: K,
          listener: LoopEvents<T>[K]
        ) => {
          const listeners = events.get(event);
          if (listeners) {
            listeners.delete(listener as (...args: unknown[]) => void);
          }
        };

        const emit = <K extends keyof LoopEvents<T>>(
          event: K,
          ...args: unknown[]
        ) => {
          const listeners = events.get(event);
          if (listeners) {
            listeners.forEach((listener) => listener(...args));
          }
        };

        let isPaused = false;
        let pausePromise: Promise<void> | null = null;
        let pauseResolve: (() => void) | null = null;

        ctx.pause = () => {
          if (!isPaused) {
            isPaused = true;
            pausePromise = new Promise<void>((resolve) => {
              pauseResolve = resolve;
            });
            ctx.stats.isPaused = true;
            emit("pause");
          }
        };

        ctx.resume = () => {
          if (isPaused && pauseResolve) {
            isPaused = false;
            pauseResolve();
            pauseResolve = null;
            pausePromise = null;
            ctx.stats.isPaused = false;
            emit("resume");
          }
        };

        ctx.stats.startTime = Date.now();
        ctx.stats.isRunning = true;
        emit("start");

        let retryCount = 0;
        const limit = defaultOptions.limit;

        while (ctx["~count"] < limit) {
          try {
            if (isPaused && pausePromise) {
              await pausePromise;
            }

            const startTime = Date.now();
            const result = await loopFn(ctx, ...(args as A));

            if (result === STOP_FLAG) {
              break;
            } else {
              ctx.bridge = () => result as T | undefined;
            }

            const executionTime = Date.now() - startTime;
            ctx.stats.totalExecutionTime += executionTime;
            ctx.stats.executionCount++;
            ctx.stats.averageExecutionTime =
              ctx.stats.totalExecutionTime / ctx.stats.executionCount;

            emit("iteration", ctx["~count"], result as T | undefined);

            ctx["~count"]++;
            retryCount = 0;

            if (defaultOptions.interval) {
              await sleep(defaultOptions.interval);
            }
          } catch (error) {
            ctx.stats.errorCount++;
            emit("error", error as Error, retryCount + 1);

            if (
              defaultOptions.retryOnError &&
              retryCount < defaultOptions.maxRetries
            ) {
              retryCount++;
              ctx.stats.retryCount++;
              emit("retry", error as Error, retryCount);

              if (defaultOptions.retryDelay) {
                await sleep(defaultOptions.retryDelay);
              }

              continue;
            } else {

              ctx["~count"]++;
              throw error;
            }
          }
        }

        ctx.stats.endTime = Date.now();
        ctx.stats.isRunning = false;
        emit("stop");
      },
    };
  };
};

export const createPausableLoop = <T>(options: LoopOptions<T> = {}): ReturnType<typeof createLoop<T>> => {
  return createLoop(options);
};

export const createRetryLoop = <T>(
  options: LoopOptions<T> & { retryOnError: true } = { retryOnError: true }
): ReturnType<typeof createLoop<T>> => {
  return createLoop(options);
};
