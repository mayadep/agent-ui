import test from "node:test";
import assert from "node:assert/strict";
import { clip, summarizeToolUse, parseTaskNotification, isHumanPrompt, promptText } from "../src/core/summarize.js";
import { classifyRole } from "../src/core/roles.js";

test("clip", () => {
  assert.equal(clip("a\n  b", 10), "a b");
  assert.equal(clip("abcdef", 4), "abc…");
});

test("summarizeToolUse", () => {
  assert.equal(summarizeToolUse("Bash", { command: "ls -la" }), "$ ls -la");
  assert.equal(summarizeToolUse("PowerShell", { command: "dir" }), "$ dir");
  assert.equal(summarizeToolUse("Read", { file_path: "D:\\a\\b\\c.js" }), "Read c.js");
  assert.equal(summarizeToolUse("Edit", { file_path: "/a/b.js" }), "Edit b.js");
  assert.equal(summarizeToolUse("Grep", { pattern: "foo" }), "Grep foo");
  assert.equal(summarizeToolUse("Glob", { pattern: "**/*.js" }), "Glob **/*.js");
  assert.equal(summarizeToolUse("Agent", { subagent_type: "reviewer", description: "check" }), "spawn reviewer: check");
  assert.equal(summarizeToolUse("WebFetch", { url: "https://example.com/x" }), "WebFetch example.com");
  assert.equal(summarizeToolUse("WebSearch", { query: "q" }), "WebSearch q");
  assert.equal(summarizeToolUse("mcp__neon__run_sql", {}), "neon.run_sql");
  assert.equal(summarizeToolUse("Other", {}), "Other");
  assert.ok(summarizeToolUse("Bash", { command: "x".repeat(500) }).length <= 80);
});

const NOTE = '<task-notification><task-id>abc123</task-id><tool-use-id>toolu_1</tool-use-id><status>failed</status><summary>Agent "x" failed: boom</summary></task-notification>';

test("parseTaskNotification", () => {
  assert.deepEqual(parseTaskNotification(NOTE), { taskId: "abc123", toolUseId: "toolu_1", status: "failed", summary: 'Agent "x" failed: boom' });
  assert.equal(parseTaskNotification("hello"), null);
  assert.equal(parseTaskNotification("<task-notification><status>x</status></task-notification>"), null);
});

test("isHumanPrompt", () => {
  const u = (content, extra = {}) => ({ type: "user", message: { content }, ...extra });
  assert.equal(isHumanPrompt(u("hello")), true);
  assert.equal(isHumanPrompt(u([{ type: "text", text: "hi" }])), true);
  assert.equal(isHumanPrompt(u("hi <system-reminder>x</system-reminder>")), true);
  assert.equal(promptText(u("hi <system-reminder>x</system-reminder>")), "hi");
  assert.equal(promptText(u("참조할것 첨부 [Image #1]")), "참조할것 첨부");
  assert.equal(promptText(u("a [Image #2] b")), "a b");
  assert.equal(isHumanPrompt(u(NOTE, { origin: { kind: "task-notification" } })), false);
  assert.equal(isHumanPrompt(u(NOTE)), false);
  assert.equal(isHumanPrompt(u([{ type: "tool_result", content: "x" }])), false);
  assert.equal(isHumanPrompt(u("hello", { isMeta: true })), false);
  assert.equal(isHumanPrompt(u("hello", { isSidechain: true })), false);
  assert.equal(isHumanPrompt(u("<command-name>/x</command-name>")), false);
  assert.equal(isHumanPrompt(u("<local-command-stdout>x")), false);
  assert.equal(isHumanPrompt(u("<system-reminder>only</system-reminder>")), false);
  assert.equal(isHumanPrompt({ type: "assistant", message: { content: "x" } }), false);
});

test("classifyRole", () => {
  const j = ["judge", "reviewer"];
  assert.equal(classifyRole("Reviewer", j), "judge");
  assert.equal(classifyRole("implementer", j), "worker");
  assert.equal(classifyRole(null, j), "worker");
});

test("promptText 자리표시자 제거", () => {
  const u = (content) => ({ type: "user", message: { content } });
  assert.equal(promptText(u("fix [Image #1] this [Pasted text #2 +40 lines] now")), "fix this now");
  assert.equal(promptText(u("[Image #1]")), "");
  assert.equal(isHumanPrompt(u("[Image #1]")), false);
});


// ---- 보강: 경계값 ----

test("summarize 경계: clip 정확히 max / max 초과 / 빈 입력, tool 요약 누락 입력", () => {
  assert.equal(clip("abcd", 4), "abcd");
  assert.equal(clip("abcde", 4), "abc…");
  assert.equal(clip("", 5), "");
  assert.equal(clip("   ", 5), "");
  assert.equal(clip("a   \n\t b", 10), "a b");
  assert.equal(clip(undefined, 5), "");
  assert.doesNotThrow(() => summarizeToolUse("Bash", {}));
  assert.doesNotThrow(() => summarizeToolUse("Read", {}));
  assert.doesNotThrow(() => summarizeToolUse("Agent", {}));
  assert.doesNotThrow(() => summarizeToolUse("WebFetch", { url: "not a url" }));
  assert.equal(summarizeToolUse("Agent", {}), "spawn agent:");
  assert.equal(summarizeToolUse("Task", { subagent_type: "x", description: "y" }), "spawn x: y");
  assert.ok(summarizeToolUse("WebFetch", { url: "not a url" }).startsWith("WebFetch "));
  assert.equal(summarizeToolUse("Read", { file_path: "C:\\a\\b\\c.txt" }), "Read c.txt");
});

test("promptText 자리표시자: 대소문자 구분, 배열 content, 개행 유지 후 공백 압축, 변형 입력", () => {
  const u = (content) => ({ type: "user", message: { content } });
  assert.equal(promptText(u("[image #1] keep")), "[image #1] keep"); // 대소문자 구분
  assert.equal(promptText(u("[Image #12] a")), "a");
  assert.equal(promptText(u("a [Pasted text #3] b")), "a b");
  assert.equal(promptText(u("a [Pasted text #3 +400 lines]\nb")), "a \nb");
  assert.equal(promptText(u([{ type: "text", text: "x [Image #1]" }, { type: "text", text: "y" }])), "x \ny");
  assert.equal(promptText(u("[Image #1][Image #2]")), "");
  assert.equal(isHumanPrompt(u("[Image #1] [Image #2]")), false);
  assert.equal(isHumanPrompt(u("[Image #1] hello")), true);
  assert.equal(promptText(u("a\t\t b")), "a b");
});
