import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { normalizeLimits, LimitsReader, defaultLimitsFile, MAX_LIMITS_FILE_BYTES } from "../src/core/limits.js";

const R5 = 1738425600000;
const R7 = 1738857600000;
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "agent-ui-lim-"));
const sample = {
  version: 1, updatedAtMs: 1761700000000, sessionId: "abc",
  five_hour: { usedPercentage: 23.5, resetsAtMs: R5 },
  seven_day: { usedPercentage: 41.2, resetsAtMs: R7 },
};
const write = (name, obj) => {
  const f = path.join(tmp, name);
  fs.writeFileSync(f, typeof obj === "string" ? obj : JSON.stringify(obj));
  return f;
};

test("L1 normalizeLimits 정상", () => {
  assert.deepEqual(normalizeLimits(sample), {
    updatedAtMs: 1761700000000,
    five_hour: { usedPercentage: 23.5, resetsAtMs: R5 },
    seven_day: { usedPercentage: 41.2, resetsAtMs: R7 },
  });
});

test("L2 normalizeLimits 거부", () => {
  for (const bad of [null, [], { ...sample, version: 2 }, { ...sample, updatedAtMs: undefined }, { ...sample, updatedAtMs: "1" }, { ...sample, updatedAtMs: 0 }]) {
    assert.equal(normalizeLimits(bad), null);
  }
  const n = normalizeLimits({ ...sample, five_hour: { usedPercentage: NaN, resetsAtMs: R5 }, seven_day: { usedPercentage: 150, resetsAtMs: 0 } });
  assert.equal(n.five_hour, null);
  assert.equal(n.seven_day, null);
  assert.equal(normalizeLimits({ ...sample, five_hour: { usedPercentage: 150, resetsAtMs: R5 } }).five_hour.usedPercentage, 150);
});

test("L3 read 파일 없음 → 생성 후 ok", () => {
  const f = path.join(tmp, "l3.json");
  const r = new LimitsReader(f);
  assert.deepEqual(r.read(), { status: "missing", limits: null });
  fs.writeFileSync(f, JSON.stringify(sample));
  assert.equal(r.read().status, "ok");
});

test("L4 read 깨진 파일·큰 파일·디렉터리", () => {
  assert.equal(new LimitsReader(write("l4a.json", "{")).read().status, "invalid");
  assert.equal(new LimitsReader(write("l4b.json", "x".repeat(MAX_LIMITS_FILE_BYTES + 1))).read().status, "invalid");
  const d = path.join(tmp, "l4dir");
  fs.mkdirSync(d);
  assert.deepEqual(new LimitsReader(d).read(), { status: "invalid", limits: null });
});

test("L5 read 캐시", () => {
  const f = write("l5.json", sample);
  const r = new LimitsReader(f);
  const first = r.read();
  const orig = fs.readFileSync;
  let calls = 0;
  fs.readFileSync = (...a) => { calls++; return orig(...a); };
  try {
    assert.equal(r.read(), first);
    assert.equal(calls, 0);
    fs.writeFileSync(f, JSON.stringify({ ...sample, five_hour: { usedPercentage: 90, resetsAtMs: R5 } }));
    const t = new Date(Date.now() + 2000);
    fs.utimesSync(f, t, t);
    const next = r.read();
    assert.equal(calls, 1);
    assert.equal(next.limits.five_hour.usedPercentage, 90);
  } finally {
    fs.readFileSync = orig;
  }
});

test("L6 read 일시 오류는 직전 결과 유지", () => {
  const f = write("l6.json", sample);
  const r = new LimitsReader(f);
  const first = r.read();
  assert.equal(first.status, "ok");
  const orig = fs.readFileSync;
  fs.readFileSync = () => { throw Object.assign(new Error("busy"), { code: "EBUSY" }); };
  try {
    fs.writeFileSync(f, JSON.stringify({ ...sample, updatedAtMs: sample.updatedAtMs + 1 }));
    const t = new Date(Date.now() + 4000);
    fs.utimesSync(f, t, t);
    assert.equal(r.read(), first);
  } finally {
    fs.readFileSync = orig;
  }
  assert.equal(r.read().limits.updatedAtMs, sample.updatedAtMs + 1);
});

test("L7 defaultLimitsFile", () => {
  assert.equal(defaultLimitsFile(), path.join(os.homedir(), ".claude", "agent-ui", "rate-limits.json"));
});
