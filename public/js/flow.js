import { h } from "./dom.js";
import { fmtElapsed, fmtTokens } from "./format.js";

const SVG_NS = "http://www.w3.org/2000/svg";

// 구조(노드 id/역할/판정 노드/모델 막대 label)가 바뀔 때만 DOM 을 다시 만들고,
// 그 외에는 제자리 갱신해서 CSS 애니메이션이 매초 끊기지 않게 한다.
function signature(run) {
  const ids = run.nodes.map((n) => `${n.id}:${n.role}`).join(",");
  return `${ids}|${run.verdict.judgeId}|${run.modelUsage.map((m) => m.label).join(",")}`;
}

// 최종 judge 노드와 그 이전 judge 수(순수 함수, DOM 불필요)
export function pickJudge(run) {
  const latest = run.verdict.judgeId ? run.nodes.find((n) => n.id === run.verdict.judgeId) ?? null : null;
  const total = run.nodes.filter((n) => n.role === "judge").length;
  return { latest, previous: total - (latest ? 1 : 0) };
}

function el(parent, tag, cls, text) {
  const e = h(tag, cls, text);
  parent.append(e);
  return e;
}

function statusClass(status) {
  return `st-${status}`;
}

function barState(status) {
  if (status === "running") return "indeterminate";
  if (status === "completed") return "full";
  if (status === "failed") return "failed";
  return "empty"; // pending / stale / idle
}

function elapsedOf(node, nowMs) {
  if (!node.startedAt) return "—";
  const end = node.endedAt ? Date.parse(node.endedAt) : nowMs;
  return fmtElapsed(end - Date.parse(node.startedAt));
}

function modelBadge(badge, model) {
  badge.textContent = model ? model.label : "model n/a";
  badge.className = `badge m-${model ? model.family : "unknown"}`;
}

function buildMain(parent) {
  const box = el(parent, "div", "box main");
  const head = el(box, "div", "box-head");
  const title = el(head, "span", "box-title", "main agent");
  const badge = el(head, "span", "badge");
  const activity = el(box, "div", "box-activity");
  const meta = el(box, "div", "box-meta");
  return {
    box,
    set(node, run, nowMs) {
      title.textContent = "main agent";
      modelBadge(badge, node.model);
      activity.textContent = node.activity ?? "—";
      const started = run.startedAt ? fmtElapsed(nowMs - Date.parse(run.startedAt)) : "—";
      meta.textContent = `turn ${node.turns} · ${started} · ${run.permissionMode ?? "—"}`;
      box.className = `box main ${statusClass(node.status)}`;
    },
  };
}

function buildWorker(parent) {
  const box = el(parent, "div", "box worker");
  const head = el(box, "div", "box-head");
  const title = el(head, "span", "box-title");
  const badge = el(head, "span", "badge");
  const desc = el(box, "div", "box-desc");
  const meta = el(box, "div", "box-meta");
  const activity = el(box, "div", "box-activity");
  const bar = el(box, "div", "bar");
  el(bar, "i", "bar-fill");
  const barLabel = el(box, "div", "bar-label");
  return {
    box,
    set(node, run, nowMs) {
      title.textContent = node.agentType ?? node.id.slice(0, 7);
      modelBadge(badge, node.model);
      desc.textContent = node.description ?? "";
      meta.textContent = `${node.status} · tools ${node.toolUses} · ${elapsedOf(node, nowMs)}`;
      activity.textContent = node.activity ?? "—";
      bar.className = `bar ${barState(node.status)}`;
      barLabel.textContent = node.status === "pending" ? "not started" : "";
      box.className = `box ${node.role} ${statusClass(node.status)}`;
    },
  };
}

function buildJudge(parent, previous) {
  const box = el(parent, "div", "box judge");
  const head = el(box, "div", "box-head");
  const title = el(head, "span", "box-title", "judge");
  const badge = el(head, "span", "badge");
  const after = el(box, "div", "box-meta");
  const verdict = el(box, "div", "box-activity");
  const prev = el(box, "div", "box-meta");
  return {
    box,
    set(node, run, nowMs) {
      title.textContent = node.agentType ?? "judge";
      modelBadge(badge, node.model);
      after.textContent = `after turn ${node.spawnedAtMainTurn ?? "n/a"}`;
      const v = run.verdict;
      verdict.textContent = v.text ? `${v.status}: ${v.text}` : v.status;
      prev.textContent = previous > 0 ? `previous: ${previous}` : "";
      box.className = `box judge ${statusClass(node.status)}`;
    },
  };
}

function buildUsage(parent, labels) {
  const box = el(parent, "div", "box usage");
  el(box, "div", "box-head").append(h("span", "box-title", "model usage"));
  const rows = new Map();
  for (const label of labels) {
    const r = el(box, "div", "u-row");
    const name = el(r, "span", "u-label", label);
    const track = el(r, "span", "u-track");
    const fill = el(track, "i", "u-fill");
    const val = el(r, "span", "u-val");
    rows.set(label, { name, fill, val });
  }
  return {
    box,
    set(run) {
      const max = Math.max(1, ...run.modelUsage.map((m) => m.outputTokens));
      for (const m of run.modelUsage) {
        const r = rows.get(m.label);
        if (!r) continue;
        r.name.className = `u-label m-${m.family}`;
        r.fill.className = `u-fill f-${m.family}`;
        r.fill.style.width = `${Math.round((m.outputTokens / max) * 100)}%`;
        r.val.textContent = fmtTokens(m.outputTokens);
      }
    },
  };
}

function path(svg, cls) {
  const p = document.createElementNS(SVG_NS, "path");
  p.setAttribute("class", cls);
  svg.append(p);
  return p;
}

function rebuild(container, run) {
  container.replaceChildren();
  const refs = { sig: signature(run), items: new Map(), links: [], svg: null };
  const mainNode = run.nodes[0];
  const { latest: latestJudge, previous } = pickJudge(run);
  const workers = run.nodes.filter((n) => n.role === "worker");

  const svg = document.createElementNS(SVG_NS, "svg");
  svg.setAttribute("class", "links");
  container.append(svg);
  refs.svg = svg;

  const rowMain = el(container, "div", "flow-row");
  const main = buildMain(rowMain);
  refs.items.set(mainNode.id, main);

  const rowUsage = el(container, "div", "flow-row");
  const usage = buildUsage(rowUsage, run.modelUsage.map((m) => m.label));
  refs.usage = usage;

  const rowWorkers = el(container, "div", "flow-row workers");
  if (workers.length === 0) {
    el(rowWorkers, "div", "box empty", "no subagents");
  }
  for (const n of workers) refs.items.set(n.id, buildWorker(rowWorkers));

  const rowJudge = el(container, "div", "flow-row");
  if (latestJudge) {
    refs.items.set(latestJudge.id, buildJudge(rowJudge, previous));
  } else {
    el(rowJudge, "div", "box judge dim", "judge: n/a");
  }

  // 연결선: 메인→usage, usage→워커, 워커→judge(judge 없으면 생략). 도착 노드 상태로 애니메이션.
  refs.links.push({ from: main.box, to: usage.box, nodeId: mainNode.id, p: path(svg, "link") });
  for (const n of workers) {
    refs.links.push({ from: usage.box, to: refs.items.get(n.id).box, nodeId: n.id, p: path(svg, "link") });
    if (latestJudge) refs.links.push({ from: refs.items.get(n.id).box, to: refs.items.get(latestJudge.id).box, nodeId: latestJudge.id, p: path(svg, "link") });
  }
  return refs;
}

function layoutLinks(container, refs) {
  const cr = container.getBoundingClientRect();
  refs.svg.setAttribute("width", String(container.scrollWidth));
  refs.svg.setAttribute("height", String(container.scrollHeight));
  for (const l of refs.links) {
    const a = l.from.getBoundingClientRect();
    const b = l.to.getBoundingClientRect();
    const x1 = a.left + a.width / 2 - cr.left + container.scrollLeft;
    const y1 = a.bottom - cr.top + container.scrollTop;
    const x2 = b.left + b.width / 2 - cr.left + container.scrollLeft;
    const y2 = b.top - cr.top + container.scrollTop;
    const my = (y1 + y2) / 2;
    l.p.setAttribute("d", `M ${x1} ${y1} C ${x1} ${my}, ${x2} ${my}, ${x2} ${y2}`);
  }
}

const observers = new WeakMap();

export function renderFlow(container, run, nowMs) {
  let refs = container._refs;
  if (!refs || refs.sig !== signature(run)) {
    refs = rebuild(container, run);
    container._refs = refs;
    if (!observers.has(container) && typeof ResizeObserver !== "undefined") {
      const ro = new ResizeObserver(() => { if (container._refs) layoutLinks(container, container._refs); });
      ro.observe(container);
      observers.set(container, ro);
    }
  }
  const byId = new Map(run.nodes.map((n) => [n.id, n]));
  for (const [id, item] of refs.items) {
    const n = byId.get(id);
    if (n) item.set(n, run, nowMs);
  }
  refs.usage.set(run);
  for (const l of refs.links) {
    const n = byId.get(l.nodeId);
    l.p.setAttribute("class", `link ${n && n.status === "running" ? "running" : ""}`.trim());
  }
  layoutLinks(container, refs);
}
