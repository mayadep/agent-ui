import { renderHeader, renderGoal } from "./panels.js";
import { renderFlow } from "./flow.js";
import { resetLog, appendLog } from "./log.js";
import { LIMITS_POLL_MS } from "./limits.js";

const MAX_CLIENT_EVENTS = 1000;
const $ = (id) => document.getElementById(id);
const els = { header: $("header"), goal: $("goal"), flow: $("flow"), log: $("log"), select: $("session-select"), conn: $("conn") };

let state = { run: null, events: [] };
let source = null;
let limitsResp = { status: "loading", limits: null };
let agents = null; // null → 아직 못 받음(패널 생략)

function setConn(text, ok) {
  els.conn.textContent = text;
  els.conn.classList.toggle("ok", !!ok);
}

function renderTick() {
  if (!state.run) return;
  renderGoal(els.goal, state.run, Date.now(), limitsResp, agents);
  renderFlow(els.flow, state.run, Date.now());
}

function renderAll() {
  if (!state.run) return;
  renderHeader(els.header, state.run);
  renderTick();
}

function connect(p, s) {
  if (source) source.close();
  source = new EventSource(`/api/run/${encodeURIComponent(p)}/${encodeURIComponent(s)}/stream`);
  source.addEventListener("open", () => setConn("live", true));
  source.addEventListener("error", () => setConn("reconnecting…", false));
  source.addEventListener("snapshot", (e) => {
    const d = JSON.parse(e.data);
    state = { run: d.run, events: d.events.slice(-MAX_CLIENT_EVENTS) };
    renderAll();
    resetLog(els.log, state.events, state.run);
  });
  source.addEventListener("update", (e) => {
    const d = JSON.parse(e.data);
    state.run = d.run;
    // snapshot 과 첫 update 가 겹칠 수 있으므로 마지막 seq 보다 큰 이벤트만 취한다
    const lastSeq = state.events.at(-1)?.seq ?? -1;
    const fresh = d.newEvents.filter((ev) => ev.seq > lastSeq);
    state.events = state.events.concat(fresh).slice(-MAX_CLIENT_EVENTS);
    renderAll();
    appendLog(els.log, fresh, state.run);
  });
}

const LIMIT_STATUSES = ["ok", "missing", "invalid"];
const sessionQuery = (p, s) => `?p=${encodeURIComponent(p)}&s=${encodeURIComponent(s)}`;

// 마지막 정상 값은 유지(신선도 표시가 처리)하고, 그 외에는 error 로 둔다.
function markLimitsError() {
  if (limitsResp.status !== "ok") limitsResp = { status: "error", limits: null };
}

async function pollLimits() {
  try {
    const r = await fetch("/api/limits");
    const body = r.ok ? await r.json() : null;
    if (body && LIMIT_STATUSES.includes(body.status)) {
      limitsResp = { status: body.status, limits: body.limits ?? null };
    } else {
      markLimitsError();
    }
  } catch {
    markLimitsError();
  }
  renderTick();
}

async function loadAgents() {
  try {
    const r = await fetch("/api/agents");
    if (r.ok) agents = (await r.json()).agents;
  } catch {
    /* 목록 실패는 치명적이지 않음 */
  }
  renderTick();
}

async function fillSelect(p, s) {
  try {
    const r = await fetch("/api/sessions");
    const { sessions } = await r.json();
    els.select.replaceChildren();
    for (const x of sessions) {
      const o = document.createElement("option");
      o.value = `${x.projectKey}|${x.sessionId}`;
      o.textContent = `${x.title ?? x.sessionId.slice(0, 8)}  [${x.projectKey}]`;
      els.select.append(o);
    }
    els.select.value = `${p}|${s}`;
  } catch {
    /* 목록 실패는 치명적이지 않음 */
  }
}

els.select.addEventListener("change", () => {
  const [p, s] = els.select.value.split("|");
  location.search = sessionQuery(p, s);
});

async function main() {
  const q = new URLSearchParams(location.search);
  let p = q.get("p");
  let s = q.get("s");
  if (!p || !s) {
    const r = await fetch("/api/sessions/latest");
    if (!r.ok) {
      setConn("no sessions", false);
      els.goal.textContent = "no sessions found";
      return;
    }
    ({ projectKey: p, sessionId: s } = await r.json());
    history.replaceState(null, "", sessionQuery(p, s));
  }
  fillSelect(p, s);
  connect(p, s);
  loadAgents();
  pollLimits();
  setInterval(pollLimits, LIMITS_POLL_MS);
  setInterval(renderTick, 1000);
}

main();
