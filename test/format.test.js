import test from "node:test";
import assert from "node:assert/strict";
import { fmtElapsed, fmtTokens, fmtClock, fmtCountdown } from "../public/js/format.js";

test("fmtElapsed", () => {
  assert.equal(fmtElapsed(45000), "45s");
  assert.equal(fmtElapsed(185000), "3m 05s");
  assert.equal(fmtElapsed(3720000), "1h 02m");
  assert.equal(fmtElapsed(-5), "0s");
});

test("fmtTokens", () => {
  assert.equal(fmtTokens(999), "999");
  assert.equal(fmtTokens(12345), "12.3k");
  assert.equal(fmtTokens(1240000), "1.24M");
});

test("fmtClock", () => {
  assert.match(fmtClock("2026-10-29T01:02:03Z"), /^\d\d:\d\d:\d\d$/);
  assert.equal(fmtClock("bad"), "--:--:--");
});

test("sortEvents: ts 오름차순, 동률은 seq", async () => {
  const { sortEvents } = await import("../public/js/log.js");
  const ev = (seq, ts) => ({ seq, ts });
  const out = sortEvents([ev(0, "2026-01-01T00:00:05Z"), ev(1, "2026-01-01T00:00:01Z"), ev(2, "2026-01-01T00:00:01Z")]);
  assert.deepEqual(out.map((e) => e.seq), [1, 2, 0]);
});

test("fmtTokens 경계", () => {
  const cases = [[999, "999"], [999.6, "999"], [1000, "1.0k"], [999949, "999.9k"], [999950, "1.00M"], [999999, "1.00M"], [1240000, "1.24M"], [-5, "0"], [NaN, "0"]];
  for (const [n, want] of cases) assert.equal(fmtTokens(n), want, String(n));
});

// ---- 보강: 경계값 ----

test("fmtTokens: 승격 경계와 비정상 입력", () => {
  const cases = [
    [0, "0"], [1, "1"], [999.999, "999"], [1000.4, "1.0k"], [1049, "1.0k"], [1050, "1.1k"],
    [999900, "999.9k"], [999949.9, "999.9k"], [999950, "1.00M"], [1000000, "1.00M"],
    [1e9, "1000.00M"], [Infinity, "0"], [-Infinity, "0"], [undefined, "0"], [null, "0"], ["abc", "0"], ["12345", "12.3k"],
  ];
  for (const [n, want] of cases) assert.equal(fmtTokens(n), want, String(n));
  assert.ok(!fmtTokens(999960).includes("1000.0k"));
});

test("fmtElapsed: 단위 경계와 비정상 입력", () => {
  const cases = [[0, "0s"], [999, "0s"], [1000, "1s"], [59999, "59s"], [60000, "1m 00s"], [3599999, "59m 59s"], [3600000, "1h 00m"], [NaN, "0s"], [undefined, "0s"], [-1e9, "0s"]];
  for (const [n, want] of cases) assert.equal(fmtElapsed(n), want, String(n));
});

test("fmtClock: 빈 문자열/undefined 는 --:--:--", () => {
  assert.equal(fmtClock(""), "--:--:--");
  assert.equal(fmtClock(undefined), "--:--:--");
});

test("F1 fmtCountdown 경계", () => {
  const cases = [
    [0, "0s"], [59999, "59s"], [60000, "1m 00s"], [309000, "5m 09s"], [3599999, "59m 59s"], [3600000, "1h 00m"],
    [7980000, "2h 13m"], [86399000, "23h 59m"], [86400000, "1d 00h"], [(6 * 86400 + 23 * 3600) * 1000, "6d 23h"],
    [-1, "0s"], [NaN, "0s"], ["x", "0s"],
  ];
  for (const [n, want] of cases) assert.equal(fmtCountdown(n), want, String(n));
});
