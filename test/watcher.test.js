import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { SessionWatcher, getWatcher } from "../src/core/session-watcher.js";
import { DEFAULTS } from "../src/config.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const SID = "11111111-1111-4111-8111-111111111111";
const PK = "D--demo";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function copyRoot() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "agent-ui-watcher-"));
  fs.cpSync(path.join(here, "fixtures", "projects"), root, { recursive: true });
  return { root, main: path.join(root, PK, `${SID}.jsonl`) };
}

const mk = (root, extra = {}) =>
  new SessionWatcher({ root, projectKey: PK, sessionId: SID, cfg: { ...DEFAULTS, projectsRoot: root, ...extra } });

const textLine = (id, text) =>
  JSON.stringify({
    type: "assistant", timestamp: "2026-10-29T02:00:00Z",
    message: { id, role: "assistant", model: "claude-opus-5-5", content: [{ type: "text", text }], usage: {} },
  }) + "\n";

test("reset 경로: 파일이 줄면 reset 통지 후 새 내용 기준", () => {
  const { root, main } = copyRoot();
  try {
    const w = mk(root);
    w.poll();
    const before = w.snapshot().run.totals.turns;
    const msgs = [];
    w.subscribe((m) => msgs.push(m));
    const lines = fs.readFileSync(main, "utf8").split("\n").filter(Boolean);
    fs.writeFileSync(main, lines.slice(0, 4).join("\n") + "\n");
    w.poll();
    assert.ok(msgs.some((m) => m.type === "reset"));
    assert.ok(w.snapshot().run.totals.turns < before);
    w.stop();
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test("throttle 묶기: 연속 변경은 update 1회", async () => {
  const { root, main } = copyRoot();
  try {
    const w = mk(root, { pushThrottleMs: 200 });
    w.poll();
    const updates = [];
    w.subscribe((m) => { if (m.type === "update") updates.push(m); });
    fs.appendFileSync(main, textLine("msg_a", "first-line"));
    w.poll();
    fs.appendFileSync(main, textLine("msg_b", "second-line"));
    w.poll();
    await sleep(300);
    assert.equal(updates.length, 1);
    const texts = updates[0].newEvents.map((e) => e.text);
    assert.ok(texts.includes("first-line") && texts.includes("second-line"));
    w.stop();
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test("idleWatcherMs: 구독 없으면 폐기, 구독 중이면 유지", async () => {
  const { root } = copyRoot();
  const cfg = { ...DEFAULTS, projectsRoot: root, idleWatcherMs: 50 };
  let w2;
  try {
    const w1 = getWatcher(root, PK, SID, cfg);
    const unsub = w1.subscribe(() => {});
    await sleep(150);
    assert.equal(getWatcher(root, PK, SID, cfg), w1);
    unsub();
    await sleep(150);
    w2 = getWatcher(root, PK, SID, cfg);
    assert.notEqual(w2, w1);
    assert.equal(w1.timer, null);
  } finally {
    w2?.stop();
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("poll 예외: 던지지 않고 같은 메시지는 1회, 복구 시 1회 로그", (t) => {
  const { root } = copyRoot();
  try {
    const w = mk(root);
    w.poll();
    const log = t.mock.method(console, "error", () => {});
    const original = w.mainTailer.readNew;
    const failWith = (msg) => { w.mainTailer.readNew = () => { throw new Error(msg); }; };

    failWith("boom");
    for (let i = 0; i < 3; i++) assert.doesNotThrow(() => w.poll());
    assert.equal(log.mock.callCount(), 1);
    assert.match(String(log.mock.calls[0].arguments[0]), /poll failed for D--demo\/.*: boom/);

    failWith("bang");
    w.poll();
    assert.equal(log.mock.callCount(), 2);

    w.mainTailer.readNew = original;
    w.poll();
    assert.equal(log.mock.callCount(), 3);
    assert.match(String(log.mock.calls[2].arguments[0]), /poll recovered for D--demo\//);
    w.poll();
    assert.equal(log.mock.callCount(), 3);
    w.stop();
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});


// ---- 보강: R5 / 경계값 ----

test("poll 예외 후에도 start() 타이머와 구독은 유지되고(stop 되지 않음), 복구 뒤 새 줄은 정확히 1회 적용", (t) => {
  const { root, main } = copyRoot();
  try {
    const w = mk(root, { pollMs: 60000 });
    w.start();
    const log = t.mock.method(console, "error", () => {});
    const msgs = [];
    w.subscribe((m) => msgs.push(m));
    const turnsBefore = w.snapshot().run.totals.turns;
    const original = w.mainTailer.readNew;
    w.mainTailer.readNew = () => { throw new Error("disk gone"); };
    fs.appendFileSync(main, textLine("msg_after_fail", "after-fail"));
    assert.doesNotThrow(() => w.poll());
    assert.doesNotThrow(() => w.poll());
    assert.notEqual(w.timer, null, "poll 예외로 watcher 가 stop 되면 안 됨");
    assert.equal(w.subscribers.size, 1);
    assert.equal(log.mock.callCount(), 1);
    w.mainTailer.readNew = original;
    w.poll();
    assert.equal(w.snapshot().run.totals.turns, turnsBefore + 1);
    w.poll();
    w.poll();
    assert.equal(w.snapshot().run.totals.turns, turnsBefore + 1, "같은 줄을 두 번 적용하면 안 됨");
    w.stop();
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test("poll 예외: 서브에이전트 tailer 예외도 삼키고 같은 메시지는 1회만 로그", (t) => {
  const { root } = copyRoot();
  try {
    const w = mk(root);
    w.poll();
    const log = t.mock.method(console, "error", () => {});
    const first = [...w.subs.values()][0];
    assert.ok(first, "픽스처에 서브에이전트가 있어야 함");
    first.tailer.readNew = () => { throw new Error("sub boom"); };
    for (let i = 0; i < 4; i++) assert.doesNotThrow(() => w.poll());
    assert.equal(log.mock.callCount(), 1);
    assert.match(String(log.mock.calls[0].arguments[0]), /sub boom/);
    w.stop();
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test("poll 예외: 예외가 Error 가 아닌 값(문자열/undefined)이어도 던지지 않는다", (t) => {
  const { root } = copyRoot();
  try {
    const w = mk(root);
    w.poll();
    const log = t.mock.method(console, "error", () => {});
    w.mainTailer.readNew = () => { throw "plain string"; };
    assert.doesNotThrow(() => w.poll());
    assert.match(String(log.mock.calls[0].arguments[0]), /plain string/);
    w.mainTailer.readNew = () => { throw undefined; };
    assert.doesNotThrow(() => w.poll());
    w.stop();
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test("메인 파일이 비어 있거나 아직 없어도 poll/snapshot 은 던지지 않고 main 노드만 있다", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "agent-ui-watcher-"));
  try {
    fs.mkdirSync(path.join(root, PK));
    const w = mk(root);
    assert.doesNotThrow(() => w.poll()); // 파일 없음
    let s = w.snapshot();
    assert.equal(s.run.nodes.length, 1);
    assert.deepEqual(s.events, []);
    fs.writeFileSync(path.join(root, PK, `${SID}.jsonl`), "");
    assert.doesNotThrow(() => w.poll()); // 빈 파일
    s = w.snapshot();
    assert.equal(s.run.nodes.length, 1);
    assert.equal(s.run.totals.turns, 0);
    w.stop();
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test("구독 해제 후에는 통지를 받지 않고, 예외를 던지는 구독자가 다른 구독자를 막지 않는다", async () => {
  const { root, main } = copyRoot();
  try {
    const w = mk(root, { pushThrottleMs: 0 });
    w.poll();
    const got = [];
    w.subscribe(() => { throw new Error("subscriber bug"); });
    const unsub = w.subscribe((m) => got.push(m));
    const gone = [];
    w.subscribe((m) => gone.push(m))();
    fs.appendFileSync(main, textLine("msg_s1", "s1"));
    w.poll();
    await sleep(50);
    assert.ok(got.some((m) => m.type === "update"));
    assert.equal(gone.length, 0);
    unsub();
    const n = got.length;
    fs.appendFileSync(main, textLine("msg_s2", "s2"));
    w.poll();
    await sleep(50);
    assert.equal(got.length, n);
    w.stop();
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test("변경이 없는 poll 은 update 를 보내지 않는다", async () => {
  const { root } = copyRoot();
  try {
    const w = mk(root, { pushThrottleMs: 0 });
    w.poll();
    await sleep(50); // 첫 poll 이 예약한 flush 를 먼저 비운다
    const got = [];
    w.subscribe((m) => got.push(m));
    w.poll();
    w.poll();
    await sleep(50);
    assert.equal(got.length, 0);
    w.stop();
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test("getWatcher: 구독 없이 생성만 해도 idleWatcherMs 뒤 폐기된다 (R12)", async () => {
  const { root } = copyRoot();
  const cfg = { ...DEFAULTS, projectsRoot: root, idleWatcherMs: 50 };
  let w2;
  try {
    const w1 = getWatcher(root, PK, SID, cfg);
    assert.equal(getWatcher(root, PK, SID, cfg), w1);
    await sleep(150);
    w2 = getWatcher(root, PK, SID, cfg);
    assert.notEqual(w2, w1);
    assert.equal(w1.timer, null);
  } finally {
    w2?.stop();
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("getWatcher: 다른 sessionId/root 는 별도 인스턴스", () => {
  const a = copyRoot();
  const b = copyRoot();
  const cfg = { ...DEFAULTS, idleWatcherMs: 60000 };
  try {
    const wa = getWatcher(a.root, PK, SID, cfg);
    const wb = getWatcher(b.root, PK, SID, cfg);
    assert.notEqual(wa, wb);
    wa.stop();
    wb.stop();
  } finally {
    fs.rmSync(a.root, { recursive: true, force: true });
    fs.rmSync(b.root, { recursive: true, force: true });
  }
});

test("reset 직후 같은 poll 에서 전체를 다시 읽어 노드 수가 새 내용 기준이 된다 (R12 reset 경로)", () => {
  const { root, main } = copyRoot();
  try {
    const w = mk(root);
    w.poll();
    assert.equal(w.snapshot().run.nodes.length, 5);
    const msgs = [];
    w.subscribe((m) => msgs.push(m));
    fs.writeFileSync(main, textLine("only", "only-line"));
    w.poll();
    assert.equal(msgs.filter((m) => m.type === "reset").length, 1);
    assert.equal(msgs.filter((m) => m.type === "update").length, 0, "reset 시 대기 중인 newEvents 는 버린다");
    const s = w.snapshot();
    assert.equal(s.run.totals.turns, 1);
    assert.ok(s.events.some((e) => e.text === "only-line"));
    assert.equal(s.events[0].seq, 0, "reset 후 seq 는 0 부터 다시 시작");
    w.stop();
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});
