import { h } from "./dom.js";
import { fmtCountdown } from "./format.js";

/** @typedef {{ status: 'loading'|'ok'|'missing'|'invalid'|'error', limits: object|null }} LimitsResp */

export const LIMIT_WARN_REMAINING = 20; // 잔여 % 가 이 값 미만이면 warn(주황)
export const LIMIT_DANGER_REMAINING = 10; // 잔여 % 가 이 값 미만이면 danger(빨강)
export const LIMITS_STALE_MS = 15 * 60 * 1000; // updatedAtMs 가 이보다 오래되면 stale
export const LIMITS_POLL_MS = 5000; // app.js 의 /api/limits 폴링 주기
export const LIMIT_ROWS = [{ key: "five_hour", label: "5h" }, { key: "seven_day", label: "7d" }];
export const LIMIT_NOTES = {
  loading: "limits: loading…",
  missing: "limits n/a · Pro/Max only, shown after first response",
  invalid: "limits n/a · limits file unreadable",
  error: "limits n/a · request failed",
  empty: "limits n/a · no window data yet",
};

const STATUSES = ["loading", "ok", "missing", "invalid", "error"];
const isNum = (v) => typeof v === "number" && Number.isFinite(v);
const isObj = (v) => v !== null && typeof v === "object";

const naRow = ({ key, label }, usedText) => ({
  key, label, state: "na", level: "none", fillPct: 0, valueText: "n/a", usedText, resetText: "",
});

function windowRow(row, w, nowMs) {
  const { key, label } = row;
  if (!isObj(w) || !isNum(w.usedPercentage) || !isNum(w.resetsAtMs)) return naRow(row, "no data");
  if (nowMs >= w.resetsAtMs) {
    return { key, label, state: "expired", level: "none", fillPct: 0, valueText: "reset", usedText: "window reset", resetText: "awaiting update" };
  }
  const c = Math.min(100, Math.max(0, w.usedPercentage));
  const remaining = 100 - c;
  const remainingPct = Math.floor(remaining);
  const usedPct = 100 - remainingPct;
  const level = remaining < LIMIT_DANGER_REMAINING ? "danger" : remaining < LIMIT_WARN_REMAINING ? "warn" : "normal";
  return {
    key, label, state: "ok", level, fillPct: c, // 막대는 사용한 만큼 왼쪽에서 오른쪽으로 차오른다
    valueText: `${remainingPct}% left`,
    usedText: `used ${usedPct}%`,
    resetText: `resets in ${fmtCountdown(w.resetsAtMs - nowMs)}`,
  };
}

// 순수 함수. 항상 LIMIT_ROWS 순서의 행 2개를 돌려준다.
export function limitView(resp, nowMs) {
  let status;
  if (resp === undefined) status = "loading";
  else if (!isObj(resp) || !STATUSES.includes(resp.status) || !Number.isFinite(nowMs)) status = "error";
  else if (resp.status === "ok" && !isObj(resp.limits)) status = "invalid";
  else status = resp.status;

  if (status !== "ok") {
    return { rows: LIMIT_ROWS.map((r) => naRow(r, "")), note: LIMIT_NOTES[status], stale: false };
  }
  const limits = resp.limits;
  const rows = LIMIT_ROWS.map((r) => windowRow(r, limits[r.key], nowMs));
  const age = nowMs - limits.updatedAtMs;
  const updatedKnown = isNum(limits.updatedAtMs);
  const stale = updatedKnown ? age > LIMITS_STALE_MS : true;
  let note = null;
  if (stale) note = updatedKnown ? `as of ${fmtCountdown(age)} ago` : "as of unknown";
  else if (rows.every((r) => r.state === "na")) note = LIMIT_NOTES.empty;
  return { rows, note, stale };
}

export function buildLimits(view) {
  const root = h("div", view.stale ? "g-limits stale" : "g-limits");
  for (const r of view.rows) {
    const el = h("div", `lim lv-${r.level} ls-${r.state}`);
    const top = h("div", "lim-top");
    const track = h("span", "lim-track");
    const fill = h("span", "lim-fill");
    fill.style.width = `${r.fillPct}%`;
    track.append(fill);
    top.append(h("span", "lim-label", r.label), track, h("span", "lim-val", r.valueText));
    const sub = h("div", "lim-sub");
    sub.append(h("span", "lim-used", r.usedText), h("span", "lim-reset", r.resetText));
    el.append(top, sub);
    root.append(el);
  }
  if (view.note) root.append(h("div", "lim-note", view.note));
  return root;
}
