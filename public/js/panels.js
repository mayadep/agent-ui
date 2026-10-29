import { h } from "./dom.js";
import { fmtElapsed, fmtTokens } from "./format.js";
import { buildLimits, limitView } from "./limits.js";

const LEGEND = [
  ["goal", "goal / condition"],
  ["main", "main agent"],
  ["judge", "judge"],
  ["worker", "worker"],
];

export function renderHeader(el, run) {
  const title = h("div", "h-title");
  title.append(h("span", "h-name", run.title ?? `session ${run.sessionId.slice(0, 8)}`), h("span", "h-key", run.projectKey));
  const legend = h("div", "legend");
  for (const [role, label] of LEGEND) {
    const item = h("span", "legend-item");
    const sw = h("i", "swatch");
    sw.style.background = `var(--c-${role})`;
    item.append(sw, h("span", null, label));
    legend.append(item);
  }
  el.replaceChildren(title, legend);
}

function row(label, value, cls) {
  const r = h("div", "g-row");
  r.append(h("span", "g-label", label), h("span", `g-value${cls ? " " + cls : ""}`, value));
  return r;
}

export function renderGoal(el, run, nowMs, limitsResp) {
  const main = run.nodes[0];
  const kids = [];
  kids.push(h("div", "g-head", "THE GOAL"));
  kids.push(h("div", "g-turn", `turn ${main.turns} · ${main.model ? main.model.label : "model n/a"}`));

  kids.push(h("div", "g-text", run.goal ? run.goal.text : "n/a"));
  if (run.currentPrompt && run.goal && run.currentPrompt.text !== run.goal.text) {
    kids.push(h("div", "g-latest", `latest: ${run.currentPrompt.text}`));
  }

  kids.push(row("turns", String(main.turns)));
  kids.push(row("tokens", fmtTokens(run.totals.tokens)));
  kids.push(buildLimits(limitView(limitsResp ?? { status: "loading", limits: null }, nowMs)));
  const v = run.verdict;
  kids.push(row("verdict", v.status, `v-${v.status.replace(/\s/g, "-")}`));
  if (v.text) kids.push(h("div", "g-sub", v.text));

  let running = "n/a";
  if (main.status === "running" && run.currentPrompt?.ts) {
    running = fmtElapsed(nowMs - Date.parse(run.currentPrompt.ts));
  } else if (main.status === "idle" && run.lastActivityAt) {
    running = `idle · last activity ${fmtElapsed(nowMs - Date.parse(run.lastActivityAt))} ago`;
  }
  kids.push(row("running", running));

  const judge = run.verdict.judgeId ? run.nodes.find((n) => n.id === run.verdict.judgeId) : null;
  kids.push(h("div", "g-judge", judge ? `judge: ${judge.model ? judge.model.label : "model n/a"} · ${judge.agentType ?? "n/a"}` : "judge: n/a"));
  el.replaceChildren(...kids);
}
