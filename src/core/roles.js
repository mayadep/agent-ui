export function classifyRole(agentType, judgeAgentTypes) {
  const t = String(agentType ?? "").toLowerCase();
  const set = (judgeAgentTypes ?? []).map((s) => String(s).toLowerCase());
  return t && set.includes(t) ? "judge" : "worker";
}
