import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { parseModel } from "./models.js";
import { classifyRole } from "./roles.js";

const DESC_MAX = 200;

export function defaultAgentsDir() {
  return path.join(os.homedir(), ".claude", "agents");
}

// 프런트매터의 `key: value` 한 줄 값만 읽는다(등록 목록 표시에는 name/description/model 이면 충분).
export function parseFrontmatter(text) {
  const m = String(text).match(/^---\r?\n([\s\S]*?)\r?\n---/);
  const out = {};
  if (!m) return out;
  for (const line of m[1].split(/\r?\n/)) {
    const kv = line.match(/^([A-Za-z_-]+):\s*(.*)$/);
    if (kv) out[kv[1]] = kv[2].trim();
  }
  return out;
}

// 사용자가 등록한 에이전트(`~/.claude/agents/*.md`) 목록. 읽을 수 없으면 빈 배열.
export function listAgents(dir, judgeAgentTypes) {
  let names = [];
  try { names = fs.readdirSync(dir); } catch { return []; }
  const out = [];
  for (const n of names.sort()) {
    if (!n.endsWith(".md")) continue;
    let fm;
    try { fm = parseFrontmatter(fs.readFileSync(path.join(dir, n), "utf8")); } catch { continue; }
    const name = fm.name || n.slice(0, -3);
    const model = parseModel(fm.model);
    out.push({
      name,
      role: classifyRole(name, judgeAgentTypes),
      description: (fm.description ?? "").slice(0, DESC_MAX),
      model: model ? { family: model.family, label: model.label } : null,
    });
  }
  return out;
}
