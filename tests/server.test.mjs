import assert from "node:assert/strict";
import { once } from "node:events";
import { resolve } from "node:path";
import { afterEach, test } from "node:test";
import { createApp } from "../server.mjs";

const servers = [];

function song(id, name = `Song ${id}`) {
  return {
    id,
    name,
    ar: [{ name: `Artist ${id}` }],
    al: { picUrl: `/cover-${id}.png` }
  };
}

function urlData(overrides) {
  return {
    url: `https://audio.test/${Math.random()}.mp3`,
    time: 65_000,
    br: 320000,
    level: "exhigh",
    type: "mp3",
    ...overrides
  };
}

function urlResponse(id, byId) {
  return {
    body: {
      data: String(id).split(",").map((item) => ({ id: Number(item), ...byId[item] }))
    }
  };
}

async function startTestServer(options) {
  const app = await createApp(options);
  const server = app.listen(0, "127.0.0.1");
  servers.push(server);
  await once(server, "listening");
  const address = server.address();
  assert.equal(typeof address, "object");
  return `http://127.0.0.1:${address.port}`;
}

async function getJson(url, init) {
  const response = await fetch(url, init);
  const body = await response.json();
  return { response, body };
}

async function assertEventually(assertion, timeoutMs = 500, intervalMs = 10) {
  const startedAt = Date.now();
  let lastError;
  while (Date.now() - startedAt < timeoutMs) {
    try {
      assertion();
      return;
    } catch (error) {
      lastError = error;
      await new Promise((resolve) => setTimeout(resolve, intervalMs));
    }
  }
  assertion();
  if (lastError) throw lastError;
}

afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => new Promise((resolve, reject) => {
    server.close((error) => error ? reject(error) : resolve());
  })));
});

test("search returns only server-verified full playable Netease songs", async () => {
  const neteaseClient = {
	    async search() {
	      return { body: { result: { songs: [song(1), song(2), song(3), song(4), song(5)] } } };
	    },
    async song_url({ id }) {
      const byId = {
        "1": urlData({ url: "https://audio.test/full.mp3", time: 65_000 }),
	        "2": urlData({ url: "", time: 65_000 }),
	        "3": urlData({ freeTrialInfo: { start: 0, end: 30_000 }, time: 65_000 }),
	        "4": urlData({ url: "https://audio.test/short.mp3", time: 30_000 }),
	        "5": urlData({ url: "https://audio.test/exact.mp3", time: 60_000 })
	      };
      return urlResponse(id, byId);
    },
    async lyric() {
      return { body: { lrc: { lyric: "" } } };
    }
  };
  const baseUrl = await startTestServer({ neteaseClient });

  const { response, body } = await getJson(`${baseUrl}/api/netease/search?keyword=test&limit=20`);

  assert.equal(response.status, 200);
  assert.equal(body.songs.length, 1);
  assert.equal(body.songs[0].id, "netease_1");
	  assert.equal(body.songs[0].url, "/api/netease/stream/1?quality=exhigh");
	  assert.equal(body.songs[0].verifiedPlayable, true);
	  assert.ok(body.songs[0].durationMs > 60_000);
	  assert.equal(body.filtered, 4);
	});

	test("search uses Android default exhigh quality while keeping full-playable filtering", async () => {
	  const requested = [];
	  const neteaseClient = {
    async search() {
      return { body: { result: { songs: [song(10), song(11)] } } };
    },
	    async song_url_v1({ id, level }) {
	      requested.push({ id, level });
	      return urlResponse(id, {
	        "10": urlData({ url: "https://audio.test/exhigh.mp3", time: 65_000, br: 320000, level: "exhigh", type: "mp3" }),
	        "11": urlData({ url: "https://audio.test/short.mp3", time: 30_000, br: 320000, level: "exhigh", type: "mp3" })
	      });
    },
    async song_url() {
      throw new Error("legacy song_url should not be called when song_url_v1 exists");
    }
  };
  const baseUrl = await startTestServer({ neteaseClient });

	  const { response, body } = await getJson(`${baseUrl}/api/netease/search?keyword=test&limit=20`);

	  assert.equal(response.status, 200);
	  assert.deepEqual(requested, [{ id: "10,11", level: "exhigh" }, { id: "11", level: "standard" }]);
	  assert.equal(body.songs.length, 1);
	  assert.equal(body.songs[0].id, "netease_10");
	  assert.equal(body.songs[0].level, "exhigh");
	  assert.equal(body.songs[0].type, "mp3");
	  assert.equal(body.songs[0].br, 320000);
	});

	test("search honors explicit lossless quality and exposes returned metadata", async () => {
	  const requested = [];
	  const neteaseClient = {
	    async search() {
	      return { body: { result: { songs: [song(10)] } } };
	    },
	    async song_url_v1({ id, level }) {
	      requested.push({ id, level });
	      return urlResponse(id, {
	        "10": urlData({ url: "https://audio.test/lossless.flac", time: 65_000, br: 999000, level: "lossless", type: "flac" })
	      });
	    },
	    async song_url() {
	      throw new Error("legacy song_url should not be called when song_url_v1 exists");
	    }
	  };
	  const baseUrl = await startTestServer({ neteaseClient });

	  const { response, body } = await getJson(`${baseUrl}/api/netease/search?keyword=test&limit=20&quality=lossless`);

	  assert.equal(response.status, 200);
	  assert.deepEqual(requested, [{ id: "10", level: "lossless" }]);
	  assert.equal(body.songs[0].url, "/api/netease/stream/10?quality=lossless");
	  assert.equal(body.songs[0].level, "lossless");
	  assert.equal(body.songs[0].type, "flac");
	  assert.equal(body.songs[0].audioType, "flac");
	  assert.equal(body.songs[0].br, 999000);
	});

test("song resolve rejects no-url, trial, and 30-second playback data", async () => {
  const neteaseClient = {
    async song_url({ id }) {
	      const byId = {
	        "1": urlData({ url: "https://audio.test/full.mp3", time: 65_000 }),
	        "2": urlData({ url: "", time: 65_000 }),
	        "3": urlData({ freeTrialInfo: { start: 0, end: 30_000 }, time: 65_000 }),
	        "4": urlData({ url: "https://audio.test/short.mp3", time: 30_000 }),
	        "5": urlData({ url: "https://audio.test/exact.mp3", time: 60_000 })
	      };
      return urlResponse(id, byId);
    },
    async lyric() {
      return { body: { lrc: { lyric: "[00:00.00]full lyric" } } };
    }
  };
  const baseUrl = await startTestServer({ neteaseClient });

  const valid = await getJson(`${baseUrl}/api/netease/song/1`);
  assert.equal(valid.response.status, 200);
	  assert.equal(valid.body.url, "/api/netease/stream/1?quality=exhigh");
  assert.equal(valid.body.verifiedPlayable, true);
  assert.ok(valid.body.durationMs > 60_000);
  assert.equal(valid.body.lrc, "[00:00.00]full lyric");

  const noUrl = await getJson(`${baseUrl}/api/netease/song/2`);
  assert.equal(noUrl.response.status, 404);
  assert.equal(noUrl.body.reason, "no_url");

  const trial = await getJson(`${baseUrl}/api/netease/song/3`);
  assert.equal(trial.response.status, 404);
  assert.equal(trial.body.reason, "trial_fragment");

	  const short = await getJson(`${baseUrl}/api/netease/song/4`);
	  assert.equal(short.response.status, 404);
	  assert.equal(short.body.reason, "too_short");

	  const exact = await getJson(`${baseUrl}/api/netease/song/5`);
	  assert.equal(exact.response.status, 404);
	  assert.equal(exact.body.reason, "too_short");
});

test("update endpoint exposes only the fixed GitHub release metadata", async () => {
  let releaseCalls = 0;
  const fetchImpl = async (url) => {
    releaseCalls += 1;
    if (url === "https://api.github.com/repos/randerous/jianyin-web-clean-public/releases?per_page=100") {
      return new Response(JSON.stringify([
        { tag_name: "v1.0.29", published_at: "2026-07-18T00:00:00Z", body: "Latest release" },
        { tag_name: "v1.0.28", published_at: "2026-07-17T00:00:00Z", body: "Current release" },
        { tag_name: "v1.0.27", published_at: "2026-07-16T00:00:00Z", body: "Older release" },
        { tag_name: "v1.0.30", published_at: "2026-07-19T00:00:00Z", body: "Future release" },
        { tag_name: "v1.0.31", draft: true, published_at: "2026-07-20T00:00:00Z", body: "Draft release" },
        { tag_name: "v1.0.32", prerelease: true, published_at: "2026-07-21T00:00:00Z", body: "Pre-release" }
      ]), { status: 200, headers: { "content-type": "application/json" } });
    }
    assert.equal(url, "https://api.github.com/repos/randerous/jianyin-web-clean-public/releases/latest");
    return new Response(JSON.stringify({
      tag_name: "v1.0.29",
      html_url: "https://github.com/randerous/jianyin-web-clean-public/releases/tag/v1.0.29",
      published_at: "2026-07-18T00:00:00Z",
      body: "Latest release",
      assets: [
        {
          name: "app-release.apk",
          browser_download_url: "https://github.com/randerous/jianyin-web-clean-public/releases/download/v1.0.29/app-release.apk",
          digest: "sha256:0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
          size: 123
        },
        {
          name: "jianyin-windows-launcher.exe",
          browser_download_url: "https://github.com/randerous/jianyin-web-clean-public/releases/download/v1.0.29/jianyin-windows-launcher.exe",
          digest: "sha256:abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789",
          size: 456
        },
        {
          name: "evil.apk",
          browser_download_url: "https://example.test/evil.apk",
          digest: "sha256:0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef"
        }
      ]
    }), { status: 200, headers: { "content-type": "application/json" } });
  };
  const baseUrl = await startTestServer({ fetchImpl });

  const first = await getJson(`${baseUrl}/api/update/latest`);
  const second = await getJson(`${baseUrl}/api/update/latest`);
  assert.equal(first.response.status, 200);
  assert.equal(first.body.currentVersion, "1.0.28");
  assert.equal(first.body.latestVersion, "1.0.29");
  assert.equal(first.body.available, true);
  assert.deepEqual(first.body.releaseNotes.map((note) => note.tag), ["v1.0.29"]);
  assert.deepEqual(first.body.releaseNotes.map((note) => note.notes), ["Latest release"]);
  assert.equal(first.body.canApply, false);
  assert.equal(first.body.assets.apk.sha256, "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef");
  assert.equal(first.body.assets.apk.size, 123);
  assert.equal(first.body.assets.windowsLauncher.sha256, "abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789");
  assert.equal(second.body.tag, "v1.0.29");
  assert.equal(releaseCalls, 2);
});

test("update apply is disabled unless the local launcher explicitly enables it", async () => {
  const baseUrl = await startTestServer({ fetchImpl: async () => {
    throw new Error("GitHub should not be queried when apply is disabled");
  } });
  const result = await getJson(`${baseUrl}/api/update/apply`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ tag: "v1.0.19" })
  });
  assert.equal(result.response.status, 403);
  assert.equal(result.body.error, "update_apply_disabled");
});

test("lyrics endpoint finds Netease lyric by song title and artist", async () => {
  const neteaseClient = {
    async cloudsearch({ keywords }) {
      assert.match(keywords, /September/);
      return { body: { result: { songs: [song(91, "September")] } } };
    },
    async lyric({ id }) {
      assert.equal(id, "91");
      return { body: { lrc: { lyric: "[00:00.00]Do you remember" } } };
    }
  };
  const baseUrl = await startTestServer({ neteaseClient });

  const result = await getJson(`${baseUrl}/api/lyrics?name=${encodeURIComponent("September")}&artist=${encodeURIComponent("Artist 91")}&source=flac`);

  assert.equal(result.response.status, 200);
  assert.equal(result.body.provider, "netease");
  assert.equal(result.body.id, "netease_91");
  assert.equal(result.body.lrc, "[00:00.00]Do you remember");
});

test("lyrics endpoint falls back to direct Netease web APIs", async () => {
  const neteaseClient = {
    async cloudsearch() {
      throw new Error("read ECONNRESET");
    },
    async lyric() {
      throw new Error("read ECONNRESET");
    }
  };
  const fetchImpl = async (url) => {
    const parsed = new URL(url);
    if (parsed.pathname === "/api/search/get/web") {
      assert.equal(parsed.searchParams.get("s"), "September Artist 91");
      return new Response(JSON.stringify({
        result: { songs: [song(91, "September")] }
      }), { headers: { "content-type": "application/json" } });
    }
    if (parsed.pathname === "/api/song/lyric") {
      assert.equal(parsed.searchParams.get("id"), "91");
      return new Response(JSON.stringify({
        lrc: { lyric: "[00:00.00]direct lyric" }
      }), { headers: { "content-type": "application/json" } });
    }
    throw new Error(`unexpected fetch ${url}`);
  };
  const baseUrl = await startTestServer({ neteaseClient, fetchImpl });

  const result = await getJson(`${baseUrl}/api/lyrics?name=${encodeURIComponent("September")}&artist=${encodeURIComponent("Artist 91")}&source=flac`);

  assert.equal(result.response.status, 200);
  assert.equal(result.body.provider, "netease");
  assert.equal(result.body.id, "netease_91");
  assert.equal(result.body.lrc, "[00:00.00]direct lyric");
});

test("lyrics endpoint converts Netease yrc json lines to LRC", async () => {
  const neteaseClient = {
    async cloudsearch() {
      return { body: { result: { songs: [song(386175, "倔强")] } } };
    },
    async lyric({ id }) {
      assert.equal(id, "386175");
      return {
        body: {
          yrc: {
            lyric: [
              JSON.stringify({ t: 0, c: [{ tx: "作词: " }, { tx: "五月天 阿信" }] }),
              JSON.stringify({ t: 18520, c: [{ tx: "当我和世界不一样" }] })
            ].join("\n")
          }
        }
      };
    }
  };
  const baseUrl = await startTestServer({ neteaseClient });

  const result = await getJson(`${baseUrl}/api/lyrics?name=${encodeURIComponent("倔强")}&artist=${encodeURIComponent("五月天")}&source=flac`);

  assert.equal(result.response.status, 200);
  assert.equal(result.body.lrc, "[00:00.000]作词: 五月天 阿信\n[00:18.520]当我和世界不一样");
});

test("stream revalidates playback data and forwards range requests", async () => {
  let upstreamRange = "";
  let upstreamCalls = 0;
  const neteaseClient = {
    async song_url({ id }) {
      const byId = {
        "1": urlData({ url: "https://audio.test/full.mp3", time: 65_000 }),
        "2": urlData({ url: "", time: 65_000 }),
        "3": urlData({ freeTrialInfo: { start: 0, end: 30_000 }, time: 65_000 }),
        "4": urlData({ url: "https://audio.test/short.mp3", time: 30_000 })
      };
      return urlResponse(id, byId);
    }
  };
  const fetchImpl = async (_url, init = {}) => {
    upstreamCalls += 1;
    upstreamRange = init.headers.Range || "";
    return new Response("0123456789", {
      status: upstreamRange ? 206 : 200,
      headers: upstreamRange
        ? {
            "content-type": "audio/mpeg",
            "content-length": "10",
            "content-range": "bytes 0-9/10",
            "accept-ranges": "bytes"
          }
        : {
            "content-type": "audio/mpeg",
            "content-length": "10",
            "accept-ranges": "bytes"
          }
    });
  };
  const baseUrl = await startTestServer({ neteaseClient, fetchImpl });

  const ranged = await fetch(`${baseUrl}/api/netease/stream/1`, {
    headers: { Range: "bytes=0-9" }
  });
  assert.equal(ranged.status, 206);
  assert.equal(upstreamRange, "bytes=0-9");
  assert.equal(ranged.headers.get("content-range"), "bytes 0-9/10");
  assert.equal(await ranged.text(), "0123456789");

  for (const [id, reason] of [["2", "no_url"], ["3", "trial_fragment"], ["4", "too_short"]]) {
    const { response, body } = await getJson(`${baseUrl}/api/netease/stream/${id}`);
    assert.equal(response.status, 404);
    assert.equal(body.reason, reason);
  }
  assert.equal(upstreamCalls, 1);
});

test("shared state redacts credentials before persisting", async () => {
  const statePath = resolve("test-results", `state-redaction-${Date.now()}-${Math.random()}.json`);
  const baseUrl = await startTestServer({ neteaseClient: {}, statePath });

  const write = await getJson(`${baseUrl}/api/state`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      state: {
        playlists: [{ id: "safe", name: "Safe Playlist", songs: [] }],
        accountCookie: "MUSIC_U=secret",
        nested: { cookie: "SESSDATA=secret; bili_jct=secret", token: "abc" },
        notes: ["plain", "MUSIC_U=leak"]
      }
    })
  });
  const read = await getJson(`${baseUrl}/api/state`);
  const serialized = JSON.stringify(read.body.state);

  assert.equal(write.response.status, 200);
  assert.equal(read.response.status, 200);
  assert.equal(read.body.state.playlists[0].id, "safe");
  assert.doesNotMatch(serialized, /MUSIC_U|SESSDATA|bili_jct|secret|accountCookie|cookie|token/i);
});

test("shared state ignores an older write that arrives after a newer write", async () => {
  const statePath = resolve("test-results", `state-order-${Date.now()}-${Math.random()}.json`);
  const baseUrl = await startTestServer({ neteaseClient: {}, statePath });

  const newer = await getJson(`${baseUrl}/api/state`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ state: { marker: "newer", updatedAt: 200 } })
  });
  const older = await getJson(`${baseUrl}/api/state`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ state: { marker: "older", updatedAt: 100 } })
  });
  const read = await getJson(`${baseUrl}/api/state`);

  assert.equal(newer.response.status, 200);
  assert.equal(older.response.status, 200);
  assert.equal(read.body.state.marker, "newer");
  assert.equal(read.body.state.updatedAt, 200);
});

test("upstream error messages redact credential material", async () => {
  const neteaseClient = {
    async login_status() {
      throw new Error("upstream saw MUSIC_U=secret; token=abc; credential=hidden");
    }
  };
  const baseUrl = await startTestServer({ neteaseClient });

  const login = await getJson(`${baseUrl}/api/netease/account/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ cookie: "MUSIC_U=secret" })
  });

  assert.equal(login.response.status, 502);
  assert.equal(login.body.error, "netease_login_failed");
  assert.doesNotMatch(login.body.message, /MUSIC_U|secret|token|credential|abc/i);
  assert.match(login.body.message, /\[redacted]/);
});

test("flac test source searches full songs and proxies ranged streams", async () => {
  let upstreamRange = "";
  const fetchImpl = async (url, init = {}) => {
    const textUrl = String(url);
    if (textUrl === "https://flac.music.hi.cn/") {
      return new Response("", {
        status: 200,
        headers: { "set-cookie": "sl-session=mock; Path=/; sl_jwt_session=mockjwt; Path=/" }
      });
    }
    if (textUrl.includes("/ajax.php?act=search")) {
      const params = new URLSearchParams(String(init.body));
      const page = Number(params.get("page") ?? "1");
      return Response.json({
        code: 0,
        data: {
          list: page === 1 ? [
            {
              id: "100",
              name: "Full Song",
              artist: "Test Artist",
              pic_url: "/cover.png",
              duration: "213",
              time: "12345",
              sign: "signed",
              minfo: [{ format: "flac", bitrate: "2000", level: "ff" }]
            },
            {
              id: "101",
              name: "Short Song",
              artist: "Test Artist",
              duration: "30",
              time: "12345",
              sign: "signed",
              minfo: [{ format: "mp3", bitrate: "320", level: "p" }]
            }
          ] : [],
          total: "2"
        }
      });
    }
    if (textUrl.includes("/ajax.php?act=getUrl")) {
      const body = String(init.body);
      assert.match(body, /songid=100/);
      assert.match(body, /format=flac/);
      assert.match(body, /bitrate=2000/);
      assert.match(body, /time=12345/);
      assert.match(body, /sign=signed/);
      return Response.json({
        code: 0,
        data: {
          url: "https://audio.test/full.flac",
          format: "flac",
          bitrate: 2000,
          duration: 213,
          songid: 100
        }
      });
    }
    if (textUrl === "https://audio.test/full.flac") {
      upstreamRange = init.headers.Range || "";
      return new Response("0123456789", {
        status: upstreamRange ? 206 : 200,
        headers: {
          "content-type": "audio/x-flac",
          "content-length": "10",
          "content-range": "bytes 0-9/10",
          "accept-ranges": "bytes"
        }
      });
    }
    throw new Error(`unexpected fetch ${textUrl}`);
  };
  const baseUrl = await startTestServer({ fetchImpl });

  const search = await getJson(`${baseUrl}/api/flac/search?keyword=test&limit=5`);
  assert.equal(search.response.status, 200);
  assert.equal(search.body.songs.length, 1);
  assert.equal(search.body.songs[0].id, "flac_100");
  assert.equal(search.body.songs[0].durationMs, 213_000);
  assert.equal(search.body.songs[0].audioType, "flac");

  const stream = await fetch(`${baseUrl}${search.body.songs[0].url}`, {
    headers: { Range: "bytes=0-9" }
  });
  assert.equal(stream.status, 206);
  assert.equal(upstreamRange, "bytes=0-9");
  assert.equal(stream.headers.get("content-type"), "audio/x-flac");
  assert.equal(await stream.text(), "0123456789");
});

test("flac test source prefers highest FLAC quality when both FLAC and 320k exist", async () => {
  const fetchImpl = async (url, init = {}) => {
    const textUrl = String(url);
    if (textUrl === "https://flac.music.hi.cn/") {
      return new Response("", {
        status: 200,
        headers: { "set-cookie": "sl-session=mock; Path=/; sl_jwt_session=mockjwt; Path=/" }
      });
    }
    if (textUrl.includes("/ajax.php?act=search")) {
      return Response.json({
        code: 0,
        data: {
          list: [{
            id: "101",
            name: "Android Friendly",
            artist: "Artist",
            duration: "213",
            time: "t101",
            sign: "s101",
            minfo: [
              { format: "flac", bitrate: "2000", level: "ff" },
              { format: "mp3", bitrate: "320", level: "p" }
            ]
          }],
          total: "1"
        }
      });
    }
    throw new Error(`unexpected fetch ${textUrl}`);
  };
  const baseUrl = await startTestServer({ fetchImpl });

  const search = await getJson(`${baseUrl}/api/flac/search?keyword=android&limit=1`);

  assert.equal(search.response.status, 200);
  assert.equal(search.body.songs[0].audioType, "flac");
  assert.equal(search.body.songs[0].quality, "flac");
  assert.match(search.body.songs[0].url, /format=flac/);
  assert.match(search.body.songs[0].url, /bitrate=2000/);
});

test("flac song resolve falls back to 320k when FLAC URL is unavailable", async () => {
  const requests = [];
  const fetchImpl = async (url, init = {}) => {
    const textUrl = String(url);
    if (textUrl === "https://flac.music.hi.cn/") {
      return new Response("", {
        status: 200,
        headers: { "set-cookie": "sl-session=mock; Path=/; sl_jwt_session=mockjwt; Path=/" }
      });
    }
    if (textUrl.includes("/ajax.php?act=getUrl")) {
      const body = String(init.body);
      requests.push(new URLSearchParams(body));
      if (body.includes("format=flac")) {
        return Response.json({ code: 0, data: { url: "", format: "flac", bitrate: 2000, duration: 213 } });
      }
      if (body.includes("format=mp3") && body.includes("bitrate=320")) {
        return Response.json({ code: 0, data: { url: "https://audio.test/full.mp3", format: "mp3", bitrate: 320, duration: 213 } });
      }
    }
    throw new Error(`unexpected fetch ${textUrl}`);
  };
  const baseUrl = await startTestServer({ fetchImpl });

  const result = await getJson(`${baseUrl}/api/flac/song/101?format=flac&bitrate=2000&time=t101&sign=s101`);

  assert.equal(result.response.status, 200);
  assert.equal(result.body.audioType, "mp3");
  assert.equal(result.body.quality, "320k");
  assert.match(result.body.url, /format=mp3/);
  assert.match(result.body.url, /bitrate=320/);
  assert.deepEqual(requests.map((params) => [params.get("format"), params.get("bitrate")]), [["flac", "2000"], ["mp3", "320"]]);
});

test("flac stream falls back to 320k when FLAC upstream audio fails", async () => {
  const getUrlRequests = [];
  const audioRequests = [];
  const fetchImpl = async (url, init = {}) => {
    const textUrl = String(url);
    if (textUrl === "https://flac.music.hi.cn/") {
      return new Response("", {
        status: 200,
        headers: { "set-cookie": "sl-session=mock; Path=/; sl_jwt_session=mockjwt; Path=/" }
      });
    }
    if (textUrl.includes("/ajax.php?act=getUrl")) {
      const body = String(init.body);
      const params = new URLSearchParams(body);
      getUrlRequests.push([params.get("format"), params.get("bitrate")]);
      const isMp3 = params.get("format") === "mp3";
      return Response.json({
        code: 0,
        data: {
          url: isMp3 ? "https://audio.test/full.mp3" : "https://audio.test/full.flac",
          format: isMp3 ? "mp3" : "flac",
          bitrate: isMp3 ? 320 : 2000,
          duration: 213
        }
      });
    }
    if (textUrl === "https://audio.test/full.flac") {
      audioRequests.push("flac");
      return new Response("bad", { status: 502 });
    }
    if (textUrl === "https://audio.test/full.mp3") {
      audioRequests.push("mp3");
      return new Response("0123456789", { status: 206, headers: { "content-type": "audio/mpeg" } });
    }
    throw new Error(`unexpected fetch ${textUrl}`);
  };
  const baseUrl = await startTestServer({ fetchImpl });

  const stream = await fetch(`${baseUrl}/api/flac/stream/101?format=flac&bitrate=2000&time=t101&sign=s101`, {
    headers: { Range: "bytes=0-9" }
  });

  assert.equal(stream.status, 206);
  assert.equal(stream.headers.get("content-type"), "audio/mpeg");
  assert.equal(await stream.text(), "0123456789");
  assert.deepEqual(getUrlRequests, [["flac", "2000"], ["flac", "2000"], ["mp3", "320"]]);
  assert.deepEqual(audioRequests, ["flac", "flac", "mp3"]);
});

test("flac test source builds app pages from upstream 20-song pages", async () => {
  const searchBodies = [];
  const fetchImpl = async (url, init = {}) => {
    const textUrl = String(url);
    if (textUrl === "https://flac.music.hi.cn/") {
      return new Response("", {
        status: 200,
        headers: { "set-cookie": "sl-session=mock; Path=/; sl_jwt_session=mockjwt; Path=/" }
      });
    }
    if (textUrl.includes("/ajax.php?act=search")) {
      const params = new URLSearchParams(String(init.body));
      searchBodies.push(params);
      const page = Number(params.get("page") ?? "1");
      const size = Number(params.get("size") ?? "20");
      const firstId = (page - 1) * size + 1;
      return Response.json({
        code: 0,
        data: {
          list: Array.from({ length: size }, (_, index) => {
            const id = firstId + index;
            return {
              id: String(id),
              name: `Artist Song ${id}`,
              artist: "Artist",
              duration: id % 17 === 0 ? "30" : "213",
              time: `t${id}`,
              sign: `s${id}`,
              minfo: [{ format: "flac", bitrate: "2000", level: "ff" }]
            };
          }),
          total: "360"
        }
      });
    }
    throw new Error(`unexpected fetch ${textUrl}`);
  };
  const baseUrl = await startTestServer({ fetchImpl });

  const search = await getJson(`${baseUrl}/api/flac/search?keyword=artist&limit=30&page=3`);

  assert.equal(search.response.status, 200);
  assert.equal(search.body.songs.length, 30);
  assert.deepEqual(searchBodies.map((params) => params.get("page")), ["1", "2", "3", "4", "5"]);
  assert.deepEqual([...new Set(searchBodies.map((params) => params.get("size")))], ["20"]);
  assert.equal(search.body.page, 3);
  assert.equal(search.body.limit, 30);
  assert.equal(search.body.total, 360);
  assert.equal(search.body.hasMore, true);
  assert.equal(search.body.songs[0].id, "flac_64");
  assert.equal(search.body.songs.at(-1).id, "flac_95");
});

test("flac test source caches duplicate searches and shares in-flight requests", async () => {
  let searchCalls = 0;
  let releaseSearch;
  const searchGate = new Promise((resolve) => {
    releaseSearch = resolve;
  });
  const fetchImpl = async (url) => {
    const textUrl = String(url);
    if (textUrl === "https://flac.music.hi.cn/") {
      return new Response("", {
        status: 200,
        headers: { "set-cookie": "sl-session=mock; Path=/; sl_jwt_session=mockjwt; Path=/" }
      });
    }
    if (textUrl.includes("/ajax.php?act=search")) {
      searchCalls += 1;
      await searchGate;
      return Response.json({
        code: 0,
        data: {
          list: [{
            id: "300",
            name: "Cached Song",
            artist: "Cache Artist",
            duration: "213",
            time: "t300",
            sign: "s300",
            minfo: [{ format: "mp3", bitrate: "320", level: "p" }]
          }],
          total: "1"
        }
      });
    }
    throw new Error(`unexpected fetch ${textUrl}`);
  };
  const baseUrl = await startTestServer({ fetchImpl });

  const first = getJson(`${baseUrl}/api/flac/search?keyword=cached&limit=5&page=1`);
  const second = getJson(`${baseUrl}/api/flac/search?keyword=cached&limit=5&page=1`);
  await new Promise((resolve) => setTimeout(resolve, 25));
  assert.equal(searchCalls, 1);
  releaseSearch();
  const [firstResult, secondResult] = await Promise.all([first, second]);
  const third = await getJson(`${baseUrl}/api/flac/search?keyword=cached&limit=5&page=1`);

  assert.equal(firstResult.response.status, 200);
  assert.equal(secondResult.response.status, 200);
  assert.equal(third.response.status, 200);
  assert.equal(firstResult.body.cached, false);
  assert.equal(secondResult.body.cached, true);
  assert.equal(third.body.cached, true);
  assert.equal(searchCalls, 1);
  assert.equal(third.body.songs[0].id, "flac_300");
});

test("flac test source refreshes cookie when ajax returns html challenge", async () => {
  let baseCalls = 0;
  let searchCalls = 0;
  const fetchImpl = async (url, init = {}) => {
    const textUrl = String(url);
    if (textUrl === "https://flac.music.hi.cn/") {
      baseCalls += 1;
      if (baseCalls === 1) {
        return new Response("<!doctype html><html>home</html>", {
          status: 200,
          headers: { "set-cookie": "sl-session=stale; Path=/; sl_jwt_session=old; Path=/" }
        });
      }
      if (baseCalls === 2) {
        return new Response("<html id='anticc_redirect'><body><script>var cbk_var='/?__CBK=mock';window.location=cbk_var;</script></body></html>", {
          status: 200,
          headers: { "content-type": "text/html" }
        });
      }
      assert.match(init.headers.Cookie, /sl-session=fresh/);
      assert.match(init.headers.Cookie, /sl-challenge-jwt=jwt/);
      return new Response("<!doctype html><html>ready</html>", {
        status: 200,
        headers: { "set-cookie": "sl_jwt_session=freshjwt; Path=/; sl_jwt_sign=; Path=/; sl-challenge-jwt=; Path=/" }
      });
    }
    if (textUrl === "https://flac.music.hi.cn/?__CBK=mock") {
      return new Response("<html><script>SafeLineChallenge(\"client-key\")</script></html>", {
        status: 468,
        headers: { "set-cookie": "sl-session=fresh; Path=/" }
      });
    }
    if (textUrl.endsWith("/challenge/v2/api/issue")) {
      return Response.json({ code: 200, data: { issue_id: "issue-1", data: [1, 2, 3] } });
    }
    if (textUrl.endsWith("/challenge/v2/api/verify")) {
      const body = JSON.parse(init.body);
      assert.equal(body.issue_id, "issue-1");
      return Response.json({ code: 200, data: { jwt: "jwt" } });
    }
    if (textUrl.includes("/ajax.php?act=search")) {
      searchCalls += 1;
      if (searchCalls === 1) {
        assert.match(init.headers.Cookie, /sl-session=stale/);
        return new Response("<html id='anticc_redirect'><body>SafeLineChallenge(\"client-key\")</body></html>", {
          status: 200,
          headers: { "content-type": "text/html" }
        });
      }
      assert.match(init.headers.Cookie, /sl-session=fresh/);
      assert.match(init.headers.Cookie, /sl_jwt_session=freshjwt/);
      assert.doesNotMatch(init.headers.Cookie, /Path=\//);
      const params = new URLSearchParams(String(init.body));
      const page = Number(params.get("page") ?? "1");
      return Response.json({
        code: 0,
        data: {
          list: page === 1 ? [{
            id: "200",
            name: "Recovered Full Song",
            artist: "Test Artist",
            duration: "213",
            time: "999",
            sign: "freshsign",
            minfo: [{ format: "flac", bitrate: "2000", level: "ff" }]
          }] : [],
          total: "1"
        }
      });
    }
    throw new Error(`unexpected fetch ${textUrl}`);
  };
  const baseUrl = await startTestServer({ fetchImpl });

  const search = await getJson(`${baseUrl}/api/flac/search?keyword=test&limit=5`);

  assert.equal(search.response.status, 200);
  assert.equal(search.body.songs.length, 1);
  assert.equal(search.body.songs[0].id, "flac_200");
  assert.equal(search.body.songs[0].durationMs, 213_000);
  assert.ok(searchCalls >= 2);
  assert.equal(baseCalls, 3);
});

test("flac bad upstream json returns actionable sanitized error", async () => {
  const fetchImpl = async (url) => {
    const textUrl = String(url);
    if (textUrl === "https://flac.music.hi.cn/") {
      return new Response("", {
        status: 200,
        headers: { "set-cookie": "sl-session=mock; Path=/; sl_jwt_session=mockjwt; Path=/" }
      });
    }
    if (textUrl.includes("/ajax.php?act=search")) {
      return new Response("<html>SafeLineChallenge MUSIC_U=secret</html>", {
        status: 403,
        headers: { "content-type": "text/html" }
      });
    }
    throw new Error(`unexpected fetch ${textUrl}`);
  };
  const baseUrl = await startTestServer({ fetchImpl });

  const result = await getJson(`${baseUrl}/api/flac/search?keyword=test`);

  assert.equal(result.response.status, 502);
  assert.equal(result.body.error, "flac_search_failed");
  assert.match(result.body.message, /测试源接口不可用|upstream status 403/);
  assert.doesNotMatch(result.body.message, /invalid json|<html|SafeLineChallenge|MUSIC_U|secret/i);
});

test("flac song resolve rejects missing url and short getUrl responses", async () => {
  const fetchImpl = async (url, init = {}) => {
    const textUrl = String(url);
    if (textUrl === "https://flac.music.hi.cn/") {
      return new Response("", {
        status: 200,
        headers: { "set-cookie": "sl-session=mock; Path=/; sl_jwt_session=mockjwt; Path=/" }
      });
    }
    if (textUrl.includes("/ajax.php?act=getUrl")) {
      const body = String(init.body);
      if (body.includes("songid=300")) {
        return Response.json({ code: 0, data: { url: "", format: "flac", bitrate: 2000, duration: 213 } });
      }
      if (body.includes("songid=301")) {
        return Response.json({ code: 0, data: { url: "https://audio.test/short.flac", format: "flac", bitrate: 2000, duration: 60 } });
      }
    }
    throw new Error(`unexpected fetch ${textUrl}`);
  };
  const baseUrl = await startTestServer({ fetchImpl });

  const noUrl = await getJson(`${baseUrl}/api/flac/song/300?format=flac&bitrate=2000&time=t&sign=s`);
  const short = await getJson(`${baseUrl}/api/flac/song/301?format=flac&bitrate=2000&time=t&sign=s`);

  assert.equal(noUrl.response.status, 404);
  assert.equal(noUrl.body.error, "flac_song_unavailable");
  assert.equal(short.response.status, 404);
  assert.equal(short.body.error, "flac_song_unavailable");
});

test("search verifies candidates in small batches, stops after desired playable results, and caches", async () => {
  const requested = [];
  const neteaseClient = {
    async search() {
      return { body: { result: { songs: Array.from({ length: 30 }, (_, index) => song(index + 1)) } } };
    },
    async song_url_v1({ id, level }) {
      requested.push({ id, level });
      const byId = Object.fromEntries(String(id).split(",").map((item) => [item, urlData({ url: `https://audio.test/${item}.mp3`, time: 65_000 })]));
      return urlResponse(id, byId);
    }
  };
  const baseUrl = await startTestServer({ neteaseClient });

  const first = await getJson(`${baseUrl}/api/netease/search?keyword=batch&limit=5`);
  const second = await getJson(`${baseUrl}/api/netease/search?keyword=batch&limit=5`);

  assert.equal(first.response.status, 200);
  assert.equal(first.body.songs.length, 5);
  assert.equal(first.body.cached, false);
  assert.equal(second.body.cached, true);
  assert.deepEqual(requested, [{ id: "1,2,3,4,5,6,7,8,9,10", level: "exhigh" }]);
});

test("search can return 60 playable Netease songs from a larger artist result set", async () => {
  const searchLimits = [];
  const requested = [];
  const neteaseClient = {
    async search({ limit }) {
      searchLimits.push(limit);
      return { body: { result: { songs: Array.from({ length: limit }, (_, index) => song(index + 1)) } } };
    },
    async song_url_v1({ id, level }) {
      requested.push({ id, level });
      const byId = Object.fromEntries(String(id).split(",").map((item) => [
        item,
        Number(item) <= 40
          ? urlData({ url: "", time: 65_000 })
          : urlData({ url: `https://audio.test/${item}.mp3`, time: 65_000 })
      ]));
      return urlResponse(id, byId);
    }
  };
  const baseUrl = await startTestServer({ neteaseClient });

  const { response, body } = await getJson(`${baseUrl}/api/netease/search?keyword=artist&limit=60`);

  assert.equal(response.status, 200);
  assert.deepEqual(searchLimits, [180]);
  assert.equal(body.songs.length, 60);
  assert.equal(body.songs[0].id, "netease_41");
  assert.equal(body.songs.at(-1).id, "netease_100");
  assert.equal(body.filtered, 120);
  assert.ok(requested.some((call) => call.id === "91,92,93,94,95,96,97,98,99,100"));
  assert.ok(requested.every((call) => !String(call.id).includes("101")));
});

test("quality fallback follows Android 5.0.0 order and stops when playable", async () => {
  const requested = [];
  const neteaseClient = {
    async search() {
      return { body: { result: { songs: [song(99)] } } };
    },
    async song_url_v1({ id, level }) {
      requested.push(level);
      return urlResponse(id, {
        "99": level === "lossless"
          ? urlData({ url: "https://audio.test/lossless.flac", time: 65_000, br: 999000, level: "lossless", type: "flac" })
          : urlData({ url: "", time: 65_000, level })
      });
    }
  };
  const baseUrl = await startTestServer({ neteaseClient });

  const { response, body } = await getJson(`${baseUrl}/api/netease/search?keyword=fallback&limit=1&quality=jymaster`);

  assert.equal(response.status, 200);
  assert.deepEqual(requested, ["jymaster", "sky", "jyeffect", "hires", "lossless"]);
  assert.equal(body.songs[0].level, "lossless");
  assert.equal(body.songs[0].url, "/api/netease/stream/99?quality=jymaster");
});

test("song and stream endpoints use the same quality fallback before playback", async () => {
  const requested = [];
  const neteaseClient = {
    async song_url_v1({ id, level }) {
      requested.push({ id, level });
      const playable = level === "lossless";
      return urlResponse(id, {
        [String(id)]: playable
          ? urlData({ url: `https://audio.test/${id}-lossless.flac`, time: 65_000, br: 999000, level: "lossless", type: "flac" })
          : level === "sky"
            ? urlData({ url: `https://audio.test/${id}-trial.mp3`, freeTrialInfo: { start: 0, end: 30_000 }, time: 65_000, level })
            : level === "jyeffect"
              ? urlData({ url: `https://audio.test/${id}-exact.mp3`, time: 60_000, level })
              : urlData({ url: "", time: 65_000, level })
      });
    },
    async lyric_new() {
      return { body: { lrc: { lyric: "[00:00.00]fallback lyric" } } };
    }
  };
  let upstreamRange = "";
  const fetchImpl = async (url, init = {}) => {
    upstreamRange = init.headers.Range || "";
    assert.equal(String(url), "https://audio.test/502-lossless.flac");
    return new Response("fallback-audio", {
      status: upstreamRange ? 206 : 200,
      headers: {
        "content-type": "audio/flac",
        "content-length": "14",
        "content-range": "bytes 0-13/14",
        "accept-ranges": "bytes"
      }
    });
  };
  const baseUrl = await startTestServer({ neteaseClient, fetchImpl });

  const songResult = await getJson(`${baseUrl}/api/netease/song/501?quality=jymaster`);
  const stream = await fetch(`${baseUrl}/api/netease/stream/502?quality=jymaster`, { headers: { Range: "bytes=0-13" } });

  assert.equal(songResult.response.status, 200);
  assert.equal(songResult.body.url, "/api/netease/stream/501?quality=jymaster");
  assert.equal(songResult.body.level, "lossless");
  assert.equal(songResult.body.verifiedPlayable, true);
  assert.equal(stream.status, 206);
  assert.equal(upstreamRange, "bytes=0-13");
  assert.equal(await stream.text(), "fallback-audio");
  assert.deepEqual(requested.map((item) => `${item.id}:${item.level}`), [
    "501:jymaster",
    "501:sky",
    "501:jyeffect",
    "501:hires",
    "501:lossless",
    "502:jymaster",
    "502:sky",
    "502:jyeffect",
    "502:hires",
    "502:lossless"
  ]);
});

test("netease song resolve still plays when lyric request fails", async () => {
  const neteaseClient = {
    async song_url({ id }) {
      return urlResponse(id, {
        "701": urlData({ url: "https://audio.test/full.mp3", time: 65_000 })
      });
    },
    async lyric() {
      throw new Error("lyric outage");
    }
  };
  const baseUrl = await startTestServer({ neteaseClient });

  const result = await getJson(`${baseUrl}/api/netease/song/701`);

  assert.equal(result.response.status, 200);
  assert.equal(result.body.verifiedPlayable, true);
  assert.equal(result.body.url, "/api/netease/stream/701?quality=exhigh");
  assert.equal(result.body.lrc, "");
});

test("playlist endpoint imports Netease metadata as FLAC-search playable placeholders", async () => {
  const playlist = {
    id: 77,
    name: "Playlist",
    coverImgUrl: "/playlist.png",
    trackCount: 3,
    tracks: [song(1), song(2), song(3)],
    trackIds: [{ id: 1 }, { id: 2 }, { id: 3 }]
  };
  const neteaseClient = {
    async playlist_detail({ id }) {
      if (String(id) === "88") throw new Error("read ECONNRESET");
      return { body: { playlist } };
    },
    async search({ keywords }) {
      return { body: { result: { songs: keywords === "热歌" ? [song(4), song(5)] : [song(1), song(2), song(3)] } } };
    },
    async personalized() {
      return { body: { result: [
        { id: 88, name: "Broken Playlist", picUrl: "/broken.png", trackCount: 3 },
        { id: 77, name: "Playlist", picUrl: "/playlist.png", trackCount: 3 }
      ] } };
    },
    async top_playlist({ offset }) {
      return { body: { playlists: [
        { id: 900 + Number(offset ?? 0), name: `Playlist ${offset}`, coverImgUrl: "/offset.png", trackCount: 10 }
      ] } };
    },
    async song_url({ id }) {
      return urlResponse(id, {
        "1": urlData({ url: "https://audio.test/1.mp3", time: 65_000 }),
        "2": urlData({ url: "", time: 65_000 }),
        "3": urlData({ freeTrialInfo: { start: 0, end: 30_000 }, time: 65_000 }),
        "4": urlData({ url: "https://audio.test/4.mp3", time: 65_000 }),
        "5": urlData({ url: "https://audio.test/5.mp3", time: 30_000 })
      });
    }
  };
  const fetchImpl = async (url, init = {}) => {
    const parsed = new URL(url);
    if (parsed.hostname !== "flac.music.hi.cn") throw new Error(`unexpected fetch ${url}`);
    if (parsed.pathname === "/" || parsed.pathname === "") {
      return new Response("ok", { status: 200, headers: { "Content-Type": "text/plain", "set-cookie": "sl-session=test" } });
    }
    const action = parsed.searchParams.get("act");
    const params = new URLSearchParams(String(init.body ?? ""));
    if (action === "search") {
      const keyword = String(params.get("keyword") ?? "");
      const id = keyword.includes("4") ? 400 : keyword.includes("1") ? 100 : 0;
      return new Response(JSON.stringify({
        code: 0,
        data: {
          list: id ? [{
            id: String(id),
            name: id === 400 ? "Song 4" : "Song 1",
            artist: id === 400 ? "Artist 4" : "Artist 1",
            duration: 65,
            pic_url: "/flac.png",
            time: "t",
            sign: "s",
            minfo: [{ format: "mp3", bitrate: "320" }]
          }] : [],
          total: id ? 1 : 0
        }
      }), { status: 200, headers: { "Content-Type": "application/json" } });
    }
    if (action === "getUrl") {
      return new Response(JSON.stringify({ code: 0, data: { url: "https://audio.test/flac.mp3", duration: 65, bitrate: 320, format: "mp3" } }), { status: 200, headers: { "Content-Type": "application/json" } });
    }
    throw new Error(`unexpected flac action ${action}`);
  };
  const baseUrl = await startTestServer({ neteaseClient, fetchImpl });

  const imported = await getJson(`${baseUrl}/api/netease/playlist/77`);
  const home = await getJson(`${baseUrl}/api/netease/home`);
  const refreshedHome = await getJson(`${baseUrl}/api/netease/home?refresh=2&playlistLimit=20`);

  assert.equal(imported.response.status, 200);
  assert.deepEqual(imported.body.playlist.songs.map((item) => item.id), ["flac_search_playlist_1", "flac_search_playlist_2", "flac_search_playlist_3"]);
  assert.deepEqual(imported.body.playlist.songs.map((item) => item.source), ["flac", "flac", "flac"]);
  assert.deepEqual(imported.body.playlist.songs.map((item) => item.url), ["", "", ""]);
  assert.equal(imported.body.playlist.songs[0].verifiedPlayable, false);
  assert.equal(imported.body.playlist.trackCount, 3);
  assert.deepEqual(home.body.radarSongs, []);
  assert.deepEqual(home.body.hotSongs, []);
  assert.deepEqual(home.body.recommendedPlaylists.map((item) => item.id), ["88", "77"]);
  assert.deepEqual(home.body.recommendedPlaylists.map((item) => item.songs ?? []), [[], []]);
  assert.deepEqual(refreshedHome.body.recommendedPlaylists.map((item) => item.id), ["940"]);
  assert.equal(refreshedHome.body.offset, 40);
});

test("netease playlist detail loads all available songs and preserves track count", async () => {
  const songs = Array.from({ length: 120 }, (_item, index) => song(index + 1));
  const playlist = {
    id: 990,
    name: "Large Playlist",
    coverImgUrl: "/large.png",
    trackCount: songs.length,
    tracks: songs.slice(0, 20),
    trackIds: songs.map((item) => ({ id: item.id }))
  };
  const neteaseClient = {
    async playlist_detail() {
      return { body: { playlist } };
    },
    async playlist_track_all({ limit }) {
      assert.equal(limit, 1000);
      return { body: { songs } };
    },
    async song_url_v1() {
      throw new Error("playlist import should not verify Netease song URLs");
    }
  };
  const baseUrl = await startTestServer({ neteaseClient });

  const imported = await getJson(`${baseUrl}/api/netease/playlist/990`);

  assert.equal(imported.response.status, 200);
  assert.equal(imported.body.playlist.songs.length, 120);
  assert.equal(imported.body.playlist.songs[0].id, "flac_search_playlist_1");
  assert.equal(imported.body.playlist.songs[119].id, "flac_search_playlist_120");
  assert.equal(imported.body.playlist.trackCount, 120);
});

test("home recommendation does not prefetch playlist detail", async () => {
  let detailCalls = 0;
  const playlist = {
    id: 77,
    name: "Prefetched Playlist",
    coverImgUrl: "/playlist.png",
    trackCount: 2,
    tracks: [song(1), song(2)],
    trackIds: [{ id: 1 }, { id: 2 }]
  };
  const neteaseClient = {
    async personalized() {
      return { body: { result: [{ id: 77, name: "Prefetched Playlist", picUrl: "/playlist.png", trackCount: 2 }] } };
    },
    async playlist_detail() {
      detailCalls += 1;
      return { body: { playlist } };
    }
  };
  const baseUrl = await startTestServer({ neteaseClient });

  const home = await getJson(`${baseUrl}/api/netease/home?playlistLimit=1`);
  assert.equal(home.response.status, 200);
  await new Promise((resolve) => setTimeout(resolve, 25));
  assert.equal(detailCalls, 0);
  const imported = await getJson(`${baseUrl}/api/netease/playlist/77`);

  assert.equal(imported.response.status, 200);
  assert.equal(detailCalls, 1);
  assert.deepEqual(imported.body.playlist.songs.map((item) => item.source), ["flac", "flac"]);
});

test("netease playlist detail falls back to track_all when detail is slow", async () => {
  const oldTimeout = process.env.JIANYIN_PLAYLIST_TIMEOUT_MS;
  process.env.JIANYIN_PLAYLIST_TIMEOUT_MS = "20";
  try {
    const trackAllLimits = [];
    const neteaseClient = {
      async playlist_detail() {
        await new Promise((resolve) => setTimeout(resolve, 80));
        return { body: { playlist: { id: 77, name: "Slow Detail", tracks: [song(99)], trackIds: [{ id: 99 }] } } };
      },
      async playlist_track_all({ limit }) {
        trackAllLimits.push(limit);
        return { body: { songs: [song(1), song(2)] } };
      }
    };
    const baseUrl = await startTestServer({ neteaseClient });

    const imported = await getJson(`${baseUrl}/api/netease/playlist/77`);

	    assert.equal(imported.response.status, 200);
	    assert.deepEqual(imported.body.playlist.songs.map((item) => item.id), ["flac_search_playlist_1", "flac_search_playlist_2"]);
	    assert.deepEqual(trackAllLimits, [1000]);
  } finally {
    if (oldTimeout === undefined) delete process.env.JIANYIN_PLAYLIST_TIMEOUT_MS;
    else process.env.JIANYIN_PLAYLIST_TIMEOUT_MS = oldTimeout;
  }
});

test("home recommendation returns summaries without detail fan-out", async () => {
  const requested = [];
  const playlists = Array.from({ length: 12 }, (_item, index) => ({
    id: index + 1,
    name: `Playlist ${index + 1}`,
    picUrl: `/playlist-${index + 1}.png`,
    trackCount: 1
  }));
  const neteaseClient = {
    async personalized() {
      return { body: { result: playlists } };
    },
    async playlist_detail({ id }) {
      requested.push(String(id));
      return { body: { playlist: { id, name: `Playlist ${id}`, tracks: [song(id)], trackIds: [{ id }] } } };
    }
  };
  const baseUrl = await startTestServer({ neteaseClient });

  const home = await getJson(`${baseUrl}/api/netease/home?playlistLimit=12`);
  assert.equal(home.response.status, 200);
  await new Promise((resolve) => setTimeout(resolve, 25));
  assert.equal(home.body.recommendedPlaylists.length, 12);
  assert.deepEqual(requested, []);
});

test("netease account login validates cookie and syncs only playable playlists", async () => {
  const requested = [];
  const neteaseClient = {
    async login_status({ cookie }) {
      requested.push(cookie);
      return { body: { data: { profile: { userId: 123, nickname: "Mock Netease" } } } };
    },
    async user_playlist() {
      return { body: { playlist: [{ id: 700, name: "Mine", coverImgUrl: "/mine.png", trackCount: 2, creator: { nickname: "me" } }] } };
    },
    async playlist_detail() {
      return { body: { playlist: { id: 700, name: "Mine", coverImgUrl: "/mine.png", tracks: [song(8), song(9)], trackIds: [{ id: 8 }, { id: 9 }] } } };
    },
    async song_url({ id }) {
      return urlResponse(id, {
        "8": urlData({ url: "https://audio.test/8.mp3", time: 65_000 }),
        "9": urlData({ url: "https://audio.test/9.mp3", time: 30_000 })
      });
    }
  };
  const baseUrl = await startTestServer({ neteaseClient });

  const login = await getJson(`${baseUrl}/api/netease/account/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ cookie: "MUSIC_U=mock" })
  });
  const playlists = await getJson(`${baseUrl}/api/netease/account/playlists`);

  assert.equal(login.response.status, 200);
  assert.equal(login.body.loggedIn, true);
  assert.deepEqual(requested, ["MUSIC_U=mock", "MUSIC_U=mock"]);
  assert.equal(playlists.response.status, 200);
  assert.equal(playlists.body.playlists[0].songs.length, 1);
  assert.equal(playlists.body.playlists[0].songs[0].id, "netease_8");
});

test("netease account playlist sync loads all available songs beyond 60", async () => {
  const songs = Array.from({ length: 120 }, (_item, index) => song(index + 1));
  const trackAllLimits = [];
  const neteaseClient = {
    async login_status() {
      return { body: { data: { profile: { userId: 456, nickname: "Large Account" } } } };
    },
    async user_playlist() {
      return { body: { playlist: [{ id: 701, name: "Large Mine", coverImgUrl: "/large-mine.png", trackCount: songs.length, creator: { nickname: "me" } }] } };
    },
    async playlist_detail() {
      return { body: { playlist: { id: 701, name: "Large Mine", coverImgUrl: "/large-mine.png", trackCount: songs.length, tracks: songs.slice(0, 20), trackIds: songs.map((item) => ({ id: item.id })) } } };
    },
    async playlist_track_all({ limit }) {
      trackAllLimits.push(limit);
      return { body: { songs } };
    },
    async song_url_v1({ id }) {
      const byId = Object.fromEntries(String(id).split(",").map((item) => [item, urlData({ url: `https://audio.test/${item}.mp3`, time: 65_000 })]));
      return urlResponse(id, byId);
    }
  };
  const baseUrl = await startTestServer({ neteaseClient });

  const login = await getJson(`${baseUrl}/api/netease/account/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ cookie: "MUSIC_U=large" })
  });
  const playlists = await getJson(`${baseUrl}/api/netease/account/playlists`);

  assert.equal(login.response.status, 200);
  assert.equal(playlists.response.status, 200);
  assert.deepEqual(trackAllLimits, [1000]);
  assert.equal(playlists.body.playlists[0].songs.length, 120);
  assert.equal(playlists.body.playlists[0].songs.at(-1).id, "netease_120");
});

test("netease account rejects invalid cookies, sync failures, and logout clears auth", async () => {
  const calls = [];
  const neteaseClient = {
    async login_status({ cookie }) {
      calls.push({ method: "login_status", cookie });
      if (cookie === "MUSIC_U=valid") {
        return { body: { data: { profile: { userId: 123, nickname: "Mock Netease" } } } };
      }
      return { body: { data: { profile: null, account: null } } };
    },
    async user_playlist() {
      calls.push({ method: "user_playlist" });
      throw new Error("mock playlist outage");
    }
  };
  const baseUrl = await startTestServer({ neteaseClient });

  const empty = await getJson(`${baseUrl}/api/netease/account/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ cookie: "" })
  });
  const invalid = await getJson(`${baseUrl}/api/netease/account/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ cookie: "MUSIC_U=fake-but-invalid" })
  });
  const beforeLogin = await getJson(`${baseUrl}/api/netease/account/playlists`);
  const valid = await getJson(`${baseUrl}/api/netease/account/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ cookie: "MUSIC_U=valid" })
  });
  const syncFailure = await getJson(`${baseUrl}/api/netease/account/playlists`);
  const logout = await getJson(`${baseUrl}/api/netease/account/logout`, { method: "POST" });
  const afterLogout = await getJson(`${baseUrl}/api/netease/account/playlists`);

  assert.equal(empty.response.status, 400);
  assert.equal(empty.body.error, "cookie_required");
  assert.equal(invalid.response.status, 401);
  assert.equal(invalid.body.error, "netease_login_invalid");
  assert.equal(beforeLogin.response.status, 401);
  assert.equal(valid.response.status, 200);
  assert.equal(valid.body.loggedIn, true);
  assert.equal(syncFailure.response.status, 502);
  assert.equal(syncFailure.body.error, "netease_sync_failed");
  assert.match(syncFailure.body.message, /mock playlist outage/);
  assert.equal(logout.response.status, 200);
  assert.equal(logout.body.loggedIn, false);
  assert.equal(afterLogout.response.status, 401);
  assert.ok(calls.some((call) => call.method === "login_status" && call.cookie === "MUSIC_U=fake-but-invalid"));
});

test("netease account does not fake success from bare MUSIC_U without validation profile", async () => {
  const neteaseClient = {};
  const baseUrl = await startTestServer({ neteaseClient });

  const login = await getJson(`${baseUrl}/api/netease/account/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ cookie: "MUSIC_U=looks-real-but-unverified" })
  });

  assert.equal(login.response.status, 401);
  assert.equal(login.body.error, "netease_login_invalid");
});

test("bili search, account sync, song resolve, and stream proxy use verified full media", async () => {
  const calls = [];
  const json = (body) => new Response(JSON.stringify(body), { headers: { "content-type": "application/json" } });
  const fetchImpl = async (url, init = {}) => {
    const parsed = new URL(url);
    calls.push({ pathname: parsed.pathname, headers: init.headers ?? {} });
    if (parsed.pathname === "/x/web-interface/nav") {
      return json({ code: 0, data: { isLogin: true, uname: "BiliUser", mid: 456, wbi_img: { img_url: "https://i0.hdslb.com/bfs/wbi/abcdefghijklmnopqrstuvwxyz1234567890abcdef.png", sub_url: "https://i0.hdslb.com/bfs/wbi/1234567890abcdefghijklmnopqrstuvwxyzabcdef.png" } } });
    }
    if (parsed.pathname === "/x/web-interface/wbi/search/type") {
      return json({ code: 0, data: { result: [{ bvid: "BV1abc", cid: 123, title: "<em>Full</em> Video", author: "UP", pic: "//pic.test/a.jpg", duration: "03:20" }, { bvid: "BVshort", cid: 124, title: "Short", author: "UP", pic: "", duration: "00:30" }] } });
    }
    if (parsed.pathname === "/x/player/wbi/playurl") {
      return json({ code: 0, data: { dash: { audio: [{ baseUrl: "https://audio.bili.test/high.m4a", backupUrl: ["https://audio.bili.test/backup.m4a"], codecs: "mp4a.40.2", id: 30280, bandwidth: 192000 }, { baseUrl: "https://audio.bili.test/low.m4a", codecs: "mp4a.40.2", id: 30216, bandwidth: 64000 }] } } });
    }
    if (parsed.pathname === "/x/web-interface/view") {
      return json({ code: 0, data: { bvid: "BV1abc", cid: 123, title: "Full Video", pic: "/view.jpg", owner: { name: "UP" }, duration: 200 } });
    }
    if (parsed.pathname === "/x/v3/fav/folder/created/list-all") {
      return json({ code: 0, data: { list: [{ id: 88, title: "Bili Fav", cover: "/fav.jpg", media_count: 2 }] } });
    }
    if (parsed.pathname === "/x/v3/fav/resource/list") {
      return json({ code: 0, data: { medias: [{ bvid: "BV1abc", cid: 123, title: "Full Video", cover: "/cover.jpg", upper: { name: "UP" }, duration: 200 }, { bvid: "BVshort", cid: 124, title: "Short", cover: "", upper: { name: "UP" }, duration: 30 }] } });
    }
    if (url.startsWith("https://audio.bili.test/")) {
      return new Response("audio", { status: init.headers.Range ? 206 : 200, headers: { "content-type": "audio/mp4", "content-length": "5", "content-range": "bytes 0-4/5", "accept-ranges": "bytes" } });
    }
    return json({ code: -1, message: "unexpected" });
  };
  const baseUrl = await startTestServer({ neteaseClient: {}, fetchImpl });

  const search = await getJson(`${baseUrl}/api/bili/search?keyword=test`);
  const login = await getJson(`${baseUrl}/api/bili/account/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ cookie: "SESSDATA=mock; DedeUserID=456; bili_jct=csrf" })
  });
  const playlists = await getJson(`${baseUrl}/api/bili/account/playlists`);
  const songResult = await getJson(`${baseUrl}/api/bili/song/BV1abc?cid=123`);
  const stream = await fetch(`${baseUrl}/api/bili/stream/BV1abc?cid=123`, { headers: { Range: "bytes=0-4" } });

  assert.equal(search.response.status, 200);
  assert.deepEqual(search.body.songs.map((item) => item.id), ["bili_BV1abc_123"]);
  assert.equal(login.body.loggedIn, true);
  assert.equal(playlists.body.playlists[0].songs.length, 1);
  assert.equal(songResult.response.status, 200);
  assert.equal(songResult.body.url, "/api/bili/stream/BV1abc?cid=123&quality=high");
  assert.equal(songResult.body.durationMs, 200_000);
  assert.equal(stream.status, 206);
  assert.equal(await stream.text(), "audio");
  assert.ok(calls.some((call) => call.pathname === "/x/player/wbi/playurl"));
  assert.ok(calls.some((call) => call.pathname === "/x/web-interface/wbi/search/type"));
  assert.ok(calls.some((call) => call.pathname === "/x/web-interface/view"));
});

test("bili account sync fetches every favorite folder and every media page", async () => {
  const folderRequests = [];
  const mediaRequests = [];
  const json = (body) => new Response(JSON.stringify(body), { headers: { "content-type": "application/json" } });
  const folders = Array.from({ length: 9 }, (_, index) => ({
    id: index + 1,
    title: `Folder ${index + 1}`,
    cover: `/folder-${index + 1}.jpg`,
    media_count: index === 0 ? 61 : 1
  }));
  const fullMedia = (folderId, index) => ({
    bvid: `BV${folderId}_${index}`,
    cid: folderId * 1000 + index,
    title: `Folder ${folderId} Track ${index}`,
    cover: `/cover-${folderId}-${index}.jpg`,
    upper: { name: "UP" },
    duration: 200
  });
  const fetchImpl = async (url) => {
    const parsed = new URL(url);
    if (parsed.pathname === "/x/web-interface/nav") {
      return json({ code: 0, data: { isLogin: true, uname: "BiliUser", mid: 456 } });
    }
    if (parsed.pathname === "/x/v3/fav/folder/created/list-all") {
      folderRequests.push(parsed);
      return json({ code: 0, data: { list: folders } });
    }
    if (parsed.pathname === "/x/v3/fav/resource/list") {
      const folderId = Number(parsed.searchParams.get("media_id"));
      const page = Number(parsed.searchParams.get("pn"));
      mediaRequests.push({ folderId, page });
      const all = folderId === 1
        ? Array.from({ length: 61 }, (_, index) => fullMedia(folderId, index + 1))
        : [fullMedia(folderId, 1)];
      const start = (page - 1) * 60;
      return json({
        code: 0,
        data: {
          info: { media_count: all.length },
          medias: all.slice(start, start + 60)
        }
      });
    }
    throw new Error(`unexpected fetch ${url}`);
  };
  const baseUrl = await startTestServer({ neteaseClient: {}, fetchImpl });

  const login = await getJson(`${baseUrl}/api/bili/account/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ cookie: "SESSDATA=valid; DedeUserID=456; bili_jct=csrf" })
  });
  const synced = await getJson(`${baseUrl}/api/bili/account/playlists`);

  assert.equal(login.response.status, 200);
  assert.equal(synced.response.status, 200);
  assert.equal(synced.body.playlists.length, 9);
  assert.equal(synced.body.playlists[0].songs.length, 61);
  assert.equal(synced.body.playlists[0].trackCount, 61);
  assert.deepEqual(mediaRequests.filter((request) => request.folderId === 1).map((request) => request.page), [1, 2]);
  assert.equal(folderRequests.length, 1);
});

test("bili search signs WBI request and does not expose invalid json on upstream html", async () => {
  const searchRequests = [];
  const json = (body) => new Response(JSON.stringify(body), { headers: { "content-type": "application/json" } });
  const navBody = { code: 0, data: { isLogin: false, wbi_img: { img_url: "https://i0.hdslb.com/bfs/wbi/abcdefghijklmnopqrstuvwxyz1234567890abcdef.png", sub_url: "https://i0.hdslb.com/bfs/wbi/1234567890abcdefghijklmnopqrstuvwxyzabcdef.png" } } };
  const fetchImpl = async (url) => {
    const parsed = new URL(url);
    if (parsed.pathname === "/x/web-interface/nav") return json(navBody);
    if (parsed.pathname === "/x/web-interface/wbi/search/type") {
      searchRequests.push(parsed);
      return json({
        code: 0,
        data: {
          result: [
            { bvid: "BVfull", cid: 123, title: "Full", author: "UP", pic: "", duration: "03:20" },
            { bvid: "BVexact", cid: 124, title: "Exact", author: "UP", pic: "", duration: "01:00" },
            { bvid: "BVshort", cid: 125, title: "Short", author: "UP", pic: "", duration: "00:59" }
          ]
        }
      });
    }
    throw new Error(`unexpected fetch ${url}`);
  };
  const baseUrl = await startTestServer({ neteaseClient: {}, fetchImpl });

  const signed = await getJson(`${baseUrl}/api/bili/search?keyword=test&limit=5`);

  assert.equal(signed.response.status, 200);
  assert.equal(searchRequests.length, 1);
  assert.equal(searchRequests[0].searchParams.get("keyword"), "test");
  assert.equal(searchRequests[0].searchParams.get("search_type"), "video");
  assert.ok(searchRequests[0].searchParams.get("wts"));
  assert.match(searchRequests[0].searchParams.get("w_rid") ?? "", /^[a-f0-9]{32}$/);
  assert.deepEqual(signed.body.songs.map((item) => item.id), ["bili_BVfull_123"]);

  const htmlFetchImpl = async (url) => {
    const parsed = new URL(url);
    if (parsed.pathname === "/x/web-interface/nav") return json(navBody);
    if (parsed.pathname === "/x/web-interface/wbi/search/type") {
      return new Response("<html><title>412</title><body>risk control</body></html>", {
        status: 412,
        headers: { "content-type": "text/html" }
      });
    }
    throw new Error(`unexpected fetch ${url}`);
  };
  const htmlBaseUrl = await startTestServer({ neteaseClient: {}, fetchImpl: htmlFetchImpl });
  const htmlFailure = await getJson(`${htmlBaseUrl}/api/bili/search?keyword=test&limit=5`);

  assert.equal(htmlFailure.response.status, 502);
  assert.equal(htmlFailure.body.error, "bili_search_failed");
  assert.match(htmlFailure.body.message, /Bili 接口不可用|风控/);
  assert.doesNotMatch(htmlFailure.body.message, /invalid json/i);
});

test("bili account rejects invalid cookies, sync failures, and logout clears auth", async () => {
  let mode = "invalid";
  const json = (body) => new Response(JSON.stringify(body), { headers: { "content-type": "application/json" } });
  const fetchImpl = async (url, init = {}) => {
    const parsed = new URL(url);
    if (parsed.pathname === "/x/web-interface/nav") {
      if (mode === "valid" || mode === "sync-fails") {
        assert.match(init.headers.Cookie ?? "", /SESSDATA=valid/);
        return json({ code: 0, data: { isLogin: true, uname: "BiliUser", mid: 456, wbi_img: { img_url: "https://i0.hdslb.com/bfs/wbi/abcdefghijklmnopqrstuvwxyz1234567890abcdef.png", sub_url: "https://i0.hdslb.com/bfs/wbi/1234567890abcdefghijklmnopqrstuvwxyzabcdef.png" } } });
      }
      return json({ code: 0, data: { isLogin: false } });
    }
    if (parsed.pathname === "/x/v3/fav/folder/created/list-all") {
      return json({ code: -101, message: "账号未登录" });
    }
    throw new Error(`unexpected fetch ${url}`);
  };
  const baseUrl = await startTestServer({ neteaseClient: {}, fetchImpl });

  const empty = await getJson(`${baseUrl}/api/bili/account/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ cookie: "" })
  });
  const invalid = await getJson(`${baseUrl}/api/bili/account/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ cookie: "SESSDATA=invalid; DedeUserID=456" })
  });
  const beforeLogin = await getJson(`${baseUrl}/api/bili/account/playlists`);
  mode = "valid";
  const valid = await getJson(`${baseUrl}/api/bili/account/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ cookie: "SESSDATA=valid; DedeUserID=456; bili_jct=csrf" })
  });
  mode = "sync-fails";
  const syncFailure = await getJson(`${baseUrl}/api/bili/account/playlists`);
  const logout = await getJson(`${baseUrl}/api/bili/account/logout`, { method: "POST" });
  mode = "invalid";
  const afterLogout = await getJson(`${baseUrl}/api/bili/account/playlists`);

  assert.equal(empty.response.status, 400);
  assert.equal(empty.body.error, "cookie_required");
  assert.equal(invalid.response.status, 401);
  assert.equal(invalid.body.error, "bili_login_invalid");
  assert.equal(beforeLogin.response.status, 401);
  assert.equal(valid.response.status, 200);
  assert.equal(valid.body.loggedIn, true);
  assert.equal(syncFailure.response.status, 502);
  assert.equal(syncFailure.body.error, "bili_sync_failed");
  assert.match(syncFailure.body.message, /账号未登录/);
  assert.equal(logout.response.status, 200);
  assert.equal(logout.body.loggedIn, false);
  assert.equal(afterLogout.response.status, 401);
});