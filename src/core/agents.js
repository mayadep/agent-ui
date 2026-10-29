import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { parseModel } from "./models.js";
import { classifyRole } from "./roles.js";

const DESC_MAX = 200;

export function defaultAgentsDir() {
  return path.join(os.homedir(), ".claude", "agents");
}

function unquote(v) {
  const m = v.match(/^(["'])(.*)\1$/);
  return m ? m[2] : v;
}

// 프런트매터의 `key: value` 값을 읽는다. 양끝 따옴표 한 쌍은 벗기고, `|`/`>` 블록 값은 들여쓴 다음 줄들을 공백으로 이어 붙인다.
export function parseFrontmatter(text) {
  const m = String(text).match(/^---\r?\n([\s\S]*?)\r?\n---/);
  const out = {};
  if (!m) return out;
  const lines = m[1].split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const kv = lines[i].match(/^([A-Za-z_-]+):\s*(.*)$/);
    if (!kv) continue;
    let value = kv[2].trim();
    if (/^[|>][+-]?$/.test(value)) {
      const parts = [];
      while (i + 1 < lines.length && /^\s+\S/.test(lines[i + 1])) parts.push(lines[++i].trim());
      value = parts.join(" ");
    }
    out[kv[1]] = unquote(value);
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
