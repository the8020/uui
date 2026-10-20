import { assertEquals } from "@std/assert";
import { concurrencyLimit } from "./limiter.ts";

Deno.test("concurrency limit runs tasks in order without exceeding the bound", async () => {
  const run = concurrencyLimit(2);
  let active = 0;
  let peak = 0;
  const started: number[] = [];
  const results = await Promise.all(
    [0, 1, 2, 3, 4].map((index) =>
      run(async () => {
        started.push(index);
        active++;
        peak = Math.max(peak, active);
        await new Promise((resolve) => setTimeout(resolve, 5));
        active--;
        if (index === 1) throw new Error("failed");
        return index;
      }).catch(() => -1)
    ),
  );
  assertEquals(results, [0, -1, 2, 3, 4]);
  assertEquals(started, [0, 1, 2, 3, 4]);
  assertEquals(peak, 2);
  assertEquals(await run(() => Promise.resolve("free")), "free");
});
