import assert from "node:assert/strict";
import { test } from "node:test";
import { createTtlCache } from "../server.mjs";

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

test("ttl cache stores and returns entries with their payload fields intact", () => {
  const cache = createTtlCache(60_000);
  cache.set("a", { data: { id: 1 } });
  const entry = cache.get("a");
  assert.equal(entry.data.id, 1);
  assert.ok(entry.expiresAt > Date.now());
  assert.equal(cache.has("a"), true);
  assert.equal(cache.size, 1);
});

test("ttl cache drops entries once their ttl elapses", async () => {
  const cache = createTtlCache(20);
  cache.set("a", { data: "x" });
  assert.equal(cache.get("a").data, "x");
  await sleep(40);
  assert.equal(cache.get("a"), undefined);
  assert.equal(cache.has("a"), false);
});

test("ttl cache refreshes expiry when a key is overwritten", async () => {
  const cache = createTtlCache(30);
  cache.set("a", { data: "first" });
  await sleep(20);
  cache.set("a", { data: "second" });
  await sleep(20);
  assert.equal(cache.get("a").data, "second");
});

test("ttl cache delete and clear remove entries immediately", () => {
  const cache = createTtlCache(60_000);
  cache.set("a", { data: 1 });
  cache.set("b", { data: 2 });
  cache.delete("a");
  assert.equal(cache.has("a"), false);
  assert.equal(cache.has("b"), true);
  cache.clear();
  assert.equal(cache.size, 0);
});

test("ttl cache evicts least-recently-used entries beyond max", () => {
  const cache = createTtlCache(60_000, { max: 3 });
  cache.set("a", { data: 1 });
  cache.set("b", { data: 2 });
  cache.set("c", { data: 3 });
  cache.get("a"); // touch a, so b becomes the coldest entry
  cache.set("d", { data: 4 });
  assert.equal(cache.has("b"), false);
  assert.equal(cache.has("a"), true);
  assert.equal(cache.has("c"), true);
  assert.equal(cache.has("d"), true);
  assert.equal(cache.size, 3);
});

test("ttl cache sweep removes expired entries without touching live ones", () => {
  const cache = createTtlCache(60_000, { max: 100 });
  cache.set("gone", { data: 1 });
  cache.set("live", { data: 2 });
  // Force "gone" to look expired, then trigger a sweep via a new insertion.
  cache.get("gone").expiresAt = Date.now() - 1;
  cache.set("another", { data: 3 });
  assert.equal(cache.has("gone"), false);
  assert.equal(cache.has("live"), true);
  assert.equal(cache.has("another"), true);
});

test("ttl cache still caps size at max immediately when entries are expired", () => {
  // 增量清扫下过期条目会暂留，但容量约束仍在 set 内同步生效，size 不会越过 max。
  const cache = createTtlCache(60_000, { max: 5, sweepBudget: 1 });
  for (let index = 0; index < 20; index += 1) {
    const entry = { data: index };
    cache.set(`k${index}`, entry);
    entry.expiresAt = Date.now() - 1; // 就地标记为过期，模拟滞留
  }
  assert.ok(cache.size <= 5, `size ${cache.size} 超过 max`);
  cache.set("fresh", { data: "fresh" });
  assert.ok(cache.size <= 5, `size ${cache.size} 超过 max`);
  assert.equal(cache.get("fresh").data, "fresh");
});

test("ttl cache keeps live entries when stale entries occupy capacity", () => {
  // 滞留的过期条目不得挤掉存活条目：max=4，2 条全过期后写入 2 条存活，存活条目必须都在。
  const cache = createTtlCache(60_000, { max: 4, sweepBudget: 1 });
  const staleA = { data: "stale-a" };
  const staleB = { data: "stale-b" };
  cache.set("stale-a", staleA);
  cache.set("stale-b", staleB);
  staleA.expiresAt = Date.now() - 1;
  staleB.expiresAt = Date.now() - 1;
  cache.set("live-a", { data: 1 });
  cache.set("live-b", { data: 2 });
  assert.equal(cache.get("live-a").data, 1);
  assert.equal(cache.get("live-b").data, 2);
  assert.equal(cache.has("stale-a"), false);
  assert.equal(cache.has("stale-b"), false);
});

test("ttl cache clears every expired entry once the cursor completes a full pass", () => {
  // 游标增量清扫的收敛性：全部条目过期后，连续 set 至多 ceil(size/budget)+1 次即可把过期项清空。
  const budget = 4;
  const total = 12;
  const cache = createTtlCache(60_000, { max: 100, sweepBudget: budget });
  for (let index = 0; index < total; index += 1) {
    const entry = { data: index };
    cache.set(`old${index}`, entry);
    entry.expiresAt = Date.now() - 1;
  }
  const rounds = Math.ceil(total / budget) + 1;
  for (let index = 0; index < rounds; index += 1) cache.set(`new${index}`, { data: index });
  for (let index = 0; index < total; index += 1) {
    assert.equal(cache.has(`old${index}`), false, `old${index} 未被清扫`);
  }
  assert.equal(cache.size, rounds);
});
