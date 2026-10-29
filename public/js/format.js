const pad = (n) => String(n).padStart(2, "0");

export function fmtClock(iso) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "--:--:--";
  return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

export function fmtElapsed(ms) {
  const s = Math.max(0, Math.floor((Number(ms) || 0) / 1000));
  if (s < 60) return `${s}s`;
  if (s < 3600) return `${Math.floor(s / 60)}m ${pad(s % 60)}s`;
  return `${Math.floor(s / 3600)}h ${pad(Math.floor((s % 3600) / 60))}m`;
}

export function fmtTokens(n) {
  let v = Number(n);
  if (!Number.isFinite(v) || v < 0) v = 0;
  if (v < 1000) return String(Math.floor(v));
  const k = (v / 1000).toFixed(1);
  // 반올림 결과가 1000.0 이 되는 값(999950 이상)은 M 단위로 승격한다
  if (Number(k) < 1000) return `${k}k`;
  return `${(v / 1e6).toFixed(2)}M`;
}

// 리셋까지 남은 시간. 일 단위까지 표시한다(fmtElapsed 는 일 단위를 쓰지 않음).
export function fmtCountdown(ms) {
  let v = Number(ms);
  if (!Number.isFinite(v) || v < 0) v = 0;
  const s = Math.floor(v / 1000);
  if (s < 60) return `${s}s`;
  if (s < 3600) return `${Math.floor(s / 60)}m ${pad(s % 60)}s`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ${pad(Math.floor((s % 3600) / 60))}m`;
  return `${Math.floor(s / 86400)}d ${pad(Math.floor((s % 86400) / 3600))}h`;
}
