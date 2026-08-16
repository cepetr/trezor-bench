/**
 * Unit tests for the trailing-edge debouncer.
 *
 * Uses short real timers (no fake-timer library in the toolchain); delays
 * are kept small to keep the suite fast while staying comfortably above
 * scheduler jitter.
 */
import * as assert from "assert";
import { Debouncer } from "../../../util/debouncer";

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

suite("Debouncer", () => {
  test("runs the callback once after the delay elapses", async () => {
    let calls = 0;
    const debouncer = new Debouncer(20, () => calls++);

    debouncer.schedule();
    assert.strictEqual(calls, 0);

    await sleep(60);
    assert.strictEqual(calls, 1);
    debouncer.dispose();
  });

  test("coalesces rapid schedule() calls into a single run", async () => {
    let calls = 0;
    const debouncer = new Debouncer(20, () => calls++);

    debouncer.schedule();
    debouncer.schedule();
    debouncer.schedule();

    await sleep(60);
    assert.strictEqual(calls, 1);
    debouncer.dispose();
  });

  test("rescheduling restarts the delay", async () => {
    let calls = 0;
    const debouncer = new Debouncer(50, () => calls++);

    debouncer.schedule();
    await sleep(30);
    debouncer.schedule();
    await sleep(30);
    // 60ms after the first schedule(), but only 30ms after the second —
    // the trailing edge has not been reached yet.
    assert.strictEqual(calls, 0);

    await sleep(50);
    assert.strictEqual(calls, 1);
    debouncer.dispose();
  });

  test("dispose() cancels a pending run", async () => {
    let calls = 0;
    const debouncer = new Debouncer(20, () => calls++);

    debouncer.schedule();
    debouncer.dispose();

    await sleep(60);
    assert.strictEqual(calls, 0);
  });

  test("can be scheduled again after the callback has run", async () => {
    let calls = 0;
    const debouncer = new Debouncer(20, () => calls++);

    debouncer.schedule();
    await sleep(60);
    debouncer.schedule();
    await sleep(60);

    assert.strictEqual(calls, 2);
    debouncer.dispose();
  });

  test("dispose() is a no-op when nothing is pending", async () => {
    let calls = 0;
    const debouncer = new Debouncer(20, () => calls++);

    debouncer.dispose();

    debouncer.schedule();
    await sleep(60);
    assert.strictEqual(calls, 1);

    // Disposing after the callback already ran must not throw either.
    debouncer.dispose();
  });
});
