import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn, spawnSync } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";
import {
  parseWindow, parseRateLimits, mergeWindow, mergeLimits, statusText, writeFileAtomic, runStatusline,
  LIMITS_FILE_NAME, DUMP_FILE_NAME, SAME_WINDOW_TOLERANCE_MS,
} from "../scripts/statusline.mjs";
import { createServer } from "../src/server/http.js";
import { DEFAULTS } from "../src/config.js";
import { limitView } from "../public/js/limits.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const SCRIPT = path.resolve(here, "..", "scripts", "statusline.mjs");
const FIX = path.join(here, "fixtures", "statusline");
const readFix = (name) => fs.readFileSync(path.join(FIX, name), "utf8");

const R5 = 1738425600000;
const R7 = 1738857600000;
const NOW = R5 - 7980000;
const mkTmp = () => fs.mkdtempSync(path.join(os.tmpdir(), "agent-ui-lim-"));
const win = (usedPercentage, resetsAtMs) => ({ usedPercentage, resetsAtMs });

test("S1 parseWindow 정상·단위", () => {
  assert.deepEqual(parseWindow({ used_percentage: 23.5, resets_at: 1738425600 }), win(23.5, R5));
  assert.deepEqual(parseWindow({ used_percentage: 23.5, resets_at: R5 }), win(23.5, R5));
});

test("S2 parseWindow 거부", () => {
  const bad = [
    null, [], "x",
    { used_percentage: "23", resets_at: 1738425600 },
    { used_percentage: NaN, resets_at: 1738425600 },
    { used_percentage: Infinity, resets_at: 1738425600 },
    { used_percentage: 5 },
    { used_percentage: 5, resets_at: 0 },
    { used_percentage: 5, resets_at: -5 },
    { used_percentage: 5, resets_at: "1738425600" },
  ];
  for (const b of bad) assert.equal(parseWindow(b), null, JSON.stringify(b));
  assert.equal(parseWindow({ used_percentage: -3, resets_at: 1738425600 }).usedPercentage, -3);
  assert.equal(parseWindow({ used_percentage: 120, resets_at: 1738425600 }).usedPercentage, 120);
});

test("S3 parseRateLimits", () => {
  const docs = JSON.parse(readFix("input-docs.json"));
  assert.deepEqual(parseRateLimits(docs), { five_hour: win(23.5, R5), seven_day: win(41.2, R7) });
  assert.equal(parseRateLimits({}), null);
  assert.equal(parseRateLimits({ rate_limits: null }), null);
  assert.equal(parseRateLimits({ rate_limits: [] }), null);
  assert.equal(parseRateLimits(null), null);
  assert.deepEqual(
    parseRateLimits({ rate_limits: { five_hour: { used_percentage: 30, resets_at: 1738425600 } } }),
    { five_hour: win(30, R5), seven_day: null },
  );
  assert.equal(parseRateLimits({ rate_limits: { five_hour: { used_percentage: "x" }, seven_day: 3 } }), null);
  assert.equal(parseRateLimits({ rate_limits: { spend_limit: { used_percentage: 5, resets_at: 1738425600 } } }), null);
});

test("S4 mergeWindow 규칙", () => {
  const old = win(50, R5);
  assert.deepEqual(mergeWindow(old, null), old);
  assert.deepEqual(mergeWindow(null, win(10, R5)), win(10, R5));
  const T = SAME_WINDOW_TOLERANCE_MS;
  assert.equal(T, 60000);
  assert.deepEqual(mergeWindow(old, win(1, R5 + 61000)), win(1, R5 + 61000));
  assert.deepEqual(mergeWindow(old, win(99, R5 - 61000)), old);
  assert.deepEqual(mergeWindow(win(30, R5), win(40, R5 + 30000)), win(40, R5 + 30000));
  assert.deepEqual(mergeWindow(win(40, R5 + 30000), win(30, R5)), win(40, R5 + 30000));
  assert.deepEqual(mergeWindow(win(30, R5), win(40, R5 - 30000)), win(40, R5));
  assert.deepEqual(mergeWindow(win(40, R5 - 30000), win(30, R5)), win(40, R5));
});

test("S5 mergeLimits 기존 파일 형식", () => {
  const inc = { five_hour: win(10, R5), seven_day: null };
  for (const ex of [null, "x", { version: 2, five_hour: win(90, R5), seven_day: win(90, R7) }]) {
    const m = mergeLimits(ex, inc, 123, "sid");
    assert.deepEqual(m, { version: 1, updatedAtMs: 123, sessionId: "sid", five_hour: win(10, R5), seven_day: null });
  }
  const m = mergeLimits({ version: 1, five_hour: { usedPercentage: "1", resetsAtMs: R5 }, seven_day: win(5, R7) }, inc, 7, null);
  assert.equal(m.five_hour.usedPercentage, 10);
  assert.deepEqual(m.seven_day, win(5, R7));
  assert.equal(m.version, 1);
  assert.equal(m.updatedAtMs, 7);
  assert.equal(m.sessionId, null);
  const m2 = mergeLimits({ version: 1, five_hour: { usedPercentage: "1", resetsAtMs: R5 }, seven_day: null }, { five_hour: null, seven_day: null }, 1, null);
  assert.equal(m2.five_hour, null);
});

test("S6 statusText", () => {
  const both = { five_hour: win(23.5, R5), seven_day: win(41.2, R7) };
  assert.equal(statusText(both, NOW), "5h 76% left · 7d 58% left");
  assert.equal(statusText({ five_hour: win(23.5, R5), seven_day: null }, NOW), "5h 76% left");
  assert.equal(statusText(both, R5), "7d 58% left");
  assert.equal(statusText(both, R5 + 1), "7d 58% left");
  assert.equal(statusText(null, NOW), "");
  const one = (u) => statusText({ five_hour: win(u, R5), seven_day: null }, NOW);
  assert.equal(one(100), "5h 0% left");
  assert.equal(one(-3), "5h 100% left");
  assert.equal(one(80.5), "5h 19% left");
});

test("S7 writeFileAtomic", () => {
  const dir = mkTmp();
  const f = path.join(dir, "a.json");
  fs.writeFileSync(f, "old");
  writeFileAtomic(f, "new");
  assert.equal(fs.readFileSync(f, "utf8"), "new");
  assert.deepEqual(fs.readdirSync(dir).filter((n) => n.endsWith(".tmp")), []);
  const d = path.join(dir, "adir");
  fs.mkdirSync(d);
  assert.throws(() => writeFileAtomic(d, "x"));
  assert.deepEqual(fs.readdirSync(dir).filter((n) => n.endsWith(".tmp")), []);
  assert.ok(fs.statSync(d).isDirectory());
});

test("S8 runStatusline 입력별 파일 동작", () => {
  const dir = mkTmp();
  const file = path.join(dir, LIMITS_FILE_NAME);
  const docs = readFix("input-docs.json");
  const out = runStatusline({ raw: docs, dir, nowMs: NOW, dump: false });
  assert.equal(out, "5h 76% left · 7d 58% left");
  const saved = JSON.parse(fs.readFileSync(file, "utf8"));
  assert.deepEqual(Object.keys(saved), ["version", "updatedAtMs", "sessionId", "five_hour", "seven_day"]);
  assert.equal(saved.sessionId, "test-session-abc");
  assert.equal(saved.updatedAtMs, NOW);
  assert.deepEqual(saved.five_hour, win(23.5, R5));
  assert.equal("model" in saved, false);
  assert.equal("workspace" in saved, false);

  const before = fs.readFileSync(file);
  assert.equal(runStatusline({ raw: readFix("input-no-rate-limits.json"), dir, nowMs: NOW + 5, dump: false }), "");
  assert.deepEqual(fs.readFileSync(file), before);
  for (const raw of ["{", ""]) {
    assert.equal(runStatusline({ raw, dir, nowMs: NOW + 5, dump: false }), "");
    assert.deepEqual(fs.readFileSync(file), before);
  }
  const empty = mkTmp();
  assert.equal(runStatusline({ raw: readFix("input-no-rate-limits.json"), dir: empty, nowMs: NOW, dump: false }), "");
  assert.deepEqual(fs.readdirSync(empty), []);
});

test("S9 runStatusline 한쪽 윈도우·병합", () => {
  const dir = mkTmp();
  const file = path.join(dir, LIMITS_FILE_NAME);
  runStatusline({ raw: readFix("input-docs.json"), dir, nowMs: NOW, dump: false });
  runStatusline({ raw: readFix("input-five-hour-only.json"), dir, nowMs: NOW + 1000, dump: false });
  let saved = JSON.parse(fs.readFileSync(file, "utf8"));
  assert.equal(saved.five_hour.usedPercentage, 30);
  assert.equal(saved.seven_day.usedPercentage, 41.2);
  const lower = JSON.stringify({ session_id: "s2", rate_limits: { five_hour: { used_percentage: 25, resets_at: 1738425600 } } });
  runStatusline({ raw: lower, dir, nowMs: NOW + 2000, dump: false });
  saved = JSON.parse(fs.readFileSync(file, "utf8"));
  assert.equal(saved.five_hour.usedPercentage, 30);
  assert.equal(saved.updatedAtMs, NOW + 2000);
  assert.equal(saved.sessionId, "s2");
});

test("S10 runStatusline 쓰기 실패·덤프", () => {
  const dir = mkTmp();
  const notDir = path.join(dir, "file");
  fs.writeFileSync(notDir, "x");
  const lines = [];
  const orig = process.stderr.write;
  process.stderr.write = (s) => { lines.push(String(s)); return true; };
  let out;
  try {
    out = runStatusline({ raw: readFix("input-docs.json"), dir: notDir, nowMs: NOW, dump: false });
  } finally {
    process.stderr.write = orig;
  }
  assert.equal(out, "5h 76% left · 7d 58% left");
  assert.equal(lines.length, 1);
  assert.ok(lines[0].startsWith("agent-ui statusline:"));

  const d2 = mkTmp();
  runStatusline({ raw: readFix("input-docs.json"), dir: d2, nowMs: NOW, dump: false });
  assert.equal(fs.existsSync(path.join(d2, DUMP_FILE_NAME)), false);
  const d3 = mkTmp();
  assert.equal(runStatusline({ raw: "{broken", dir: d3, nowMs: NOW, dump: true }), "");
  assert.equal(fs.readFileSync(path.join(d3, DUMP_FILE_NAME), "utf8"), "{broken");
});

// ---- 자식 프로세스 ----

function envFor(tmp) {
  return { ...process.env, USERPROFILE: tmp, HOME: tmp };
}
const limitsPath = (tmp) => path.join(tmp, ".claude", "agent-ui", LIMITS_FILE_NAME);
const run = (tmp, input, args = []) =>
  spawnSync(process.execPath, [SCRIPT, ...args], { input, env: envFor(tmp), encoding: "utf8" });

test("S11 자식 프로세스 정상", () => {
  const tmp = mkTmp();
  const r = run(tmp, readFix("input-docs.json"));
  assert.equal(r.status, 0);
  assert.equal(r.stdout, "");
  const saved = JSON.parse(fs.readFileSync(limitsPath(tmp), "utf8"));
  assert.deepEqual(saved.five_hour, win(23.5, R5));
  assert.deepEqual(saved.seven_day, win(41.2, R7));

  const future = Math.floor(Date.now() / 1000) + 7200;
  const doc = JSON.parse(readFix("input-docs.json"));
  doc.rate_limits.five_hour.resets_at = future;
  doc.rate_limits.seven_day.resets_at = future;
  const tmp2 = mkTmp();
  const r2 = run(tmp2, JSON.stringify(doc));
  assert.equal(r2.status, 0);
  assert.match(r2.stdout, /^5h \d+% left · 7d \d+% left\n$/);
});

test("S12 자식 프로세스 부재·깨짐", () => {
  for (const input of [readFix("input-no-rate-limits.json"), "{", ""]) {
    const tmp = mkTmp();
    const r = run(tmp, input);
    assert.equal(r.status, 0);
    assert.equal(r.stdout, "");
    assert.doesNotMatch(r.stderr, /\bat .*\(.*:\d+:\d+\)/);
    assert.equal(fs.existsSync(limitsPath(tmp)), false);
  }
});

test("S13 자식 프로세스 한쪽 윈도우", () => {
  const tmp = mkTmp();
  const r = run(tmp, readFix("input-five-hour-only.json"));
  assert.equal(r.status, 0);
  const saved = JSON.parse(fs.readFileSync(limitsPath(tmp), "utf8"));
  assert.equal(saved.five_hour.usedPercentage, 30);
  assert.equal(saved.seven_day, null);
});

function runAsync(tmp, input) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [SCRIPT], { env: envFor(tmp), stdio: ["pipe", "pipe", "pipe"] });
    child.on("error", reject);
    child.on("close", (code) => resolve(code));
    child.stdin.end(input);
  });
}

test("S14 동시 기록", async () => {
  const tmp = mkTmp();
  const mk = (used) => JSON.stringify({ session_id: `s${used}`, rate_limits: { five_hour: { used_percentage: used, resets_at: 1738425600 } } });
  const used = [10, 20, 30, 40, 50, 60, 70, 80];
  const codes = await Promise.all(used.map((u) => runAsync(tmp, mk(u))));
  assert.deepEqual(codes, used.map(() => 0));
  const file = limitsPath(tmp);
  const saved = JSON.parse(fs.readFileSync(file, "utf8"));
  assert.deepEqual(Object.keys(saved), ["version", "updatedAtMs", "sessionId", "five_hour", "seven_day"]);
  assert.ok(used.includes(saved.five_hour.usedPercentage));
  assert.deepEqual(fs.readdirSync(path.dirname(file)).filter((n) => n.endsWith(".tmp")), []);
  const before = saved.five_hour.usedPercentage;
  assert.equal(run(tmp, mk(5)).status, 0);
  assert.equal(JSON.parse(fs.readFileSync(file, "utf8")).five_hour.usedPercentage, before);
});

test("S15 --dump", () => {
  const tmp = mkTmp();
  const input = readFix("input-docs.json");
  assert.equal(run(tmp, input, ["--dump"]).status, 0);
  assert.equal(fs.readFileSync(path.join(tmp, ".claude", "agent-ui", DUMP_FILE_NAME), "utf8"), input);
  const tmp2 = mkTmp();
  assert.equal(run(tmp2, input).status, 0);
  assert.equal(fs.existsSync(path.join(tmp2, ".claude", "agent-ui", DUMP_FILE_NAME)), false);
});

test("S16 end-to-end: 스크립트 → 파일 → /api/limits → limitView", async () => {
  const tmp = mkTmp();
  assert.equal(run(tmp, readFix("input-docs.json")).status, 0);
  const server = createServer({ ...DEFAULTS, projectsRoot: mkTmp(), limitsFile: limitsPath(tmp) });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  try {
    const res = await fetch(`http://127.0.0.1:${server.address().port}/api/limits`);
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.status, "ok");
    assert.ok(Number.isFinite(body.limits.updatedAtMs));
    assert.deepEqual(body.limits.five_hour, win(23.5, R5));
    assert.deepEqual(body.limits.seven_day, win(41.2, R7));
    assert.equal("sessionId" in body.limits, false);
    // updatedAtMs 는 지금(NOW 보다 미래)이라 stale 이 아니다
    const view = limitView(body, NOW);
    assert.equal(view.stale, false);
    assert.equal(view.rows[0].valueText, "76% left");
    assert.equal(view.rows[0].resetText, "resets in 2h 13m");
    assert.equal(view.rows[1].valueText, "58% left");
  } finally {
    server.closeAllConnections();
    server.close();
  }
});

test("S17 import 만으로는 출력도 파일 생성도 없다 (13a)", () => {
  const home = mkTmp();
  const r = spawnSync(process.execPath, ["-e", `import(${JSON.stringify(pathToFileURL(SCRIPT).href)})`], {
    env: { ...process.env, HOME: home, USERPROFILE: home },
    encoding: "utf8",
  });
  assert.equal(r.status, 0);
  assert.equal(r.stdout, "");
  assert.equal(fs.existsSync(path.join(home, ".claude", "agent-ui")), false);
});
