import test from "node:test";
import assert from "node:assert/strict";
import { parseModel } from "../src/core/models.js";
import { loadConfig } from "../src/config.js";

test("parseModel examples", () => {
  assert.equal(parseModel("claude-opus-5-5").label, "opus 5.5");
  assert.equal(parseModel("claude-haiku-5-5").label, "haiku 5.5");
  assert.equal(parseModel("claude-sonnet-4-5-20250929").label, "sonnet 4.5");
  assert.equal(parseModel("claude-3-5-haiku-20241022").label, "haiku 3.5");
  const g = parseModel("gpt-x");
  assert.equal(g.family, "unknown");
  assert.equal(g.label, "gpt-x");
});

test("parseModel null cases", () => {
  assert.equal(parseModel(null), null);
  assert.equal(parseModel(undefined), null);
  assert.equal(parseModel(""), null);
  assert.equal(parseModel("<synthetic>"), null);
});

test("parseModel variant", () => {
  const m = parseModel("claude-opus-5-5[1m]");
  assert.equal(m.family, "opus");
  assert.equal(m.version, "5.5");
  assert.equal(m.label, "opus 5.5");
  assert.equal(m.variant, "1m");
});

test("loadConfig", () => {
  assert.throws(() => loadConfig(["--port", "x"]));
  assert.throws(() => loadConfig(["--nope"]));
  assert.throws(() => loadConfig(["--host", "0.0.0.0"]));
  assert.equal(loadConfig(["--host", "localhost"]).host, "localhost");
  const c = loadConfig(["--port", "0", "--judge-types", "a,b"]);
  assert.equal(c.port, 0);
  assert.deepEqual(c.judgeAgentTypes, ["a", "b"]);
  assert.equal(c.host, "127.0.0.1");
});
