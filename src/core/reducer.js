// 레코드 스트림 → RunState. 순수 함수만 둔다(부수효과 없음). 형식 변화는 이 파일만 고치면 된다.
import { parseModel } from "./models.js";
import { classifyRole } from "./roles.js";
import { clip, summarizeToolUse, parseTaskNotification, isHumanPrompt, promptText } from "./summarize.js";

/** @typedef {'opus'|'sonnet'|'haiku'|'unknown'} ModelFamily */
/** @typedef {{ id: string, family: ModelFamily, version: string|null, label: string, variant: string|null }} ModelInfo */
/** @typedef {'main'|'worker'|'judge'} AgentRole */
/** @typedef {'pending'|'running'|'idle'|'completed'|'failed'|'stale'} AgentStatus */
/** @typedef {{
 *   id: string, role: AgentRole, agentType: string|null, description: string|null, parentId: string|null,
 *   toolUseId: string|null, spawnDepth: number, model: ModelInfo|null, status: AgentStatus,
 *   startedAt: string|null, endedAt: string|null, lastActivityAt: string|null, activity: string|null,
 *   turns: number, toolUses: number,
 *   tokens: { input: number, output: number, cacheRead: number, cacheCreation: number },
 *   resultText: string|null, spawnedAtMainTurn: number|null
 * }} AgentNode */
/** @typedef {'prompt'|'text'|'tool'|'tool_error'|'spawn'|'agent_done'|'agent_failed'|'turn_end'} EventKind */
/** @typedef {{ seq: number, ts: string, agentId: string, modelLabel: string|null, kind: EventKind, text: string, verdict: string|null }} Event */
/** @typedef {{
 *   sessionId: string, projectKey: string, cwd: string|null, title: string|null,
 *   goal: { text: string, ts: string } | null, currentPrompt: { text: string, ts: string } | null,
 *   permissionMode: string|null, startedAt: string|null, lastActivityAt: string|null,
 *   nodes: AgentNode[],
 *   modelUsage: { label: string, family: ModelFamily, outputTokens: number }[],
 *   verdict: { judgeId: string|null, status: 'n/a'|'not yet'|'running'|'done'|'failed', text: string|null },
 *   totals: { turns: number, tokens: number }
 * }} Run */

const GOAL_MAX = 240;
const EVENT_MAX = 160;
const ACTIVITY_MAX = 80;
const RESULT_MAX = 120;
const FAILED_STATUSES = new Set(["failed", "killed", "error"]);

function newNode(id, role, parentId, spawnDepth) {
  return {
    id, role, agentType: null, description: null, parentId, toolUseId: null, spawnDepth,
    model: null, status: "pending", startedAt: null, endedAt: null, lastActivityAt: null,
    activity: null, turns: 0, toolUses: 0,
    tokens: { input: 0, output: 0, cacheRead: 0, cacheCreation: 0 },
    resultText: null, spawnedAtMainTurn: null,
  };
}

export function createRunState(projectKey, sessionId) {
  const main = newNode("main", "main", null, 0);
  main.status = "idle";
  return {
    projectKey, sessionId, cwd: null, title: null, goal: null, currentPrompt: null,
    permissionMode: null, startedAt: null, lastActivityAt: null,
    nodesById: new Map([["main", main]]),
    usageByMessageId: new Map(),
    events: [],
    nextSeq: 0,
    // 내부 보조 상태
    seenMessageIds: new Set(),
    seenNotifications: new Set(),
    handbackIds: new Set(),
    pendingSpawnTurn: new Map(), // toolUseId → main.turns
    pendingSpawnInfo: new Map(), // toolUseId → { agentType, description }
    turnEnded: false,
  };
}

// 시각 비교는 문자열이 아니라 Date.parse 로 한다(`.500Z` 표기 혼용, 파싱 불가 값 대응).
function tsMs(s) {
  const t = Date.parse(s);
  return Number.isFinite(t) ? t : null;
}

function tsAfter(a, b) {
  const x = tsMs(a);
  const y = tsMs(b);
  return x !== null && y !== null && x > y;
}

function tsMax(a, b) {
  if (tsMs(b) === null) return a;
  if (tsMs(a) === null) return b;
  return tsAfter(b, a) ? b : a;
}

function addEvent(state, cfg, e) {
  const node = state.nodesById.get(e.agentId);
  const ev = {
    seq: state.nextSeq++,
    ts: e.ts ?? "",
    agentId: e.agentId,
    modelLabel: node?.model?.label ?? null,
    kind: e.kind,
    text: clip(e.text ?? "", EVENT_MAX),
    verdict: e.verdict ?? null,
  };
  state.events.push(ev);
  const max = cfg?.maxEvents ?? 2000;
  if (state.events.length > max) state.events.splice(0, state.events.length - max);
  return ev;
}

function ensureNode(state, agentId, status = "pending") {
  let n = state.nodesById.get(agentId);
  if (!n) {
    n = newNode(agentId, "worker", "main", 1);
    n.status = status;
    state.nodesById.set(agentId, n);
  }
  return n;
}

function linkSpawn(state, node, toolUseId, cfg) {
  if (typeof toolUseId !== "string" || !toolUseId) return;
  if (!node.toolUseId) node.toolUseId = toolUseId;
  if (node.spawnedAtMainTurn === null && state.pendingSpawnTurn.has(toolUseId)) {
    node.spawnedAtMainTurn = state.pendingSpawnTurn.get(toolUseId);
  }
  const info = state.pendingSpawnInfo.get(toolUseId);
  if (info) {
    if (!node.agentType && info.agentType) node.agentType = info.agentType;
    if (!node.description && info.description) node.description = clip(info.description, ACTIVITY_MAX);
  }
  if (cfg && node.agentType) node.role = classifyRole(node.agentType, cfg.judgeAgentTypes);
}

function textOf(content) {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content.filter((b) => b && b.type === "text" && typeof b.text === "string").map((b) => b.text).join("\n");
  }
  return "";
}

function firstLine(text) {
  for (const l of String(text ?? "").split(/\r?\n/)) if (l.trim()) return l;
  return "";
}

function handleNotification(state, text, ts, cfg) {
  const note = parseTaskNotification(text);
  if (!note) return null;
  const node = state.nodesById.get(note.taskId);
  if (!node || node.id === "main") return null;
  let status;
  if (note.status === "completed") status = "completed";
  else if (FAILED_STATUSES.has(note.status)) status = "failed";
  else return null;
  const key = `${note.taskId}|${note.status}|${note.summary}`;
  if (state.seenNotifications.has(key)) return null;
  state.seenNotifications.add(key);
  node.status = status;
  node.endedAt = ts ?? null;
  const failed = status === "failed";
  return addEvent(state, cfg, {
    ts, agentId: node.id, kind: failed ? "agent_failed" : "agent_done", text: note.summary || status, verdict: failed ? "failed" : "done",
  });
}

// 메인을 깨운다(R14). main.status 를 running 으로, turnEnded 를 해제한다. main.status 가 실제로 바뀌었으면 true.
function wakeMain(state) {
  const main = state.nodesById.get("main");
  const changed = main.status !== "running";
  main.status = "running";
  state.turnEnded = false;
  return changed;
}

// task-notification 텍스트의 taskId 가 알려진 서브에이전트 노드면 그 노드, 아니면 null. 상태 변경 없음.
function notificationTarget(state, text) {
  const note = parseTaskNotification(text);
  if (!note) return null;
  const node = state.nodesById.get(note.taskId);
  return node && node.id !== "main" ? node : null;
}

export function applyRecord(state, record, source, cfg) {
  const res = { changed: false, newEvents: [] };
  if (!record || typeof record !== "object") return res;
  const emit = (e) => { res.newEvents.push(addEvent(state, cfg, e)); res.changed = true; };

  const isMain = source?.kind !== "subagent";
  const agentId = isMain ? "main" : source.agentId;
  const ts = typeof record.timestamp === "string" ? record.timestamp : null;

  let node = state.nodesById.get(agentId);
  if (!node) {
    node = ensureNode(state, agentId, "running");
    res.changed = true;
  }
  if (!isMain && ts && !node.startedAt) node.startedAt = ts;

  if (ts) {
    state.startedAt = state.startedAt ?? ts;
    state.lastActivityAt = tsMax(state.lastActivityAt, ts);
    node.lastActivityAt = tsMax(node.lastActivityAt, ts);
  }
  if (isMain && !state.cwd && typeof record.cwd === "string") state.cwd = record.cwd;

  const evAgent = (kind, text, extra = {}) => emit({ ts, agentId, kind, text, ...extra });

  switch (record.type) {
    case "ai-title":
      if (typeof record.aiTitle === "string") { state.title = record.aiTitle; res.changed = true; }
      break;

    case "permission-mode":
      if (typeof record.permissionMode === "string") { state.permissionMode = record.permissionMode; res.changed = true; }
      break;

    case "user": {
      if (isMain && typeof record.permissionMode === "string") {
        state.permissionMode = record.permissionMode;
        res.changed = true;
      }
      if (record.origin?.kind === "task-notification") {
        const text = textOf(record.message?.content);
        const ev = handleNotification(state, text, ts, cfg);
        if (ev) { res.newEvents.push(ev); res.changed = true; }
        // (W2) 메인 소스의 알려진 서브에이전트 알림은 중복·status 와 무관하게 메인을 깨운다
        if (isMain && record.isSidechain !== true && notificationTarget(state, text) && wakeMain(state)) res.changed = true;
        break;
      }
      if (isMain && isHumanPrompt(record)) {
        const text = clip(promptText(record), GOAL_MAX);
        if (!state.goal) state.goal = { text, ts: ts ?? "" };
        state.currentPrompt = { text, ts: ts ?? "" };
        wakeMain(state);
        evAgent("prompt", text);
        break;
      }
      const content = record.message?.content;
      if (Array.isArray(content)) {
        const results = content.filter((b) => b && b.type === "tool_result");
        for (const b of results) {
          if (b.is_error === true) evAgent("tool_error", textOf(b.content) || "tool error");
        }
        const tur = record.toolUseResult;
        if (tur && typeof tur === "object" && typeof tur.agentId === "string" && tur.agentId) {
          const toolUseId = results[0]?.tool_use_id ?? null;
          const target = ensureNode(state, tur.agentId);
          res.changed = true;
          linkSpawn(state, target, toolUseId, cfg);
          if (tur.status === "async_launched") {
            if (typeof tur.description === "string" && !target.description) target.description = clip(tur.description, ACTIVITY_MAX);
            if (!target.model) target.model = parseModel(tur.resolvedModel);
          } else {
            // 동기 Agent 결과(설계 8장 질문 5의 가정)
            const isErr = results.some((b) => b.is_error === true);
            target.status = isErr ? "failed" : "completed";
            target.endedAt = ts;
            emit({
              ts, agentId: target.id, kind: isErr ? "agent_failed" : "agent_done",
              text: `${target.agentType ?? "agent"} ${isErr ? "failed" : "finished"}`,
              verdict: isErr ? "failed" : "done",
            });
          }
        }
      }
      break;
    }

    case "queue-operation":
      if (record.operation === "enqueue" && typeof record.content === "string") {
        const ev = handleNotification(state, record.content, ts, cfg);
        if (ev) { res.newEvents.push(ev); res.changed = true; }
      }
      break;

    case "assistant": {
      const m = record.message;
      if (!m || typeof m !== "object") break;
      res.changed = true;
      // (W1) 비-sidechain·비-synthetic 메인 assistant 는 메인을 깨운다
      if (isMain && record.isSidechain !== true && m.model !== "<synthetic>") wakeMain(state);
      let mi = null;
      if (typeof m.model === "string" && m.model !== "<synthetic>") {
        mi = parseModel(m.model);
        if (mi) node.model = mi;
      }
      const id = typeof m.id === "string" ? m.id : null;
      if (id && !state.seenMessageIds.has(id)) {
        state.seenMessageIds.add(id);
        node.turns += 1;
      }
      if (id && m.usage && typeof m.usage === "object") {
        state.usageByMessageId.set(id, {
          agentId,
          label: mi?.label ?? null,
          family: mi?.family ?? "unknown",
          usage: m.usage,
        });
      }
      const blocks = typeof m.content === "string" ? [{ type: "text", text: m.content }] : Array.isArray(m.content) ? m.content : [];
      for (const b of blocks) {
        if (!b || typeof b !== "object") continue;
        if (b.type === "tool_use") {
          const input = b.input && typeof b.input === "object" ? b.input : {};
          if (b.name === "SubagentHandback") {
            node.resultText = clip(firstLine(input.message), RESULT_MAX);
            state.handbackIds.add(agentId);
            continue;
          }
          node.toolUses += 1;
          node.activity = summarizeToolUse(b.name, input);
          const isSpawn = b.name === "Agent" || b.name === "Task";
          // 서브에이전트 생성은 tool 과 spawn 이벤트를 따로 내지 않고 spawn 한 줄로 합친다
          evAgent(isSpawn ? "spawn" : "tool", node.activity);
          if (isSpawn) {
            if (typeof b.id === "string") {
              if (isMain) state.pendingSpawnTurn.set(b.id, node.turns);
              state.pendingSpawnInfo.set(b.id, {
                agentType: typeof input.subagent_type === "string" ? input.subagent_type : null,
                description: typeof input.description === "string" ? input.description : null,
              });
            }
          }
        } else if (b.type === "text" && typeof b.text === "string" && b.text.trim()) {
          node.activity = clip(b.text, ACTIVITY_MAX);
          if (!isMain && !state.handbackIds.has(agentId)) node.resultText = clip(firstLine(b.text), RESULT_MAX);
          evAgent("text", b.text);
        }
      }
      if (!isMain) {
        if (node.status === "pending" || node.status === "stale") {
          node.status = "running";
        } else if ((node.status === "completed" || node.status === "failed") && node.endedAt && tsAfter(ts, node.endedAt)) {
          node.status = "running";
          node.endedAt = null;
          state.handbackIds.delete(agentId);
        }
      }
      break;
    }

    case "system":
      if (isMain && (record.subtype === "turn_duration" || record.subtype === "stop_hook_summary")) {
        node.status = "idle";
        res.changed = true;
        if (!state.turnEnded) {
          state.turnEnded = true;
          evAgent("turn_end", typeof record.durationMs === "number" ? `turn ended (${Math.round(record.durationMs / 1000)}s)` : "turn ended");
        }
      }
      break;

    default:
      break;
  }
  return res;
}

export function applyMeta(state, agentId, meta, cfg) {
  const res = { changed: false, newEvents: [] };
  if (!meta || typeof meta !== "object" || typeof agentId !== "string" || !agentId) return res;
  const existed = state.nodesById.has(agentId);
  const node = ensureNode(state, agentId);
  const before = JSON.stringify([node.agentType, node.description, node.toolUseId, node.spawnDepth, node.role, node.status, node.spawnedAtMainTurn]);
  if (typeof meta.agentType === "string") node.agentType = meta.agentType;
  if (!node.description && typeof meta.description === "string") node.description = clip(meta.description, ACTIVITY_MAX);
  if (typeof meta.toolUseId === "string") linkSpawn(state, node, meta.toolUseId, null);
  if (Number.isFinite(meta.spawnDepth)) node.spawnDepth = meta.spawnDepth;
  node.role = classifyRole(node.agentType, cfg?.judgeAgentTypes ?? []);
  if (meta.finished === true && (node.status === "running" || node.status === "pending")) node.status = "completed";
  const after = JSON.stringify([node.agentType, node.description, node.toolUseId, node.spawnDepth, node.role, node.status, node.spawnedAtMainTurn]);
  res.changed = !existed || before !== after;
  return res;
}

function sortNodes(nodes) {
  const main = nodes.find((n) => n.id === "main");
  const rest = nodes.filter((n) => n.id !== "main").sort((a, b) => {
    const x = tsMs(a.startedAt);
    const y = tsMs(b.startedAt);
    if (x !== null && y !== null) {
      if (x !== y) return x < y ? -1 : 1;
    } else if (x !== null || y !== null) {
      return x !== null ? -1 : 1;
    }
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
  });
  return [main, ...rest];
}

export function toRunView(state, nowMs, cfg) {
  const tokensByAgent = new Map();
  const usageByLabel = new Map();
  let totalTokens = 0;
  for (const u of state.usageByMessageId.values()) {
    const x = u.usage;
    const inp = Number(x.input_tokens) || 0;
    const out = Number(x.output_tokens) || 0;
    const cr = Number(x.cache_read_input_tokens) || 0;
    const cc = Number(x.cache_creation_input_tokens) || 0;
    totalTokens += inp + out + cr + cc;
    const t = tokensByAgent.get(u.agentId) ?? { input: 0, output: 0, cacheRead: 0, cacheCreation: 0 };
    t.input += inp; t.output += out; t.cacheRead += cr; t.cacheCreation += cc;
    tokensByAgent.set(u.agentId, t);
    if (u.label) {
      const e = usageByLabel.get(u.label) ?? { label: u.label, family: u.family, outputTokens: 0 };
      e.outputTokens += out;
      usageByLabel.set(u.label, e);
    }
  }

  const nodes = sortNodes([...state.nodesById.values()]).map((n) => {
    const v = {
      ...n,
      model: n.model ? { ...n.model } : null,
      tokens: tokensByAgent.get(n.id) ?? { input: 0, output: 0, cacheRead: 0, cacheCreation: 0 },
    };
    if (v.status === "running" && v.lastActivityAt) {
      const last = Date.parse(v.lastActivityAt);
      if (Number.isFinite(last) && nowMs - last > cfg.staleAfterMs) v.status = "stale";
    }
    // meta.finished 로만 완료된 노드는 endedAt 이 없으므로 뷰에서만 마지막 활동 시각으로 보정한다(저장값은 그대로)
    if ((v.status === "completed" || v.status === "failed") && !v.endedAt) v.endedAt = v.lastActivityAt ?? null;
    return v;
  });

  // nodes 는 sortNodes 가 ms 기준으로 정렬했다(시작 전·무효 시각은 뒤). 판정 노드 중 마지막이 가장 최근이다.
  const judge = nodes.filter((n) => n.role === "judge").at(-1) ?? null;
  const statusMap = { pending: "not yet", running: "running", stale: "running", completed: "done", failed: "failed" };
  const verdict = judge
    ? { judgeId: judge.id, status: statusMap[judge.status] ?? "n/a", text: judge.resultText }
    : { judgeId: null, status: "n/a", text: null };

  const main = nodes[0];
  return {
    sessionId: state.sessionId,
    projectKey: state.projectKey,
    cwd: state.cwd,
    title: state.title,
    goal: state.goal,
    currentPrompt: state.currentPrompt,
    permissionMode: state.permissionMode,
    startedAt: state.startedAt,
    lastActivityAt: state.lastActivityAt,
    nodes,
    modelUsage: [...usageByLabel.values()].sort((a, b) => b.outputTokens - a.outputTokens || (a.label < b.label ? -1 : 1)),
    verdict,
    totals: { turns: main.turns, tokens: totalTokens },
  };
}

export function recentEvents(state, limit) {
  return limit > 0 ? state.events.slice(-limit) : [];
}
