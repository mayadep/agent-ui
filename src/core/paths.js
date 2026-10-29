import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const CHUNK = 64 * 1024;

export function defaultProjectsRoot() {
  return path.join(os.homedir(), ".claude", "projects");
}

export function isValidProjectKey(key) {
  return typeof key === "string" && /^[A-Za-z0-9._-]{1,200}$/.test(key) && key !== "." && key !== "..";
}

export function isValidSessionId(id) {
  return typeof id === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id);
}

function readEdges(file, size) {
  const fd = fs.openSync(file, "r");
  try {
    const headLen = Math.min(CHUNK, size);
    const head = Buffer.alloc(headLen);
    fs.readSync(fd, head, 0, headLen, 0);
    let tail = Buffer.alloc(0);
    if (size > CHUNK) {
      const tailLen = Math.min(CHUNK, size - CHUNK);
      tail = Buffer.alloc(tailLen);
      fs.readSync(fd, tail, 0, tailLen, size - tailLen);
    }
    return { head: head.toString("utf8"), tail: tail.toString("utf8") };
  } finally {
    fs.closeSync(fd);
  }
}

function extractMeta(file, size) {
  let title = null;
  let cwd = null;
  let edges;
  try { edges = readEdges(file, size); } catch { return { title, cwd }; }
  const scan = (text, wantCwd) => {
    for (const line of text.split("\n")) {
      if (!line.includes('"ai-title"') && !(wantCwd && line.includes('"cwd"'))) continue;
      let r;
      try { r = JSON.parse(line); } catch { continue; }
      if (r && r.type === "ai-title" && typeof r.aiTitle === "string") title = r.aiTitle;
      if (wantCwd && cwd === null && typeof r?.cwd === "string") cwd = r.cwd;
    }
  };
  // 앞 구간에서 cwd 와 (있으면) title, 뒤 구간에서 마지막 title 로 덮어쓴다.
  scan(edges.head, true);
  if (size > CHUNK) scan(edges.tail, cwd === null);
  return { title, cwd };
}

export function listSessions(root, limit = 30) {
  const out = [];
  let projects = [];
  try { projects = fs.readdirSync(root, { withFileTypes: true }); } catch { return []; }
  for (const p of projects) {
    if (!p.isDirectory() || !isValidProjectKey(p.name)) continue;
    let files = [];
    try { files = fs.readdirSync(path.join(root, p.name), { withFileTypes: true }); } catch { continue; }
    for (const f of files) {
      if (!f.isFile() || !f.name.endsWith(".jsonl")) continue;
      const sessionId = f.name.slice(0, -".jsonl".length);
      if (!isValidSessionId(sessionId)) continue;
      const file = path.join(root, p.name, f.name);
      let st;
      try { st = fs.statSync(file); } catch { continue; }
      out.push({ projectKey: p.name, sessionId, file, mtimeMs: st.mtimeMs, sizeBytes: st.size });
    }
  }
  out.sort((a, b) => b.mtimeMs - a.mtimeMs);
  return out.slice(0, limit).map(({ file, ...s }) => ({
    projectKey: s.projectKey,
    sessionId: s.sessionId,
    ...extractMeta(file, s.sizeBytes),
    mtimeMs: s.mtimeMs,
    sizeBytes: s.sizeBytes,
  }));
}

export function sessionFiles(root, projectKey, sessionId) {
  if (!isValidProjectKey(projectKey) || !isValidSessionId(sessionId)) throw new Error("invalid session");
  const dir = path.join(root, projectKey);
  return {
    main: path.join(dir, `${sessionId}.jsonl`),
    subagentDir: path.join(dir, sessionId, "subagents"),
  };
}

export function listSubagents(subagentDir) {
  let names = [];
  try { names = fs.readdirSync(subagentDir); } catch { return []; }
  const out = [];
  for (const n of names) {
    const m = n.match(/^agent-([A-Za-z0-9_-]+)\.jsonl$/);
    if (!m) continue;
    out.push({
      agentId: m[1],
      jsonl: path.join(subagentDir, n),
      meta: path.join(subagentDir, `agent-${m[1]}.meta.json`),
    });
  }
  return out;
}
