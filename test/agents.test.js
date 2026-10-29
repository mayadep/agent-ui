import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { listAgents, parseFrontmatter } from "../src/core/agents.js";

const JUDGES = ["judge", "reviewer", "verifier", "tester"];

test("parseFrontmatter: 한 줄 key/value, 프런트매터 없으면 빈 객체", () => {
  assert.deepEqual(parseFrontmatter("---\nname: a\r\nmodel: claude-opus-5-5\n---\nbody: x"), { name: "a", model: "claude-opus-5-5" });
  assert.deepEqual(parseFrontmatter("no frontmatter"), {});
});

test("listAgents: 이름순, 역할·모델 분류, 이름 없으면 파일명, 비 md 무시", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "agent-ui-agents-"));
  fs.writeFileSync(path.join(dir, "reviewer.md"), "---\nname: reviewer\ndescription: 검토\nmodel: claude-opus-5-5\n---\n");
  fs.writeFileSync(path.join(dir, "coder.md"), "---\ndescription: d\n---\n");
  fs.writeFileSync(path.join(dir, "notes.txt"), "x");
  const list = listAgents(dir, JUDGES);
  assert.deepEqual(list.map((a) => a.name), ["coder", "reviewer"]);
  assert.equal(list[0].role, "worker");
  assert.equal(list[0].model, null);
  assert.equal(list[1].role, "judge");
  assert.deepEqual(list[1].model, { family: "opus", label: "opus 5.5" });
});

test("listAgents: 디렉터리가 없으면 빈 배열", () => {
  assert.deepEqual(listAgents(path.join(os.tmpdir(), "agent-ui-no-such-dir"), JUDGES), []);
});

test("parseFrontmatter: 따옴표 값은 벗기고 | > 블록 값은 이어 붙인다", () => {
  const fm = parseFrontmatter('---\nname: "my-agent"\ndescription: |\n  첫 줄\n  둘째 줄\nmodel: \'opus\'\ntools: >-\n  Read,\n  Grep\nnext: x\n---\n');
  assert.equal(fm.name, "my-agent");
  assert.equal(fm.description, "첫 줄 둘째 줄");
  assert.equal(fm.model, "opus");
  assert.equal(fm.tools, "Read, Grep");
  assert.equal(fm.next, "x");
});

test("listAgents: description 은 200자로 자르고 읽을 수 없는 항목은 건너뛴다", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "agent-ui-agents-"));
  fs.writeFileSync(path.join(dir, "long.md"), `---\nname: long\ndescription: ${"가".repeat(500)}\n---\n`);
  fs.mkdirSync(path.join(dir, "dir.md")); // 파일이 아니라 디렉터리 → 읽기 실패
  const list = listAgents(dir, JUDGES);
  assert.deepEqual(list.map((a) => a.name), ["long"]);
  assert.equal(list[0].description.length, 200);
});
