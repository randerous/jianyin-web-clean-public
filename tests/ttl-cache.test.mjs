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
