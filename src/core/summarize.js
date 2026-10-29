import path from "node:path";

export function clip(text, max) {
  const s = String(text ?? "").replace(/\s+/g, " ").trim();
  if (s.length <= max) return s;
  return s.slice(0, Math.max(0, max - 1)) + "…";
}

function host(url) {
  try { return new URL(String(url)).host; } catch { return clip(url, 40); }
}

function base(p) {
  return path.basename(String(p ?? "").replace(/\\/g, "/"));
}

export function summarizeToolUse(name, input) {
  const i = input && typeof input === "object" ? input : {};
  let s;
  if (name === "Bash" || name === "PowerShell") s = "$ " + clip(i.command, 60);
  else if (name === "Read" || name === "Write" || name === "Edit") s = `${name} ${base(i.file_path)}`;
  else if (name === "Grep") s = "Grep " + clip(i.pattern, 40);
  else if (name === "Glob") s = "Glob " + String(i.pattern ?? "");
  else if (name === "Agent" || name === "Task") s = "spawn " + (i.subagent_type ?? "agent") + ": " + clip(i.description ?? "", 40);
  else if (name === "WebFetch") s = "WebFetch " + host(i.url);
  else if (name === "WebSearch") s = "WebSearch " + clip(i.query, 40);
  else {
    const m = String(name ?? "").match(/^mcp__(.+?)__(.+)$/);
    s = m ? `${m[1]}.${m[2]}` : String(name ?? "");
  }
  return clip(s, 80);
}

export function parseTaskNotification(text) {
  if (typeof text !== "string" || !text.includes("<task-notification>")) return null;
  const tag = (t) => {
    const m = text.match(new RegExp(`<${t}>([\\s\\S]*?)</${t}>`));
    return m ? m[1].trim() : null;
  };
  const taskId = tag("task-id");
  const status = tag("status");
  if (!taskId || !status) return null;
  return { taskId, toolUseId: tag("tool-use-id"), status, summary: tag("summary") ?? "" };
}

function contentOf(record) {
  return record?.message?.content;
}

export function promptText(record) {
  const c = contentOf(record);
  let t = "";
  if (typeof c === "string") t = c;
  else if (Array.isArray(c)) t = c.filter((b) => b && b.type === "text" && typeof b.text === "string").map((b) => b.text).join("\n");
  return t
    .replace(/<system-reminder>[\s\S]*?<\/system-reminder>/g, "")
    .replace(/\[(?:Image|Pasted text) #\d+[^\]]*\]/g, "") // 첨부 자리표시자
    .replace(/[ \t]{2,}/g, " ")
    .trim();
}

export function isHumanPrompt(record) {
  if (!record || record.type !== "user") return false;
  if (record.isMeta === true || record.isSidechain === true) return false;
  if (record.origin?.kind === "task-notification") return false;
  const c = contentOf(record);
  if (typeof c !== "string" && !(Array.isArray(c) && c.some((b) => b && b.type === "text"))) return false;
  const t = promptText(record);
  if (!t) return false;
  return !["<task-notification", "<command-", "<local-command-", "<system-reminder"].some((p) => t.startsWith(p));
}
