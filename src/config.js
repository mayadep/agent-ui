import { defaultProjectsRoot } from "./core/paths.js";
import { defaultLimitsFile } from "./core/limits.js";
import { defaultAgentsDir } from "./core/agents.js";

export const DEFAULTS = {
  host: "127.0.0.1",
  port: 8770,
  projectsRoot: null, // null → defaultProjectsRoot()
  pollMs: 750,
  pushThrottleMs: 300,
  staleAfterMs: 30 * 60 * 1000,
  idleWatcherMs: 60 * 1000,
  maxEvents: 2000,
  snapshotEvents: 300,
  judgeAgentTypes: ["judge", "reviewer", "verifier", "tester", "security-reviewer"],
  limitsFile: null, // null → defaultLimitsFile() (CLI 옵션 없음, 경로 고정)
  agentsDir: null, // null → defaultAgentsDir() (CLI 옵션 없음, 경로 고정)
};

const LOOPBACK_HOSTS = ["127.0.0.1", "localhost", "::1"];

// 정수 옵션: /^\d+$/ 를 먼저 통과해야 한다(parseInt("80abc"), Number("1e3") 같은 느슨한 파싱 금지).
function intOption(name, v, min, max = Infinity) {
  if (v === undefined) throw new Error(`missing value for ${name}`);
  const n = typeof v === "string" && /^\d+$/.test(v) ? Number(v) : NaN;
  if (!Number.isSafeInteger(n) || n < min || n > max) throw new Error(`invalid value for ${name}: ${v}`);
  return n;
}

function str(name, v) {
  if (v === undefined) throw new Error(`missing value for ${name}`);
  return v;
}

export function loadConfig(argv = []) {
  const cfg = { ...DEFAULTS, judgeAgentTypes: [...DEFAULTS.judgeAgentTypes] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const v = argv[i + 1];
    switch (a) {
      case "--port": cfg.port = intOption(a, v, 0, 65535); i++; break;
      case "--host": {
        const host = str(a, v);
        if (!LOOPBACK_HOSTS.includes(host)) {
          throw new Error(`--host must be a loopback address (${LOOPBACK_HOSTS.join(", ")}): ${host}`);
        }
        cfg.host = host;
        i++;
        break;
      }
      case "--projects-root": cfg.projectsRoot = str(a, v); i++; break;
      case "--judge-types":
        cfg.judgeAgentTypes = str(a, v).split(",").map((s) => s.trim()).filter(Boolean);
        i++;
        break;
      // 상한 2^31-1: setInterval 한계를 넘으면 타이머가 1ms 로 돌아가 버린다
      case "--poll-ms": cfg.pollMs = intOption(a, v, 1, 2 ** 31 - 1); i++; break;
      default: throw new Error(`unknown option: ${a}`);
    }
  }
  if (cfg.projectsRoot === null) cfg.projectsRoot = defaultProjectsRoot();
  if (cfg.limitsFile === null) cfg.limitsFile = defaultLimitsFile();
  if (cfg.agentsDir === null) cfg.agentsDir = defaultAgentsDir();
  return cfg;
}
