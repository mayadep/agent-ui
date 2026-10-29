// Claude Code statusLine 명령. stdin JSON 의 rate_limits 만 파싱해 한도 파일에 병합 저장하고 상태 줄 한 줄을 출력한다.
// 단일 파일, Node 표준 모듈만 사용. import 해도 부수효과 없음(진입점 판정은 하단 main 참고). 종료 코드는 항상 0.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

/** @typedef {{ usedPercentage: number, resetsAtMs: number }} LimitWindow */
/** @typedef {{ five_hour: LimitWindow|null, seven_day: LimitWindow|null }} LimitWindows */
/** @typedef {{ version: 1, updatedAtMs: number, sessionId: string|null,
 *              five_hour: LimitWindow|null, seven_day: LimitWindow|null }} LimitsFile */

export const WINDOW_KEYS = ["five_hour", "seven_day"];
export const WINDOW_LABELS = { five_hour: "5h", seven_day: "7d" };
export const LIMITS_FILE_NAME = "rate-limits.json";
export const DUMP_FILE_NAME = "statusline-input.json";
export const SAME_WINDOW_TOLERANCE_MS = 60 * 1000;
export const MAX_STDIN_BYTES = 1024 * 1024;
export const MAX_DUMP_CHARS = 256 * 1024;
export const STDIN_TIMEOUT_MS = 2000;
export const TMP_MAX_AGE_MS = 60 * 1000;
export const RENAME_ATTEMPTS = 5;
export const RENAME_RETRY_WAIT_MS = 15;

const isObj = (v) => v !== null && typeof v === "object" && !Array.isArray(v);
const isNum = (v) => typeof v === "number" && Number.isFinite(v);
const TMP_NAME_RE = /^(?:rate-limits|statusline-input)\.json\.\d+\.\d+\.tmp$/;

export function defaultLimitsDir() {
  return path.join(os.homedir(), ".claude", "agent-ui");
}

export function parseWindow(raw) {
  if (!isObj(raw)) return null;
  const u = raw.used_percentage;
  const r = raw.resets_at;
  if (!isNum(u)) return null;
  if (!isNum(r) || !(r > 0)) return null;
  // 문서상 초 단위. 1e11 이상은 이미 ms 로 본다(실계정 미검증 대비)
  return { usedPercentage: u, resetsAtMs: r >= 1e11 ? Math.round(r) : Math.round(r * 1000) };
}

export function parseRateLimits(input) {
  if (!isObj(input) || !isObj(input.rate_limits)) return null;
  const out = {};
  for (const key of WINDOW_KEYS) out[key] = parseWindow(input.rate_limits[key]);
  if (WINDOW_KEYS.every((k) => out[k] === null)) return null;
  return out;
}

export function mergeWindow(old, inc) {
  if (inc === null) return old;
  if (old === null) return inc;
  if (inc.resetsAtMs > old.resetsAtMs + SAME_WINDOW_TOLERANCE_MS) return inc;
  if (inc.resetsAtMs < old.resetsAtMs - SAME_WINDOW_TOLERANCE_MS) return old;
  return {
    usedPercentage: Math.max(old.usedPercentage, inc.usedPercentage),
    resetsAtMs: Math.max(old.resetsAtMs, inc.resetsAtMs),
  };
}

function existingWindow(w) {
  if (!isObj(w) || !isNum(w.usedPercentage) || !isNum(w.resetsAtMs) || !(w.resetsAtMs > 0)) return null;
  return { usedPercentage: w.usedPercentage, resetsAtMs: w.resetsAtMs };
}

export function mergeLimits(existing, incoming, nowMs, sessionId) {
  const valid = isObj(existing) && existing.version === 1;
  const out = { version: 1, updatedAtMs: nowMs, sessionId };
  for (const key of WINDOW_KEYS) {
    out[key] = mergeWindow(valid ? existingWindow(existing[key]) : null, incoming[key] ?? null);
  }
  return out;
}

export function statusText(windows, nowMs) {
  if (!windows) return "";
  const parts = [];
  for (const key of WINDOW_KEYS) {
    const w = windows[key];
    if (!w || !(nowMs < w.resetsAtMs)) continue;
    const remainingPct = Math.floor(100 - Math.min(100, Math.max(0, w.usedPercentage)));
    parts.push(`${WINDOW_LABELS[key]} ${remainingPct}% left`);
  }
  return parts.join(" · ");
}

function sleepMs(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

function tryUnlink(file) {
  try { fs.unlinkSync(file); } catch { /* 무시 */ }
}

export function writeFileAtomic(file, text) {
  const tmp = `${file}.${process.pid}.${Date.now()}.tmp`;
  try {
    fs.writeFileSync(tmp, text, "utf8");
  } catch (err) {
    tryUnlink(tmp);
    throw err;
  }
  for (let attempt = 1; ; attempt++) {
    try {
      fs.renameSync(tmp, file);
      return;
    } catch (err) {
      const retryable = err?.code === "EPERM" || err?.code === "EBUSY" || err?.code === "EACCES";
      if (!retryable || attempt >= RENAME_ATTEMPTS) {
        tryUnlink(tmp);
        throw err;
      }
      sleepMs(RENAME_RETRY_WAIT_MS);
    }
  }
}

function cleanStaleTmp(dir, nowMs) {
  try {
    for (const name of fs.readdirSync(dir)) {
      if (!TMP_NAME_RE.test(name)) continue;
      const full = path.join(dir, name);
      try {
        if (fs.statSync(full).mtimeMs < nowMs - TMP_MAX_AGE_MS) fs.unlinkSync(full);
      } catch { /* 무시 */ }
    }
  } catch { /* 무시 */ }
}

function warn(err) {
  process.stderr.write(`agent-ui statusline: ${String(err?.message ?? err)}\n`);
}

export function runStatusline({ raw, dir, nowMs, dump }) {
  try {
    if (dump) {
      try {
        fs.mkdirSync(dir, { recursive: true });
        writeFileAtomic(path.join(dir, DUMP_FILE_NAME), raw.slice(0, MAX_DUMP_CHARS));
      } catch (err) {
        warn(err);
      }
    }
    let input;
    try { input = JSON.parse(raw); } catch { return ""; }
    const windows = parseRateLimits(input);
    if (!windows) return "";
    try {
      fs.mkdirSync(dir, { recursive: true });
      cleanStaleTmp(dir, nowMs);
      const file = path.join(dir, LIMITS_FILE_NAME);
      let existing = null;
      try { existing = JSON.parse(fs.readFileSync(file, "utf8")); } catch { existing = null; }
      const sid = typeof input.session_id === "string" && input.session_id.length >= 1 && input.session_id.length <= 200
        ? input.session_id
        : null;
      const merged = mergeLimits(existing, windows, nowMs, sid);
      writeFileAtomic(file, JSON.stringify(merged, null, 2) + "\n");
    } catch (err) {
      warn(err);
    }
    return statusText(windows, nowMs);
  } catch {
    return "";
  }
}

function readStdin() {
  return new Promise((resolve) => {
    if (process.stdin.isTTY) return resolve("");
    const chunks = [];
    let size = 0;
    let done = false;
    const finish = (text) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      try { process.stdin.destroy(); } catch { /* 무시 */ }
      resolve(text);
    };
    const decode = () => Buffer.concat(chunks).toString("utf8").replace(/^﻿/, "");
    const timer = setTimeout(() => finish(decode()), STDIN_TIMEOUT_MS);
    process.stdin.on("data", (c) => {
      size += c.length;
      if (size > MAX_STDIN_BYTES) return finish("");
      chunks.push(c);
    });
    process.stdin.on("end", () => finish(decode()));
    process.stdin.on("error", () => finish(decode()));
  });
}

async function main() {
  try {
    const dump = process.argv.slice(2).includes("--dump");
    const raw = await readStdin();
    const text = runStatusline({ raw, dir: defaultLimitsDir(), nowMs: Date.now(), dump });
    if (text) process.stdout.write(text + "\n");
  } catch (err) {
    warn(err);
  } finally {
    process.exitCode = 0;
  }
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href.toLowerCase() === import.meta.url.toLowerCase()) {
  main();
}
