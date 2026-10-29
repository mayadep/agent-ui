import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { listSessions } from "../src/core/paths.js";

const KB = 1024;
const line = (o) => JSON.stringify(o) + "\n";
const filler = (bytes) => line({ type: "user", pad: "x".repeat(bytes) });

function setup(content) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "agent-ui-paths-"));
  fs.mkdirSync(path.join(root, "P"));
  fs.writeFileSync(path.join(root, "P", "33333333-3333-4333-8333-333333333333.jsonl"), content);
  return root;
}

test("listSessions: 64 KiB head/tail 만 읽는다", () => {
  const first = line({ type: "user", cwd: "C:/a" });
  const mid = line({ type: "ai-title", aiTitle: "mid" });
  const last = line({ type: "ai-title", aiTitle: "last" });
  const big = first + filler(80 * KB) + mid + filler(200 * KB) + last;
  const root = setup(big);
  try {
    const [s] = listSessions(root);
    assert.equal(s.title, "last");
    assert.equal(s.cwd, "C:/a");
  } finally { fs.rmSync(root, { recursive: true, force: true }); }

  const onlyMid = setup(first + filler(80 * KB) + mid + filler(200 * KB));
  try {
    assert.equal(listSessions(onlyMid)[0].title, null);
  } finally { fs.rmSync(onlyMid, { recursive: true, force: true }); }

  const small = setup(first + mid);
  try {
    const [s] = listSessions(small);
    assert.equal(s.title, "mid");
    assert.equal(s.cwd, "C:/a");
  } finally { fs.rmSync(small, { recursive: true, force: true }); }
});


// ---- 보강: 경계값 ----

test("listSessions: 64 KiB 경계 (정확히 64 KiB 는 head 만, 1바이트 초과도 tail 1바이트만)", () => {
  const first = line({ type: "user", cwd: "C:/a" }) + line({ type: "ai-title", aiTitle: "head-title" });
  // 정확히 64 KiB 가 되도록 패딩 (마지막은 개행 포함 줄)
  const padLine = (n) => line({ type: "user", pad: "x".repeat(n) });
  let body = first;
  const overhead = padLine(0).length;
  body += padLine(64 * KB - body.length - overhead);
  assert.equal(Buffer.byteLength(body), 64 * KB);
  const exact = setup(body);
  try {
    const [s] = listSessions(exact);
    assert.equal(s.sizeBytes, 64 * KB);
    assert.equal(s.title, "head-title");
    assert.equal(s.cwd, "C:/a");
  } finally { fs.rmSync(exact, { recursive: true, force: true }); }

  // 64 KiB + 마지막 title: 파일이 64KiB 를 넘으면 tail 에서 마지막 title 이 head 의 것을 덮어쓴다
  const over = setup(body + line({ type: "ai-title", aiTitle: "tail-title" }));
  try {
    assert.equal(listSessions(over)[0].title, "tail-title");
  } finally { fs.rmSync(over, { recursive: true, force: true }); }
});

test("listSessions: 빈 root/없는 root/잘못된 이름은 무시, limit 과 mtime 내림차순", () => {
  assert.deepEqual(listSessions(path.join(os.tmpdir(), "agent-ui-no-such-root-xyz")), []);
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "agent-ui-paths-"));
  try {
    assert.deepEqual(listSessions(root), []);
    fs.mkdirSync(path.join(root, "P"));
    fs.mkdirSync(path.join(root, "bad name"));
    fs.writeFileSync(path.join(root, "bad name", "33333333-3333-4333-8333-333333333333.jsonl"), "");
    fs.writeFileSync(path.join(root, "P", "not-a-uuid.jsonl"), "");
    fs.writeFileSync(path.join(root, "P", "33333333-3333-4333-8333-333333333333.txt"), "");
    const ids = ["aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", "cccccccc-cccc-4ccc-8ccc-cccccccccccc"];
    ids.forEach((id, i) => {
      const f = path.join(root, "P", `${id}.jsonl`);
      fs.writeFileSync(f, line({ type: "user", cwd: "C:/x" }));
      const t = new Date(Date.UTC(2026, 0, 1, 0, 0, i));
      fs.utimesSync(f, t, t);
    });
    assert.deepEqual(listSessions(root).map((s) => s.sessionId), [ids[2], ids[1], ids[0]]);
    assert.deepEqual(listSessions(root, 2).map((s) => s.sessionId), [ids[2], ids[1]]);
    assert.deepEqual(listSessions(root, 0), []);
    assert.equal(listSessions(root, 1)[0].title, null);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test("isValidProjectKey / isValidSessionId / sessionFiles / listSubagents 경계", async () => {
  const p = await import("../src/core/paths.js");
  for (const k of [".", "..", "", "a/b", "a\\b", "a b", "a".repeat(201), "한글"]) assert.equal(p.isValidProjectKey(k), false, JSON.stringify(k));
  for (const k of ["D--demo", "a", "a".repeat(200), "x.y_z-1", "..a"]) assert.equal(p.isValidProjectKey(k), true, k);
  const good = "11111111-1111-4111-8111-111111111111";
  assert.equal(p.isValidSessionId(good), true);
  assert.equal(p.isValidSessionId(good.toUpperCase()), true);
  for (const s of ["", good + "0", good.slice(1), good.replace(/-/g, ""), "../" + good, good.replace("1", "g")]) assert.equal(p.isValidSessionId(s), false, s);
  assert.throws(() => p.sessionFiles("/r", "..", good), { message: "invalid session" });
  assert.throws(() => p.sessionFiles("/r", "P", "x"), { message: "invalid session" });
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "agent-ui-paths-"));
  try {
    assert.deepEqual(p.listSubagents(path.join(root, "missing")), []);
    fs.writeFileSync(path.join(root, "agent-ok_1.jsonl"), "");
    fs.writeFileSync(path.join(root, "agent-ok_1.meta.json"), "{}");
    fs.writeFileSync(path.join(root, "agent-ok_1.prefix.json"), "{}");
    fs.writeFileSync(path.join(root, "agent-.jsonl"), "");
    fs.writeFileSync(path.join(root, "other.jsonl"), "");
    fs.writeFileSync(path.join(root, "agent-a.b.jsonl"), "");
    assert.deepEqual(p.listSubagents(root).map((s) => s.agentId), ["ok_1"]);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});
