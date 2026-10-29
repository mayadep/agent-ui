import fs from "node:fs";
import { FileTailer } from "./tailer.js";
import { createRunState, applyRecord, applyMeta, toRunView, recentEvents } from "./reducer.js";
import { sessionFiles, listSubagents } from "./paths.js";

const STALE_RECHECK_MS = 5000;

export class SessionWatcher {
  constructor({ root, projectKey, sessionId, cfg }) {
    this.cfg = cfg;
    this.projectKey = projectKey;
    this.sessionId = sessionId;
    this.files = sessionFiles(root, projectKey, sessionId);
    this.subscribers = new Set();
    this.timer = null;
    this.idleTimer = null;
    this.pushTimer = null;
    this.lastPushAt = 0;
    this.lastRunJson = null;
    this.pendingEvents = [];
    this.onIdle = null;
    this.lastPollError = null;
    this.#resetState();
  }

  #resetState() {
    this.state = createRunState(this.projectKey, this.sessionId);
    this.mainTailer = new FileTailer(this.files.main);
    this.subs = new Map(); // agentId → { tailer, metaMtime }
  }

  start() {
    if (this.timer) return;
    this.poll();
    let sinceStaleCheck = 0;
    this.timer = setInterval(() => {
      this.poll();
      sinceStaleCheck += this.cfg.pollMs;
      if (sinceStaleCheck >= STALE_RECHECK_MS) {
        sinceStaleCheck = 0;
        this.#guard(() => this.#pushIfRunChanged());
      }
    }, this.cfg.pollMs);
    this.timer.unref?.();
  }

  stop() {
    if (this.timer) clearInterval(this.timer);
    if (this.idleTimer) clearTimeout(this.idleTimer);
    if (this.pushTimer) clearTimeout(this.pushTimer);
    this.timer = this.idleTimer = this.pushTimer = null;
    this.subscribers.clear();
  }

  snapshot() {
    return {
      run: toRunView(this.state, Date.now(), this.cfg),
      events: recentEvents(this.state, this.cfg.snapshotEvents),
    };
  }

  subscribe(fn) {
    this.subscribers.add(fn);
    if (this.idleTimer) { clearTimeout(this.idleTimer); this.idleTimer = null; }
    return () => {
      this.subscribers.delete(fn);
      if (this.subscribers.size === 0) this.armIdleTimer();
    };
  }

  armIdleTimer() {
    if (this.idleTimer || !this.onIdle) return;
    this.idleTimer = setTimeout(() => {
      this.idleTimer = null;
      if (this.subscribers.size === 0) this.onIdle();
    }, this.cfg.idleWatcherMs);
    this.idleTimer.unref?.();
  }

  // 어떤 예외도 타이머 밖으로 내보내지 않는다. 같은 메시지는 1회만 로그, 복구 시 1회 로그.
  #guard(fn, isPoll = false) {
    try {
      fn();
      if (isPoll && this.lastPollError !== null) {
        console.error(`agent-ui: poll recovered for ${this.projectKey}/${this.sessionId}`);
        this.lastPollError = null;
      }
    } catch (err) {
      const msg = String(err?.message ?? err);
      if (msg !== this.lastPollError) {
        console.error(`agent-ui: poll failed for ${this.projectKey}/${this.sessionId}: ${msg}`);
        this.lastPollError = msg;
      }
    }
  }

  poll() {
    this.#guard(() => {
      const out = { changed: false, reset: false, newEvents: [] };
      try {
        this.#pollOnce(out);
      } catch (err) {
        // 실패 전까지 적용된 레코드의 이벤트는 대기열에 남겨 다음 flush 에 포함한다
        if (!out.reset) this.#queue(out);
        throw err;
      }
      if (out.reset) {
        this.#resetState();
        this.lastRunJson = null;
        this.pendingEvents = [];
        try {
          // 처음부터 다시 읽어 상태 재구축(새 이벤트는 snapshot 에 포함)
          this.#pollOnce({ changed: false, reset: false, newEvents: [] });
        } finally {
          this.#emit({ type: "reset" });
        }
        return;
      }
      this.#queue(out);
    }, true);
  }

  #queue(out) {
    if (!out.changed) return;
    this.pendingEvents.push(...out.newEvents);
    this.#schedulePush();
  }

  #pollOnce(out) {
    const st = this.state;
    const cfg = this.cfg;
    const take = (r) => {
      if (r.changed) out.changed = true;
      out.newEvents.push(...r.newEvents);
    };

    const m = this.mainTailer.readNew();
    if (m.reset) { out.reset = true; return out; }
    for (const rec of m.records) take(applyRecord(st, rec, { kind: "main" }, cfg));

    for (const f of listSubagents(this.files.subagentDir)) {
      let s = this.subs.get(f.agentId);
      if (!s) {
        s = { tailer: new FileTailer(f.jsonl), metaMtime: -1 };
        this.subs.set(f.agentId, s);
      }
      let mt = -1;
      try { mt = fs.statSync(f.meta).mtimeMs; } catch { /* meta 없음 */ }
      if (mt >= 0 && mt !== s.metaMtime) {
        s.metaMtime = mt;
        try {
          take(applyMeta(st, f.agentId, JSON.parse(fs.readFileSync(f.meta, "utf8")), cfg));
        } catch { s.metaMtime = -1; /* 쓰는 도중일 수 있어 다음 poll 에 재시도 */ }
      }
    }

    const ids = [...this.subs.keys()].sort();
    for (const id of ids) {
      const r = this.subs.get(id).tailer.readNew();
      if (r.reset) { out.reset = true; return out; }
      for (const rec of r.records) take(applyRecord(st, rec, { kind: "subagent", agentId: id }, cfg));
    }
    return out;
  }

  #schedulePush() {
    if (this.pushTimer) return;
    const wait = Math.max(0, this.lastPushAt + this.cfg.pushThrottleMs - Date.now());
    this.pushTimer = setTimeout(() => {
      this.pushTimer = null;
      this.#guard(() => this.#flush());
    }, wait);
    this.pushTimer.unref?.();
  }

  #flush() {
    // run 계산이 성공한 뒤에 대기열을 비운다(예외 시 이벤트 유실 방지)
    const run = toRunView(this.state, Date.now(), this.cfg);
    const newEvents = this.pendingEvents;
    this.pendingEvents = [];
    this.lastPushAt = Date.now();
    this.lastRunJson = JSON.stringify(run);
    this.#emit({ type: "update", run, newEvents });
  }

  #pushIfRunChanged() {
    if (this.subscribers.size === 0 || this.pushTimer) return;
    const run = toRunView(this.state, Date.now(), this.cfg);
    const json = JSON.stringify(run);
    if (json === this.lastRunJson) return;
    this.lastRunJson = json;
    this.lastPushAt = Date.now();
    const newEvents = this.pendingEvents;
    this.pendingEvents = [];
    this.#emit({ type: "update", run, newEvents });
  }

  #emit(msg) {
    for (const fn of [...this.subscribers]) {
      try { fn(msg); } catch { /* 구독자 오류는 다른 구독자에 영향 없음 */ }
    }
  }
}

const watchers = new Map();

export function getWatcher(root, projectKey, sessionId, cfg) {
  const key = `${root}\0${projectKey}\0${sessionId}`;
  let w = watchers.get(key);
  if (!w) {
    w = new SessionWatcher({ root, projectKey, sessionId, cfg });
    w.onIdle = () => { w.stop(); if (watchers.get(key) === w) watchers.delete(key); };
    watchers.set(key, w);
    w.start();
    w.armIdleTimer();
  }
  return w;
}
