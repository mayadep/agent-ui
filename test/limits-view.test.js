import test from "node:test";
import assert from "node:assert/strict";
import {
  limitView, LIMIT_NOTES, LIMIT_WARN_REMAINING, LIMIT_DANGER_REMAINING, LIMITS_STALE_MS, LIMIT_ROWS,
} from "../public/js/limits.js";

const R5 = 1738425600000;
const R7 = 1738857600000;
const NOW = R5 - 7980000;
const lim = (five, seven = { usedPercentage: 41.2, resetsAtMs: R7 }, updatedAtMs = NOW - 60000) => ({
  status: "ok",
  limits: { updatedAtMs, five_hour: five, seven_day: seven },
});
const five = (u) => lim({ usedPercentage: u, resetsAtMs: R5 });
const row0 = (resp, now = NOW) => limitView(resp, now).rows[0];

test("V1 정상", () => {
  const v = limitView(lim({ usedPercentage: 23.5, resetsAtMs: R5 }), NOW);
  assert.equal(v.rows.length, 2);
  assert.deepEqual(v.rows.map((r) => r.key), ["five_hour", "seven_day"]);
  assert.deepEqual(v.rows.map((r) => r.label), ["5h", "7d"]);
  assert.deepEqual(LIMIT_ROWS.map((r) => r.key), ["five_hour", "seven_day"]);
  const r = v.rows[0];
  assert.equal(r.state, "ok");
  assert.equal(r.level, "normal");
  assert.equal(r.fillPct, 23.5);
  assert.equal(r.valueText, "76% left");
  assert.equal(r.usedText, "used 24%");
  assert.equal(r.resetText, "resets in 2h 13m");
  assert.equal(v.note, null);
  assert.equal(v.stale, false);
});

test("V2 경계 0/100", () => {
  let r = row0(five(0));
  assert.deepEqual([r.valueText, r.usedText, r.level, r.fillPct], ["100% left", "used 0%", "normal", 0]);
  r = row0(five(100));
  assert.deepEqual([r.valueText, r.usedText, r.level, r.fillPct], ["0% left", "used 100%", "danger", 100]);
});

test("V3 소수", () => {
  let r = row0(five(23.5));
  assert.deepEqual([r.valueText, r.usedText], ["76% left", "used 24%"]);
  r = row0(five(0.4));
  assert.deepEqual([r.valueText, r.usedText], ["99% left", "used 1%"]);
  r = row0(five(99.9));
  assert.deepEqual([r.valueText, r.usedText, r.level], ["0% left", "used 100%", "danger"]);
  for (const u of [0, 0.4, 23.5, 50.5, 99.9, 100]) {
    const x = row0(five(u));
    const left = Number(/^(\d+)%/.exec(x.valueText)[1]);
    const used = Number(/(\d+)%$/.exec(x.usedText)[1]);
    assert.equal(left + used, 100, String(u));
  }
});

test("V4 범위 밖", () => {
  let r = row0(five(-5));
  assert.deepEqual([r.valueText, r.fillPct, r.level], ["100% left", 0, "normal"]);
  r = row0(five(130));
  assert.deepEqual([r.valueText, r.fillPct, r.level], ["0% left", 100, "danger"]);
});

test("V5 NaN·타입", () => {
  const bads = [
    { usedPercentage: NaN, resetsAtMs: R5 }, { usedPercentage: "50", resetsAtMs: R5 },
    { usedPercentage: null, resetsAtMs: R5 }, { usedPercentage: 50, resetsAtMs: NaN },
  ];
  for (const b of bads) {
    const v = limitView(lim(b), NOW);
    assert.equal(v.rows[0].state, "na");
    assert.equal(v.rows[0].valueText, "n/a");
    assert.equal(v.rows[0].usedText, "no data");
    assert.equal(v.rows[1].state, "ok");
  }
});

test("V6 임계값", () => {
  const u = (remaining) => 100 - remaining;
  let r = row0(five(u(LIMIT_WARN_REMAINING)));
  assert.equal(r.level, "normal");
  r = row0(five(u(LIMIT_WARN_REMAINING) + 0.5));
  assert.deepEqual([r.valueText, r.level], ["19% left", "warn"]);
  r = row0(five(u(LIMIT_DANGER_REMAINING)));
  assert.equal(r.level, "warn");
  r = row0(five(u(LIMIT_DANGER_REMAINING) + 0.01));
  assert.deepEqual([r.valueText, r.level], ["9% left", "danger"]);
});

test("V7 리셋 경과", () => {
  for (const now of [R5, R5 + 1]) {
    const r = row0(lim({ usedPercentage: 50, resetsAtMs: R5 }, null, now - 1000), now);
    assert.equal(r.state, "expired");
    assert.equal(r.valueText, "reset");
    assert.equal(r.resetText, "awaiting update");
    assert.equal(r.fillPct, 0);
    assert.equal(r.level, "none");
    assert.notEqual(r.valueText, "100% left");
  }
});

test("V8 신선도", () => {
  const five_ = { usedPercentage: 23.5, resetsAtMs: R5 };
  let v = limitView(lim(five_, undefined, NOW - LIMITS_STALE_MS), NOW);
  assert.equal(v.stale, false);
  assert.equal(v.note, null);
  v = limitView(lim(five_, undefined, NOW - LIMITS_STALE_MS - 1000), NOW);
  assert.equal(v.stale, true);
  assert.equal(v.note, "as of 15m 01s ago");
  assert.equal(v.rows[0].valueText, "76% left");
  v = limitView(lim(five_, undefined, NOW + 60000), NOW);
  assert.equal(v.stale, false);
});

test("V9 status 별 n/a", () => {
  const cases = [
    [undefined, "loading"], [{ status: "missing", limits: null }, "missing"], [{ status: "invalid", limits: null }, "invalid"],
    [{ status: "error", limits: null }, "error"], [{ status: "loading", limits: null }, "loading"],
    [{ status: "bogus" }, "error"], ["x", "error"], [null, "error"], [{ status: "ok", limits: null }, "invalid"],
  ];
  for (const [resp, key] of cases) {
    const v = limitView(resp, NOW);
    assert.equal(v.note, LIMIT_NOTES[key], JSON.stringify(resp));
    assert.equal(v.rows.length, 2);
    for (const r of v.rows) assert.deepEqual([r.state, r.valueText, r.fillPct], ["na", "n/a", 0]);
    assert.equal(v.stale, false);
  }
});

test("V10 윈도우 둘 다 없음", () => {
  const v = limitView({ status: "ok", limits: { updatedAtMs: NOW, five_hour: null, seven_day: null } }, NOW);
  assert.deepEqual(v.rows.map((r) => r.state), ["na", "na"]);
  assert.equal(v.note, LIMIT_NOTES.empty);
});

test("V11 nowMs 비정상", () => {
  const v = limitView(five(10), NaN);
  assert.equal(v.note, LIMIT_NOTES.error);
});

test("V12 순수성", () => {
  const resp = five(23.5);
  const snap = structuredClone(resp);
  assert.deepEqual(limitView(resp, NOW), limitView(resp, NOW));
  assert.deepEqual(resp, snap);
});
