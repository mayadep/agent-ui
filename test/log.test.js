import test from "node:test";
import assert from "node:assert/strict";
import { eventTimeMs, sortEvents, LogIndex } from "../public/js/log.js";

const T = (n) => `2026-01-01T00:00:${String(n).padStart(2, "0")}Z`;
const ev = (seq, ts) => ({ seq, ts });

test("eventTimeMs", () => {
  assert.equal(eventTimeMs({ ts: "" }), null);
  assert.equal(eventTimeMs({ ts: "bad" }), null);
  assert.equal(eventTimeMs({ ts: T(5) }), Date.parse(T(5)));
});

test("sortEvents: ts 오름차순, 동률은 seq", () => {
  const out = sortEvents([ev(0, T(5)), ev(1, T(1)), ev(2, T(1))]);
  assert.deepEqual(out.map((e) => e.seq), [1, 2, 0]);
});

test("sortEvents: ts 가 무효인 이벤트는 직전 유효 키를 물려받는다", () => {
  assert.deepEqual(sortEvents([ev(0, T(5)), ev(1, ""), ev(2, T(1))]).map((e) => e.seq), [2, 0, 1]);
  assert.deepEqual(sortEvents([ev(0, ""), ev(1, T(1))]).map((e) => e.seq), [0, 1]);
  assert.deepEqual(sortEvents([ev(0, T(3)), ev(1, ""), ev(2, "bad")].reverse()).map((e) => e.seq), [0, 1, 2]);
});

test("LogIndex append", () => {
  const li = new LogIndex();
  const r = [ev(0, T(1)), ev(1, T(2)), ev(2, T(3))].map((e) => li.add(e));
  assert.deepEqual(r, [
    { op: "append", index: 0, evict: 0 },
    { op: "append", index: 1, evict: 0 },
    { op: "append", index: 2, evict: 0 },
  ]);
});

test("LogIndex insert", () => {
  const li = new LogIndex();
  li.add(ev(0, T(10)));
  li.add(ev(1, T(20)));
  assert.deepEqual(li.add(ev(2, T(15))), { op: "insert", index: 1, evict: 0 });
  // 같은 ts 이면서 seq 가 크면 append
  assert.equal(li.add(ev(3, T(20))).op, "append");
});

test("LogIndex 중복/역행 seq 는 drop", () => {
  const li = new LogIndex();
  li.add(ev(0, T(1)));
  li.add(ev(1, T(2)));
  assert.deepEqual(li.add(ev(1, T(3))), { op: "drop", index: -1, evict: 0 });
  assert.deepEqual(li.add(ev(0, T(3))), { op: "drop", index: -1, evict: 0 });
  assert.equal(li.size, 2);
});

test("LogIndex MAX_ROWS", () => {
  const li = new LogIndex(3);
  li.add(ev(0, T(10)));
  li.add(ev(1, T(20)));
  li.add(ev(2, T(30)));
  const r = li.add(ev(3, T(40)));
  assert.equal(r.op, "append");
  assert.equal(r.evict, 1);
  assert.equal(li.size, 3);
  assert.deepEqual(li.add(ev(4, T(1))), { op: "drop", index: -1, evict: 0 });
  assert.equal(li.size, 3);
  const m = li.add(ev(5, T(35)));
  assert.equal(m.op, "insert");
  assert.equal(m.evict, 1);
  assert.equal(li.size, 3);
});

test("LogIndex reset", () => {
  const li = new LogIndex(3);
  const out = li.reset([ev(0, T(5)), ev(1, T(4)), ev(2, T(3)), ev(3, T(2)), ev(4, T(1))]);
  assert.equal(out.length, 3);
  assert.deepEqual(out.map((e) => e.seq), [2, 1, 0]);
  // 무효 ts 는 reset 집합의 마지막 유효 키(seq 4 의 T1)를 상속 → 가득 찬 상태에서 가장 이른 위치라 drop
  assert.equal(li.add(ev(5, "")).op, "drop");
  assert.equal(li.size, 3);
  // 여유가 있으면 맨 앞(T1)에 삽입된다
  const roomy = new LogIndex(10);
  roomy.reset([ev(0, T(5)), ev(1, T(4)), ev(2, T(1))]);
  assert.deepEqual(roomy.add(ev(3, "")), { op: "insert", index: 1, evict: 0 });
});

test("log.js 는 Node 에서 import 해도 document 에 접근하지 않는다", async () => {
  await import("../public/js/log.js");
});

// ---- 보강: 경계값 / R1 반례 ----

test("sortEvents: 빈 입력, 입력 불변, 단일 이벤트", () => {
  assert.deepEqual(sortEvents([]), []);
  const input = [ev(1, T(2)), ev(0, T(9))];
  const copy = [...input];
  const out = sortEvents(input);
  assert.notEqual(out, input);
  assert.deepEqual(input, copy);
  assert.deepEqual(sortEvents([ev(7, T(1))]).map((e) => e.seq), [7]);
});

test("sortEvents: ts 문자열 비교가 아니라 Date.parse 값으로 비교한다 (R1 반례)", () => {
  // 오프셋 표기: 문자열로는 early > late 지만 실제로는 early(01:00Z) 가 late(02:00Z) 보다 이르다
  const early = "2026-01-01T10:00:00+09:00";
  const late = "2026-01-01T02:00:00Z";
  assert.ok(early < late === false);
  assert.deepEqual(sortEvents([ev(0, late), ev(1, early)]).map((e) => e.seq), [1, 0]);
  // 밀리초 유무: 문자열로는 "07.500Z" < "07Z" 지만 실제로는 :07.5 가 :07 보다 늦다
  const frac = "2026-01-01T00:00:07.500Z";
  const whole = "2026-01-01T00:00:07Z";
  assert.ok(frac < whole);
  assert.deepEqual(sortEvents([ev(0, frac), ev(1, whole)]).map((e) => e.seq), [1, 0]);
});

test("LogIndex: ts 문자열 비교 반례 (오프셋/밀리초)", () => {
  const li = new LogIndex();
  li.add(ev(0, "2026-01-01T02:00:00Z"));
  assert.deepEqual(li.add(ev(1, "2026-01-01T10:00:00+09:00")), { op: "insert", index: 0, evict: 0 });
  const li2 = new LogIndex();
  li2.add(ev(0, "2026-01-01T00:00:07.500Z"));
  assert.equal(li2.add(ev(1, "2026-01-01T00:00:07Z")).op, "insert");
});

test("sortEvents: 동일 ts 다수는 입력 순서와 무관하게 seq 순", () => {
  const out = sortEvents([ev(3, T(1)), ev(1, T(1)), ev(2, T(1)), ev(0, T(1))]);
  assert.deepEqual(out.map((e) => e.seq), [0, 1, 2, 3]);
});

test("sortEvents: 무효 ts 가 연속이거나 전부 무효여도 NaN 키로 깨지지 않는다", () => {
  assert.deepEqual(sortEvents([ev(2, "bad"), ev(0, ""), ev(1, undefined)]).map((e) => e.seq), [0, 1, 2]);
  assert.deepEqual(sortEvents([ev(0, T(9)), ev(1, "bad"), ev(2, "bad"), ev(3, T(2))]).map((e) => e.seq), [3, 0, 1, 2]);
});

test("LogIndex: 빈 인덱스의 첫 add 가 무효 ts 면 key 0 으로 append", () => {
  const li = new LogIndex();
  assert.deepEqual(li.add(ev(0, "")), { op: "append", index: 0, evict: 0 });
  assert.deepEqual(li.add(ev(1, T(1))), { op: "append", index: 1, evict: 0 });
  assert.deepEqual(li.add(ev(2, "bad")), { op: "append", index: 2, evict: 0 });
});

test("LogIndex: 무효 ts 이벤트는 직전 유효 키를 상속한다", () => {
  const li = new LogIndex();
  li.add(ev(0, T(10)));
  li.add(ev(1, T(20)));
  assert.deepEqual(li.add(ev(2, "")), { op: "append", index: 2, evict: 0 });
  assert.deepEqual(li.add(ev(3, T(5))), { op: "insert", index: 0, evict: 0 });
  // seq 4 는 직전에 부여된 키(T5)를 상속 → T5(seq3) 바로 뒤
  assert.deepEqual(li.add(ev(4, "")), { op: "insert", index: 1, evict: 0 });
});

test("LogIndex: 동일 ts 에서 seq 가 큰 것은 항상 append", () => {
  const li = new LogIndex();
  for (let i = 0; i < 5; i++) assert.deepEqual(li.add(ev(i, T(1))), { op: "append", index: i, evict: 0 });
});

test("LogIndex: maxRows 경계 (정확히 가득 참, 동률 키 삽입, maxRows=1)", () => {
  const li = new LogIndex(3);
  for (let i = 0; i < 3; i++) assert.equal(li.add(ev(i, T(10 + i))).evict, 0);
  assert.equal(li.size, 3);
  // 가장 이른 행과 같은 키지만 seq 가 크면 index 1 (>0) → insert 후 evict 1
  assert.deepEqual(li.add(ev(3, T(10))), { op: "insert", index: 1, evict: 1 });
  assert.equal(li.size, 3);

  const one = new LogIndex(1);
  assert.deepEqual(one.add(ev(0, T(5))), { op: "append", index: 0, evict: 0 });
  assert.deepEqual(one.add(ev(1, T(6))), { op: "append", index: 1, evict: 1 });
  assert.deepEqual(one.add(ev(2, T(1))), { op: "drop", index: -1, evict: 0 });
  assert.equal(one.size, 1);
  assert.equal(one.add(ev(2, T(9))).op, "drop");
});

test("LogIndex: 중복 seq(drop) 의 ts 는 lastKey 를 오염시키지 않는다", () => {
  const li = new LogIndex();
  li.add(ev(0, T(10)));
  li.add(ev(1, T(20)));
  assert.equal(li.add(ev(1, T(59))).op, "drop");
  assert.deepEqual(li.add(ev(2, "")), { op: "append", index: 2, evict: 0 }); // T20 상속
  // T59 를 상속했다면 T50 이 앞으로 삽입돼야 하지만 T20 상속이므로 append
  assert.deepEqual(li.add(ev(3, T(50))), { op: "append", index: 3, evict: 0 });
});

test("LogIndex reset: 빈 입력, 재호출 시 이전 상태 폐기", () => {
  const li = new LogIndex(3);
  li.add(ev(0, T(1)));
  assert.deepEqual(li.reset([]), []);
  assert.equal(li.size, 0);
  assert.deepEqual(li.add(ev(0, T(1))), { op: "append", index: 0, evict: 0 });
  const out = li.reset([ev(1, T(2)), ev(0, T(1))]);
  assert.deepEqual(out.map((e) => e.seq), [0, 1]);
  assert.equal(li.add(ev(1, T(3))).op, "drop");
  assert.equal(li.add(ev(2, T(3))).op, "append");
});

test("LogIndex reset: 입력 순서가 섞여도 seq 순으로 key 를 부여한다", () => {
  const li = new LogIndex();
  const out = li.reset([ev(2, ""), ev(0, T(7)), ev(1, T(3))]);
  // seq0=T7, seq1=T3, seq2("")=T3 상속 → 표시 순서 [1, 2, 0]
  assert.deepEqual(out.map((e) => e.seq), [1, 2, 0]);
});

test("log.js export 계약: MAX_ROWS, resetLog, appendLog", async () => {
  const m = await import("../public/js/log.js");
  assert.equal(m.MAX_ROWS, 1000);
  assert.equal(typeof m.resetLog, "function");
  assert.equal(typeof m.appendLog, "function");
});
