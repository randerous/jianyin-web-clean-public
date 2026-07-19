import assert from "node:assert/strict";
import { test } from "node:test";

import { createSharedStateWriter } from "../src/lib/shared-state-writer.ts";

function createDeferred() {
  let resolve;
  let reject;
  const promise = new Promise((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

async function waitFor(predicate, message) {
  const deadline = performance.now() + 1_000;
  while (!predicate()) {
    if (performance.now() >= deadline) {
      throw new Error(message);
    }
    await new Promise((resolve) => setImmediate(resolve));
  }
}

function settlePromises() {
  return new Promise((resolve) => setImmediate(resolve));
}

test("flush keeps the latest write single-flight and upgrades it to keepalive", async () => {
  const firstWrite = createDeferred();
  const writes = [];
  let active = 0;
  let maxActive = 0;

  const writer = createSharedStateWriter(async (state, options) => {
    const callIndex = writes.length;
    writes.push({ state, options });
    active += 1;
    maxActive = Math.max(maxActive, active);
    try {
      if (callIndex === 0) await firstWrite.promise;
    } finally {
      active -= 1;
    }
  }, () => {});

  writer.enqueue({ marker: "active" });
  await waitFor(() => writes.length === 1, "the first write did not start");

  writer.enqueue({ marker: "superseded" });
  writer.flush({ marker: "flushed" });
  await settlePromises();
  assert.equal(writes.length, 1, "flush must not overlap the active write");
  assert.equal(maxActive, 1);

  firstWrite.resolve();
  await waitFor(() => writes.length === 2, "the queued keepalive write did not start");
  assert.equal(writes[1].state.marker, "flushed");
  assert.deepEqual(writes[1].options, { keepalive: true });
  await waitFor(() => active === 0, "the writes did not settle");
  await settlePromises();
  assert.equal(maxActive, 1);
});

test("flush does not duplicate the exact state already being written", async () => {
  const gate = createDeferred();
  const state = { marker: "same" };
  let calls = 0;
  const writer = createSharedStateWriter(async () => {
    calls += 1;
    await gate.promise;
  }, () => {});

  writer.enqueue(state);
  await waitFor(() => calls === 1, "the active write did not start");
  writer.flush(state);
  await settlePromises();
  assert.equal(calls, 1);
  gate.resolve();
});

test("each failed write reports its actual error", async () => {
  const outcomes = ["failure", "failure", "success", "failure"];
  let calls = 0;
  const errors = [];

  const writer = createSharedStateWriter(async () => {
    const outcome = outcomes[calls];
    calls += 1;
    if (outcome === "failure") throw new Error(`state save failed ${calls}`);
  }, (error) => {
    errors.push(error);
  });

  const enqueueAndSettle = async (marker) => {
    const expectedCalls = calls + 1;
    writer.enqueue({ marker });
    await waitFor(() => calls === expectedCalls, `write ${expectedCalls} did not start`);
    await settlePromises();
  };

  await enqueueAndSettle("failure-1");
  assert.equal(errors.length, 1);
  assert.match(errors[0].message, /failed 1/);

  await enqueueAndSettle("failure-2");
  assert.equal(errors.length, 2, "a second failed user save must not be hidden by a notification latch");
  assert.match(errors[1].message, /failed 2/);

  await enqueueAndSettle("success");
  assert.equal(errors.length, 2);

  await enqueueAndSettle("failure-after-success");
  assert.equal(errors.length, 3);
  assert.match(errors[2].message, /failed 4/);
});

test("active and queued keepalive failures are both observable without overlap", async () => {
  const gate = createDeferred();
  let calls = 0;
  const errors = [];
  const writer = createSharedStateWriter(async () => {
    calls += 1;
    await gate.promise;
    throw new Error(`state save failed ${calls}`);
  }, (error) => {
    errors.push(error);
  });

  writer.enqueue({ marker: "active" });
  await waitFor(() => calls === 1, "the active write did not start");
  writer.flush({ marker: "keepalive" });
  await settlePromises();
  assert.equal(calls, 1);
  gate.resolve();
  await waitFor(() => calls === 2, "the keepalive write did not start after the active failure");
  await waitFor(() => errors.length === 2, "both failure notifications were not forwarded");
  await settlePromises();
  assert.equal(errors.length, 2);
});

test("coalescing preserves the newest state pending behind an active write", async () => {
  const firstWrite = createDeferred();
  const writes = [];

  const writer = createSharedStateWriter(async (state) => {
    const callIndex = writes.length;
    writes.push(state);
    if (callIndex === 0) await firstWrite.promise;
  }, () => {});

  writer.enqueue({ marker: "active" });
  await waitFor(() => writes.length === 1, "the first write did not start");

  writer.enqueue({ marker: "superseded-1" });
  writer.enqueue({ marker: "superseded-2" });
  writer.enqueue({ marker: "newest" });
  assert.equal(writes.length, 1);

  firstWrite.resolve();
  await waitFor(() => writes.length === 2, "the pending state was not written");
  await settlePromises();

  assert.deepEqual(writes.map((state) => state.marker), ["active", "newest"]);
});
