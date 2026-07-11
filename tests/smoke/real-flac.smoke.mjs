import assert from "node:assert/strict";
import { once } from "node:events";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { after, test } from "node:test";
import { createApp } from "../../server.mjs";

let server;
let tempDirectory;

after(async () => {
  if (server) {
    await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
  if (tempDirectory) await fs.rm(tempDirectory, { recursive: true, force: true });
});

test("real flac source smoke: searches, resolves, and streams full audio", async () => {
  tempDirectory = await fs.mkdtemp(path.join(os.tmpdir(), "jianyin-real-flac-"));
  const app = await createApp({ statePath: path.join(tempDirectory, "state.json") });
  server = app.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  assert.equal(typeof address, "object");
  const baseUrl = `http://127.0.0.1:${address.port}`;

  const searchResponse = await fetch(`${baseUrl}/api/flac/search?keyword=${encodeURIComponent("September Earth Wind Fire")}&limit=3`);
  assert.equal(searchResponse.status, 200);
  const search = await searchResponse.json();
  assert.ok(search.songs.length > 0);
  const first = search.songs[0];
  assert.equal(first.source, "flac");
  assert.ok(first.durationMs > 60_000);

  const songPath = first.url.replace("/api/flac/stream/", "/api/flac/song/");
  const songResponse = await fetch(`${baseUrl}${songPath}`);
  assert.equal(songResponse.status, 200);
  const song = await songResponse.json();
  assert.equal(song.verifiedPlayable, true);
  assert.ok(song.durationMs > 60_000);

  const stream = await fetch(`${baseUrl}${song.url}`, { headers: { Range: "bytes=0-65535" } });
  assert.equal(stream.status, 206);
  assert.match(stream.headers.get("content-type") ?? "", /^audio\//);
  assert.equal((await stream.arrayBuffer()).byteLength, 65_536);
});
