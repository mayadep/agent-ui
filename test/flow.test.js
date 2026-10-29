import test from "node:test";
import assert from "node:assert/strict";
import { pickJudge } from "../public/js/flow.js";

const node = (id, role) => ({ id, role });

test("pickJudge", () => {
  const run = {
    nodes: [node("main", "main"), node("j1", "judge"), node("w1", "worker"), node("j2", "judge")],
    verdict: { judgeId: "j2", status: "done", text: "ok" },
  };
  const r = pickJudge(run);
  assert.equal(r.latest.id, "j2");
  assert.equal(r.previous, 1);
  assert.deepEqual(
    pickJudge({ nodes: [node("main", "main"), node("w1", "worker")], verdict: { judgeId: null, status: "n/a", text: null } }),
    { latest: null, previous: 0 },
  );
});
