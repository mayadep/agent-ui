import test, { before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import http from "node:http";
import { fileURLToPath } from "node:url";
import { createServer, isAllowedHost } from "../src/server/http.js";
import { DEFAULTS } from "../src/config.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const SID = "11111111-1111-4111-8111-111111111111";
const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "agent-ui-root-"));
fs.cpSync(path.join(here, "fixtures", "projects"), tmpRoot, { recursive: true });
const mainFile = path.join(tmpRoot, "D--demo", `${SID}.jsonl`);
const subDir = path.join(tmpRoot, "D--demo", SID, "subagents");

let server;
let base;
const limitsFile = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "agent-ui-limhttp-")), "rate-limits.json");
const agentsDir = fs.mkdtempSync(path.join(os.tmpdir(), "agent-ui-agentshttp-"));
fs.writeFileSync(path.join(agentsDir, "reviewer.md"), "---\nname: reviewer\nmodel: claude-opus-5-5\n---\n");
const cfg = { ...DEFAULTS, projectsRoot: tmpRoot, limitsFile, agentsDir, pollMs: 100, pushThrottleMs: 50, idleWatcherMs: 500 };

before(async () => {
  server = createServer(cfg);
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  base = `http://127.0.0.1:${server.address().port}`;
});

after(() => {
  server.closeAllConnections();
  server.close();
});

const getJson = async (p) => {
  const r = await fetch(base + p);
  return { status: r.status, body: await r.json(), headers: r.headers };
};

function rawGet(p) {
  return new Promise((resolve, reject) => {
    http.get({ host: "127.0.0.1", port: server.address().port, path: p }, (res) => {
      res.resume();
      res.on("end", () => resolve(res.statusCode));
    }).on("error", reject);
  });
}

// SSE 클라이언트: 이벤트를 모아 두고 조건이 맞을 때까지 기다린다.
function openSse(p) {
  const events = [];
  const waiters = [];
  let buf = "";
  const req = http.get(base + p, (res) => {
    res.setEncoding("utf8");
    res.on("data", (chunk) => {
      buf += chunk;
      let i;
      while ((i = buf.indexOf("\n\n")) >= 0) {
        const block = buf.slice(0, i);
        buf = buf.slice(i + 2);
        const ev = /^event: (.*)$/m.exec(block);
        const data = /^data: (.*)$/m.exec(block);
        if (ev && data) {
          events.push({ event: ev[1], data: JSON.parse(data[1]) });
          waiters.slice().forEach((w) => w());
        }
      }
    });
  });
  const waitFor = (pred, ms = 2000) => new Promise((resolve, reject) => {
    const check = () => {
      const found = events.find(pred);
      if (found) { cleanup(); resolve(found); }
    };
    const t = setTimeout(() => { cleanup(); reject(new Error("sse timeout")); }, ms);
    const cleanup = () => { clearTimeout(t); const i = waiters.indexOf(check); if (i >= 0) waiters.splice(i, 1); };
    waiters.push(check);
    check();
  });
  return { waitFor, close: () => req.destroy() };
}

test("GET /api/sessions and latest", async () => {
  const s = await getJson("/api/sessions");
  assert.equal(s.status, 200);
  assert.equal(s.body.sessions.length, 1);
  assert.equal(s.body.sessions[0].sessionId, SID);
  assert.equal(s.body.sessions[0].title, "Demo session");
  assert.equal(s.headers.get("cache-control"), "no-store");
  const l = await getJson("/api/sessions/latest");
  assert.deepEqual(l.body, { projectKey: "D--demo", sessionId: SID });
});

test("GET /api/run returns snapshot", async () => {
  const r = await getJson(`/api/run/D--demo/${SID}`);
  assert.equal(r.status, 200);
  assert.equal(r.body.run.nodes.length, 5);
  assert.ok(r.body.events.length > 0);
});

test("invalid and missing sessions", async () => {
  assert.equal((await getJson("/api/run/..%2F../x")).status, 400);
  assert.equal((await getJson(`/api/run/D--demo/not-a-uuid`)).status, 400);
  assert.equal((await getJson(`/api/run/..%2F/${SID}`)).status, 400);
  assert.equal((await getJson(`/api/run/D--demo/22222222-2222-4222-8222-222222222222`)).status, 404);
  assert.equal((await getJson(`/api/run/Nope/${SID}`)).status, 404);
});

test("GET /api/agents lists registered agents", async () => {
  const r = await getJson("/api/agents");
  assert.equal(r.status, 200);
  assert.equal(r.body.agents.length, 1);
  assert.equal(r.body.agents[0].name, "reviewer");
  assert.equal(r.body.agents[0].role, "judge");
});

test("static serving and traversal", async () => {
  assert.equal(await rawGet("/static/../src/config.js"), 404);
  assert.equal(await rawGet("/static/..%2Fsrc%2Fconfig.js"), 404);
  assert.equal(await rawGet("/static/nothing.js"), 404);
  const r = await fetch(base + "/");
  assert.equal(r.status, 200);
  assert.match(r.headers.get("content-type"), /text\/html/);
  const js = await fetch(base + "/static/js/app.js");
  assert.equal(js.status, 200);
  assert.match(js.headers.get("content-type"), /text\/javascript/);
});

test("SSE snapshot, update on append, new subagent", async () => {
  const sse = openSse(`/api/run/D--demo/${SID}/stream`);
  try {
    const snap = await sse.waitFor((e) => e.event === "snapshot");
    assert.equal(snap.data.run.nodes.length, 5);

    const line = JSON.stringify({
      type: "assistant", uuid: "u-x", timestamp: "2026-10-29T01:10:00Z", sessionId: SID,
      message: { id: "msg_new", role: "assistant", model: "claude-opus-5-5", content: [{ type: "text", text: "appended" }], usage: { input_tokens: 1, output_tokens: 1 } },
    });
    fs.appendFileSync(mainFile, line + "\n");
    const upd = await sse.waitFor((e) => e.event === "update" && e.data.newEvents.some((x) => x.text === "appended"));
    assert.ok(upd.data.newEvents.length >= 1);

    fs.writeFileSync(path.join(subDir, "agent-x.jsonl"), JSON.stringify({
      type: "assistant", timestamp: "2026-10-29T01:11:00Z", agentId: "x", isSidechain: true,
      message: { id: "msg_x1", role: "assistant", model: "claude-haiku-5-5", content: [{ type: "text", text: "hi" }], usage: {} },
    }) + "\n");
    await sse.waitFor((e) => e.event === "update" && e.data.run.nodes.length === 6);
  } finally {
    sse.close();
  }
});

function rawRequest(host, p) {
  return new Promise((resolve, reject) => {
    const req = http.request({ host: "127.0.0.1", port: server.address().port, path: p, headers: { Host: host } }, (res) => {
      let body = "";
      res.setEncoding("utf8");
      res.on("data", (c) => (body += c));
      res.on("end", () => resolve({ status: res.statusCode, body }));
    });
    req.on("error", reject);
    req.end();
  });
}

test("Host 헤더 검증", async () => {
  const port = server.address().port;
  const bad = await rawRequest(`evil.com:${port}`, "/api/sessions");
  assert.equal(bad.status, 403);
  assert.deepEqual(JSON.parse(bad.body), { error: "forbidden host" });
  assert.equal((await rawRequest(`localhost:${port}`, "/api/sessions")).status, 200);
  assert.equal((await rawRequest(`[::1]:${port}`, "/api/sessions")).status, 200);
  assert.equal((await rawRequest("127.0.0.1", "/api/sessions")).status, 403);
  assert.equal((await rawRequest(`127.0.0.1:${port + 1}`, "/api/sessions")).status, 403);
  assert.equal((await rawRequest(`evil.com:${port}`, `/api/run/D--demo/${SID}/stream`)).status, 403);
});

test("isAllowedHost", () => {
  assert.equal(isAllowedHost("LOCALHOST:8770", 8770), true);
  assert.equal(isAllowedHost(undefined, 8770), false);
  assert.equal(isAllowedHost("localhost.evil.com:8770", 8770), false);
});

// 픽스처 복사본(tmpRoot)을 줄이므로 이 파일의 마지막 테스트로 둔다.
test("SSE: 서버 reset 시 snapshot 을 다시 보낸다", async () => {
  const sse = openSse(`/api/run/D--demo/${SID}/stream`);
  try {
    const first = await sse.waitFor((e) => e.event === "snapshot");
    const turns = first.data.run.totals.turns;
    const lines = fs.readFileSync(mainFile, "utf8").split("\n").filter(Boolean);
    fs.writeFileSync(mainFile, lines.slice(0, 4).join("\n") + "\n");
    await sse.waitFor((e) => e.event === "snapshot" && e.data.run.totals.turns < turns);
  } finally {
    sse.close();
  }
});


// ---- 보강: Host 검증 우선순위 / R3 반례 / 경계값 (임시 서버는 listen(0) 이므로 포트는 항상 동적) ----

function rawRequestFull(host, p, method = "GET") {
  return new Promise((resolve, reject) => {
    const headers = host === undefined ? {} : { Host: host };
    const req = http.request({ host: "127.0.0.1", port: server.address().port, path: p, method, headers }, (res) => {
      let body = "";
      res.setEncoding("utf8");
      res.on("data", (c) => (body += c));
      res.on("end", () => resolve({ status: res.statusCode, body, headers: res.headers }));
    });
    req.on("error", reject);
    req.end();
  });
}

test("isAllowedHost: 접두/포함/포트 변조 우회 반례 (R3)", () => {
  const P = 8770;
  const bad = [
    `localhost.evil.com:${P}`, `evil.com:${P}`, `localhost:${P}.evil.com`, `localhost:${P}0`, `localhost:${P}@evil.com`,
    `evil.com/localhost:${P}`, `xlocalhost:${P}`, `localhost:${P - 1}`, `127.0.0.1:0`, `127.0.0.1`, `localhost`, `[::1]`, `::1:${P}`,
    `127.0.0.2:${P}`, `0.0.0.0:${P}`, `localhost:${P},evil.com`, `localhost:${P} evil.com`, "", " ", `localhost:`, `:${P}`,
  ];
  for (const h of bad) assert.equal(isAllowedHost(h, P), false, JSON.stringify(h));
  for (const h of [`127.0.0.1:${P}`, `localhost:${P}`, `[::1]:${P}`, `LocalHost:${P}`, `  localhost:${P}  `, `[::1]:${P}`.toUpperCase()]) {
    assert.equal(isAllowedHost(h, P), true, JSON.stringify(h));
  }
  for (const v of [null, 5, {}, ["localhost:8770"]]) assert.equal(isAllowedHost(v, P), false);
});

test("isAllowedHost: 포트는 호출 시점의 인자와 비교한다 (포트 0 설정값이 아님)", () => {
  assert.equal(isAllowedHost("localhost:54321", 54321), true);
  assert.equal(isAllowedHost("localhost:54321", 8770), false);
  assert.equal(isAllowedHost("localhost:8770", 54321), false);
});

test("Host 검증은 라우팅/메서드 검사보다 먼저: 잘못된 Host 는 405/404/400 대신 403", async () => {
  const port = server.address().port;
  const evil = `evil.com:${port}`;
  for (const [method, p] of [["POST", "/api/sessions"], ["DELETE", "/"], ["GET", "/nope"], ["GET", "/api/run/%zz/x"], ["GET", "/static/js/app.js"], ["GET", "/"]]) {
    const r = await rawRequestFull(evil, p, method);
    assert.equal(r.status, 403, `${method} ${p}`);
    assert.deepEqual(JSON.parse(r.body), { error: "forbidden host" });
    assert.equal(r.headers["cache-control"], "no-store");
    assert.match(r.headers["content-type"], /application\/json/);
  }
});

test("올바른 Host 에서 405/404/400 JSON 에러", async () => {
  const host = `127.0.0.1:${server.address().port}`;
  let r = await rawRequestFull(host, "/api/sessions", "POST");
  assert.equal(r.status, 405);
  assert.deepEqual(JSON.parse(r.body), { error: "method not allowed" });
  r = await rawRequestFull(host, "/nope");
  assert.equal(r.status, 404);
  assert.deepEqual(JSON.parse(r.body), { error: "not found" });
  r = await rawRequestFull(host, "/api/run/%zz/x");
  assert.equal(r.status, 400);
  assert.deepEqual(JSON.parse(r.body), { error: "bad request" });
  r = await rawRequestFull(host, "/api/run/D--demo");
  assert.equal(r.status, 404);
  r = await rawRequestFull(host, "/api/sessions/latest/extra");
  assert.equal(r.status, 404);
});

test("Host 변조 변형들: 이름 변조, 포트 변조, 포트 0 은 모두 403", async () => {
  const port = server.address().port;
  for (const h of [`localhost.evil.com:${port}`, `localhost:${port}.evil.com`, `localhost:${port}0`, `localhost:0`, `127.0.0.1:0`, "localhost", "[::1]", `LOCALHOST.evil.com:${port}`]) {
    const r = await rawRequestFull(h, "/api/sessions");
    assert.equal(r.status, 403, h);
  }
  // 대소문자/호스트 3종 정상
  for (const h of [`LOCALHOST:${port}`, `127.0.0.1:${port}`, `[::1]:${port}`]) {
    assert.equal((await rawRequestFull(h, "/api/sessions")).status, 200, h);
  }
});

test("Host 헤더가 없는 요청(HTTP/1.0)은 403", async () => {
  const net = await import("node:net");
  const raw = await new Promise((resolve, reject) => {
    const s = net.connect(server.address().port, "127.0.0.1", () => s.write("GET /api/sessions HTTP/1.0\r\n\r\n"));
    let data = "";
    s.setEncoding("utf8");
    s.on("data", (c) => (data += c));
    s.on("end", () => resolve(data));
    s.on("error", reject);
  });
  assert.match(raw, /^HTTP\/1\.1 403/);
  assert.match(raw, /"error":"forbidden host"/);
});

test("서버는 실제 listen 포트로 검증한다: 포트 0 으로 띄운 서버의 실제 포트가 0 이 아님", () => {
  assert.ok(server.address().port > 0);
});

test("/api/sessions limit 파라미터: 비정상 값은 기본값으로, 상한 200, 항상 200 응답", async () => {
  for (const q of ["", "?limit=0", "?limit=-3", "?limit=abc", "?limit=1.9", "?limit=1000", "?limit=Infinity", "?limit="]) {
    const r = await getJson(`/api/sessions${q}`);
    assert.equal(r.status, 200, q);
    assert.ok(Array.isArray(r.body.sessions), q);
    assert.equal(r.body.sessions.length, 1, q); // 픽스처 세션 1개
  }
});

test("정적 파일: 허용 확장자 외와 디렉터리/null 바이트는 404, 응답 Cache-Control no-store", async () => {
  const css = await fetch(base + "/static/styles.css");
  assert.equal(css.status, 200);
  assert.match(css.headers.get("content-type"), /text\/css; charset=utf-8/);
  assert.equal(css.headers.get("cache-control"), "no-store");
  assert.equal(await rawGet("/static/js"), 404);
  assert.equal(await rawGet("/static/"), 404);
  assert.equal(await rawGet("/static/index.html%00.js"), 404);
  assert.equal(await rawGet("/static/%2e%2e/package.json"), 404);
});

test("SSE 경로 응답 헤더와 존재하지 않는 세션의 stream 은 JSON 404", async () => {
  const miss = await getJson(`/api/run/D--demo/22222222-2222-4222-8222-222222222222/stream`);
  assert.equal(miss.status, 404);
  const inv = await getJson(`/api/run/D--demo/bad-id/stream`);
  assert.equal(inv.status, 400);
  assert.deepEqual(inv.body, { error: "invalid session" });
  const ctype = await new Promise((resolve, reject) => {
    const req = http.get(`${base}/api/run/D--demo/${SID}/stream`, (res) => {
      resolve(res.headers["content-type"]);
      req.destroy();
    });
    req.on("error", reject);
  });
  assert.match(ctype, /text\/event-stream; charset=utf-8/);
});

test("`//` 처럼 URL 로 해석할 수 없는 경로는 500 이 아니라 400", async () => {
  const net = await import("node:net");
  const server = createServer({ ...DEFAULTS, port: 0, projectsRoot: "." });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  try {
    const raw = await new Promise((resolve, reject) => {
      const port = server.address().port;
      const s = net.connect(port, "127.0.0.1", () => s.write(`GET // HTTP/1.1\r\nHost: 127.0.0.1:${port}\r\nConnection: close\r\n\r\n`));
      let data = "";
      s.setEncoding("utf8");
      s.on("data", (c) => (data += c));
      s.on("end", () => resolve(data));
      s.on("error", reject);
    });
    assert.match(raw, /^HTTP\/1\.1 400/);
  } finally {
    server.close();
  }
});

// ---- R15: /api/limits (H1~H3) ----

test("H1 /api/limits 정상·부재·깨짐", async () => {
  const valid = {
    version: 1, updatedAtMs: 1761700000000, sessionId: "abc",
    five_hour: { usedPercentage: 23.5, resetsAtMs: 1738425600000 },
    seven_day: { usedPercentage: 41.2, resetsAtMs: 1738857600000 },
  };
  fs.writeFileSync(limitsFile, JSON.stringify(valid));
  let r = await getJson("/api/limits");
  assert.equal(r.status, 200);
  assert.equal(r.body.status, "ok");
  assert.equal(r.body.limits.five_hour.usedPercentage, 23.5);
  assert.equal("sessionId" in r.body.limits, false);
  assert.equal(r.headers.get("cache-control"), "no-store");
  fs.rmSync(limitsFile);
  r = await getJson("/api/limits");
  assert.equal(r.status, 200);
  assert.deepEqual(r.body, { status: "missing", limits: null });
  fs.writeFileSync(limitsFile, "{ broken");
  r = await getJson("/api/limits");
  assert.equal(r.status, 200);
  assert.equal(r.body.status, "invalid");
  fs.rmSync(limitsFile);
});

test("H2 /api/limits 경로 고정", async () => {
  assert.equal((await getJson("/api/limits/x")).status, 404);
  assert.equal((await getJson("/api/limits/..%2F..%2Fsettings.json")).status, 404);
  const r = await getJson("/api/limits?file=C:/x");
  assert.equal(r.status, 200);
  assert.ok(["ok", "missing", "invalid"].includes(r.body.status));
  assert.deepEqual(r.body, { status: "missing", limits: null }); // cfg 파일 기준(쿼리 무시)
});

test("H3 /api/limits Host 검증·메서드", async () => {
  const port = server.address().port;
  const bad = await rawRequestFull(`evil.com:${port}`, "/api/limits");
  assert.equal(bad.status, 403);
  assert.deepEqual(JSON.parse(bad.body), { error: "forbidden host" });
  const post = await rawRequestFull(`127.0.0.1:${port}`, "/api/limits", "POST");
  assert.equal(post.status, 405);
});
