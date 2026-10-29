import fs from "node:fs";
import os from "node:os";
import path from "node:path";

/** @typedef {{ usedPercentage: number, resetsAtMs: number }} LimitWindow */
/** @typedef {{ updatedAtMs: number, five_hour: LimitWindow|null, seven_day: LimitWindow|null }} Limits */
/** @typedef {{ status: 'ok'|'missing'|'invalid', limits: Limits|null }} LimitsResult */

export const LIMIT_KEYS = ["five_hour", "seven_day"];
export const MAX_LIMITS_FILE_BYTES = 64 * 1024;

const isObj = (v) => v !== null && typeof v === "object" && !Array.isArray(v);
const isNum = (v) => typeof v === "number" && Number.isFinite(v);
const MISSING = { status: "missing", limits: null };
const INVALID = { status: "invalid", limits: null };

export function defaultLimitsFile() {
  return path.join(os.homedir(), ".claude", "agent-ui", "rate-limits.json");
}

export function normalizeLimits(obj) {
  if (!isObj(obj) || obj.version !== 1 || !isNum(obj.updatedAtMs) || !(obj.updatedAtMs > 0)) return null;
  const out = { updatedAtMs: obj.updatedAtMs };
  for (const key of LIMIT_KEYS) {
    const w = obj[key];
    out[key] = isObj(w) && isNum(w.usedPercentage) && isNum(w.resetsAtMs) && w.resetsAtMs > 0
      ? { usedPercentage: w.usedPercentage, resetsAtMs: w.resetsAtMs }
      : null;
  }
  return out;
}

// 한도 파일 읽기 전용 리더. 요청이 올 때만 stat 하고 mtime:size 가 바뀌었을 때만 다시 읽는다.
export class LimitsReader {
  constructor(file) {
    this.file = file;
    this.key = null;
    this.last = null;
  }

  #missing() {
    this.key = null;
    this.last = { ...MISSING };
    return this.last;
  }

  read() {
    try {
      let st;
      try {
        st = fs.statSync(this.file);
      } catch (err) {
        if (err?.code === "ENOENT" || err?.code === "ENOTDIR") return this.#missing();
        return this.last ?? { ...INVALID };
      }
      const key = `${st.mtimeMs}:${st.size}`;
      if (!st.isFile() || st.size > MAX_LIMITS_FILE_BYTES) {
        this.key = key;
        this.last = { ...INVALID };
        return this.last;
      }
      if (this.key === key && this.last) return this.last;
      let text;
      try {
        text = fs.readFileSync(this.file, "utf8");
      } catch (err) {
        if (err?.code === "ENOENT") return this.#missing();
        return this.last ?? { ...INVALID }; // rename 경합 등: key 를 갱신하지 않아 다음 요청에 재시도
      }
      let result;
      try {
        const limits = normalizeLimits(JSON.parse(text.replace(/^﻿/, "")));
        result = limits ? { status: "ok", limits } : { ...INVALID };
      } catch {
        result = { ...INVALID };
      }
      this.key = key;
      this.last = result;
      return result;
    } catch {
      return this.last ?? { ...INVALID };
    }
  }
}
