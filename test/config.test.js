import test from "node:test";
import assert from "node:assert/strict";
import { loadConfig } from "../src/config.js";

test("정수 옵션 검증 실패", () => {
  for (const v of ["-1", "70000", "1.5", "1e3", "", "80abc"]) {
    assert.throws(() => loadConfig(["--port", v]), { message: `invalid value for --port: ${v}` }, `port ${v}`);
  }
  for (const v of ["0", "1.5", "x"]) {
    assert.throws(() => loadConfig(["--poll-ms", v]), { message: `invalid value for --poll-ms: ${v}` }, `poll ${v}`);
  }
  assert.throws(() => loadConfig(["--port"]), /missing value for --port/);
});

test("host 는 루프백만", () => {
  for (const v of ["0.0.0.0", "192.168.0.1"]) {
    assert.throws(() => loadConfig(["--host", v]), { message: `--host must be a loopback address (127.0.0.1, localhost, ::1): ${v}` });
  }
  assert.equal(loadConfig(["--host", "::1"]).host, "::1");
});

test("유효한 경계값", () => {
  assert.equal(loadConfig(["--port", "0"]).port, 0);
  assert.equal(loadConfig(["--port", "65535"]).port, 65535);
  assert.equal(loadConfig(["--poll-ms", "1"]).pollMs, 1);
});

// ---- 보강: 경계값 / R4 반례 ----

test("포트 경계: 0, 1, 65535 통과 / 65536 이상 거부", () => {
  assert.equal(loadConfig(["--port", "0"]).port, 0);
  assert.equal(loadConfig(["--port", "1"]).port, 1);
  assert.equal(loadConfig(["--port", "65535"]).port, 65535);
  for (const v of ["65536", "99999", "100000"]) {
    assert.throws(() => loadConfig(["--port", v]), { message: `invalid value for --port: ${v}` }, v);
  }
});

test("정수 파서: parseInt/Number 로는 통과하는 입력을 모두 거부한다 (R4 반례)", () => {
  const loose = ["80abc", "12abc", "1e3", "0x50", "+80", "-0", " 80", "80 ", "8 0", "8.0", "80.", ".5", "Infinity", "NaN"];
  for (const v of loose) {
    assert.throws(() => loadConfig(["--port", v]), { message: `invalid value for --port: ${v}` }, `port ${JSON.stringify(v)}`);
    assert.throws(() => loadConfig(["--poll-ms", v]), { message: `invalid value for --poll-ms: ${v}` }, `poll ${JSON.stringify(v)}`);
  }
});

test("poll-ms 경계: 0 거부, 1 통과, 큰 값 통과, 안전 정수 초과 거부", () => {
  assert.throws(() => loadConfig(["--poll-ms", "0"]), { message: "invalid value for --poll-ms: 0" });
  assert.equal(loadConfig(["--poll-ms", "1"]).pollMs, 1);
  assert.equal(loadConfig(["--poll-ms", "3600000"]).pollMs, 3600000);
  assert.throws(() => loadConfig(["--poll-ms", "99999999999999999999"]));
  // setInterval 한계(2^31-1) 초과 시 타이머가 1ms 로 돌아가므로 거부
  assert.equal(loadConfig(["--poll-ms", "2147483647"]).pollMs, 2147483647);
  assert.throws(() => loadConfig(["--poll-ms", "2147483648"]));
});

test("앞자리 0 은 /^\\d+$/ 를 통과하므로 10진 정수로 해석된다", () => {
  assert.equal(loadConfig(["--port", "0080"]).port, 80);
  assert.equal(loadConfig(["--port", "00"]).port, 0);
});

test("모든 옵션의 값 누락, 다음 옵션을 값으로 삼키는 경우", () => {
  for (const opt of ["--port", "--host", "--projects-root", "--judge-types", "--poll-ms"]) {
    assert.throws(() => loadConfig([opt]), { message: `missing value for ${opt}` }, opt);
  }
  assert.throws(() => loadConfig(["--port", "--host", "::1"]), { message: "invalid value for --port: --host" });
});

test("알 수 없는 인자/위치 인자는 unknown option", () => {
  assert.throws(() => loadConfig(["--nope"]), { message: "unknown option: --nope" });
  assert.throws(() => loadConfig(["8080"]), { message: "unknown option: 8080" });
});

test("host: 루프백 3종만 정확히 일치 (대소문자 구분)", () => {
  for (const v of ["127.0.0.1", "localhost", "::1"]) assert.equal(loadConfig(["--host", v]).host, v);
  for (const v of ["LOCALHOST", "127.0.0.2", "::", "[::1]", "localhost ", "", "example.com"]) {
    assert.throws(() => loadConfig(["--host", v]), { message: `--host must be a loopback address (127.0.0.1, localhost, ::1): ${v}` }, JSON.stringify(v));
  }
});

test("judge-types: trim, 빈 항목 제거, 빈 결과 허용", () => {
  assert.deepEqual(loadConfig(["--judge-types", " a , b,,c "]).judgeAgentTypes, ["a", "b", "c"]);
  assert.deepEqual(loadConfig(["--judge-types", ","]).judgeAgentTypes, []);
  assert.deepEqual(loadConfig(["--judge-types", ""]).judgeAgentTypes, []);
});

test("기본값, projects-root 미검사, DEFAULTS 불변", async () => {
  const { DEFAULTS } = await import("../src/config.js");
  const snapshot = JSON.stringify(DEFAULTS);
  const mutated = loadConfig(["--judge-types", "x"]);
  mutated.judgeAgentTypes.push("y");
  const d = loadConfig([]);
  assert.equal(JSON.stringify(DEFAULTS), snapshot);
  assert.equal(d.port, 8770);
  assert.equal(d.pollMs, 750);
  assert.equal(d.host, "127.0.0.1");
  assert.equal(typeof d.projectsRoot, "string");
  assert.ok(d.projectsRoot.length > 0);
  assert.deepEqual(d.judgeAgentTypes, ["judge", "reviewer", "verifier", "tester", "security-reviewer"]);
  assert.equal(loadConfig(["--projects-root", "Z:/does/not/exist"]).projectsRoot, "Z:/does/not/exist");
});

test("limitsFile 기본값은 defaultLimitsFile() (R15)", async () => {
  const { defaultLimitsFile } = await import("../src/core/limits.js");
  assert.equal(loadConfig([]).limitsFile, defaultLimitsFile());
});
