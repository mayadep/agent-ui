import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRunState, applyRecord, applyMeta, toRunView, recentEvents } from "../src/core/reducer.js";
import { DEFAULTS } from "../src/config.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const SID = "11111111-1111-4111-8111-111111111111";
const dir = path.join(here, "fixtures", "projects", "D--demo");
const cfg = { ...DEFAULTS };

const readLines = (f) => fs.readFileSync(f, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l));

function loadAll() {
  const main = readLines(path.join(dir, `${SID}.jsonl`));
  const subDir = path.join(dir, SID, "subagents");
  const subs = fs.readdirSync(subDir).filter((n) => n.endsWith(".jsonl")).sort().map((n) => {
    const id = n.replace(/^agent-/, "").replace(/\.jsonl$/, "");
    const meta = JSON.parse(fs.readFileSync(path.join(subDir, `agent-${id}.meta.json`), "utf8"));
    return { id, records: readLines(path.join(subDir, n)), meta };
  });
  return { main, subs };
}

// 한 poll 과 같은 순서: 메인 → (meta) → 서브에이전트
function build(splitMain = null) {
  const { main, subs } = loadAll();
  const st = createRunState("D--demo", SID);
  const evs = [];
  const feed = (records, src) => { for (const r of records) evs.push(...applyRecord(st, r, src, cfg).newEvents); };
  if (splitMain) {
    feed(main.slice(0, splitMain), { kind: "main" });
    feed(main.slice(splitMain), { kind: "main" });
  } else feed(main, { kind: "main" });
  for (const s of subs) applyMeta(st, s.id, s.meta, cfg);
  for (const s of subs) feed(s.records, { kind: "subagent", agentId: s.id });
  return { st, evs, main, subs };
}

const NOW = Date.parse("2026-10-29T01:05:00Z");

test("fixture lines parse", () => {
  const { main, subs } = loadAll();
  assert.ok(main.length > 10);
  assert.equal(subs.length, 4);
});

test("full run view", () => {
  const { st, main } = build();
  const run = toRunView(st, NOW, cfg);
  assert.equal(run.nodes.length, 5);
  assert.equal(run.nodes[0].id, "main");
  const by = Object.fromEntries(run.nodes.map((n) => [n.id, n]));
  assert.equal(by.main.model.label, "opus 5.5");
  assert.equal(by.a1opus00000000001.model.label, "opus 5.5");
  assert.equal(by.a2sonnet0000000002.model.label, "sonnet 5.5");
  assert.equal(by.a3haiku00000000003.model.label, "haiku 5.5");
  assert.equal(by.a4review0000000004.model.label, "sonnet 5.5");
  assert.equal(by.a3haiku00000000003.status, "failed");
  assert.equal(by.a1opus00000000001.status, "completed");
  assert.equal(by.a2sonnet0000000002.status, "running");
  assert.equal(by.a4review0000000004.role, "judge");
  assert.equal(by.a1opus00000000001.role, "worker");
  assert.equal(run.verdict.status, "done");
  assert.equal(run.verdict.judgeId, "a4review0000000004");
  assert.equal(run.verdict.text, "APPROVED: looks fine");
  assert.equal(by.a4review0000000004.spawnedAtMainTurn, 5);
  assert.equal(by.a1opus00000000001.spawnedAtMainTurn, 1);

  // turns = 고유 message.id 수
  const ids = new Set(main.filter((r) => r.type === "assistant").map((r) => r.message.id));
  assert.equal(by.main.turns, ids.size);
  assert.equal(run.totals.turns, ids.size);

  // 토큰 = message.id 당 1회(마지막 값) 합산. msg_m1 은 3줄(output 10,20,30)
  const mainOut = 30 + 12 + 12 + 14 + 8 + 0;
  assert.equal(by.main.tokens.output, mainOut);
  assert.equal(by.main.tokens.input, 10 * 5 + 0);
  assert.equal(by.a1opus00000000001.tokens.output, 40 + 20);

  // <synthetic> 은 모델을 덮어쓰지 않음, modelUsage 에도 없음
  assert.ok(!run.modelUsage.some((m) => m.label.includes("synthetic")));
  assert.deepEqual(run.modelUsage.map((m) => m.label), ["opus 5.5", "sonnet 5.5", "haiku 5.5"]);
  assert.equal(run.modelUsage[0].outputTokens, mainOut + 60);

  assert.equal(run.title, "Demo session");
  assert.equal(run.permissionMode, "auto");
  assert.equal(run.goal.text, "Build the demo feature with three workers");
  assert.equal(by.main.status, "idle");
});

test("duplicate notifications yield one event", () => {
  const { evs } = build();
  assert.equal(evs.filter((e) => e.kind === "agent_failed").length, 1);
  assert.equal(evs.filter((e) => e.kind === "agent_done").length, 2);
  assert.equal(evs.filter((e) => e.kind === "turn_end").length, 1);
  const done = evs.find((e) => e.kind === "agent_done" && e.agentId === "a4review0000000004");
  assert.equal(done.verdict, "done");
});

test("stale after staleAfterMs", () => {
  const { st } = build();
  const later = NOW + cfg.staleAfterMs + 24 * 3600 * 1000;
  const run = toRunView(st, later, cfg);
  assert.equal(run.nodes.find((n) => n.id === "a2sonnet0000000002").status, "stale");
  assert.equal(run.nodes.find((n) => n.id === "a1opus00000000001").status, "completed");
  // 저장 상태는 바뀌지 않음
  assert.equal(st.nodesById.get("a2sonnet0000000002").status, "running");
});

test("split application is equivalent", () => {
  const a = toRunView(build().st, NOW, cfg);
  const b = toRunView(build(7).st, NOW, cfg);
  assert.deepEqual(b, a);
});

test("event seq is monotonic and recentEvents limits", () => {
  const { st } = build();
  const all = recentEvents(st, 1000);
  all.forEach((e, i) => assert.equal(e.seq, i));
  assert.equal(recentEvents(st, 3).length, 3);
});

test("unknown records and bad input never throw", () => {
  const st = createRunState("p", SID);
  assert.equal(applyRecord(st, { type: "weird-new-type", timestamp: "2026-01-01T00:00:00Z" }, { kind: "main" }, cfg).changed, false);
  assert.doesNotThrow(() => applyRecord(st, null, { kind: "main" }, cfg));
  assert.doesNotThrow(() => applyRecord(st, { type: "assistant", message: { content: 5 } }, { kind: "main" }, cfg));
});

test("resume: assistant record after completion notification reopens node", () => {
  const { st } = build();
  const id = "a1opus00000000001";
  assert.equal(st.nodesById.get(id).status, "completed");
  applyRecord(st, { type: "assistant", timestamp: "2026-10-29T02:00:00Z", message: { id: "late", model: "claude-opus-5-5", content: [{ type: "text", text: "again" }], usage: {} } }, { kind: "subagent", agentId: id }, cfg);
  assert.equal(st.nodesById.get(id).status, "running");
  assert.equal(st.nodesById.get(id).endedAt, null);
});

test("meta finished completes a running node", () => {
  const st = createRunState("p", SID);
  applyMeta(st, "x1", { agentType: "implementer", toolUseId: "t", finished: true }, cfg);
  assert.equal(st.nodesById.get("x1").status, "completed");
});

test("launch with no spawn info does not guess linkage", () => {
  const st = createRunState("p", SID);
  applyRecord(st, { type: "user", timestamp: "2026-01-01T00:00:00Z", message: { content: [{ type: "tool_result", tool_use_id: "zz", content: "x" }] }, toolUseResult: { status: "async_launched", agentId: "q1", resolvedModel: "claude-haiku-5-5" } }, { kind: "main" }, cfg);
  const n = st.nodesById.get("q1");
  assert.equal(n.status, "pending");
  assert.equal(n.model.label, "haiku 5.5");
  assert.equal(n.agentType, null);
  assert.equal(n.spawnedAtMainTurn, null);
});

test("Agent 호출은 spawn 이벤트 한 줄만 낸다 (tool 이벤트와 중복 없음)", () => {
  const { evs } = build();
  const spawns = evs.filter((e) => e.kind === "spawn");
  assert.ok(spawns.length >= 1);
  assert.ok(spawns.every((e) => e.text.startsWith("spawn ")));
  assert.equal(evs.filter((e) => e.kind === "tool" && e.text.startsWith("spawn ")).length, 0);
});

const sub = (agentId) => ({ kind: "subagent", agentId });
const asst = (ts, id, content, model = "claude-opus-5-5") => ({ type: "assistant", timestamp: ts, message: { id, model, content, usage: {} } });

test("judge 여러 개: 최신(늦은 startedAt) 선택, startedAt null 이면 그것", () => {
  const st = createRunState("p", SID);
  applyMeta(st, "r1", { agentType: "reviewer" }, cfg);
  applyMeta(st, "r2", { agentType: "reviewer" }, cfg);
  applyRecord(st, asst("2026-01-01T00:00:01Z", "a", [{ type: "text", text: "x" }]), sub("r1"), cfg);
  applyRecord(st, asst("2026-01-01T00:00:09Z", "b", [{ type: "text", text: "y" }]), sub("r2"), cfg);
  assert.equal(toRunView(st, NOW, cfg).verdict.judgeId, "r2");
  applyMeta(st, "r3", { agentType: "reviewer" }, cfg); // 아직 시작 전
  assert.equal(toRunView(st, NOW, cfg).verdict.judgeId, "r3");
});

test("judge agent_done verdict 는 알림/handback 순서와 무관하게 done, 판정 문구는 Run.verdict.text", () => {
  const note = { type: "queue-operation", operation: "enqueue", timestamp: "2026-01-01T00:00:20Z", content: "<task-notification><task-id>j1</task-id><status>completed</status><summary>done</summary></task-notification>" };
  const handback = asst("2026-01-01T00:00:10Z", "h", [{ type: "tool_use", id: "x", name: "SubagentHandback", input: { message: "APPROVED: ok\nmore" } }]);
  for (const order of ["note-first", "handback-first"]) {
    const st = createRunState("p", SID);
    applyMeta(st, "j1", { agentType: "reviewer" }, cfg);
    applyRecord(st, asst("2026-01-01T00:00:05Z", "t", [{ type: "text", text: "working" }]), sub("j1"), cfg);
    const evs = [];
    const steps = order === "note-first"
      ? [() => applyRecord(st, note, { kind: "main" }, cfg), () => applyRecord(st, handback, sub("j1"), cfg)]
      : [() => applyRecord(st, handback, sub("j1"), cfg), () => applyRecord(st, note, { kind: "main" }, cfg)];
    for (const f of steps) evs.push(...f().newEvents);
    const done = evs.find((e) => e.kind === "agent_done");
    assert.equal(done.verdict, "done", order);
    assert.equal(toRunView(st, NOW, cfg).verdict.text, "APPROVED: ok", order);
  }
});

test("동기 Agent 결과", () => {
  for (const isErr of [false, true]) {
    const st = createRunState("p", SID);
    applyRecord(st, asst("2026-01-01T00:00:01Z", "m1", [{ type: "tool_use", id: "t1", name: "Agent", input: { subagent_type: "implementer", description: "d" } }]), { kind: "main" }, cfg);
    const r = applyRecord(st, {
      type: "user", timestamp: "2026-01-01T00:00:02Z",
      message: { content: [{ type: "tool_result", tool_use_id: "t1", content: "x", ...(isErr ? { is_error: true } : {}) }] },
      toolUseResult: { agentId: "s1", status: "completed" },
    }, { kind: "main" }, cfg);
    const n = st.nodesById.get("s1");
    assert.equal(n.status, isErr ? "failed" : "completed");
    assert.equal(n.agentType, "implementer");
    assert.equal(n.spawnedAtMainTurn, 1);
    const e = r.newEvents.find((x) => x.agentId === "s1");
    assert.equal(e.kind, isErr ? "agent_failed" : "agent_done");
    assert.equal(e.verdict, isErr ? "failed" : "done");
  }
});

test("meta.toolUseId 만으로 spawnedAtMainTurn 연결", () => {
  const st = createRunState("p", SID);
  applyRecord(st, asst("2026-01-01T00:00:01Z", "m1", [{ type: "text", text: "a" }]), { kind: "main" }, cfg);
  applyRecord(st, asst("2026-01-01T00:00:02Z", "m2", [{ type: "tool_use", id: "t9", name: "Agent", input: { subagent_type: "reviewer" } }]), { kind: "main" }, cfg);
  applyMeta(st, "m1x", { agentType: "reviewer", toolUseId: "t9" }, cfg);
  const n = st.nodesById.get("m1x");
  assert.equal(n.spawnedAtMainTurn, 2);
  assert.equal(n.role, "judge");
});

test("meta.finished: 저장 endedAt 은 null, 뷰에서만 마지막 활동 시각으로 보정", () => {
  const st = createRunState("p", SID);
  const T = "2026-01-01T00:00:07Z";
  applyRecord(st, asst(T, "a", [{ type: "text", text: "x" }]), sub("f1"), cfg);
  applyMeta(st, "f1", { agentType: "implementer", finished: true }, cfg);
  assert.equal(st.nodesById.get("f1").endedAt, null);
  const v = toRunView(st, NOW, cfg).nodes.find((n) => n.id === "f1");
  assert.equal(v.status, "completed");
  assert.equal(v.endedAt, T);
});


// ---- 보강: 경계값 / 회귀 / R2, R7 ----

const mainSrc = { kind: "main" };
const note = (id, status, summary = "s", ts = "2026-01-01T00:00:20Z") => ({
  type: "queue-operation", operation: "enqueue", timestamp: ts,
  content: `<task-notification><task-id>${id}</task-id><status>${status}</status><summary>${summary}</summary></task-notification>`,
});

test("빈 상태: toRunView 는 main 만, verdict n/a, 합계 0, 던지지 않음", () => {
  const st = createRunState("p", SID);
  const run = toRunView(st, NOW, cfg);
  assert.equal(run.nodes.length, 1);
  assert.equal(run.nodes[0].id, "main");
  assert.equal(run.nodes[0].model, null);
  assert.deepEqual(run.verdict, { judgeId: null, status: "n/a", text: null });
  assert.deepEqual(run.totals, { turns: 0, tokens: 0 });
  assert.deepEqual(run.modelUsage, []);
  assert.equal(run.goal, null);
  assert.equal(run.startedAt, null);
  assert.deepEqual(recentEvents(st, 10), []);
});

test("Event.verdict 는 done/failed/null 만 (R2): 픽스처 전체 이벤트", () => {
  const { evs } = build();
  assert.ok(evs.length > 0);
  for (const e of evs) {
    assert.ok(e.verdict === "done" || e.verdict === "failed" || e.verdict === null, `${e.kind}: ${e.verdict}`);
    if (e.kind === "agent_done") assert.equal(e.verdict, "done");
    else if (e.kind === "agent_failed") assert.equal(e.verdict, "failed");
    else assert.equal(e.verdict, null, e.kind);
  }
  // 판정 문구(handback 첫 줄)가 어떤 이벤트의 verdict 에도 들어가지 않는다
  assert.ok(!evs.some((e) => e.verdict === "APPROVED: looks fine"));
});

test("maxEvents: 오래된 이벤트부터 버리고 seq 는 계속 증가", () => {
  const small = { ...cfg, maxEvents: 3 };
  const st = createRunState("p", SID);
  for (let i = 0; i < 6; i++) applyRecord(st, asst(`2026-01-01T00:00:0${i}Z`, `m${i}`, [{ type: "text", text: `t${i}` }]), mainSrc, small);
  const evs = recentEvents(st, 100);
  assert.equal(evs.length, 3);
  assert.deepEqual(evs.map((e) => e.seq), [3, 4, 5]);
  assert.deepEqual(evs.map((e) => e.text), ["t3", "t4", "t5"]);
});

test("recentEvents: limit 이 이벤트 수보다 크거나 같을 때", () => {
  const st = createRunState("p", SID);
  applyRecord(st, asst("2026-01-01T00:00:01Z", "a", [{ type: "text", text: "x" }]), mainSrc, cfg);
  assert.equal(recentEvents(st, 1).length, 1);
  assert.equal(recentEvents(st, 999).length, 1);
});

test("레코드에 timestamp 가 없으면 Event.ts 는 빈 문자열", () => {
  const st = createRunState("p", SID);
  const r = applyRecord(st, { type: "assistant", message: { id: "n", model: "claude-opus-5-5", content: [{ type: "text", text: "no ts" }], usage: {} } }, mainSrc, cfg);
  assert.equal(r.newEvents[0].ts, "");
  assert.equal(toRunView(st, NOW, cfg).startedAt, null);
});

test("task-notification 상태 매핑: killed/error 는 failed, 알 수 없는 상태와 미지의 taskId 는 무시", () => {
  for (const [status, want] of [["completed", "completed"], ["failed", "failed"], ["killed", "failed"], ["error", "failed"]]) {
    const st = createRunState("p", SID);
    applyRecord(st, asst("2026-01-01T00:00:05Z", "a", [{ type: "text", text: "x" }]), sub("w1"), cfg);
    const r = applyRecord(st, note("w1", status), mainSrc, cfg);
    assert.equal(st.nodesById.get("w1").status, want, status);
    assert.equal(r.newEvents.length, 1, status);
    assert.equal(st.nodesById.get("w1").endedAt, "2026-01-01T00:00:20Z");
  }
  const st = createRunState("p", SID);
  applyRecord(st, asst("2026-01-01T00:00:05Z", "a", [{ type: "text", text: "x" }]), sub("w1"), cfg);
  const odd = applyRecord(st, note("w1", "weird-status"), mainSrc, cfg);
  assert.equal(st.nodesById.get("w1").status, "running");
  assert.deepEqual(odd.newEvents, []);
  const unknown = applyRecord(st, note("not-a-node", "completed"), mainSrc, cfg);
  assert.deepEqual(unknown.newEvents, []);
  assert.equal(st.nodesById.has("not-a-node"), false);
});

test("같은 알림 중복 제거는 (taskId, status, summary) 조합 기준: summary 가 다르면 새 이벤트", () => {
  const st = createRunState("p", SID);
  applyRecord(st, asst("2026-01-01T00:00:05Z", "a", [{ type: "text", text: "x" }]), sub("w1"), cfg);
  assert.equal(applyRecord(st, note("w1", "completed", "one"), mainSrc, cfg).newEvents.length, 1);
  assert.equal(applyRecord(st, note("w1", "completed", "one"), mainSrc, cfg).newEvents.length, 0);
  assert.equal(applyRecord(st, note("w1", "completed", "two"), mainSrc, cfg).newEvents.length, 1);
});

test("재개 경계: 레코드 ts 가 endedAt 과 같으면 재개하지 않고, 더 늦으면 재개", () => {
  const st = createRunState("p", SID);
  applyRecord(st, asst("2026-01-01T00:00:05Z", "a", [{ type: "text", text: "x" }]), sub("w1"), cfg);
  applyRecord(st, note("w1", "completed", "s", "2026-01-01T00:00:20Z"), mainSrc, cfg);
  applyRecord(st, asst("2026-01-01T00:00:20Z", "b", [{ type: "text", text: "same ts" }]), sub("w1"), cfg);
  assert.equal(st.nodesById.get("w1").status, "completed");
  applyRecord(st, asst("2026-01-01T00:00:21Z", "c", [{ type: "text", text: "later" }]), sub("w1"), cfg);
  assert.equal(st.nodesById.get("w1").status, "running");
});

test("재개 판정은 handback 표시를 해제해 이후 text 가 resultText 를 갱신한다", () => {
  const st = createRunState("p", SID);
  applyRecord(st, asst("2026-01-01T00:00:05Z", "a", [{ type: "tool_use", id: "h", name: "SubagentHandback", input: { message: "FIRST" } }]), sub("w1"), cfg);
  applyRecord(st, asst("2026-01-01T00:00:06Z", "b", [{ type: "text", text: "ignored after handback" }]), sub("w1"), cfg);
  assert.equal(st.nodesById.get("w1").resultText, "FIRST");
  applyRecord(st, note("w1", "completed", "s", "2026-01-01T00:00:10Z"), mainSrc, cfg);
  applyRecord(st, asst("2026-01-01T00:00:30Z", "c", [{ type: "text", text: "resumed work" }]), sub("w1"), cfg);
  assert.equal(st.nodesById.get("w1").status, "running");
  // 재개를 일으킨 바로 그 레코드의 text 는 아직 handback 표시가 남은 채 처리된다(해제는 블록 처리 뒤). 다음 레코드부터 갱신된다.
  applyRecord(st, asst("2026-01-01T00:00:31Z", "d", [{ type: "text", text: "second resumed" }]), sub("w1"), cfg);
  assert.equal(st.nodesById.get("w1").resultText, "second resumed");
});

test("verdict.status 매핑: pending→not yet, running, completed→done, failed, stale→running", () => {
  const mk = () => { const st = createRunState("p", SID); applyMeta(st, "j", { agentType: "verifier" }, cfg); return st; };
  assert.equal(toRunView(mk(), NOW, cfg).verdict.status, "not yet");
  const running = mk();
  applyRecord(running, asst("2026-01-01T00:00:05Z", "a", [{ type: "text", text: "x" }]), sub("j"), cfg);
  assert.equal(toRunView(running, Date.parse("2026-01-01T00:00:10Z"), cfg).verdict.status, "running");
  assert.equal(toRunView(running, Date.parse("2026-01-01T00:00:05Z") + cfg.staleAfterMs + 1, cfg).verdict.status, "running");
  const done = mk();
  applyRecord(done, asst("2026-01-01T00:00:05Z", "a", [{ type: "text", text: "x" }]), sub("j"), cfg);
  applyRecord(done, note("j", "completed"), mainSrc, cfg);
  assert.equal(toRunView(done, NOW, cfg).verdict.status, "done");
  const failed = mk();
  applyRecord(failed, asst("2026-01-01T00:00:05Z", "a", [{ type: "text", text: "x" }]), sub("j"), cfg);
  applyRecord(failed, note("j", "failed"), mainSrc, cfg);
  assert.equal(toRunView(failed, NOW, cfg).verdict.status, "failed");
});

test("judgeAgentTypes 설정이 비어 있으면 judge 없음 (verdict n/a)", () => {
  const empty = { ...cfg, judgeAgentTypes: [] };
  const st = createRunState("p", SID);
  applyMeta(st, "r", { agentType: "reviewer" }, empty);
  assert.equal(st.nodesById.get("r").role, "worker");
  assert.equal(toRunView(st, NOW, empty).verdict.status, "n/a");
});

test("<synthetic> 만 있는 노드는 모델 null, modelUsage 에서 제외", () => {
  const st = createRunState("p", SID);
  applyRecord(st, { type: "assistant", timestamp: "2026-01-01T00:00:01Z", message: { id: "s1", model: "<synthetic>", content: [{ type: "text", text: "x" }], usage: { output_tokens: 5 } } }, sub("w"), cfg);
  const run = toRunView(st, NOW, cfg);
  assert.equal(run.nodes.find((n) => n.id === "w").model, null);
  assert.deepEqual(run.modelUsage, []);
  // 이후 실제 모델이 오고 다시 synthetic 이 와도 덮어쓰지 않는다
  applyRecord(st, asst("2026-01-01T00:00:02Z", "s2", [{ type: "text", text: "y" }], "claude-haiku-5-5"), sub("w"), cfg);
  applyRecord(st, { type: "assistant", timestamp: "2026-01-01T00:00:03Z", message: { id: "s3", model: "<synthetic>", content: [{ type: "text", text: "z" }], usage: {} } }, sub("w"), cfg);
  assert.equal(st.nodesById.get("w").model.label, "haiku 5.5");
});

test("연결 근거 없는 서브에이전트는 시작 순서/시간으로 추정 연결하지 않는다 (spawn 있어도 toolUseId 불일치)", () => {
  const st = createRunState("p", SID);
  applyRecord(st, asst("2026-01-01T00:00:01Z", "m1", [{ type: "tool_use", id: "tA", name: "Agent", input: { subagent_type: "implementer", description: "d" } }]), mainSrc, cfg);
  applyRecord(st, asst("2026-01-01T00:00:02Z", "x", [{ type: "text", text: "hi" }]), sub("orphan"), cfg);
  applyMeta(st, "orphan", { agentType: "implementer", toolUseId: "unrelated" }, cfg);
  const n = st.nodesById.get("orphan");
  assert.equal(n.spawnedAtMainTurn, null);
  assert.equal(n.description, null);
});

test("applyMeta: 비정상 meta 입력은 던지지 않고, 변화 없는 재적용은 changed false", () => {
  const st = createRunState("p", SID);
  assert.doesNotThrow(() => applyMeta(st, "m", null, cfg));
  assert.doesNotThrow(() => applyMeta(st, "m", { agentType: 5, spawnDepth: "x", toolUseId: 7, finished: "yes" }, cfg));
  assert.equal(st.nodesById.get("m").status, "pending"); // finished 는 === true 일 때만
  const meta = { agentType: "implementer", toolUseId: "t", spawnDepth: 2 };
  assert.equal(applyMeta(st, "m2", meta, cfg).changed, true);
  assert.equal(applyMeta(st, "m2", meta, cfg).changed, false);
  assert.equal(st.nodesById.get("m2").spawnDepth, 2);
  assert.deepEqual(applyMeta(st, "m2", meta, cfg).newEvents, []);
});

test("toRunView: lastActivityAt 이 없는 running 노드는 stale 로 바뀌지 않고 던지지 않는다", () => {
  const st = createRunState("p", SID);
  applyMeta(st, "x", { agentType: "implementer" }, cfg); // pending
  st.nodesById.get("x").status = "running";
  assert.doesNotThrow(() => toRunView(st, 1e15, cfg));
  assert.equal(toRunView(st, 1e15, cfg).nodes.find((n) => n.id === "x").status, "running");
});

test("toRunView 는 저장 상태의 endedAt 을 건드리지 않는다 (R7), 호출을 반복해도 동일", () => {
  const st = createRunState("p", SID);
  applyRecord(st, asst("2026-01-01T00:00:07Z", "a", [{ type: "text", text: "x" }]), sub("f1"), cfg);
  applyMeta(st, "f1", { finished: true }, cfg);
  const a = toRunView(st, NOW, cfg);
  const b = toRunView(st, NOW, cfg);
  assert.deepEqual(a, b);
  assert.equal(st.nodesById.get("f1").endedAt, null);
  // 이후 재개: 저장 endedAt 이 null 이므로 재개 분기는 타지 않는다(status 는 completed 유지) — 현재 동작 고정
  applyRecord(st, asst("2026-01-01T00:00:50Z", "b", [{ type: "text", text: "more" }]), sub("f1"), cfg);
  assert.equal(st.nodesById.get("f1").status, "completed");
  assert.equal(toRunView(st, NOW, cfg).nodes.find((n) => n.id === "f1").endedAt, "2026-01-01T00:00:50Z");
});

test("startedAt 이 있는 완료 노드는 뷰에서 항상 endedAt 을 가진다 (R7)", () => {
  const { st } = build();
  for (const n of toRunView(st, NOW, cfg).nodes) {
    if ((n.status === "completed" || n.status === "failed") && n.id !== "main") assert.ok(n.endedAt, n.id);
  }
});

test("동일 message.id 재전송은 turns 를 늘리지 않고 usage 는 마지막 값 1회", () => {
  const st = createRunState("p", SID);
  const u = (out) => ({ type: "assistant", timestamp: "2026-01-01T00:00:01Z", message: { id: "same", model: "claude-opus-5-5", content: [{ type: "text", text: "x" }], usage: { output_tokens: out, input_tokens: 1 } } });
  applyRecord(st, u(5), mainSrc, cfg);
  applyRecord(st, u(9), mainSrc, cfg);
  const run = toRunView(st, NOW, cfg);
  assert.equal(run.nodes[0].turns, 1);
  assert.equal(run.nodes[0].tokens.output, 9);
  assert.equal(run.nodes[0].tokens.input, 1);
  assert.equal(run.totals.tokens, 10);
});

// ---- tester 가 찾은 버그의 회귀 테스트(수정 완료) ----

test("recentEvents(state, 0) 은 빈 배열이어야 한다", () => {
  const st = createRunState("p", SID);
  applyRecord(st, asst("2026-01-01T00:00:01Z", "a", [{ type: "text", text: "x" }]), mainSrc, cfg);
  assert.deepEqual(recentEvents(st, 0), []);
});

test("재개 판정이 ts 문자열 비교: 밀리초 표기가 섞이면 더 늦은 레코드가 재개를 못 한다", () => {
  const st = createRunState("p", SID);
  applyRecord(st, asst("2026-01-01T00:00:05Z", "a", [{ type: "text", text: "x" }]), sub("w1"), cfg);
  applyRecord(st, note("w1", "completed", "s", "2026-01-01T00:00:20Z"), mainSrc, cfg);
  // 20.500Z 는 20Z 보다 늦지만 문자열로는 "20.500Z" < "20Z"
  applyRecord(st, asst("2026-01-01T00:00:20.500Z", "b", [{ type: "text", text: "later" }]), sub("w1"), cfg);
  assert.equal(st.nodesById.get("w1").status, "running");
});

test("파싱 불가 timestamp 레코드가 완료된 노드를 재개시키면 안 된다", () => {
  const st = createRunState("p", SID);
  applyRecord(st, asst("2026-01-01T00:00:05Z", "a", [{ type: "text", text: "x" }]), sub("w1"), cfg);
  applyRecord(st, note("w1", "completed", "s", "2026-01-01T00:00:20Z"), mainSrc, cfg);
  applyRecord(st, asst("garbage", "b", [{ type: "text", text: "bad ts" }]), sub("w1"), cfg);
  assert.equal(st.nodesById.get("w1").status, "completed");
});

test("judge 선택은 시각 표기가 섞여도 가장 늦게 시작한 노드를 고른다(문자열 비교 금지)", () => {
  const st = createRunState("p", SID);
  applyMeta(st, "r1", { agentType: "reviewer", toolUseId: "t1" }, cfg);
  applyMeta(st, "r2", { agentType: "reviewer", toolUseId: "t2" }, cfg);
  applyRecord(st, asst("2026-10-29T10:00:00.500Z", "m1", [{ type: "text", text: "a" }]), sub("r1"), cfg);
  applyRecord(st, asst("2026-10-29T10:00:00Z", "m2", [{ type: "text", text: "b" }]), sub("r2"), cfg);
  // r2(10:00:00Z)가 r1(10:00:00.500Z)보다 이르므로 최신 judge 는 r1
  assert.equal(toRunView(st, Date.parse("2026-10-29T10:01:00Z"), cfg).verdict.judgeId, "r1");
});

// ---- R14: 메인 깨움 규칙 (설계 7.2) ----

const wkTs = (n) => `2026-02-01T00:00:${String(n).padStart(2, "0")}Z`;
const wkMain = { kind: "main" };
const WK_NOTE = "<task-notification><task-id>s1</task-id><status>completed</status><summary>done</summary></task-notification>";
const wkPrompt = (n) => ({ type: "user", timestamp: wkTs(n), message: { role: "user", content: "do it" } });
const wkAsst = (n, id, content = [{ type: "text", text: "ok" }], extra = {}) => ({
  type: "assistant", timestamp: wkTs(n), message: { id, model: "claude-opus-5-5", content, usage: {} }, ...extra,
});
const wkResult = (n) => ({ type: "user", timestamp: wkTs(n), message: { role: "user", content: [{ type: "tool_result", tool_use_id: "tb", content: "x" }] } });
const wkTurnDur = (n, durationMs) => ({ type: "system", subtype: "turn_duration", timestamp: wkTs(n), ...(durationMs ? { durationMs } : {}) });
const wkStopHook = (n) => ({ type: "system", subtype: "stop_hook_summary", timestamp: wkTs(n) });
const wkEnqueue = (n) => ({ type: "queue-operation", operation: "enqueue", timestamp: wkTs(n), content: WK_NOTE });
const wkUserNote = (n, extra = {}) => ({
  type: "user", timestamp: wkTs(n), origin: { kind: "task-notification" }, message: { role: "user", content: WK_NOTE }, ...extra,
});
const wkSpawn = (n) => wkAsst(n, "msg-spawn", [{ type: "tool_use", id: "t1", name: "Agent", input: { subagent_type: "implementer", description: "d" } }]);
const wkLaunched = (n) => ({
  type: "user", timestamp: wkTs(n),
  message: { role: "user", content: [{ type: "tool_result", tool_use_id: "t1", content: "launched" }] },
  toolUseResult: { status: "async_launched", agentId: "s1" },
});
const ends = (st) => st.events.filter((e) => e.kind === "turn_end").length;
const mainStatus = (st, n) => toRunView(st, Date.parse(wkTs(n)), cfg).nodes[0].status;
const wkApply = (st, r, src = wkMain) => applyRecord(st, r, src, cfg);

// 1번 시나리오 레코드 배열(턴1 종료 → enqueue → 알림 → assistant → 종료)
const wkScenario1 = () => [
  wkPrompt(1), wkSpawn(2), wkLaunched(3), wkAsst(4, "m-a"), wkTurnDur(5),
  wkEnqueue(6), wkUserNote(7), wkAsst(8, "m-b"), wkStopHook(9),
];

test("R14-1 알림만으로 시작된 턴: enqueue 는 깨우지 않고 user 알림(W2)이 깨운다", () => {
  const st = createRunState("p", SID);
  const recs = wkScenario1();
  for (const r of recs.slice(0, 6)) wkApply(st, r); // ... enqueue
  assert.equal(mainStatus(st, 6), "idle");
  assert.equal(ends(st), 1);
  assert.equal(st.nodesById.get("s1").status, "completed");
  const resB = wkApply(st, recs[6]);
  assert.equal(mainStatus(st, 7), "running");
  assert.equal(resB.changed, true);
  assert.equal(resB.newEvents.length, 0); // 중복 알림이라 이벤트 없음
  wkApply(st, recs[7]);
  assert.equal(mainStatus(st, 8), "running");
  wkApply(st, recs[8]);
  assert.equal(mainStatus(st, 9), "idle");
  assert.equal(ends(st), 2);
  assert.equal(st.events.at(-1).kind, "turn_end");
});

test("R14-2 알림 레코드 없이 assistant(W1)만으로도 깨운다", () => {
  const st = createRunState("p", SID);
  const recs = wkScenario1().filter((r) => r.origin?.kind !== "task-notification");
  for (const r of recs.slice(0, 6)) wkApply(st, r);
  assert.equal(mainStatus(st, 6), "idle");
  wkApply(st, recs[6]); // wkAsst(8)
  assert.equal(mainStatus(st, 8), "running");
  wkApply(st, recs[7]); // wkStopHook(9)
  assert.equal(mainStatus(st, 9), "idle");
  assert.equal(ends(st), 2);
});

test("R14-3 일반 프롬프트 턴: 내내 running, 종료 후 idle, turn_end 1회", () => {
  const st = createRunState("p", SID);
  wkApply(st, wkPrompt(1));
  assert.equal(mainStatus(st, 1), "running");
  wkApply(st, wkAsst(2, "m1", [{ type: "tool_use", id: "tb", name: "Bash", input: { command: "ls" } }]));
  assert.equal(mainStatus(st, 2), "running");
  wkApply(st, wkResult(3));
  wkApply(st, wkAsst(4, "m2"));
  assert.equal(mainStatus(st, 4), "running");
  wkApply(st, wkTurnDur(5));
  assert.equal(mainStatus(st, 5), "idle");
  assert.equal(ends(st), 1);
});

test("R14-4 중복 종료 레코드는 turn_end 를 한 번만 낸다", () => {
  const run = (end1, end2) => {
    const st = createRunState("p", SID);
    for (const r of [wkPrompt(1), wkAsst(2, "m1"), end1, end2]) wkApply(st, r);
    return st;
  };
  const a = run(wkStopHook(3), wkTurnDur(4, 5000));
  assert.equal(mainStatus(a, 4), "idle");
  assert.equal(ends(a), 1);
  assert.equal(a.events.at(-1).text, "turn ended");
  const b = run(wkTurnDur(3, 5000), wkStopHook(4));
  assert.equal(mainStatus(b, 4), "idle");
  assert.equal(ends(b), 1);
  assert.equal(b.events.at(-1).text, "turn ended (5s)");
  const c = createRunState("p", SID);
  for (const r of [...wkScenario1(), wkTurnDur(10)]) wkApply(c, r);
  assert.equal(mainStatus(c, 10), "idle");
  assert.equal(ends(c), 2);
});

test("R14-5 첫 로드: 레코드 순서만으로 최종 상태가 결정된다", () => {
  const load = (recs) => {
    const st = createRunState("p", SID);
    for (const r of recs) wkApply(st, r);
    return st;
  };
  const recs = wkScenario1();
  const full = load(recs);
  assert.equal(mainStatus(full, 9), "idle");
  assert.equal(ends(full), 2);
  assert.equal(full.nodesById.get("main").turns, 3);
  const noLastEnd = load(recs.slice(0, -1));
  assert.equal(mainStatus(noLastEnd, 8), "running");
  assert.equal(ends(noLastEnd), 1);
  const endsWithNote = load(recs.slice(0, 7)); // 마지막 assistant 와 stop_hook_summary 제외
  assert.equal(mainStatus(endsWithNote, 7), "running");
  assert.equal(ends(endsWithNote), 1);
});

test("R14-6 턴 중간 알림은 상태·이벤트를 바꾸지 않는다", () => {
  const st = createRunState("p", SID);
  for (const r of [wkPrompt(1), wkSpawn(2), wkLaunched(3)]) wkApply(st, r);
  wkApply(st, wkUserNote(4));
  assert.equal(mainStatus(st, 4), "running");
  wkApply(st, wkAsst(5, "m1"));
  wkApply(st, wkTurnDur(6));
  assert.equal(ends(st), 1);
});

test("R14-7 synthetic assistant 는 깨우지 않는다", () => {
  const st = createRunState("p", SID);
  for (const r of [wkPrompt(1), wkAsst(2, "m1"), wkTurnDur(3)]) wkApply(st, r);
  const syn = wkAsst(4, "m-syn", [{ type: "text", text: "API Error: x" }]);
  syn.message.model = "<synthetic>";
  wkApply(st, syn);
  assert.equal(mainStatus(st, 4), "idle");
  wkApply(st, wkStopHook(5));
  assert.equal(ends(st), 1);
});

test("R14-8 sidechain·서브에이전트 레코드는 깨우지 않는다", () => {
  const st = createRunState("p", SID);
  for (const r of [wkPrompt(1), wkAsst(2, "m1"), wkTurnDur(3)]) wkApply(st, r);
  wkApply(st, wkAsst(4, "m-side", undefined, { isSidechain: true }));
  assert.equal(mainStatus(st, 4), "idle");
  wkApply(st, wkAsst(5, "m-sub"), sub("s1"));
  assert.equal(mainStatus(st, 5), "idle");
  assert.equal(st.nodesById.get("s1").status, "running");
  wkApply(st, wkTurnDur(6), sub("s1"));
  assert.equal(mainStatus(st, 6), "idle");
  wkApply(st, wkUserNote(7, { isSidechain: true }));
  assert.equal(mainStatus(st, 7), "idle");
  assert.equal(ends(st), 1);
});

test("R14-9 알려지지 않은 알림은 깨우지 않는다", () => {
  const st = createRunState("p", SID);
  for (const r of [wkPrompt(1), wkAsst(2, "m1"), wkTurnDur(3)]) wkApply(st, r);
  const unknown = wkUserNote(4);
  unknown.message.content = "<task-notification><task-id>bgshell1</task-id><status>completed</status><summary>x</summary></task-notification>";
  const res = wkApply(st, unknown);
  assert.equal(mainStatus(st, 4), "idle");
  assert.equal(res.changed, false);
  assert.equal(ends(st), 1);
});
