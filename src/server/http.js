import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { listSessions, sessionFiles, isValidProjectKey, isValidSessionId } from "../core/paths.js";
import { getWatcher } from "../core/session-watcher.js";
import { LimitsReader, defaultLimitsFile } from "../core/limits.js";
import { listAgents, defaultAgentsDir } from "../core/agents.js";

const PUBLIC_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "public");
const TYPES = { ".js": "text/javascript", ".css": "text/css", ".html": "text/html" };
const PING_MS = 15000;

function sendJson(res, status, body) {
  const data = JSON.stringify(body);
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    "Content-Length": Buffer.byteLength(data),
  });
  res.end(data);
}

function sendFile(res, file) {
  const type = TYPES[path.extname(file).toLowerCase()];
  let data;
  if (!type) return sendJson(res, 404, { error: "not found" });
  try { data = fs.readFileSync(file); } catch { return sendJson(res, 404, { error: "not found" }); }
  res.writeHead(200, { "Content-Type": `${type}; charset=utf-8`, "Cache-Control": "no-store", "Content-Length": data.length });
  res.end(data);
}

function decodeSegments(pathname) {
  try { return pathname.split("/").slice(1).map(decodeURIComponent); } catch { return null; }
}

// DNS rebinding 방어: Host 헤더가 실제 listen 포트를 포함한 루프백 3종과 정확히 일치해야 한다.
export function isAllowedHost(hostHeader, port) {
  if (typeof hostHeader !== "string") return false;
  return [`127.0.0.1:${port}`, `localhost:${port}`, `[::1]:${port}`].includes(hostHeader.trim().toLowerCase());
}

export function createServer(cfg) {
  const root = cfg.projectsRoot;
  const limitsReader = new LimitsReader(cfg.limitsFile ?? defaultLimitsFile());

  function resolveSession(res, projectKey, sessionId) {
    if (!isValidProjectKey(projectKey) || !isValidSessionId(sessionId)) {
      sendJson(res, 400, { error: "invalid session" });
      return null;
    }
    if (!fs.existsSync(sessionFiles(root, projectKey, sessionId).main)) {
      sendJson(res, 404, { error: "not found" });
      return null;
    }
    return getWatcher(root, projectKey, sessionId, cfg);
  }

  function handleStream(req, res, watcher) {
    res.writeHead(200, {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-store",
      Connection: "keep-alive",
    });
    const send = (event, data) => res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
    send("snapshot", watcher.snapshot());
    const unsubscribe = watcher.subscribe((msg) => {
      if (msg.type === "update") send("update", { run: msg.run, newEvents: msg.newEvents });
      else if (msg.type === "reset") send("snapshot", watcher.snapshot());
    });
    const ping = setInterval(() => res.write(": ping\n\n"), PING_MS);
    ping.unref?.();
    const done = () => { clearInterval(ping); unsubscribe(); };
    req.on("close", done);
    res.on("close", done);
  }

  function route(req, res) {
    if (req.method !== "GET") return sendJson(res, 405, { error: "method not allowed" });
    let url;
    try {
      url = new URL(req.url, "http://localhost");
    } catch {
      return sendJson(res, 400, { error: "bad request" });
    }
    const seg = decodeSegments(url.pathname);
    if (!seg) return sendJson(res, 400, { error: "bad request" });

    if (url.pathname === "/") return sendFile(res, path.join(PUBLIC_DIR, "index.html"));

    if (seg[0] === "static" && seg.length >= 2) {
      const file = path.resolve(PUBLIC_DIR, ...seg.slice(1));
      if (!file.startsWith(PUBLIC_DIR + path.sep)) return sendJson(res, 404, { error: "not found" });
      return sendFile(res, file);
    }

    if (seg[0] === "api") {
      if (seg[1] === "sessions" && seg.length === 2) {
        const n = Number(url.searchParams.get("limit"));
        const limit = Number.isFinite(n) && n > 0 ? Math.min(Math.floor(n), 200) : 30;
        return sendJson(res, 200, { sessions: listSessions(root, limit) });
      }
      if (seg[1] === "sessions" && seg[2] === "latest" && seg.length === 3) {
        const first = listSessions(root, 1)[0];
        if (!first) return sendJson(res, 404, { error: "no sessions" });
        return sendJson(res, 200, { projectKey: first.projectKey, sessionId: first.sessionId });
      }
      if (seg[1] === "agents" && seg.length === 2) {
        return sendJson(res, 200, { agents: listAgents(cfg.agentsDir ?? defaultAgentsDir(), cfg.judgeAgentTypes) });
      }
      if (seg[1] === "limits" && seg.length === 2) return sendJson(res, 200, limitsReader.read());
      if (seg[1] === "run" && (seg.length === 4 || (seg.length === 5 && seg[4] === "stream"))) {
        const watcher = resolveSession(res, seg[2], seg[3]);
        if (!watcher) return;
        if (seg.length === 5) return handleStream(req, res, watcher);
        return sendJson(res, 200, watcher.snapshot());
      }
    }
    return sendJson(res, 404, { error: "not found" });
  }

  const server = http.createServer((req, res) => {
    try {
      if (!isAllowedHost(req.headers.host, server.address()?.port)) {
        return sendJson(res, 403, { error: "forbidden host" });
      }
      route(req, res);
    } catch (err) {
      if (!res.headersSent) sendJson(res, 500, { error: "internal error" });
      else res.end();
      console.error("agent-ui: request failed:", err?.message ?? err);
    }
  });
  return server;
}
