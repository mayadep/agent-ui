import { h } from "./dom.js";
import { fmtClock } from "./format.js";

export const MAX_ROWS = 1000;

function who(ev, run) {
  if (ev.agentId === "main") return "main";
  const n = run.nodes.find((x) => x.id === ev.agentId);
  return n?.agentType ?? ev.agentId.slice(0, 7);
}

function buildRow(ev, run) {
  const tr = h("div", `log-row k-${ev.kind}`);
  tr.append(
    h("span", "l-time", fmtClock(ev.ts)),
    h("span", "l-who", `${ev.modelLabel ?? "n/a"} · ${who(ev, run)}`),
    h("span", "l-text", ev.text),
    h("span", "l-verdict", ev.verdict ?? ""),
  );
  return tr;
}

export function eventTimeMs(ev) {
  const t = Date.parse(ev.ts);
  return Number.isFinite(t) ? t : null;
}

// 표시 순서: key(ts 의 ms) 오름차순, 동률은 seq. 시각이 없는 이벤트는 seq 상 직전 유효 key 를 물려받는다(없으면 0).
const before = (a, b) => a.key < b.key || (a.key === b.key && a.seq < b.seq);

function keyed(events) {
  let lastKey = null;
  const rows = [];
  for (const ev of [...events].sort((a, b) => a.seq - b.seq)) {
    const t = eventTimeMs(ev);
    if (t !== null) lastKey = t;
    rows.push({ ev, key: lastKey ?? 0, seq: ev.seq });
  }
  return { rows, lastKey };
}

export function sortEvents(events) {
  return keyed(events).rows.sort((a, b) => (before(a, b) ? -1 : before(b, a) ? 1 : 0)).map((r) => r.ev);
}

// 정렬 위치 계산만 담당하는 순수 클래스(DOM 없음). rows 는 표시 순서.
export class LogIndex {
  constructor(maxRows = MAX_ROWS) {
    this.maxRows = maxRows;
    this.rows = [];
    this.lastKey = null;
    this.maxSeq = -1;
  }

  get size() {
    return this.rows.length;
  }

  reset(events) {
    const { rows, lastKey } = keyed(events);
    rows.sort((a, b) => (before(a, b) ? -1 : before(b, a) ? 1 : 0));
    this.maxSeq = rows.reduce((m, r) => Math.max(m, r.seq), -1);
    this.lastKey = lastKey;
    const kept = rows.slice(-this.maxRows);
    this.rows = kept.map(({ key, seq }) => ({ key, seq }));
    return kept.map((r) => r.ev);
  }

  add(ev) {
    if (ev.seq <= this.maxSeq) return { op: "drop", index: -1, evict: 0 };
    this.maxSeq = ev.seq;
    const t = eventTimeMs(ev);
    if (t !== null) this.lastKey = t;
    const row = { key: this.lastKey ?? 0, seq: ev.seq };
    const last = this.rows[this.rows.length - 1];
    let op = "append";
    let index;
    if (!last || before(last, row)) {
      this.rows.push(row);
      index = this.rows.length - 1;
    } else {
      // upper bound: 새 행보다 뒤에 와야 하는 첫 행
      let lo = 0;
      let hi = this.rows.length;
      while (lo < hi) {
        const mid = (lo + hi) >> 1;
        if (before(row, this.rows[mid])) hi = mid;
        else lo = mid + 1;
      }
      index = lo;
      if (this.rows.length >= this.maxRows && index === 0) return { op: "drop", index: -1, evict: 0 };
      this.rows.splice(index, 0, row);
      op = "insert";
    }
    const evict = Math.max(0, this.rows.length - this.maxRows);
    if (evict) this.rows.splice(0, evict);
    return { op, index, evict };
  }
}

export function resetLog(el, events, run) {
  const stick = el.scrollHeight - el.scrollTop - el.clientHeight < 40;
  el._log = new LogIndex();
  const frag = document.createDocumentFragment();
  for (const ev of el._log.reset(events)) frag.append(buildRow(ev, run));
  el.replaceChildren(frag);
  if (stick) el.scrollTop = el.scrollHeight;
}

export function appendLog(el, newEvents, run) {
  if (!el._log) return resetLog(el, newEvents, run);
  const stick = el.scrollHeight - el.scrollTop - el.clientHeight < 40;
  for (const ev of [...newEvents].sort((a, b) => a.seq - b.seq)) {
    const { op, index, evict } = el._log.add(ev);
    if (op === "drop") continue;
    const row = buildRow(ev, run);
    if (op === "append") el.append(row);
    else el.insertBefore(row, el.children[index]);
    for (let i = 0; i < evict; i++) el.firstElementChild.remove();
  }
  if (stick) el.scrollTop = el.scrollHeight;
}
