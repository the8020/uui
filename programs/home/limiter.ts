/**
 * Runs at most `limit` tasks at a time; later tasks wait in arrival order.
 * One limiter per Home session bounds all overlapping tile data requests.
 */
export function concurrencyLimit(limit: number) {
  let running = 0;
  const waiting: Array<() => void> = [];
  return async function run<T>(task: () => Promise<T>): Promise<T> {
    if (running >= limit) {
      await new Promise<void>((resolve) => waiting.push(resolve));
    } else {
      running++;
    }
    try {
      return await task();
    } finally {
      const next = waiting.shift();
      if (next === undefined) running--;
      else next();
    }
  };
}
