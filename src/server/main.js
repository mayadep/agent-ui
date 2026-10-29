import { loadConfig } from "../config.js";
import { createServer } from "./http.js";

let cfg;
try {
  cfg = loadConfig(process.argv.slice(2));
} catch (err) {
  console.error(`agent-ui: ${err.message}`);
  process.exit(1);
}

const server = createServer(cfg);
server.on("error", (err) => {
  console.error(`agent-ui: ${err.message}`);
  process.exit(1);
});
server.listen(cfg.port, cfg.host, () => {
  const { address, port } = server.address();
  const host = address.includes(":") ? `[${address}]` : address;
  console.log(`agent-ui: http://${host}:${port}`);
  console.log(`agent-ui: projects root ${cfg.projectsRoot}`);
});

function shutdown() {
  server.close(() => process.exit(0));
  server.closeAllConnections?.();
  setTimeout(() => process.exit(0), 1000).unref();
}
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
