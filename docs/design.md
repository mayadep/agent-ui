# agent-ui: Claude Code 에이전트 실행 뷰어 설계

> 상태: 확정 (2026-10-29, 사용자가 "알아서 결정하고 확정 후 구현" 지시. 8장 질문은 모두 설계안대로 채택. 같은 날 리뷰 반영 보강도 사용자 승인 하에 진행, 상태 유지. R14(메인 깨움 규칙)도 사용자가 승인한 규칙으로 보강, 상태 유지. R15(사용 한도 표시)는 사용자 요청 기능이며 settings.json `statusLine` 추가를 사용자가 명시적으로 승인함, 상태 유지. R16(judge 실행별 카드)·R17(등록 에이전트 목록)은 사용자 요청으로 이미 구현된 코드를 문서에 반영한 사후 보강이며 열린 질문이 없어 상태 유지)
> 작성: architect 에이전트 · 날짜: 2026-10-29
> 이 문서가 구현의 유일한 근거다. 여기 없는 내용은 구현자가 판단으로 채우지 않는다.

## 변경 이력: 2026-10-29 리뷰 반영

1~9단계 구현 완료 후 리뷰 결과와 실제 코드(`src/`, `public/`, `test/`)를 대조해 보강했다. 아래 항목은 7장 10단계(10a~10h)로 구현한다. "현 구현 반영" 표시 항목은 이미 코드에 있는 사실을 문서에 맞춘 것이라 코드 변경이 없다.

| # | 항목 | 바뀐 절 | 코드 변경 |
|---|---|---|---|
| R1 | session log 정렬을 **`ts` 오름차순(동률 seq)** 으로 뒤집음(기존 "ts 정렬 금지, seq 순" 폐기). ts 가 없거나 파싱 불가한 이벤트는 seq 순으로 직전 유효 키를 물려받음. 로그를 update 마다 통째로 다시 그리지 않고 `LogIndex` 로 append/삽입, snapshot 시에만 reset | 3.8, 3.11.1, 4, 5, 6, 7 | 있음(10a, 10b) |
| R2 | `Event.verdict` 는 `"done"`/`"failed"`/`null` 만. 판정 문구는 `Run.verdict.text` 에만 둔다(judge 의 agent_done 이벤트에 resultText 를 넣던 규칙 폐기) | 3.1, 3.5, 6 | 있음(10c) |
| R3 | HTTP Host 헤더 검증(허용 3종, 포트 필수, 실제 listen 포트와 비교, 불일치 403 JSON) | 3.9, 5 | 있음(10d) |
| R4 | 설정 검증: `--port` 0~65535 정수, `--poll-ms` 1 이상 정수, `--host` 루프백 3종만(현 구현 반영) | 3.10 | 있음(10e, port/poll-ms 부분) |
| R5 | `SessionWatcher.poll` 은 예외를 삼키고 로그만, 같은 메시지 반복 로그 금지, 복구 시 1회 로그 | 3.8 | 있음(10f) |
| R6 | `fmtTokens` 반올림 승격 규칙(999950 → `1.00M`) | 3.11 | 있음(10g) |
| R7 | `meta.finished` 로 completed 된 노드의 endedAt: 뷰에서 `endedAt ?? lastActivityAt` | 3.5, 4.1 | 있음(10c) |
| R8 | 모델 막대 값 표시를 `fmtTokens` 로 | 4.1 | 있음(10g) |
| R9 | `promptText` 의 `[Image #n]`/`[Pasted text #n]` 제거 규칙 | 3.4 | 없음(현 구현 반영) |
| R10 | `src/config.js` 가 `src/core/paths.js` 를 import, `public/js/dom.js` 모듈 존재, test 스크립트 `node --test "test/*.test.js"`, judge 선택 규칙과 `previous: N` 을 순수 함수 `pickJudge` 로 분리 | 2, 3.11 | `pickJudge` 만 있음(10g), 나머지 없음 |
| R11 | `Agent`/`Task` 호출은 `spawn` 이벤트 한 줄만(tool 이벤트 없음, text = `summarizeToolUse` 결과) | 3.5 | 없음(현 구현 반영) |
| R12 | 405/500 응답, watcher 생성 즉시 idle 타이머 가동 등 문서에 빠진 현 동작 기재 | 3.8, 3.9 | 없음(현 구현 반영) |
| R13 | 7장에 10단계(보강 구현)와 11단계(누락 테스트 목록) 추가 | 7 | 테스트 추가 |
| R14 | **메인 깨움 규칙**: 메인 소스의 비-`<synthetic>`·비-sidechain assistant 레코드, 또는 알려진 서브에이전트의 task-notification `user` 레코드도 main.status 를 `running` 으로 바꾸고 `turnEnded` 를 해제한다(기존에는 사람 프롬프트만). 그 턴의 `turn_duration`/`stop_hook_summary` 가 다시 `turn_end` 1회를 내고 idle 로 돌린다. 7장 12단계로 구현 | 1.2, 2, 3.5, 4.1, 5, 6, 7, 8 | 있음(12) |
| R15 | **사용 한도(5시간/주간) 표시**: statusLine 명령 스크립트(`scripts/statusline.mjs`)가 stdin JSON 의 `rate_limits` 만 파싱해 `~/.claude/agent-ui/rate-limits.json` 에 원자적으로 병합 저장하고 터미널 상태 줄에 잔여 % 한 줄을 출력. 서버는 그 파일을 읽기 전용으로 `GET /api/limits` 로 제공(Run/SSE 스키마 불변), 클라이언트가 5초 폴링 후 THE GOAL 패널 tokens 아래에 잔여 %·막대·리셋까지 시간 표시. `~/.claude/settings.json` 의 `statusLine` 키 추가는 사용자 승인 하에 **메인 에이전트**가 수행(구현자 범위 밖, 5장 규칙). 7장 13단계 | 1, 1.3, 2.1, 3.9, 3.10, 3.11, 3.12, 3.13, 3.14, 4, 4.1, 4.2, 5, 6, 7, 8 | 있음(13) |
| R16 | **judge 실행별 카드**: judge 도 워커 행에서 실행마다 카드 1개(역할 색 파란 테두리)로 그린다. 하단 단일 judge 박스, `pickJudge`, `previous: N`, `after turn N` 표시, 워커→judge 연결선, `test/flow.test.js` 제거. 연결선은 usage → 각 카드이고, 줄바꿈으로 내려간 카드는 바로 위 줄의 가장 가까운 카드에서 잇는다. 기본 `judgeAgentTypes` 에 `tester` 추가. 7장 14단계 | 1, 2, 2.2, 3.10, 3.11, 4.1, 5, 6, 7, 7.1, 8 | 있음(14, 이미 구현·커밋 `051bfc3`) |
| R17 | **등록 에이전트 목록**: 신규 `src/core/agents.js`(`~/.claude/agents/*.md` 프런트매터 읽기), 공개 API `GET /api/agents`, 설정 키 `agentsDir`, THE GOAL 패널 맨 아래 `REGISTERED AGENTS` 접기/펴기 목록. 기본 `judgeAgentTypes` 에 `security-reviewer` 추가(최종 기본값 `judge, reviewer, verifier, tester, security-reviewer`). 7장 15단계 | 1, 2.2, 3.9, 3.10, 3.11, 3.15, 3.16, 4.1, 4.4, 5, 6, 7, 7.4 | 있음(15, 이미 구현·커밋 `ca9ecc8` + 프런트매터 따옴표·블록 값 보강) |

### R16·R17 보강 배경 (2026-10-29, 사후 문서화)
- 두 기능 모두 사용자 요청으로 먼저 구현됐고(R16 커밋 `051bfc3`, R17 커밋 `ca9ecc8` 와 그 뒤 프런트매터 파서 보강), 이 절은 실제 코드(`src/core/agents.js`, `src/server/http.js`, `src/config.js`, `public/js/panels.js`, `public/js/app.js`, `public/js/flow.js`, 테스트)를 읽고 문서를 사실에 맞춘 것이다. 이 보강으로 생기는 코드 변경은 없다.
- R16 이 기존 설계와 충돌하는 부분(4.1 "최종 judge 박스", 연결선 "각 워커→judge", 3.11 `pickJudge`, 7.1 `test/flow.test.js`, 8장 "흐린 `judge: n/a` 박스")은 해당 절에서 정정했다. `Run.verdict`(3.1, 3.5 의 최신 judge 선택 규칙)는 그대로이며 THE GOAL 패널의 verdict/judge 줄이 계속 쓴다.
- 기존 설계의 기본 `judgeAgentTypes` 값 `["judge","reviewer","verifier"]` 는 코드와 달라 정정했다(3.10, 6).
- 문서 정리: 빠져 있던 `## 4. 데이터 흐름` 제목을 복구했다(내용 변경 없음, 3.16 다음).

### R14 보강 배경 (2026-10-29)
- 증상(실제 세션 화면에서 확인): 백그라운드 서브에이전트 완료 알림으로 메인이 깨어나 assistant 레코드를 계속 써도 메인 박스가 idle(글로우 없음)로 남고, 그 턴 끝의 `turn_duration`/`stop_hook_summary` 가 `turn_end` 이벤트를 만들지 않는다.
- 원인(`src/core/reducer.js` 확인): main.status 를 `running` 으로 바꾸고 `state.turnEnded = false` 로 되돌리는 곳이 `user` + `isHumanPrompt` 분기(206~207행) 하나뿐이다. `system` 분기(314~321행)는 `turnEnded` 가 이미 true 면 이벤트를 내지 않는다. 알림으로 시작된 턴은 사람 프롬프트가 없으므로 직전 턴의 `turnEnded = true` 가 그대로 남는다.
- 해결 범위: reducer 의 상태 전이 규칙만 바꾼다. Run/Event 스키마, 클라이언트, watcher 는 바꾸지 않는다.

### R15 보강 배경 (2026-10-29)
- 사용자 요청: 작업하면서 5시간 한도와 주간 한도의 **잔여량**과 **리셋까지 남은 시간**을 THE GOAL 패널에서 본다.
- 데이터 출처 제약(1.3): 한도 수치를 프로그램으로 얻는 공식 경로는 statusLine 명령의 stdin JSON 하나뿐이다. 트랜스크립트·훅 입력·OTEL·agent-dashboard 이벤트 파일에는 값이 없다(직접 확인). 따라서 기존 "settings.json 수정 금지"(1장 비목표, 5장)에 **이 기능 한정 예외**를 둔다. 사용자가 `statusLine` 키 추가를 명시적으로 승인했다(추가 전 백업 조건).
- 역할 분리: 구현자는 statusLine 스크립트, 서버 읽기 모듈, 화면만 만든다. `~/.claude/settings.json` 적용은 7장 13g 의 절차대로 **메인 에이전트가 사용자 승인 하에** 수행한다.
- 해결 범위: 신규 스크립트 1개, 서버 모듈 1개, 클라이언트 모듈 1개, 기존 `config.js`/`http.js`/`format.js`/`panels.js`/`app.js`/`styles.css` 소폭 변경. Run/Event/AgentNode 스키마, reducer, watcher, SSE 페이로드는 바꾸지 않는다.

## 1. 목적과 범위

- 해결할 문제: Claude Code 세션에서 메인 에이전트와 서브에이전트(병렬 워커, 검토자 등)가 어떤 모델로 무엇을 하고 있는지 한 화면에서 볼 수 없다. 로컬 세션 트랜스크립트를 읽어 레퍼런스 화면(어두운 터미널 스타일 플로우 다이어그램) 형태로 실시간 시각화한다.
- 포함:
  - 로컬 트랜스크립트(`~/.claude/projects/<projectKey>/<sessionId>.jsonl` + `<sessionId>/subagents/agent-<id>.jsonl` + `.meta.json`) 파싱
  - 파일 증분 읽기(폴링) → SSE 로 브라우저 푸시
  - 화면: 상단 타이틀/범례, 좌측 THE GOAL 패널, 중앙 플로우(메인 → 중간 레이어 → 서브에이전트 카드 행. R16 이후 judge 도 이 행에서 실행마다 카드 1개), 하단 session log
  - (R17) 사용자가 등록한 에이전트 목록(`~/.claude/agents/*.md`): `GET /api/agents` 와 THE GOAL 패널 맨 아래 `REGISTERED AGENTS` 접기/펴기 목록
  - 모든 노드에 모델 짧은 표시명(예: `opus 5.5`, `haiku 5.5`) 표시
  - 세션 선택(목록 API + 화면 상단 선택 박스)
  - (R15) 사용 한도 표시: 5시간·주간 한도의 잔여 %, 막대, 리셋까지 남은 시간(THE GOAL 패널). 데이터는 statusLine 스크립트가 기록한 `~/.claude/agent-ui/rate-limits.json`
- 비목표 (이번에 하지 않는 것):
  - Claude Code 훅 설치/설정 변경 (`~/.claude/settings.json` 수정 금지). **R15 예외**: `statusLine` 키 1개 추가만 허용, 사용자 승인 하에 메인 에이전트가 7장 13g 절차로 수행(구현자는 하지 않음), 규칙은 5장
  - (R15) 게이트웨이 전용 `rate_limits.spend_limit.*`, Claude Code 외 경로(claude.ai 웹, 비공식 usage API, OAuth 자격 증명 파일)로 한도 조회, 계정 여러 개 구분, 한도 이력/그래프
  - 에이전트 제어(중단, 메시지 전송 등) — 읽기 전용 뷰어다
  - 원격 접속, 인증, 다중 사용자
  - 과거 세션 통계/검색, 영구 저장소(DB)
  - 비용(USD) 표시 (`cost-state` 레코드는 세션 종료 시점에만 기록되어 실시간성이 없음)
  - 워커 진행률 % (로그에 근거 데이터가 없음, 6장 참조)
  - (R17) 프로젝트별 에이전트(`<project>/.claude/agents/`)와 플러그인 제공 에이전트는 등록 목록에 표시하지 않는다(사용자 전역 `~/.claude/agents/` 만). 등록 목록 폴링·변경 감지는 하지 않는다(페이지 로드 시 1회). 필요해지면 `src/core/limits.js` 의 `LimitsReader` 처럼 mtime 캐시를 둔다

### 1.1 현재 상태 요약
- 최초 설계 시점(2026-10-29) `D:\mayadep\agent-ui` 는 빈 프로젝트였다(git 저장소 아님, CLAUDE.md 없음). 현재 1~9단계 구현 완료, 테스트 6파일(`test/*.test.js`).
- 환경: Windows 10, Node.js v24.22.0 / npm 11.19.1 설치 확인(`node -v`, `npm -v`).
- 참고한 선행 작업: `D:\mayadep\graph-flow` (Python 표준 라이브러리 서버 + 훅 기반). 그 `notes.md` 에 "훅만으로는 서브에이전트 id ↔ Agent 호출 연결을 시작 순서로 **추정**해야 한다"는 한계가 기록돼 있다. 트랜스크립트에는 이 연결이 명시적으로 있으므로(1.2) 이번 설계는 트랜스크립트를 기본 소스로 한다. graph-flow 는 포트 8765/8766 을 쓰므로 충돌을 피한다. graph-flow 코드는 재사용/수정하지 않는다.

### 1.2 트랜스크립트 구조 (실제 파일로 확인한 근거)
조사 파일: `~/.claude/projects/C--Users-BEST-Desktop-mayadep-it-word/92a79dc4-...jsonl`(1134줄, 서브에이전트 14개), `~/.claude/projects/D--mayadep/5321e585-...jsonl`(haiku 서브에이전트 포함), 각 `subagents/` 폴더. 확인 스크립트는 조회 전용으로만 실행.

| 항목 | 관찰 결과 |
|---|---|
| 파일 위치 | 메인: `<root>/<projectKey>/<sessionId>.jsonl`. 서브에이전트: `<root>/<projectKey>/<sessionId>/subagents/agent-<agentId>.jsonl`, 같은 이름의 `.meta.json`, 일부는 `.prefix.json`(무시). `projectKey` 는 cwd 경로를 `-` 로 치환한 폴더명(예: `D--mayadep-agent-ui`). |
| 레코드 type | `user`, `assistant`, `attachment`, `system`(subtype: `turn_duration`, `stop_hook_summary`, `away_summary`), `queue-operation`, `last-prompt`, `ai-title`, `mode`, `permission-mode`, `file-history-*`, `cost-state`, `api-request*`, `atis-latch`, `tools-used`. 알 수 없는 type 이 계속 추가되는 형식이다. |
| 공통 필드 | `uuid`, `parentUuid`, `timestamp`(ISO8601 UTC), `sessionId`, `cwd`, `isSidechain`(메인 false/없음, 서브에이전트 파일은 true), 서브에이전트 레코드에는 `agentId`. |
| 모델 | `assistant.message.model` (관측값: `claude-opus-5-5`, `claude-sonnet-5-5`, `claude-haiku-5-5`, `<synthetic>`). `assistant.requestedModel` 은 `claude-opus-5-5[1m]` 처럼 컨텍스트 접미사가 붙을 수 있다. `<synthetic>` 은 실제 모델이 아니다. |
| 한 응답 = 여러 줄 | 같은 `message.id` 가 콘텐츠 블록(thinking/text/tool_use)마다 별도 줄로 기록된다. 실측: assistant 372줄 = 고유 `message.id` 157개, 한 id 최대 10줄. 각 줄에 `message.usage` 가 있다. |
| 토큰 | `message.usage`: `input_tokens`, `output_tokens`, `cache_read_input_tokens`, `cache_creation_input_tokens`. |
| 종료 사유 | `message.stop_reason`: `tool_use`, `end_turn`, `stop_sequence`. |
| 서브에이전트 생성 | 메인 assistant 의 `tool_use` 블록 `name: "Agent"`, `input: {description, subagent_type, prompt, run_in_background?}`. 바로 뒤 user 레코드의 `toolUseResult` = `{isAsync:true, status:"async_launched", agentId, description, resolvedModel:"claude-haiku-5-5", ...}` → **tool_use id ↔ agentId ↔ 모델이 시작 시점에 확정**된다. |
| 서브에이전트 메타 | `agent-<id>.meta.json` = `{agentType, description, toolUseId, spawnDepth, requestShape:"background", finished?:true}`. `toolUseId` 로 부모 Agent 호출과 직접 연결된다. `finished` 는 15개 파일에 없음(진행 중이거나 구버전). |
| 서브에이전트 종료 | 메인 파일에 `queue-operation`(operation `enqueue`) 과 `user` 레코드(`origin.kind:"task-notification"`)로 `<task-notification><task-id>{agentId}</task-id><tool-use-id>..</tool-use-id><status>completed|failed</status><summary>Agent "..." finished|failed: ...</summary>` 가 들어온다. 같은 task-id 로 여러 번 올 수 있다(재개 시). |
| 서브에이전트 최종 보고 | 서브에이전트 transcript 마지막 부근 `tool_use name:"SubagentHandback"`, `input.message`. |
| 권한 모드 | `user.permissionMode`(관측: `auto`, `default`, `plan`, `acceptEdits`), `permission-mode` 레코드. |
| 제목 | `ai-title.aiTitle`. |
| 턴 종료 | `system` subtype `turn_duration`(`durationMs`) 또는 `stop_hook_summary`. 둘 중 하나만 있는 세션도 있다. |
| 턴 순서 (R14 조사) | 로컬 메인 파일 96개 전수 조회(조회 전용 스크립트, 내용 미출력): 턴 종료 레코드 538건, 그중 두 subtype 이 연달아 오는 경우 119건. **턴 종료 레코드 뒤에 `user` 레코드 없이 비-synthetic assistant 가 오는 경우 0건**(턴 종료는 항상 그 턴의 마지막 assistant 뒤). 알림으로 깨는 턴의 순서: `system:turn_duration`(또는 `stop_hook_summary`) → `queue-operation:enqueue` → `queue-operation:dequeue` → `user`(`origin.kind:"task-notification"`) → `assistant` … → 턴 종료. 메인이 작업 중일 때 알림이 오면 같은 순서가 턴 중간(`user:tool_result` 뒤)에 끼어든다. 사람 프롬프트 `user` 레코드에는 `origin.kind:"human"` 이 붙은 경우도 있다. |
| `<synthetic>` assistant (R14 조사) | 관측 5건 전부 메인 파일·`isSidechain:false`. 내용은 `API Error: …`, `You've hit your session limit …`, `No response requested.` 같은 클라이언트 생성 문구이고 4건은 `isApiErrorMessage:true`. 이 레코드 뒤에는 턴 종료 레코드가 오지 않을 수 있다(알림 5건 연속 뒤 synthetic 1건 후 사람 프롬프트로 넘어간 세션 확인). |
| 미확인 | 동기(foreground) Agent 호출의 `toolUseResult` 형태 — 로컬 로그 전체에서 `async_launched` 23건만 관측되고 동기 결과는 0건. goal/judge/verdict 에 해당하는 레코드 type 은 없음(`grep` 결과 0건). |
| 파일 간 순서 | 메인 파일과 서브에이전트 파일은 따로 기록되고 서버는 파일 단위로 읽는다(메인 → 서브에이전트 사전순). 따라서 이벤트 생성 순서(seq)는 실제 시간 순서와 다르다. 예: judge 의 완료 알림(메인 파일)이 judge 의 SubagentHandback(서브에이전트 파일)보다 먼저 적용된다. |

### 1.3 사용 한도 데이터 출처 (R15)
근거: 공식 문서 https://code.claude.com/docs/en/statusline.md (2026-10-29 조회). 실계정 stdin 은 아직 확인하지 못했다(8장 R15 위험).

| 항목 | 내용 |
|---|---|
| 경로 | `settings.json` 의 `statusLine: { type: "command", command, padding?, refreshInterval? }`. Claude Code 가 명령을 실행하며 세션 JSON 을 stdin 으로 주고 stdout 을 상태 줄에 표시 |
| 필드 | `rate_limits.five_hour.used_percentage`(0~100, 소수 가능), `rate_limits.five_hour.resets_at`(Unix epoch **초**), `rate_limits.seven_day.used_percentage`, `rate_limits.seven_day.resets_at`. `session_id`(세션 고유). 문서 예시: five_hour `{used_percentage: 23.5, resets_at: 1738425600}`, seven_day `{used_percentage: 41.2, resets_at: 1738857600}` |
| 존재 조건 | claude.ai Pro/Max 구독자만, 세션의 첫 API 응답 이후만. 윈도우별로 독립적으로 없을 수 있고 `resets_at` 이 지나면 그 윈도우를 뺀다 |
| 실행 시점 | 세션 시작(재개 포함), 새 assistant 메시지, `/compact` 완료, 권한 모드 변경, vim 모드 토글, `command` 변경, `refreshInterval` 타이머, 마지막으로 받은 rate-limit 윈도우의 `resets_at` 도달. 300ms 디바운스. 실행 중 새 갱신이 오면 **실행 중인 스크립트를 취소**한다 |
| 출력 | 종료 코드 0 일 때만 stdout 표시. 0 이 아니거나 출력이 없으면 상태 줄이 빈다. 여러 줄은 여러 행 |
| Windows | Git Bash 가 있으면 Git Bash, 없으면 PowerShell 로 실행. `command` 안의 경로는 슬래시(`/`)로 쓴다(역슬래시는 Git Bash 가 삼킴) |
| 부작용 | 사용자 정의 상태 줄이 있으면 Claude Code 가 footer 의 키 힌트(`esc to interrupt`, `? for shortcuts` 등) 대부분을 숨긴다. 작업 공간 신뢰 전에는 실행되지 않는다 |
| 현재 설정 | `~/.claude/settings.json` 에 `statusLine` 키 없음(`hooks` 만 있음, 2026-10-29 확인) |

## 2. 모듈 구조

외부 의존성 0개. Node 24 표준 모듈(`node:http`, `node:fs`, `node:path`, `node:os`, `node:url`, `node:test`, `node:assert`)과 브라우저 표준 API 만 쓴다. 빌드 단계 없음. 모든 JS 는 ES 모듈(`"type": "module"`).

"10·12단계 변경" 열은 리뷰 반영(7장 10a~10h, 11)과 R14(7장 12단계)로 고칠 파일이다. 12단계에서 바뀌는 파일은 `src/core/reducer.js`, `test/reducer.test.js` 둘뿐이다. R15(13단계) 신규·변경 파일은 2.1 표에 따로 적는다.

| 모듈/파일 | 신규·변경 | 책임 | 의존 | 10·12단계 변경 |
|---|---|---|---|---|
| `package.json` | 신규 | `name: "agent-ui"`, `type: "module"`, `private: true`, `engines.node: ">=20"`, scripts `start: node src/server/main.js`, `test: node --test "test/*.test.js"` (Windows 셸에서 디렉터리 인자 대신 glob 을 따옴표로 넘겨 Node 가 펼치게 함). dependencies 없음 | - | 없음 |
| `src/config.js` | 신규 | 기본 설정 상수와 CLI 인자 병합·검증(`loadConfig`). `projectsRoot` 기본값을 위해 `defaultProjectsRoot` 를 import | `src/core/paths.js` | 있음(10e) |
| `src/core/models.js` | 신규 | model id → `ModelInfo` 변환(순수 함수) | - | 없음 |
| `src/core/roles.js` | 신규 | 서브에이전트 역할(worker/judge) 분류(순수 함수) | `src/config.js` 의 값(인자로 받음) | 없음 |
| `src/core/summarize.js` | 신규 | tool_use / 텍스트 → 한 줄 요약 문자열, 잘라내기, task-notification 파싱(순수 함수) | `node:path` | 없음 |
| `src/core/reducer.js` | 신규 | 레코드 스트림 → `RunState` 갱신(순수, 부수효과 없음). `toRunView` 로 직렬화용 `Run` 생성 | models, roles, summarize | 있음(10c, 12: 메인 깨움 규칙) |
| `src/core/tailer.js` | 신규 | 파일 하나의 증분 줄 읽기(바이트 오프셋, 잘린 줄 버퍼, 파일 축소 감지) | `node:fs` | 없음 |
| `src/core/paths.js` | 신규 | projects 루트 해석, 프로젝트/세션 목록, 이름 검증, 서브에이전트 파일 경로 | `node:fs`, `node:os`, `node:path` | 없음 |
| `src/core/session-watcher.js` | 신규 | 한 세션의 메인/서브에이전트 파일을 폴링 → reducer 적용 → 구독자에게 변경 통지 | tailer, reducer, paths | 있음(10f) |
| `src/server/http.js` | 신규 | Host 검증, 라우팅, 정적 파일, JSON API, SSE | session-watcher, paths | 있음(10d) |
| `src/server/main.js` | 신규 | 진입점: 설정 로드(실패 시 exit 1), 서버 기동, 종료 처리, 접속 URL 출력 | config, http | 없음 |
| `public/index.html` | 신규 | 터미널 창 크롬 + 4개 영역 골격 | - | 없음 |
| `public/styles.css` | 신규 | 다크 테마, 색상 CSS 변수(역할/모델 패밀리), 글로우/흐림/점선 애니메이션 | - | 없음 |
| `public/js/app.js` | 신규 | 세션 선택, SSE 연결/재연결, 클라이언트 상태 보관, 렌더 호출 | panels, flow, log | 있음(10b) |
| `public/js/dom.js` | 신규(문서 누락 반영) | DOM 생성 헬퍼 `h(tag, cls, text)`. 텍스트는 `textContent` 로만 | - | 없음 |
| `public/js/format.js` | 신규 | 시각(HH:MM:SS), 경과시간(`1m 05s`), 토큰(`12.3k`) 포맷(순수) | - | 있음(10g) |
| `public/js/panels.js` | 신규 | 헤더/범례, THE GOAL 패널 렌더 | dom, format | 없음 |
| `public/js/flow.js` | 신규 | 플로우 다이어그램(노드 박스, SVG 연결선, 애니메이션 상태) 렌더. (R16) `pickJudge` 제거, judge 도 카드로 | dom, format | 있음(10g, R16 14단계) |
| `public/js/log.js` | 신규 | session log: `LogIndex`(순수, 정렬 위치 계산) + DOM 반영(`resetLog`/`appendLog`), 자동 스크롤 | dom, format | 있음(10a) |
| `test/models.test.js` | 신규 | 모델 매핑, `loadConfig` 기본 케이스 | - | 없음 |
| `test/summarize.test.js` | 신규 | 요약/알림 파싱/역할 분류 테스트 | - | 있음(11: promptText) |
| `test/tailer.test.js` | 신규 | 증분 읽기 테스트(임시 파일) | - | 없음 |
| `test/reducer.test.js` | 신규 | 픽스처 → 기대 Run 비교 | fixtures | 있음(11, 12: 7.2 목록) |
| `test/http.test.js` | 신규 | API/SSE 통합 테스트(임시 projects 루트) | fixtures | 있음(11) |
| `test/format.test.js` | 신규 | `format.js` 단위 테스트, `sortEvents` | - | 있음(11) |
| `test/config.test.js` | 신규(11) | `loadConfig` 검증 규칙 | - | 신규 |
| `test/log.test.js` | 신규(11) | `LogIndex`, `sortEvents`, `eventTimeMs` | - | 신규 |
| `test/flow.test.js` | 신규(11) → **삭제(R16)** | `pickJudge` 테스트였으나 R16 에서 함수와 함께 삭제 | - | 삭제 |
| `test/watcher.test.js` | 신규(11) | `SessionWatcher` reset 경로, throttle 묶기, poll 예외, `getWatcher` idle 폐기 | fixtures | 신규 |
| `test/paths.test.js` | 신규(11) | `listSessions` 64 KiB head/tail | - | 신규 |
| `test/fixtures/projects/D--demo/11111111-1111-4111-8111-111111111111.jsonl` 외 `subagents/*` | 신규 | **손으로 작성한** 익명 픽스처(메인 1 + 워커 3 + reviewer 1, 모델 opus/sonnet/haiku 혼합, 실패 1건, `<synthetic>` 1건, 같은 message.id 다중 줄 포함) | - | 없음 |
| `docs/design.md` | 신규 | 이 문서 | - | - |

### 2.1 R15(13단계) 신규·변경 파일

외부 의존성 0개 원칙 유지. 아래 표에 없는 파일은 13단계에서 바꾸지 않는다(특히 `src/core/reducer.js`, `src/core/session-watcher.js`, `src/core/paths.js`, `public/js/flow.js`, `public/js/log.js`, 기존 픽스처).

| 모듈/파일 | 신규·변경 | 책임 | 의존 | 13단계 |
|---|---|---|---|---|
| `scripts/statusline.mjs` | 신규 | statusLine 명령. stdin JSON 읽기 → `rate_limits` 방어적 파싱 → 기존 파일과 병합 → `~/.claude/agent-ui/rate-limits.json` 원자적 쓰기 → 상태 줄 한 줄 출력, 항상 종료 코드 0. `--dump` 인자 시 stdin 원문을 별도 파일에 기록. 단일 파일, import 해도 부수효과 없음(3.12) | `node:fs`, `node:os`, `node:path`, `node:url` 만 | 13a |
| `src/core/limits.js` | 신규 | 한도 파일 경로 기본값, 저장 스키마 검증(`normalizeLimits`), stat 캐시 읽기(`LimitsReader`). 읽기 전용(3.13) | `node:fs`, `node:os`, `node:path` | 13c |
| `src/config.js` | 변경 | `DEFAULTS.limitsFile: null` 추가, `loadConfig` 가 null 이면 `defaultLimitsFile()` 로 채움. CLI 옵션은 추가하지 않음(3.10) | `src/core/limits.js` | 13d |
| `src/server/http.js` | 변경 | `createServer` 에서 `LimitsReader` 1개 생성, `GET /api/limits` 라우트(3.9) | `src/core/limits.js` | 13d |
| `public/js/format.js` | 변경 | `fmtCountdown(ms)` 추가(3.11) | - | 13e |
| `public/js/limits.js` | 신규 | 상수(임계값·폴링 주기·신선도), 순수 함수 `limitView`, DOM 생성 `buildLimits`(3.14). 모듈 최상위에서 `document` 접근 금지(Node 테스트 import) | dom, format | 13e |
| `public/js/panels.js` | 변경 | `renderGoal(el, run, nowMs, limitsResp)` 4번째 인자, tokens 행 바로 뒤에 `buildLimits(limitView(limitsResp, nowMs))` 삽입 | limits | 13f |
| `public/js/app.js` | 변경 | `limitsResp` 상태, `pollLimits()` 최초 1회 + `LIMITS_POLL_MS` 간격 폴링, `renderTick` 이 `renderGoal` 에 `limitsResp` 전달 | limits | 13f |
| `public/styles.css` | 변경 | `.g-limits`, `.lim-*` 클래스(4.1). 새 색 변수 없이 기존 변수 재사용 | - | 13f |
| `test/statusline.test.js` | 신규 | 스크립트 순수 함수, 원자적 쓰기, 자식 프로세스 실행(정상·부재·깨짐·한쪽·동시), end-to-end(스크립트 → 파일 → `/api/limits`) | fixtures | 13a, 13b |
| `test/limits.test.js` | 신규 | `normalizeLimits`, `LimitsReader` 캐시·부재·깨짐 | - | 13c |
| `test/limits-view.test.js` | 신규 | `limitView` 경계·임계값·만료·신선도·n/a 사유 | - | 13e |
| `test/format.test.js` | 변경 | `fmtCountdown` 경계 | - | 13e |
| `test/http.test.js` | 변경 | `/api/limits` 응답, Host 403 적용 확인. `cfg.limitsFile` 을 임시 경로로 지정 | - | 13d |
| `test/fixtures/statusline/input-docs.json` | 신규 | 공식 문서 예시 구조를 옮긴 **손으로 쓴** stdin(값: five_hour 23.5 / 1738425600, seven_day 41.2 / 1738857600, `session_id: "test-session-abc"`, 그 밖에 `model`, `workspace`, `context_window` 일부). 실계정 stdin 복사 금지 | - | 13b |
| `test/fixtures/statusline/input-five-hour-only.json` | 신규 | `rate_limits` 에 `five_hour` 만(30, 1738425600) | - | 13b |
| `test/fixtures/statusline/input-no-rate-limits.json` | 신규 | `rate_limits` 키 없음(API 키 사용자·첫 응답 전) | - | 13b |

### 2.2 R16(14단계)·R17(15단계) 신규·변경 파일

외부 의존성 0개 원칙 유지. 아래 표에 없는 파일은 14·15단계에서 바뀌지 않았다(특히 `src/core/reducer.js`, `src/core/roles.js`, `src/core/session-watcher.js`, Run/Event/AgentNode 스키마, SSE 페이로드).

| 모듈/파일 | 신규·변경 | 책임 | 의존 | 단계 |
|---|---|---|---|---|
| `public/js/flow.js` | 변경 | judge 노드를 워커 행에 실행마다 카드로 렌더(`box ${node.role}` 클래스), 단일 judge 박스·`pickJudge` 삭제, 구조 서명에서 judgeId 제거, 연결선 규칙 변경(3.11, 4.1) | dom, format | 14 |
| `public/styles.css` | 변경 | (14) `.box.judge { --role-color: var(--c-judge); }`. (15) `.g-agents`, `.g-agents-head`, `.g-toggle`, `.ag-list[hidden]`, `.ag-row`, `.ag-name.ag-judge`, `.ag-name.ag-worker`, `.ag-model`. 새 색 변수 없음 | - | 14, 15 |
| `test/flow.test.js` | 삭제 | `pickJudge` 가 없어져 삭제 | - | 14 |
| `src/core/agents.js` | 신규 | `defaultAgentsDir`, `parseFrontmatter`, `listAgents`(3.15). 읽기 전용 | `node:fs`, `node:os`, `node:path`, `./models.js`(`parseModel`), `./roles.js`(`classifyRole`) | 15 |
| `src/config.js` | 변경 | `DEFAULTS.judgeAgentTypes` 를 `["judge","reviewer","verifier","tester","security-reviewer"]` 로(14 에서 `tester`, 15 에서 `security-reviewer`), `DEFAULTS.agentsDir: null` 추가, `loadConfig` 가 null 이면 `defaultAgentsDir()` 로 채움. CLI 옵션 없음(3.10) | `src/core/agents.js` | 14, 15 |
| `src/server/http.js` | 변경 | `GET /api/agents` 라우트(3.9) | `src/core/agents.js` | 15 |
| `public/js/panels.js` | 변경 | `renderGoal` 5번째 인자 `agents`, 비공개 `buildAgents`, 접힘 상태 모듈 변수 + localStorage(3.16) | dom | 15 |
| `public/js/app.js` | 변경 | 모듈 상태 `agents`, `loadAgents()` 페이지 로드 시 1회, `renderTick` 이 `renderGoal` 에 `agents` 전달(3.16) | - | 15 |
| `test/agents.test.js` | 신규 | `parseFrontmatter`, `listAgents` 단위 테스트(7.4) | - | 15 |
| `test/http.test.js` | 변경 | `cfg.agentsDir` 를 임시 폴더로 지정, `/api/agents` 응답·하위 경로 404(7.4) | - | 15 |
| `test/config.test.js` | 변경 | `DEFAULTS.judgeAgentTypes` 기본값 단언을 새 목록으로 | - | 14, 15 |
| `README.md` | 변경 | `--judge-types` 기본값, 플로우 설명, 등록 에이전트 패널 설명 | - | 14, 15 |

## 3. 인터페이스

### 3.1 데이터 모델 (JSDoc 타입, `src/core/reducer.js` 상단에 정의)

```js
/** @typedef {'opus'|'sonnet'|'haiku'|'unknown'} ModelFamily */
/** @typedef {{
 *   id: string,              // 원본 id, 예 "claude-opus-5-5[1m]"
 *   family: ModelFamily,
 *   version: string|null,    // "5.5", 알 수 없으면 null
 *   label: string,           // 화면 표시명, 예 "opus 5.5"
 *   variant: string|null     // 대괄호 접미사, 예 "1m"
 * }} ModelInfo */

/** @typedef {'main'|'worker'|'judge'} AgentRole */
/** @typedef {'pending'|'running'|'idle'|'completed'|'failed'|'stale'} AgentStatus */

/** @typedef {{
 *   id: string,              // 메인은 "main", 서브에이전트는 agentId (예 "a2f3e10f2f3f35106")
 *   role: AgentRole,
 *   agentType: string|null,  // meta.agentType 또는 Agent input.subagent_type, 메인은 null
 *   description: string|null,// Agent input.description
 *   parentId: string|null,   // 메인은 null, 서브에이전트는 "main"
 *   toolUseId: string|null,
 *   spawnDepth: number,      // 메인 0, meta.spawnDepth 없으면 1
 *   model: ModelInfo|null,   // null 이면 화면에 "model n/a"
 *   status: AgentStatus,
 *   startedAt: string|null,  // ISO
 *   endedAt: string|null,    // Run 뷰에서는 3.5 toRunView 규칙으로 보정된 값
 *   lastActivityAt: string|null,
 *   activity: string|null,   // 마지막 tool_use 요약 또는 마지막 텍스트 앞부분 (최대 80자)
 *   turns: number,           // 고유 assistant message.id 수
 *   toolUses: number,        // tool_use 블록 수 (SubagentHandback 제외, Agent/Task 포함)
 *   tokens: { input: number, output: number, cacheRead: number, cacheCreation: number },
 *   resultText: string|null, // SubagentHandback.message 의 첫 비어있지 않은 줄, handback 전에는 마지막 assistant text 의 첫 줄 (최대 120자)
 *   spawnedAtMainTurn: number|null // 이 노드를 만든 Agent tool_use 를 처리할 때의 main.turns, 메인·근거 없음은 null
 * }} AgentNode */

/** @typedef {'prompt'|'text'|'tool'|'tool_error'|'spawn'|'agent_done'|'agent_failed'|'turn_end'} EventKind */
/** @typedef {{
 *   seq: number,             // 세션 내 단조 증가 (0부터), 서버의 레코드 적용 순서. 표시 순서가 아니다(3.11.1)
 *   ts: string,              // ISO, 원본 레코드 timestamp. 레코드에 timestamp 가 없으면 ""
 *   agentId: string,         // "main" 또는 agentId
 *   modelLabel: string|null, // 해당 시점 모델 label
 *   kind: EventKind,
 *   text: string,            // 최대 160자, 개행은 공백으로
 *   verdict: 'done'|'failed'|null  // agent_done → "done", agent_failed → "failed", 그 외 null. judge 도 예외 없음(판정 문구는 Run.verdict.text)
 * }} Event */

/** @typedef {{
 *   sessionId: string,
 *   projectKey: string,
 *   cwd: string|null,
 *   title: string|null,               // 마지막 ai-title
 *   goal: { text: string, ts: string } | null,          // 첫 사람 프롬프트
 *   currentPrompt: { text: string, ts: string } | null, // 마지막 사람 프롬프트
 *   permissionMode: string|null,
 *   startedAt: string|null,           // 첫 레코드 timestamp
 *   lastActivityAt: string|null,
 *   nodes: AgentNode[],               // [0] 은 항상 main, 이후 startedAt 오름차순 (null 은 뒤로, 동률은 id 사전순)
 *   modelUsage: { label: string, family: ModelFamily, outputTokens: number }[], // 모델 label 별 합계, outputTokens 내림차순, 동률 label 사전순
 *   verdict: { judgeId: string|null, status: 'n/a'|'not yet'|'running'|'done'|'failed', text: string|null },
 *   totals: { turns: number, tokens: number }  // turns = main.turns, tokens = 모든 노드 input+output+cacheRead+cacheCreation 합
 * }} Run */

/** @typedef {{ projectKey: string, sessionId: string, title: string|null, cwd: string|null, mtimeMs: number, sizeBytes: number }} SessionSummary */
```

**verdict 의미 확정(R2)**:
- `Event.verdict`: 이벤트 한 줄의 완료 결과 표시용. 값은 `"done"`, `"failed"`, `null` 셋뿐이다. judge 노드의 `agent_done` 도 `"done"` 이다.
- `Run.verdict.text`: 판정 문구. 최신 judge 노드(3.5 의 선택 규칙)의 `resultText` 를 그대로 쓴다. Run 은 매 update 마다 전체가 다시 전송되므로 handback 이 완료 알림보다 늦게 적용돼도 다음 update 에서 자동으로 채워진다.

### 3.2 `src/core/models.js`

```js
export function parseModel(id /* string|null|undefined */) /* : ModelInfo|null */
```
- 규칙(순서대로 적용):
  1. `id` 가 falsy 이거나 `"<synthetic>"` 이면 `null`.
  2. 끝의 `\[([^\]]+)\]` 를 `variant` 로 떼어낸다(`"claude-opus-5-5[1m]"` → base `"claude-opus-5-5"`, variant `"1m"`).
  3. base 에서 끝의 `-\d{8}` 날짜 접미사를 제거.
  4. 패밀리 = base 에 포함된 토큰 `opus|sonnet|haiku` 중 첫 번째(대소문자 무시). 없으면 `unknown`.
  5. 버전 = `claude-<family>-(\d+)-(\d+)` → `"$1.$2"`, 아니면 `claude-<family>-(\d+)$` → `"$1"`, 아니면 구형 `claude-(\d+)-(\d+)-<family>` → `"$1.$2"`, 아니면 `claude-(\d+)-<family>` → `"$1"`, 아니면 `null`.
  6. label = family 가 unknown 이 아니면 `version ? \`${family} ${version}\` : family`, unknown 이면 base 에서 앞의 `claude-` 를 뗀 문자열(최대 24자).
- 예: `claude-opus-5-5` → `opus 5.5`; `claude-haiku-5-5` → `haiku 5.5`; `claude-sonnet-4-5-20250929` → `sonnet 4.5`; `claude-3-5-haiku-20241022` → `haiku 3.5`; `gpt-x` → family unknown, label `gpt-x`.
- 에러: 던지지 않는다.

### 3.3 `src/core/roles.js`

```js
export function classifyRole(agentType /* string|null */, judgeAgentTypes /* string[] */) /* : 'worker'|'judge' */
```
- `agentType` 을 소문자로 바꿔 `judgeAgentTypes`(소문자 비교) 에 포함되면 `'judge'`, 아니면 `'worker'`. 메인 노드에는 호출하지 않는다.

### 3.4 `src/core/summarize.js`

```js
export function clip(text /* string */, max /* number */) /* : string */          // 개행·연속공백 → 공백 1개, trim, max 초과 시 (max-1)자 + "…"
export function summarizeToolUse(name /* string */, input /* object */) /* : string */
export function parseTaskNotification(text /* string */) /* : { taskId: string, toolUseId: string|null, status: string, summary: string } | null */
export function isHumanPrompt(record /* object */) /* : boolean */
export function promptText(record /* object */) /* : string */
```
- `summarizeToolUse` 규칙: `Bash`/`PowerShell` → `"$ " + clip(input.command, 60)`; `Read`/`Write`/`Edit` → `"<Name> " + basename(input.file_path)`(역슬래시는 `/` 로 바꿔 basename); `Grep` → `"Grep " + clip(input.pattern, 40)`; `Glob` → `"Glob " + input.pattern`; `Agent`/`Task` → `"spawn " + (input.subagent_type ?? "agent") + ": " + clip(input.description ?? "", 40)`; `WebFetch` → `"WebFetch " + host(input.url)`(URL 파싱 실패 시 `clip(url, 40)`); `WebSearch` → `"WebSearch " + clip(input.query, 40)`; `mcp__<server>__<tool>` → `"<server>.<tool>"`; 그 외 → name. 결과 전체를 `clip(…, 80)`.
- `parseTaskNotification`: 문자열에 `<task-notification>` 이 없으면 `null`. `<task-id>`, `<tool-use-id>`, `<status>`, `<summary>` 태그 내용을 정규식 `/<tag>([\s\S]*?)<\/tag>/` 로 추출 후 trim. task-id 또는 status 가 없으면 `null`. summary 없으면 `""`.
- `isHumanPrompt(record)`: `record.type === "user"` 이고, `record.isMeta !== true`, `record.isSidechain !== true`, `record.origin?.kind !== "task-notification"`, `message.content` 가 문자열이거나 `type:"text"` 블록을 포함하는 배열(`tool_result` 블록만 있으면 false), `promptText` 결과가 비어 있지 않고 `<task-notification`, `<command-`, `<local-command-`, `<system-reminder` 로 시작하지 않을 때 `true`.
- `promptText(record)` (R9, 현 구현 반영): 다음 순서로 처리한다.
  1. 문자열 content 그대로, 또는 배열이면 `type:"text"` 블록의 `text` 를 `"\n"` 으로 이어 붙인다.
  2. `/<system-reminder>[\s\S]*?<\/system-reminder>/g` 제거.
  3. 첨부 자리표시자 `/\[(?:Image|Pasted text) #\d+[^\]]*\]/g` 제거. 예: `[Image #1]`, `[Pasted text #2 +40 lines]`. 대소문자 구분(정확히 `Image`, `Pasted text`).
  4. 연속 공백/탭 `/[ \t]{2,}/g` → 공백 1개(개행은 유지, 이후 `clip` 이 처리).
  5. trim.
  - 결과가 빈 문자열이면(이미지만 붙여 넣은 프롬프트) `isHumanPrompt` 가 false 가 되어 goal/latest 에 반영되지 않는다. 이는 의도된 동작이다.

### 3.5 `src/core/reducer.js`

```js
export function createRunState(projectKey /* string */, sessionId /* string */) /* : RunState */
export function applyRecord(state /* RunState */, record /* object */, source /* { kind: 'main' } | { kind: 'subagent', agentId: string } */, cfg /* { judgeAgentTypes: string[], staleAfterMs: number, maxEvents: number } */) /* : { changed: boolean, newEvents: Event[] } */
export function applyMeta(state /* RunState */, agentId /* string */, meta /* object */, cfg) /* : { changed: boolean, newEvents: Event[] } */
export function toRunView(state /* RunState */, nowMs /* number */, cfg) /* : Run */
export function recentEvents(state /* RunState */, limit /* number */) /* : Event[] */
```
- `RunState` 는 reducer 내부 구조(비공개): `run` 필드들 + `nodesById: Map<string, NodeState>` + `usageByMessageId: Map<string, {agentId, label, family, usage}>` + `events: Event[]`(최대 `cfg.maxEvents`, 넘으면 앞에서 제거) + `nextSeq` + 보조 상태(`seenMessageIds`, `seenNotifications`, `handbackIds`, `pendingSpawnTurn: Map<toolUseId, number>`, `pendingSpawnInfo: Map<toolUseId, {agentType, description}>`, `turnEnded`).
- `applyRecord` 처리 규칙(레코드 type 별, 모르는 type 은 무시하고 `changed:false`):
  - 모든 레코드: `timestamp` 가 있으면 `startedAt`(최초), `lastActivityAt` 갱신, 해당 노드 `lastActivityAt` 갱신.
  - `ai-title` → `title`. `permission-mode` → `permissionMode = record.permissionMode`. `user.permissionMode` 가 있으면(메인 소스) 같은 필드 갱신.
  - `user` 이고 `isHumanPrompt` (메인 소스만) → `goal` 이 null 이면 설정, `currentPrompt` 항상 갱신, `wakeMain(state)`(아래 "메인 깨움 규칙", 기존 `node.status = "running"; state.turnEnded = false` 두 줄을 이 호출로 교체), 이벤트 `prompt`.
  - `user` 이고 content 에 `tool_result` 블록: `is_error: true` 면 이벤트 `tool_error`(text = 결과 앞 160자). `record.toolUseResult.agentId` 가 비어 있지 않은 문자열이면 해당 노드를 보장(없으면 생성, status `pending`)하고 첫 `tool_result` 블록의 `tool_use_id` 로 `linkSpawn`(아래). 그다음:
    - `toolUseResult.status === "async_launched"`: `description`(비어 있을 때만), `model = parseModel(toolUseResult.resolvedModel)`(노드에 아직 모델이 없을 때만).
    - 그 외(동기 Agent 결과, 1.2 미확인 항목의 가정): 블록 중 하나라도 `is_error` 면 `failed`, 아니면 `completed`. `endedAt = record.timestamp`. 이벤트 `agent_failed`/`agent_done`(agentId = 대상 노드, text = `"<agentType ?? "agent"> failed|finished"`, verdict `"failed"`/`"done"`).
  - `user` 의 `origin.kind === "task-notification"` 또는 `queue-operation`(operation `enqueue`) 의 content: `parseTaskNotification` 결과의 taskId 가 이미 존재하는 서브에이전트 노드 id 이면 상태 반영: `completed` → `completed`, `failed`/`killed`/`error` → `failed`, 그 외 문자열은 무시. `endedAt = record.timestamp`. 이벤트 `agent_done`/`agent_failed`, text = `summary || status`, **verdict = `"done"`/`"failed"`(judge 포함, R2)**. 같은 알림이 queue-operation 과 user 레코드로 두 번 오므로 **(taskId, status, summary) 조합이 같은 알림은 한 번만** 처리한다. taskId 가 알려지지 않은(백그라운드 셸 등) 알림은 무시. 위 처리와 **별개로**, 메인 깨움 규칙 (W2) 에 해당하는 `user` 알림 레코드는 `wakeMain` 을 호출한다(중복 알림이라 이벤트가 안 나와도 호출한다).
  - `assistant`: 소스 노드에 대해 `message.model` 이 `<synthetic>` 이 아니면 `node.model = parseModel(message.model)`. `message.id` 가 처음이면 `turns += 1`. `usageByMessageId.set(message.id, …)` 로 **덮어쓰기**(같은 id 여러 줄 → 마지막 값 1회만 합산). 콘텐츠 블록(문자열 content 는 text 블록 1개로 취급):
    - `tool_use` 이고 name 이 `SubagentHandback` → `resultText = clip(input.message 첫 비어있지 않은 줄, 120)`, 이 노드를 handback 완료로 표시(이후 text 블록이 resultText 를 덮지 않음). 이벤트 없음, toolUses 증가 없음.
    - 그 외 `tool_use` → `toolUses += 1`, `activity = summarizeToolUse(name, input)`. 이벤트는 **한 줄만** 낸다(R11): name 이 `Agent`/`Task` 면 kind `spawn`, 아니면 kind `tool`. 두 경우 모두 text = 그 `activity` 문자열(`Agent`/`Task` 는 `"spawn <type>: <desc>"`). `Agent`/`Task` 이고 `b.id` 가 문자열이면 `pendingSpawnInfo[b.id] = {agentType: input.subagent_type, description: input.description}`, 메인 소스면 `pendingSpawnTurn[b.id] = main.turns`.
    - `text` 블록(공백 아닌 내용) → `activity = clip(text, 80)`, 서브에이전트이고 handback 전이면 `resultText = clip(첫 줄, 120)`, 이벤트 `text`.
    - `thinking` 블록은 무시.
    - 노드 status: 서브에이전트가 `pending`/`stale` 이면 `running`; 서브에이전트가 `completed`/`failed` 이고 `endedAt` 이 있고 레코드 timestamp 가 `endedAt` 보다 늦으면 `running` 으로 되돌리고 `endedAt = null`, handback 표시 해제(재개).
    - 메인: 메인 깨움 규칙 (W1) 에 해당하면 `wakeMain(state)`. 위치는 `if (!m || typeof m !== "object") break;` 바로 다음(콘텐츠 블록 처리 전). content 가 비어 있어도 호출한다.
  - `system` subtype `turn_duration` 또는 `stop_hook_summary` (메인 소스) → main.status = `idle`, `turnEnded` 가 false 일 때만 `turnEnded = true` 로 하고 이벤트 `turn_end`. 즉 **마지막 깨움(W0~W2) 이후 첫 번째 종료 레코드만** 이벤트를 만든다(같은 턴에 두 subtype 이 어떤 순서로 와도 1회). 이 분기의 현 코드(314~321행)는 바꾸지 않는다.

- **메인 깨움 규칙(R14)**. main.status 를 `running` 으로 바꾸고 `turnEnded` 를 해제하는 근거는 아래 셋뿐이며, 모두 `wakeMain` 한 함수로만 처리한다.
  - (W0) 메인 소스 `user` 레코드이고 `isHumanPrompt(record)` 가 true (기존 규칙).
  - (W1) 메인 소스(`source.kind !== "subagent"`) `assistant` 레코드이고, `record.isSidechain !== true`, `record.message` 가 객체, `record.message.model !== "<synthetic>"`. `message.model` 이 없거나 문자열이 아니어도 (W1) 에 해당한다(synthetic 만 제외).
  - (W2) 메인 소스 `user` 레코드이고 `record.isSidechain !== true`, `record.origin?.kind === "task-notification"`, `notificationTarget(state, textOf(record.message?.content))` 가 null 이 아님. 알림의 status 값(completed/failed/그 외)과 중복 여부(`seenNotifications`)는 따지지 않는다.
  - 근거가 **아닌** 것(상태·`turnEnded` 를 건드리지 않음): `queue-operation`(enqueue/dequeue 모두. enqueue 는 메인이 바쁠 때 대기열에 넣는 기록이라 실제 전달 시점이 아니다), taskId 가 알려지지 않은 알림, 서브에이전트 소스의 모든 레코드, `isSidechain:true` 레코드, `<synthetic>` assistant, `tool_result` 만 있는 `user` 레코드, `attachment`·`system` 등 그 밖의 type.
  - 비공개 함수 시그니처(`src/core/reducer.js`):
    ```js
    // 메인을 깨운다. main.status = "running", state.turnEnded = false. main.status 가 실제로 바뀌었으면 true
    function wakeMain(state /* RunState */) /* : boolean */
    // task-notification 텍스트를 parseTaskNotification 으로 파싱해 taskId 가 nodesById 에 있고 "main" 이 아니면 그 노드, 아니면 null.
    // status 값·seenNotifications 와 무관(순수 조회, 상태 변경 없음). handleNotification 은 바꾸지 않는다(자체 파싱 유지)
    function notificationTarget(state /* RunState */, text /* string */) /* : AgentNode|null */
    ```
  - `res.changed`: (W0)·(W1) 분기는 이미 `res.changed = true` 다. (W2) 는 `wakeMain` 이 true 를 반환하면 `res.changed = true`.
  - (W2) 의 호출 순서: `user` 알림 분기에서 `handleNotification` 을 먼저 호출해 이벤트를 처리한 뒤 `wakeMain` 을 호출하고 `break`. 같은 `textOf(...)` 결과를 두 함수에 넘긴다.
  - 상태 전이 결과(검증 대상):
    - 일반 프롬프트 턴: prompt(W0) → assistant…(W1, 이미 running) → 종료 레코드 → idle, `turn_end` 1회. 1.2 조사대로 종료 레코드는 그 턴의 마지막 assistant 뒤에 오므로 idle 로 끝난다.
    - 알림으로 시작된 턴: (직전 턴 종료로 idle, `turnEnded` true) → `queue-operation` enqueue/dequeue(변화 없음) → `user` 알림(W2: running, `turnEnded` false) → assistant…(W1) → 종료 레코드 → idle, `turn_end` 1회. 알림 레코드 없이 assistant 가 먼저 와도(W1) 같은 결과.
    - 턴 중간 알림: 이미 running 이고 `turnEnded` false 이므로 상태 변화 없음, 이벤트 추가 없음.
    - 종료 레코드 두 개(`stop_hook_summary` + `turn_duration`, 순서 무관): 첫 번째가 이벤트 1회, 두 번째는 idle 유지·이벤트 없음. 두 레코드 사이에 (W0~W2) 가 끼면 두 번째도 이벤트를 낸다 — 실제로 메인이 다시 일한 것이므로 의도된 동작이다(1.2 조사에서 0건).
    - 첫 로드(빈 상태에서 파일 전체를 순서대로 적용): 위 규칙이 레코드 순서만으로 결정되므로 최종 main.status 는 마지막 깨움과 마지막 종료 레코드 중 나중 것에 따른다. 파일이 종료 레코드로 끝나면 idle, 종료 레코드 없이 비-synthetic assistant 나 (W2) 알림으로 끝나면 running(30분이 지나면 뷰에서 stale, 3.5 toRunView). 별도 "첫 로드 모드" 는 두지 않는다.
    - `<synthetic>` assistant 는 상태를 바꾸지 않는다. 직전이 idle 이면 idle, running 이면 running 으로 남는다(synthetic 뒤에 종료 레코드가 없는 세션은 다음 사람 프롬프트·깨움 전까지 running → stale. 기존 동작과 같음, 이번 범위 밖).
  - 서브에이전트 소스의 모든 레코드 → 노드가 없으면 생성(status `running`), `startedAt` 이 null 이면 이 레코드 timestamp.
- `linkSpawn(state, node, toolUseId, cfg)`(비공개): `node.toolUseId` 가 비었으면 설정, `node.spawnedAtMainTurn` 이 null 이고 `pendingSpawnTurn` 에 있으면 복사, `pendingSpawnInfo` 의 agentType/description 을 비어 있는 필드에만 복사, agentType 이 있으면 role 재분류. **연결 근거는 `toolUseResult` 의 tool_use_id 와 `meta.toolUseId` 두 가지뿐**이다.
- `applyMeta`: 노드 보장 후 `agentType`(문자열이면 덮어씀), `description`(비어 있을 때만), `meta.toolUseId` 로 `linkSpawn`(→ `spawnedAtMainTurn` 연결은 meta 만으로도 성립), `spawnDepth`(유한 숫자일 때), `role = classifyRole(agentType, cfg.judgeAgentTypes)`. `meta.finished === true` 이고 status 가 `running`/`pending` 이면 `completed`. 이때 상태의 `endedAt` 은 건드리지 않는다(값이 없을 수 있음, 아래 toRunView 가 보정). `changed` = 노드 신규 생성이거나 위 필드 중 하나라도 바뀜. 이벤트는 내지 않는다.
- `toRunView(state, nowMs, cfg)`:
  - status 가 `running` 이고 `nowMs - Date.parse(lastActivityAt) > cfg.staleAfterMs` 인 노드는 뷰에서 `stale` 로 보낸다(상태 저장값은 바꾸지 않음).
  - **endedAt 보정(R7)**: 뷰 노드의 status 가 `completed`/`failed` 이고 `endedAt` 이 null 이면 `endedAt = lastActivityAt`(그것도 null 이면 null). 상태 저장값은 바꾸지 않는다(재개 판정이 저장값을 쓰므로). 서브에이전트는 `startedAt` 과 `lastActivityAt` 이 같은 레코드에서 함께 설정되므로 `startedAt` 이 있으면 보정 후 `endedAt` 도 반드시 있다.
  - `verdict`: judge 노드 선택 = role `judge` 인 뷰 노드 중 정렬 키(`startedAt`, null 이면 가장 늦은 값으로 취급)가 가장 큰 것, 동률이면 `nodes` 순서상 뒤의 것. 없으면 `{judgeId:null, status:'n/a', text:null}`. 있으면 status 매핑 pending→`not yet`, running/stale→`running`, completed→`done`, failed→`failed`; `text = resultText`.
  - `modelUsage`: `usageByMessageId` 를 label 별 `output_tokens` 합산(label 없는 항목 제외).
- 에러: 필드가 없거나 타입이 다르면 해당 필드만 건너뛴다. 던지지 않는다.

### 3.6 `src/core/tailer.js`

```js
export class FileTailer {
  constructor(filePath /* string */)
  /** 새로 추가된 완전한 줄을 파싱해 반환. 파일이 없으면 { records: [], reset: false, badLines: 0 }.
   *  파일 크기가 이전 오프셋보다 작아지면 오프셋 0 으로 되돌리고 reset: true 와 전체 레코드를 반환. */
  readNew() /* : { records: object[], reset: boolean, badLines: number } */
}
```
- 동기 API(`fs.openSync`/`fs.readSync`/`fs.fstatSync`, 읽은 뒤 즉시 close). 한 번에 최대 8 MiB 씩 반복해서 끝까지 읽는다.
- 바이트 단위로 버퍼링하고 마지막 `\n` 이후 바이트는 다음 호출까지 보관(UTF-8 멀티바이트 경계 보호). 줄은 `\r?\n` 기준. 빈 줄은 건너뜀. `JSON.parse` 실패 줄은 버리고 `badLines` 증가.
- open 실패만 빈 결과로 처리한다. fstat/read 중 예외는 호출자(SessionWatcher.poll)로 전파된다(3.8 의 예외 처리 규칙).

### 3.7 `src/core/paths.js`

```js
export function defaultProjectsRoot() /* : string */          // path.join(os.homedir(), ".claude", "projects")
export function isValidProjectKey(key /* string */) /* : boolean */   // /^[A-Za-z0-9._-]{1,200}$/ 이고 "." / ".." 아님
export function isValidSessionId(id /* string */) /* : boolean */     // /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
export function listSessions(root /* string */, limit /* number = 30 */) /* : SessionSummary[] */  // 모든 프로젝트의 <uuid>.jsonl, mtimeMs 내림차순
export function sessionFiles(root, projectKey, sessionId) /* : { main: string, subagentDir: string } */  // 검증 실패 시 Error('invalid session')
export function listSubagents(subagentDir /* string */) /* : { agentId: string, jsonl: string, meta: string }[] */  // /^agent-([A-Za-z0-9_-]+)\.jsonl$/ 기준, 폴더 없으면 []
```
- `listSessions` 의 `title`/`cwd` 는 상위 `limit` 개 파일에 대해서만, 파일 앞 64 KiB(head)와 뒤 64 KiB(tail, 파일이 64 KiB 초과일 때만, head 와 겹치지 않게 `min(64KiB, size-64KiB)` 바이트)만 읽어 찾는다. `cwd` = head 의 첫 `cwd` 값(head 에 없으면 tail 의 첫 값), `title` = head → tail 순으로 훑어 마지막 `ai-title`. 중간 구간은 읽지 않는다. 구간 경계에서 잘린 줄은 JSON 파싱 실패로 건너뛴다.

### 3.8 `src/core/session-watcher.js`

```js
export class SessionWatcher {
  constructor(opts /* { root: string, projectKey: string, sessionId: string, cfg: Config } */)
  start()                 // 즉시 1회 poll 후 setInterval(cfg.pollMs), 타이머 unref
  stop()                  // 모든 타이머 해제, 구독자 비움
  poll()                  // 1회 폴링. 절대 던지지 않는다(아래 예외 처리)
  snapshot() /* : { run: Run, events: Event[] } */            // events = recentEvents(state, cfg.snapshotEvents)
  subscribe(fn /* (msg: { type: 'update', run: Run, newEvents: Event[] } | { type: 'reset' }) => void */) /* : () => void (unsubscribe) */
  onIdle /* : (() => void) | null */   // getWatcher 가 설정. 구독자 0 상태로 idleWatcherMs 경과 시 호출
}
export function getWatcher(root, projectKey, sessionId, cfg) /* : SessionWatcher */
```
- `getWatcher`: 키 `root\0projectKey\0sessionId` 로 1개 공유. 새로 만들 때 `start()` 후 **즉시 idle 타이머를 건다**(구독 없이 `GET /api/run` 만 호출한 경우에도 `idleWatcherMs` 뒤 폐기되도록). 구독이 생기면 idle 타이머 해제, 구독자가 0 이 되면 다시 건다. 타이머 만료 시 구독자가 여전히 0 이면 `stop()` 하고 캐시에서 제거. 이후 같은 키로 `getWatcher` 를 부르면 새 인스턴스를 만든다.
- poll 순서: (1) 메인 tailer `readNew` (2) `listSubagents` 로 새 서브에이전트 발견 시 tailer 추가, meta.json 은 mtime 이 바뀌었을 때만 다시 읽어 `applyMeta`(JSON 파싱 실패 시 mtime 기록을 지워 다음 poll 에 재시도) (3) 각 서브에이전트 tailer `readNew`(agentId 사전순) (4) 변경이 있으면 newEvents 를 대기열에 쌓고 push 예약.
- reset: 어느 tailer 든 `reset: true` 면 그 poll 의 나머지를 중단하고, 상태를 `createRunState` 로 새로 만들고 모든 tailer 를 새로 만든 뒤(오프셋 0) 같은 poll 안에서 한 번 더 전체를 읽는다. 대기 중인 newEvents 는 버리고 `{type:'reset'}` 을 통지한다(이벤트는 다음 snapshot 에 포함). http 는 reset 을 받으면 `snapshot` 이벤트를 다시 보낸다.
- 레코드 적용 순서: 한 poll 안에서 메인 → 서브에이전트(agentId 사전순). 서버는 파일 간 timestamp 정렬을 하지 않는다(Event.seq = 적용 순서). **표시 순서는 클라이언트가 3.11.1 규칙으로 `ts` 정렬한다(R1).**
- push throttle: 첫 변경 시 `max(0, lastPushAt + pushThrottleMs - now)` 뒤로 flush 를 예약하고, 예약이 걸려 있는 동안의 변경은 newEvents 를 같은 대기열에 이어 붙인다(update 1회로 묶임). flush 는 `toRunView` 를 계산해 `{type:'update', run, newEvents}` 통지.
- stale 재확인: 누적 poll 간격이 5000ms 이상이 될 때마다, 구독자가 있고 예약된 flush 가 없으면 run 을 다시 계산해 직전 전송본(JSON 문자열 비교)과 다르면 update 를 보낸다.
- 구독자 콜백 예외는 잡아서 무시한다(다른 구독자에 영향 없음).
- **예외 처리(R5)**:
  - `poll()` 본문 전체(reset 경로 포함)를 try/catch 로 감싼다. `start()` 의 첫 poll 과 interval 콜백 모두 `poll()` 을 통해서만 폴링하므로 어떤 경우에도 예외가 타이머 밖으로 나가 프로세스를 죽이지 않는다. interval 콜백의 stale 재확인(`#pushIfRunChanged`)과 flush 타이머 콜백(`#flush`)도 같은 방식으로 감싼다.
  - 실패 시: `msg = String(err?.message ?? err)`. 인스턴스 필드 `lastPollError` 와 다를 때만 `console.error(\`agent-ui: poll failed for ${projectKey}/${sessionId}: ${msg}\`)` 를 출력하고 `lastPollError = msg`. 같은 메시지가 연속되면 출력하지 않는다(메시지가 바뀌면 새로 1회 출력).
  - 다음 poll 이 예외 없이 끝나면, `lastPollError` 가 null 이 아니었을 때만 `console.error(\`agent-ui: poll recovered for ${projectKey}/${sessionId}\`)` 1회 출력 후 `lastPollError = null`.
  - 재시도는 별도 로직 없이 다음 interval 의 poll 이 이어서 수행한다. 실패 이전까지 적용된 레코드와 진행된 tailer 오프셋은 유지한다(같은 줄을 두 번 적용하지 않음). 실패한 poll 에서 이미 쌓인 newEvents 는 대기열에 남겨 다음 flush 에 포함한다.

### 3.9 HTTP API (`src/server/http.js`)

```js
export function createServer(cfg /* Config */) /* : http.Server */
export function isAllowedHost(hostHeader /* string|undefined */, port /* number */) /* : boolean */
```
- `cfg.host` 에만 바인딩(기본 `127.0.0.1`, 3.10 의 루프백 3종만 허용). 모든 응답 `Cache-Control: no-store`.
- **Host 헤더 검증(R3)**: 모든 요청에서 라우팅·메서드 검사보다 **먼저** 수행한다.
  - 허용 집합: `` `127.0.0.1:${port}` ``, `` `localhost:${port}` ``, `` `[::1]:${port}` `` 정확히 3개. `isAllowedHost` 는 `hostHeader` 가 문자열이 아니면 false, 아니면 `hostHeader.trim().toLowerCase()` 가 집합에 있으면 true.
  - **포트 생략 불가**: `Host: localhost`, `Host: 127.0.0.1` 은 거부한다. 서버는 80 번 포트를 쓰지 않으므로 정상 브라우저 요청은 항상 포트를 포함한다.
  - `port` 는 `cfg.port` 가 아니라 **요청 처리 시점의 `server.address().port`** 다(`--port 0` 과 테스트의 `listen(0)` 에서 실제 할당 포트와 비교해야 함). `createServer` 안에서 `const server = http.createServer(handler)` 로 만든 뒤 handler 가 `server.address()?.port` 를 읽는다. 바인딩 주소(`cfg.host`)와 무관하게 3개 모두 허용한다(모두 같은 루프백 머신을 가리킴).
  - 불일치 또는 Host 없음: `403 { error: "forbidden host" }`(JSON, `Cache-Control: no-store`). SSE 경로도 같은 응답(스트림을 열지 않음).
  - 목적: DNS rebinding 으로 외부 웹 페이지가 로컬 트랜스크립트 요약을 읽는 것을 막는다.

| 메서드/경로 | 응답 |
|---|---|
| (Host 불일치, 모든 경로) | `403 { error: "forbidden host" }` |
| GET 이외 메서드 | `405 { error: "method not allowed" }` |
| 경로의 퍼센트 디코딩 실패 | `400 { error: "bad request" }` |
| `GET /` | `public/index.html` |
| `GET /static/<file>` | `public/` 아래 파일. `path.resolve` 결과가 `public/` + 구분자로 시작하지 않으면 404. 확장자별 Content-Type(`; charset=utf-8`): `.js` `text/javascript`, `.css` `text/css`, `.html` `text/html`, 그 외 404 |
| `GET /api/sessions?limit=N` | `200 { sessions: SessionSummary[] }`, N 기본 30, 양의 유한수만 인정해 floor, 최대 200 |
| `GET /api/sessions/latest` | `200 { projectKey, sessionId }` (listSessions 첫 항목), 세션 없으면 `404 { error: "no sessions" }` |
| `GET /api/run/:projectKey/:sessionId` | `200 { run: Run, events: Event[] }`. 검증 실패 `400 { error: "invalid session" }`, 메인 파일 없음 `404 { error: "not found" }` |
| `GET /api/run/:projectKey/:sessionId/stream` | SSE. 아래 참조. 검증/존재 실패는 위와 같은 JSON 에러 |
| `GET /api/limits` (R15) | `200 { status: "ok"\|"missing"\|"invalid", limits: Limits\|null }` = `limitsReader.read()` 결과 그대로(3.13). 쿼리 문자열은 무시. 경로는 정확히 `seg.length === 2 && seg[1] === "limits"` 일 때만. 파일이 없거나 깨져도 200(상태는 `status` 로 구분). `/api/limits/<무엇이든>` 은 404 |
| `GET /api/agents` (R17) | `200 { agents: RegisteredAgent[] }` = `listAgents(cfg.agentsDir ?? defaultAgentsDir(), cfg.judgeAgentTypes)`(3.15). 요청마다 폴더를 다시 읽는다(캐시 없음). 쿼리 문자열은 무시. 경로는 정확히 `seg.length === 2 && seg[1] === "agents"` 일 때만. 폴더가 없거나 읽을 수 없어도 `200 { agents: [] }`. `/api/agents/<무엇이든>` 은 404 |
| 그 외 | `404 { error: "not found" }` |
| 처리 중 예외 | 헤더 전이면 `500 { error: "internal error" }`, 이미 보냈으면 연결 종료. `console.error("agent-ui: request failed:", message)` |

- SSE 형식(`Content-Type: text/event-stream; charset=utf-8`):
  - 연결 직후 `event: snapshot\ndata: {"run":Run,"events":Event[]}\n\n`
  - 변경 시 `event: update\ndata: {"run":Run,"newEvents":Event[]}\n\n`
  - reset 시 `event: snapshot` 을 다시 보낸다(클라이언트는 상태 전체 교체).
  - 15초마다 `: ping\n\n`.
  - 연결 종료 시 unsubscribe.
- 클라이언트 재연결: `EventSource` 기본 재연결에 맡기고, 재연결 시 받은 snapshot 으로 상태를 통째로 교체한다.
- (R15) `createServer(cfg)` 는 함수 시작부에서 `const limitsReader = new LimitsReader(cfg.limitsFile ?? defaultLimitsFile())` 를 **1개** 만든다(요청마다 만들지 않음). 한도 경로는 이 값 하나뿐이고 요청 URL·쿼리·헤더로 경로를 만들지 않는다. SSE snapshot/update 페이로드와 `Run` 에는 한도를 넣지 않는다. Host 검증(R3)은 이 라우트에도 그대로 먼저 적용된다(라우트를 `route()` 안에 둔다).
- (R17) `/api/agents` 도 `route()` 안에 있어 Host 검증·405 규칙이 먼저 적용된다. 폴더 경로는 `cfg.agentsDir`(null 이면 `defaultAgentsDir()`) 하나뿐이고 요청 URL·쿼리·헤더로 경로를 만들지 않는다. 등록 목록은 SSE snapshot/update 와 `Run` 에 넣지 않는다.

### 3.10 설정 (`src/config.js`)

```js
import { defaultProjectsRoot } from "./core/paths.js";
import { defaultLimitsFile } from "./core/limits.js";   // (R15)
import { defaultAgentsDir } from "./core/agents.js";    // (R17)
export const DEFAULTS = {
  host: "127.0.0.1",
  port: 8770,
  projectsRoot: null,            // null → defaultProjectsRoot()
  pollMs: 750,
  pushThrottleMs: 300,
  staleAfterMs: 30 * 60 * 1000,
  idleWatcherMs: 60 * 1000,
  maxEvents: 2000,               // RunState 보관 상한
  snapshotEvents: 300,           // snapshot 에 담는 최근 이벤트 수
  judgeAgentTypes: ["judge", "reviewer", "verifier", "tester", "security-reviewer"], // (R16/R17 정정) 기존 문서의 3개 목록은 코드와 다름
  limitsFile: null,              // (R15) null → defaultLimitsFile() (src/core/limits.js)
  agentsDir: null,               // (R17) null → defaultAgentsDir() (src/core/agents.js)
};
export function loadConfig(argv /* string[] */) /* : Config */   // Config = typeof DEFAULTS 와 같은 모양, projectsRoot·limitsFile·agentsDir 은 string 으로 채워짐
```
- (R16/R17) `judgeAgentTypes` 기본값은 `judge`, `reviewer`, `verifier`, `tester`, `security-reviewer` 5개다. 서브에이전트 노드 역할(3.3)과 등록 에이전트 목록의 역할(3.15)이 같은 값을 쓴다. `--judge-types` 로 바꾸면 둘 다 바뀐다.
- (R17) `agentsDir`: `loadConfig` 끝에서 `if (cfg.agentsDir === null) cfg.agentsDir = defaultAgentsDir()`. **CLI 옵션은 만들지 않는다**(경로 고정). 테스트는 `createServer({ ...DEFAULTS, agentsDir: <임시 폴더> })` 로 지정한다. `createServer` 는 `cfg.agentsDir` 가 null 이면 `defaultAgentsDir()` 을 쓴다.
- (R15) `limitsFile`: `loadConfig` 끝에서 `if (cfg.limitsFile === null) cfg.limitsFile = defaultLimitsFile()`. **CLI 옵션은 만들지 않는다**(경로 고정). 테스트는 `createServer({ ...DEFAULTS, limitsFile: <임시 경로> })` 로 지정한다. `createServer` 는 `cfg.limitsFile` 이 null 이면 `defaultLimitsFile()` 을 쓴다(기존 http 테스트처럼 `loadConfig` 없이 `DEFAULTS` 를 펼쳐 넘기는 경우 대비).
- CLI: `--port <n>`, `--host <h>`, `--projects-root <dir>`, `--judge-types a,b,c`, `--poll-ms <n>`. 값이 없는 옵션은 `Error("missing value for <opt>")`. 알 수 없는 인자는 `Error("unknown option: …")`.
- **검증 규칙(R4)** — 위반 시 `loadConfig` 가 `Error` 를 던지고 `main.js` 가 `agent-ui: <message>` 를 stderr 에 출력 후 `process.exit(1)`:
  - 정수 파싱: 값 문자열이 `/^\d+$/` 와 일치해야 한다(부호, 소수점, 지수, 공백, `0x` 불가). 그 뒤 `Number(v)`.
  - `--port`: 0 이상 65535 이하 정수. 0 은 OS 임의 포트(테스트용). 위반 시 `Error("invalid value for --port: <v>")`.
  - `--poll-ms`: 1 이상 정수(상한 없음). 위반 시 `Error("invalid value for --poll-ms: <v>")`.
  - `--host` (현 구현 반영): `127.0.0.1`, `localhost`, `::1` 중 하나(정확히 일치, 대소문자 구분). 위반 시 `Error("--host must be a loopback address (127.0.0.1, localhost, ::1): <v>")`.
  - `--judge-types`: 쉼표 분리, 각 항목 trim, 빈 항목 제거. 결과가 빈 배열이어도 허용(judge 없음).
  - `--projects-root`: 존재 여부는 검사하지 않는다(없으면 세션 목록이 빈 배열).

### 3.11 프론트엔드 모듈

```js
// public/js/dom.js
export function h(tag /* string */, cls /* string|null|undefined */, text /* string|null|undefined */) /* : HTMLElement */  // text 는 textContent 로만
// public/js/format.js
export function fmtClock(iso /* string */) /* : string */          // 로컬 시각 "HH:MM:SS", 파싱 불가 "--:--:--"
export function fmtElapsed(ms /* number */) /* : string */          // "45s" | "3m 05s" | "1h 02m", 음수/NaN 은 0 으로
export function fmtTokens(n /* number */) /* : string */            // 아래 규칙
export function fmtCountdown(ms /* number */) /* : string */        // (R15) 아래 규칙
// public/js/panels.js
export function renderHeader(el /* HTMLElement */, run /* Run */) /* : void */
export function renderGoal(el /* HTMLElement */, run /* Run */, nowMs /* number */, limitsResp /* LimitsResp|undefined, R15 3.14 */, agents /* RegisteredAgent[]|null|undefined, R17 3.16 */) /* : void */
// public/js/limits.js → 3.14
// public/js/flow.js
export function renderFlow(el /* HTMLElement */, run /* Run */, nowMs /* number */) /* : void */
// (R16) pickJudge 는 삭제됐다. flow.js 의 공개 export 는 renderFlow 하나뿐
// public/js/log.js  → 3.11.1
```
- 모든 텍스트는 `textContent` 로만 넣는다(`innerHTML` 에 데이터 삽입 금지). DOM 생성은 `dom.js` 의 `h` 를 쓴다.
- **`fmtTokens(n)` (R6)**: `v = Number(n)`, 유한수가 아니거나 음수면 0.
  1. `v < 1000` → `String(Math.floor(v))` (예: 999 → `"999"`, 999.6 → `"999"`).
  2. `k = (v / 1000).toFixed(1)`. `Number(k) < 1000` 이면 `` `${k}k` `` (예: 1000 → `"1.0k"`, 12345 → `"12.3k"`, 999949 → `"999.9k"`).
  3. 그 외(반올림 결과가 1000.0 이 되는 999950 이상 포함) → `` `${(v / 1e6).toFixed(2)}M` `` (예: 999950 → `"1.00M"`, 999999 → `"1.00M"`, 1240000 → `"1.24M"`).
  - 즉 표시 문자열이 `"1000.0k"` 가 되는 일은 없다. M 상한은 두지 않는다(1e9 → `"1000.00M"`).
- **`fmtCountdown(ms)` (R15)**: `v = Number(ms)`, 유한수가 아니거나 음수면 0. `s = Math.floor(v / 1000)`. `pad` 는 기존 2자리 0 채움.
  1. `s < 60` → `` `${s}s` `` (예: 0 → `"0s"`, 59999ms → `"59s"`)
  2. `s < 3600` → `` `${Math.floor(s / 60)}m ${pad(s % 60)}s` `` (예: 60000 → `"1m 00s"`, 309000 → `"5m 09s"`)
  3. `s < 86400` → `` `${Math.floor(s / 3600)}h ${pad(Math.floor((s % 3600) / 60))}m` `` (예: 7980000 → `"2h 13m"`, 86399000 → `"23h 59m"`)
  4. 그 외 → `` `${Math.floor(s / 86400)}d ${pad(Math.floor((s % 86400) / 3600))}h` `` (예: 86400000 → `"1d 00h"`, 6일 23시간 → `"6d 23h"`)
  - `fmtElapsed` 는 바꾸지 않는다(기존 경과 표시는 일 단위를 쓰지 않음).
- (R15) `renderGoal` 의 `limitsResp` 가 `undefined` 이면 `{ status: "loading", limits: null }` 로 취급한다. tokens 행(`row("tokens", …)`) **바로 다음**에 `buildLimits(limitView(limitsResp, nowMs))` 결과 요소 1개를 넣는다. 나머지 행 순서는 바꾸지 않는다.
- (R15) `app.js`:
  - 모듈 상태 `let limitsResp = { status: "loading", limits: null };`
  - `async function pollLimits()`: `fetch("/api/limits")`. `r.ok` 이고 본문의 `status` 가 `"ok"`/`"missing"`/`"invalid"` 중 하나면 `limitsResp = { status: body.status, limits: body.limits ?? null }`. 그 외(네트워크 예외, 비 2xx, 형식 불일치)는 `limitsResp.status === "ok"` 이면 **그대로 유지**(마지막 값 + 3.14 신선도 표시로 처리), 아니면 `limitsResp = { status: "error", limits: null }`. 끝에 `renderTick()`. 예외를 밖으로 던지지 않는다.
  - `main()` 에서 `connect(p, s)` 다음에 `pollLimits()` 1회, `setInterval(pollLimits, LIMITS_POLL_MS)`. "no sessions" 로 조기 반환하는 경로에서는 호출하지 않는다(goal 패널이 없음).
  - `renderTick()` 은 `renderGoal(els.goal, state.run, Date.now(), limitsResp, agents)` 로 호출(R17 에서 5번째 인자 추가, 3.16). 리셋까지 남은 시간은 기존 1초 타이머의 `renderTick` 으로 갱신된다(서버 요청 없음).
- ~~`pickJudge(run)`~~ (R16 에서 삭제): 기존 "judge 박스에 최신 judge 1개 + `previous: N`, judge 노드는 워커 행에 그리지 않음" 규칙은 폐기됐다. 현재 규칙은 아래 `renderFlow`.
- **`renderFlow(el, run, nowMs)` (R16)**:
  - 카드 대상 = `run.nodes.filter(n => n.role !== "main")`(worker 와 judge 모두), `run.nodes` 순서(startedAt 오름차순) 그대로. 카드는 같은 빌더(`buildWorker`)로 만들고 `box.className = \`box ${node.role} ${statusClass(node.status)}\``. judge 카드는 CSS `.box.judge { --role-color: var(--c-judge) }` 로 파란 테두리, 그 외 내용(제목·배지·설명·meta·activity·진행 막대)은 워커와 같다. 서브에이전트 0개면 점선 빈 박스 `no subagents`.
  - 구조 서명(`signature`) = 노드 `id:role` 목록 + `modelUsage` label 목록. judgeId 는 포함하지 않는다. 서명이 같으면 제자리 갱신.
  - 연결선 = 메인 → usage 1개 + usage → 각 카드 1개씩. 선의 running 애니메이션은 도착 노드 status 가 `running` 일 때.
  - 연결선 배치(`layoutLinks`, 비공개): usage 에서 출발하는 선의 도착 카드 `b` 에 대해, 다른 usage 출발 선의 도착 카드들 중 `r.bottom <= b.top + 1 && r.top < b.top - 1`(= `b` 보다 위 줄)인 카드를 후보로 삼고, 후보가 있으면 가로 중심이 `b` 의 가로 중심과 가장 가까운 카드의 아래 중앙에서 선을 시작한다(flex-wrap 으로 내려간 카드의 선이 윗줄 카드를 가로지르지 않게). 후보가 없으면(첫 줄) usage 박스 아래 중앙에서 시작. 후보는 "바로 위 줄"(위쪽 카드 중 `bottom` 이 가장 큰 줄)의 카드로 한정하며, 그 줄에서 가로 중심이 가장 가까운 카드를 고른다(줄이 3개 이상이어도 동일).
- `app.js`: URL `?p=<projectKey>&s=<sessionId>` 가 없으면 `/api/sessions/latest` 로 받아 `history.replaceState` 로 URL 을 채운다(404 면 "no sessions" 표시 후 종료). 상단 선택 박스는 `/api/sessions` 목록(`title ?? sessionId 앞 8자` + `[projectKey]`)으로 채우고 변경 시 `location.search` 를 바꿔 다시 로드. 경과시간 표시는 1초 타이머로 `renderGoal`/`renderFlow` 를 다시 호출(서버 요청 없음, 로그는 다시 그리지 않음).
  - snapshot 수신: `state = { run, events: events.slice(-1000) }`, `renderHeader`/`renderGoal`/`renderFlow`, `resetLog(els.log, state.events, state.run)`.
  - update 수신: `lastSeq = state.events.at(-1)?.seq ?? -1`, `fresh = newEvents.filter(e => e.seq > lastSeq)`(snapshot 과 첫 update 의 겹침 제거), `state.events = state.events.concat(fresh).slice(-1000)`, `state.run = run`, 렌더 3종, **`appendLog(els.log, fresh, state.run)`**. update 에서 `resetLog` 를 호출하지 않는다.

#### 3.11.1 session log (`public/js/log.js`, R1)

정렬 규칙:
- 표시 순서 = 정렬 키 `key` 오름차순, 같은 키는 `seq` 오름차순. 비교 함수 `before(a, b) = a.key < b.key || (a.key === b.key && a.seq < b.seq)`.
- `key` 부여: 이벤트를 **seq 오름차순으로** 훑으며 `t = eventTimeMs(ev)`. `t !== null` 이면 `key = t`, 그리고 `lastKey = t`. `t === null`(ts 가 `""` 이거나 `Date.parse` 결과가 NaN)이면 `key = lastKey`(직전에 부여된 유효 키), 직전 유효 키가 없으면 `key = 0`(맨 앞). 즉 시각이 없는 이벤트는 seq 상 바로 앞 이벤트의 시각에 붙어 그 뒤에 표시된다.
- `lastKey` 는 `LogIndex` 인스턴스가 보관하며 `reset` 시 새 이벤트 집합 기준으로 다시 계산한다.

```js
export const MAX_ROWS = 1000;
export function eventTimeMs(ev /* Event */) /* : number|null */   // Number.isFinite(Date.parse(ev.ts)) ? 그 값 : null
export function sortEvents(events /* Event[] */) /* : Event[] */  // 새 배열. 위 규칙으로 key 부여 후 (key, seq) 정렬
export class LogIndex {
  constructor(maxRows /* number = MAX_ROWS */)
  get size() /* : number */
  /** 상태를 비우고 events 로 다시 구성. sortEvents 후 뒤에서 maxRows 개만 보관하고 그 배열(표시 순서)을 반환 */
  reset(events /* Event[] */) /* : Event[] */
  /** 이벤트 1개 추가. 반드시 seq 오름차순으로 호출. 반환값대로 DOM 을 바꾼다 */
  add(ev /* Event */) /* : { op: 'append'|'insert'|'drop', index: number, evict: number } */
}
export function resetLog(el /* HTMLElement */, events /* Event[] */, run /* Run */) /* : void */
export function appendLog(el /* HTMLElement */, newEvents /* Event[] */, run /* Run */) /* : void */
```
- `LogIndex` 내부: `rows: { key: number, seq: number }[]`(표시 순서), `lastKey: number|null`, `maxSeq: number`(-1 시작).
- `LogIndex.add(ev)` 규칙(순서대로):
  1. `ev.seq <= maxSeq` 이면 `{ op: 'drop', index: -1, evict: 0 }`(중복/역행). 아니면 `maxSeq = ev.seq`.
  2. 위 규칙으로 key 부여(필요 시 `lastKey` 갱신).
  3. `rows` 가 비었거나 마지막 행이 새 행보다 `before` 이면 → **append**: `rows.push`, `index = rows.length - 1`.
  4. 아니면 `index` = 새 행보다 뒤에 와야 하는 첫 행의 위치(이진 탐색, upper bound). 이때 `rows.length >= maxRows` 이고 `index === 0` 이면 → `{ op: 'drop', index: -1, evict: 0 }`(넣자마자 잘릴 행). 아니면 **insert**: `rows.splice(index, 0, row)`.
  5. `evict = max(0, rows.length - maxRows)`. evict 만큼 `rows` 앞에서 제거(가장 이른 행부터 버림).
  6. `{ op, index, evict }` 반환. `index` 는 **evict 적용 전** 기준 위치다.
- `resetLog(el, events, run)`: `el._log = new LogIndex()`, `rows = el._log.reset(events)`, 각 행을 `buildRow` 로 만들어 `el.replaceChildren(fragment)`. 스크롤 고정 규칙 적용.
- `appendLog(el, newEvents, run)`: `el._log` 가 없으면 `resetLog(el, newEvents, run)` 후 반환. 있으면 `newEvents` 를 seq 오름차순으로 정렬해 차례로 `el._log.add(ev)`:
  - `append` → `el.append(row)`
  - `insert` → `el.insertBefore(row, el.children[index])`
  - 그 뒤 `evict` 개만큼 `el.firstElementChild.remove()`
  - `drop` → 아무것도 안 함
  - 호출 1회당 DOM 변경은 새 이벤트 수 + 제거 수에 비례한다(기존 행은 다시 만들지 않는다).
- 스크롤 고정: 변경 전에 `stick = el.scrollHeight - el.scrollTop - el.clientHeight < 40` 을 계산하고, 변경 후 `stick` 이면 `el.scrollTop = el.scrollHeight`.
- 행 내용(`buildRow`): `fmtClock(ts)` | `{modelLabel ?? "n/a"} · {agentId==="main" ? "main" : (run 의 해당 노드 agentType ?? agentId 앞 7자)}` | `text` | `verdict ?? ""`. 행은 만들어진 뒤 갱신하지 않는다(나중에 agentType 이 알려져도 기존 행의 라벨은 그대로. 다음 snapshot 에서 반영).
- reset 은 SSE `snapshot`(최초 연결, 재연결, 서버 reset) 때만 일어난다.

### 3.12 statusLine 스크립트 (`scripts/statusline.mjs`, R15)

단일 ES 모듈 파일(`.mjs` 라서 `package.json` 위치와 무관하게 ESM). Node 표준 모듈만 쓴다. 다른 프로젝트 파일을 import 하지 않는다. 네트워크 접근 없음.

```js
/** @typedef {{ usedPercentage: number, resetsAtMs: number }} LimitWindow */
/** @typedef {{ five_hour: LimitWindow|null, seven_day: LimitWindow|null }} LimitWindows */
/** @typedef {{ version: 1, updatedAtMs: number, sessionId: string|null,
 *              five_hour: LimitWindow|null, seven_day: LimitWindow|null }} LimitsFile */

export const WINDOW_KEYS = ["five_hour", "seven_day"];
export const WINDOW_LABELS = { five_hour: "5h", seven_day: "7d" };
export const LIMITS_FILE_NAME = "rate-limits.json";
export const DUMP_FILE_NAME = "statusline-input.json";
export const SAME_WINDOW_TOLERANCE_MS = 60 * 1000;
export const MAX_STDIN_BYTES = 1024 * 1024;
export const MAX_DUMP_CHARS = 256 * 1024;
export const STDIN_TIMEOUT_MS = 2000;
export const TMP_MAX_AGE_MS = 60 * 1000;
export const RENAME_ATTEMPTS = 5;
export const RENAME_RETRY_WAIT_MS = 15;

export function defaultLimitsDir() /* : string */            // path.join(os.homedir(), ".claude", "agent-ui")
export function parseWindow(raw /* unknown */) /* : LimitWindow|null */
export function parseRateLimits(input /* unknown */) /* : LimitWindows|null */
export function mergeWindow(old /* LimitWindow|null */, inc /* LimitWindow|null */) /* : LimitWindow|null */
export function mergeLimits(existing /* unknown */, incoming /* LimitWindows */, nowMs /* number */, sessionId /* string|null */) /* : LimitsFile */
export function statusText(windows /* LimitWindows|null */, nowMs /* number */) /* : string */
export function writeFileAtomic(file /* string */, text /* string */) /* : void */   // 실패 시 throw
export function runStatusline(opts /* { raw: string, dir: string, nowMs: number, dump: boolean } */) /* : string */  // 절대 throw 안 함
```

- 저장 파일: `<dir>/rate-limits.json`, `dir` 기본값 `defaultLimitsDir()` = `~/.claude/agent-ui`(Windows `%USERPROFILE%\.claude\agent-ui`). 내용 = `JSON.stringify(LimitsFile, null, 2) + "\n"`. 예:
  ```json
  { "version": 1, "updatedAtMs": 1761700000000, "sessionId": "abc…",
    "five_hour": { "usedPercentage": 23.5, "resetsAtMs": 1738425600000 },
    "seven_day": { "usedPercentage": 41.2, "resetsAtMs": 1738857600000 } }
  ```
  - `updatedAtMs` = 마지막으로 이 파일을 쓴 시각(스크립트의 `nowMs`). 화면 신선도 판단에 쓴다(3.14).
  - `sessionId` = 마지막으로 쓴 세션의 `session_id`(디버그용, 서버는 응답에 넣지 않는다).
  - stdin 원문의 다른 필드(cwd, transcript_path, model, cost 등)는 저장하지 않는다.
- **`parseWindow(raw)`**: `raw` 가 배열이 아닌 객체가 아니면 null. `u = raw.used_percentage`, `r = raw.resets_at`. `typeof u === "number" && Number.isFinite(u)` 가 아니면 null(문자열 숫자도 거부). `typeof r === "number" && Number.isFinite(r) && r > 0` 이 아니면 null. `resetsAtMs = r >= 1e11 ? Math.round(r) : Math.round(r * 1000)`(문서상 초 단위. 1e11 이상은 이미 ms 로 보고 그대로 — 실계정 미검증 대비 방어). `u` 는 범위 밖(음수, 100 초과)이어도 **그대로** 저장한다(보정은 표시 단계, 3.14). 반환 `{ usedPercentage: u, resetsAtMs }`.
- **`parseRateLimits(input)`**: `input` 이 객체가 아니거나 `input.rate_limits` 가 배열 아닌 객체가 아니면 null. `WINDOW_KEYS` 각각 `parseWindow(input.rate_limits[key])`. 둘 다 null 이면 null. `spend_limit` 등 다른 키는 무시.
- **`mergeWindow(old, inc)`** (여러 세션이 같은 파일에 쓸 때 오래된 값으로 덮어쓰지 않기 위한 규칙. 순서대로):
  1. `inc === null` → `old`(이번 입력에 없는 윈도우는 기존 값 유지).
  2. `old === null` → `inc`.
  3. `inc.resetsAtMs > old.resetsAtMs + SAME_WINDOW_TOLERANCE_MS` → `inc`(새 윈도우가 시작됨).
  4. `inc.resetsAtMs < old.resetsAtMs - SAME_WINDOW_TOLERANCE_MS` → `old`(입력이 이전 윈도우의 낡은 값. 쉬고 있던 세션이 늦게 재실행된 경우).
  5. 그 외(같은 윈도우) → `{ usedPercentage: Math.max(old.usedPercentage, inc.usedPercentage), resetsAtMs: Math.max(old.resetsAtMs, inc.resetsAtMs) }`. 근거: 한 윈도우 안에서 사용량은 줄지 않는다. 쉬고 있던 세션의 낮은 값이 활동 중인 세션의 높은 값을 덮지 못한다.
- **`mergeLimits(existing, incoming, nowMs, sessionId)`**: `existing` 이 객체이고 `version === 1` 이면 각 키에 대해 `usedPercentage` 가 유한수, `resetsAtMs` 가 0 초과 유한수인 객체만 `{usedPercentage, resetsAtMs}` 로 취하고 나머지는 null. `existing` 이 그 외면 두 윈도우 모두 null. 반환 `{ version: 1, updatedAtMs: nowMs, sessionId, five_hour: mergeWindow(…), seven_day: mergeWindow(…) }`.
- **`statusText(windows, nowMs)`**: `windows` 가 null 이면 `""`. `WINDOW_KEYS` 순서로, 윈도우가 있고 `nowMs < resetsAtMs` 인 것만 `` `${WINDOW_LABELS[key]} ${remainingPct}% left` ``. `remainingPct = Math.floor(100 - clamp(usedPercentage, 0, 100))`(3.14 와 같은 식). 항목을 `" · "` 로 잇는다. 예: `"5h 76% left · 7d 58% left"`, 5시간만 있으면 `"5h 70% left"`, 없으면 `""`. 색·ANSI 코드·개행 없음. **이번 stdin 의 윈도우만** 쓴다(병합 결과·파일 내용과 무관, 파일 쓰기 실패와도 무관).
- **`writeFileAtomic(file, text)`**:
  1. `tmp = \`${file}.${process.pid}.${Date.now()}.tmp\`` (같은 폴더).
  2. `fs.writeFileSync(tmp, text, "utf8")`. 실패하면 `tmp` 삭제를 시도(오류 무시)하고 throw.
  3. `fs.renameSync(tmp, file)`. 에러 코드가 `EPERM`/`EBUSY`/`EACCES` 이면 최대 `RENAME_ATTEMPTS` 번까지 시도하며 사이에 `Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, RENAME_RETRY_WAIT_MS)` 로 대기(Windows 에서 서버가 같은 파일을 읽는 순간 rename 이 실패할 수 있음). 그 밖의 코드는 즉시 실패. 최종 실패 시 `tmp` 삭제 시도 후 throw. 기존 `file` 은 건드리지 않는다.
- **`runStatusline({ raw, dir, nowMs, dump })`** (순서대로, 전체를 try/catch 로 감싸 예외 시 `""` 반환):
  1. `dump` 가 true 면: `fs.mkdirSync(dir, { recursive: true })`, `writeFileAtomic(path.join(dir, DUMP_FILE_NAME), raw.slice(0, MAX_DUMP_CHARS))`. 실패는 stderr 한 줄 후 계속.
  2. `JSON.parse(raw)` 실패(빈 문자열 포함) → `""` 반환. **파일은 건드리지 않는다**.
  3. `windows = parseRateLimits(input)`. null(rate_limits 없음/전부 무효) → `""` 반환. **파일은 건드리지 않는다**(삭제하지 않음).
  4. try: `mkdirSync(dir, {recursive:true})` → 임시 파일 청소(아래) → 기존 파일 읽기(`readFileSync` + `JSON.parse`, 없거나 깨졌으면 `existing = null`) → `merged = mergeLimits(existing, windows, nowMs, sessionId)` → `writeFileAtomic(path.join(dir, LIMITS_FILE_NAME), JSON.stringify(merged, null, 2) + "\n")`. catch: `process.stderr.write(\`agent-ui statusline: ${msg}\n\`)`(`msg = String(err?.message ?? err)`), 기존 파일 유지.
     - `sessionId` = `input.session_id` 가 길이 1~200 문자열이면 그 값, 아니면 null.
     - 임시 파일 청소: `readdirSync(dir)` 중 `/^(?:rate-limits|statusline-input)\.json\.\d+\.\d+\.tmp$/` 에 맞고 `mtimeMs < nowMs - TMP_MAX_AGE_MS` 인 파일 삭제. 모든 오류 무시(Claude Code 가 실행 중인 스크립트를 취소하면 tmp 가 남을 수 있음).
  5. `statusText(windows, nowMs)` 반환.
- **진입점**(비공개 `main()`): `process.argv[1]` 이 있고 `pathToFileURL(path.resolve(process.argv[1])).href.toLowerCase() === import.meta.url.toLowerCase()` 일 때만 실행(테스트 import 시 실행 안 됨, Windows 드라이브 문자 대소문자 차이 흡수).
  - 인자: `process.argv.slice(2).includes("--dump")` 이면 `dump = true`. 다른 인자는 무시.
  - stdin: `process.stdin.isTTY` 면 `raw = ""`. 아니면 `data` 청크를 Buffer 로 모아 `end` 시 `utf8` 디코딩 후 앞의 BOM(`﻿`) 제거. 누적이 `MAX_STDIN_BYTES` 를 넘으면 읽기를 멈추고 `raw = ""`. `error` 이벤트 또는 `STDIN_TIMEOUT_MS` 경과 시 그때까지 받은 것으로 진행. 진행 후 타이머 해제, `process.stdin.destroy()`.
  - `text = runStatusline({ raw, dir: defaultLimitsDir(), nowMs: Date.now(), dump })`. `text` 가 비어 있지 않으면 `process.stdout.write(text + "\n")`, 비어 있으면 아무것도 쓰지 않는다.
  - **종료 코드는 항상 0**: `process.exitCode = 0`. `process.exit(1)` 이나 비 0 코드 금지. `main()` 전체를 try/catch/finally 로 감싸고 예외는 stderr 한 줄만. stdout 에 스택 트레이스·오류 문구를 쓰지 않는다(상태 줄에 노출됨).
- 동시 실행: 여러 세션의 스크립트가 거의 동시에 돌면 "읽기 → 병합 → rename" 사이에 다른 프로세스의 기록이 끼어 한쪽 갱신이 빠질 수 있다. 파일 잠금은 두지 않는다(rename 으로 파일은 항상 완전한 JSON). 빠진 갱신은 다음 assistant 메시지의 재실행에서 메워지고, 5단계 병합 규칙 덕분에 값이 뒤로 가지 않는다(같은 윈도우에서 max).

### 3.13 한도 파일 읽기 (`src/core/limits.js`, R15)

```js
/** @typedef {{ usedPercentage: number, resetsAtMs: number }} LimitWindow */
/** @typedef {{ updatedAtMs: number, five_hour: LimitWindow|null, seven_day: LimitWindow|null }} Limits */
/** @typedef {{ status: 'ok'|'missing'|'invalid', limits: Limits|null }} LimitsResult */
export const LIMIT_KEYS = ["five_hour", "seven_day"];
export const MAX_LIMITS_FILE_BYTES = 64 * 1024;
export function defaultLimitsFile() /* : string */   // path.join(os.homedir(), ".claude", "agent-ui", "rate-limits.json")
export function normalizeLimits(obj /* unknown */) /* : Limits|null */
export class LimitsReader {
  constructor(file /* string */)
  read() /* : LimitsResult */   // 절대 throw 안 함
}
```
- `normalizeLimits(obj)`: `obj` 가 배열 아닌 객체이고 `obj.version === 1` 이고 `obj.updatedAtMs` 가 0 초과 유한수(`typeof number`)가 아니면 null. 각 `LIMIT_KEYS` 에 대해 값이 객체이고 `usedPercentage` 가 유한수, `resetsAtMs` 가 0 초과 유한수면 `{ usedPercentage, resetsAtMs }`, 아니면 null. `sessionId` 와 알 수 없는 필드는 버린다. 두 윈도우가 모두 null 이어도 유효(객체 반환). `usedPercentage` 범위는 검사하지 않는다(표시 단계에서 보정).
- `LimitsReader` 내부 상태: `key: string|null`(`${mtimeMs}:${size}`), `last: LimitsResult|null`.
- `read()` 규칙(순서대로):
  1. `fs.statSync(file)`. 코드 `ENOENT`/`ENOTDIR` → `key = null`, `last = { status: "missing", limits: null }` 반환. 그 밖의 예외 → `last ?? { status: "invalid", limits: null }` 반환(상태 갱신 안 함).
  2. `!st.isFile()` 또는 `st.size > MAX_LIMITS_FILE_BYTES` → `key` 갱신, `last = { status: "invalid", limits: null }` 반환(읽지 않음).
  3. `key === \`${st.mtimeMs}:${st.size}\`` 이고 `last` 가 있으면 `last` 그대로 반환(파일을 다시 읽지 않음).
  4. `fs.readFileSync(file, "utf8")`. `ENOENT` → 1 의 missing 처리. 그 밖의 예외(`EBUSY`/`EPERM` 등, rename 경합) → `last ?? invalid` 반환, `key` 갱신 안 함(다음 요청에 재시도).
  5. 앞 BOM 제거 후 `JSON.parse` → `normalizeLimits`. 파싱 실패 또는 null → `{ status: "invalid", limits: null }`, 아니면 `{ status: "ok", limits }`. `key`·`last` 갱신 후 반환.
- 타이머·`fs.watch` 없음. 요청이 올 때만 stat 한다(클라이언트 5초 폴링 → 초당 0.2회 stat).
- `fs` 는 기존 모듈과 같이 `import fs from "node:fs"` 기본 import 로 받고 `fs.statSync`/`fs.readFileSync` 형태로 호출한다(7.3 L5·L6 테스트가 기본 export 객체의 메서드를 스텁함. named import 금지).

### 3.14 한도 표시 (`public/js/limits.js`, R15)

```js
/** @typedef {{ status: 'loading'|'ok'|'missing'|'invalid'|'error', limits: Limits|null }} LimitsResp */
/** @typedef {{ key: 'five_hour'|'seven_day', label: string, state: 'ok'|'expired'|'na',
 *              level: 'normal'|'warn'|'danger'|'none', fillPct: number,
 *              valueText: string, usedText: string, resetText: string }} LimitRowView */
/** @typedef {{ rows: LimitRowView[], note: string|null, stale: boolean }} LimitsView */

export const LIMIT_WARN_REMAINING = 20;          // 잔여 % 가 이 값 미만이면 warn(주황)
export const LIMIT_DANGER_REMAINING = 10;        // 잔여 % 가 이 값 미만이면 danger(빨강)
export const LIMITS_STALE_MS = 15 * 60 * 1000;   // updatedAtMs 가 이보다 오래되면 stale
export const LIMITS_POLL_MS = 5000;              // app.js 의 /api/limits 폴링 주기
export const LIMIT_ROWS = [{ key: "five_hour", label: "5h" }, { key: "seven_day", label: "7d" }];
export const LIMIT_NOTES = {
  loading: "limits: loading…",
  missing: "limits n/a · Pro/Max only, shown after first response",
  invalid: "limits n/a · limits file unreadable",
  error: "limits n/a · request failed",
  empty: "limits n/a · no window data yet",
};
export function limitView(resp /* LimitsResp|undefined */, nowMs /* number */) /* : LimitsView */   // 순수, DOM 불필요
export function buildLimits(view /* LimitsView */) /* : HTMLElement */                            // DOM 생성만
```
- **`limitView(resp, nowMs)`** — 항상 `LIMIT_ROWS` 순서의 행 2개를 반환한다.
  - 상태 결정: `resp` 가 `undefined` → `"loading"`. `resp` 가 객체가 아니거나 `resp.status` 가 5개 값 중 하나가 아니거나 `nowMs` 가 유한수가 아니면 `"error"`. `status === "ok"` 인데 `resp.limits` 가 객체가 아니면 `"invalid"`.
  - `"ok"` 가 아니면: 모든 행 `{ state: "na", level: "none", fillPct: 0, valueText: "n/a", usedText: "", resetText: "" }`, `note = LIMIT_NOTES[status]`, `stale = false`.
  - `"ok"` 이면 각 행에 대해 `w = resp.limits[key]`:
    - `w` 가 객체가 아니거나 `typeof w.usedPercentage !== "number"` 또는 `!Number.isFinite(w.usedPercentage)` 또는 `resetsAtMs` 가 유한수가 아니면 → `na`, `valueText "n/a"`, `usedText "no data"`, `resetText ""`, `fillPct 0`, `level "none"`.
    - `nowMs >= w.resetsAtMs` → `expired`: `level "none"`, `fillPct 0`, `valueText "reset"`, `usedText "window reset"`, `resetText "awaiting update"`. **사용량 0(잔여 100%)으로 가정하지 않는다.**
    - 그 외 → `ok`: `c = Math.min(100, Math.max(0, w.usedPercentage))`(음수 → 0, 100 초과 → 100), `remaining = 100 - c`, `remainingPct = Math.floor(remaining)`, `usedPct = 100 - remainingPct`(두 표시값의 합이 항상 100, 잔여는 내림이라 과대 표시하지 않음), `level = remaining < LIMIT_DANGER_REMAINING ? "danger" : remaining < LIMIT_WARN_REMAINING ? "warn" : "normal"`(판정은 내림 전 값 `remaining`, 내림 표시값과 경계가 일치), `fillPct = c`(막대는 사용한 만큼 왼쪽에서 오른쪽으로 차오른다), `valueText = \`${remainingPct}% left\``, `usedText = \`used ${usedPct}%\``, `resetText = \`resets in ${fmtCountdown(w.resetsAtMs - nowMs)}\``.
  - 신선도(`"ok"` 일 때만): `age = nowMs - resp.limits.updatedAtMs`. `stale = Number.isFinite(age) && age > LIMITS_STALE_MS`(미래 시각·음수 age 는 stale 아님). `updatedAtMs` 가 유한수가 아니면 `stale = true`, 나이 문구는 `"as of unknown"`.
  - `note`(`"ok"` 일 때): `stale` 이면 `` `as of ${fmtCountdown(age)} ago` ``, 아니면 두 행 모두 `na` 일 때 `LIMIT_NOTES.empty`, 그 외 null. stale 이어도 값은 그대로 보여 준다(숨기지 않음).
  - 예(`nowMs = 1738425600000 - 7980000`, five_hour `{23.5, 1738425600000}`, `updatedAtMs = nowMs - 60000`): 행 `{state:"ok", level:"normal", fillPct:23.5, valueText:"76% left", usedText:"used 24%", resetText:"resets in 2h 13m"}`, `note null`.
- **`buildLimits(view)`**: `h()` 와 `textContent` 만 쓴다. 구조:
  ```
  div.g-limits[.stale]
    div.lim.lv-{level}.ls-{state}            (행마다)
      div.lim-top
        span.lim-label        ← label
        span.lim-track > span.lim-fill        (fill.style.width = `${fillPct}%`)
        span.lim-val          ← valueText
      div.lim-sub
        span.lim-used         ← usedText
        span.lim-reset        ← resetText
    div.lim-note              ← note (null 이면 만들지 않음)
  ```
  `style.width` 외에 인라인 스타일을 쓰지 않는다. `fillPct` 는 `limitView` 가 0~100 으로 보장한다.

### 3.15 등록 에이전트 읽기 (`src/core/agents.js`, R17)

```js
/** @typedef {{
 *   name: string,                                    // 프런트매터 name, 없거나 빈 문자열이면 파일명에서 ".md" 를 뗀 값
 *   role: 'worker'|'judge',                          // classifyRole(name, judgeAgentTypes)
 *   description: string,                             // 프런트매터 description 앞 200자(String.prototype.slice, UTF-16 단위), 없으면 ""
 *   model: { family: ModelFamily, label: string } | null  // parseModel(프런트매터 model) 의 family/label, null 이면 null
 * }} RegisteredAgent */

export function defaultAgentsDir() /* : string */                 // path.join(os.homedir(), ".claude", "agents")
export function parseFrontmatter(text /* string */) /* : Record<string, string> */
export function listAgents(dir /* string */, judgeAgentTypes /* string[] */) /* : RegisteredAgent[] */
```
- **`parseFrontmatter(text)`**: 던지지 않는다.
  - `String(text)` 가 `/^---\r?\n([\s\S]*?)\r?\n---/` 와 맞지 않으면(파일 맨 앞이 `---` 줄이 아니면) `{}`.
  - 블록 안을 `\r?\n` 으로 나눠 줄마다 `/^([A-Za-z_-]+):\s*(.*)$/` 로 `key: value` 를 찾는다. 들여쓴 줄, 주석, 목록 항목 등 맞지 않는 줄은 건너뛴다. 값은 trim.
  - 값이 `/^[|>][+-]?$/`(`|`, `>`, `|-`, `>+` 등 블록 지시자)이면 바로 다음 줄부터 `/^\s+\S/`(들여쓰고 공백만이 아닌 줄)에 맞는 줄을 차례로 소비해 각 줄을 trim 한 뒤 공백 1개로 이어 붙인 것을 값으로 한다. 빈 줄이나 들여쓰지 않은 줄에서 멈춘다. `|` 와 `>` 를 구분하지 않는다(둘 다 한 줄로 접음).
  - 마지막으로 값 양끝이 같은 종류의 따옴표 한 쌍(`"…"` 또는 `'…'`)이면 그 한 쌍만 벗긴다(`/^(["'])(.*)\1$/`). 이스케이프 해석은 하지 않는다.
  - 같은 키가 여러 번 나오면 마지막 값. 값은 모두 문자열(YAML 타입 변환 없음).
- **`listAgents(dir, judgeAgentTypes)`**: 던지지 않는다.
  - `fs.readdirSync(dir)` 실패(폴더 없음 등)면 `[]`.
  - 이름을 `Array.prototype.sort()` 기본 정렬(코드 유닛 사전순)로 정렬한 뒤 `.md` 로 끝나는 항목만 처리. 하위 폴더는 내려가지 않는다.
  - 각 파일을 `fs.readFileSync(…, "utf8")` 로 읽어 `parseFrontmatter`. 읽기 실패(디렉터리, 권한 등)면 그 항목만 건너뛴다.
  - 결과 순서는 파일명 순서다(name 순이 아님).
  - `role` 은 `name` 으로 분류한다(Claude Code 의 `subagent_type` 이 에이전트 name 이므로 서브에이전트 노드 분류와 같은 기준).

### 3.16 등록 에이전트 패널 (`public/js/panels.js`, `public/js/app.js`, R17)

- `renderGoal(el, run, nowMs, limitsResp, agents)`: `agents` 가 truthy(배열)이면 기존 마지막 요소(`g-judge` 줄) **다음**에 `buildAgents(agents)` 1개를 넣는다. `null`/`undefined` 면 패널을 만들지 않는다. 다른 행 순서는 바꾸지 않는다.
- `buildAgents(agents)`(비공개) DOM:
  ```
  div.g-agents
    div.g-agents-head
      span                 ← `REGISTERED AGENTS (${agents.length})`
      button.g-toggle      ← 접힘이면 "+", 펼침이면 "−"(U+2212). type="button", title 접힘 "펼치기"/펼침 "접기", aria-expanded = String(!collapsed)
    div.ag-list            (hidden = collapsed)
      div.g-sub "none"     (agents 가 빈 배열일 때만)
      div.ag-row           (title = description → 마우스오버 툴팁)  ← 에이전트마다, 서버 순서 그대로
        span.ag-name.ag-{role}             ← name (역할 색: judge 파랑, worker 초록)
        span.ag-model.m-{family|unknown}   ← model.label, model 이 null 이면 "inherit"
  ```
  텍스트는 모두 `h()`/`textContent`, `innerHTML` 금지.
- 접힘 상태: `panels.js` 모듈 변수 `agentsCollapsed`(기본 false). 모듈 로드 시 `try { agentsCollapsed = localStorage.getItem("agent-ui.agentsCollapsed") === "1" } catch {}`. 버튼 클릭 시 값을 뒤집고 `try { localStorage.setItem(KEY, collapsed ? "1" : "0") } catch {}`, 그 자리에서 `.ag-list` 의 `hidden`, 버튼 글자·title·aria-expanded 를 바꾼다(전체 재렌더 없음). 1초 `renderTick` 이 패널을 다시 만들어도 모듈 변수에서 상태를 읽으므로 유지된다. 키 이름 상수 `COLLAPSE_KEY = "agent-ui.agentsCollapsed"`.
- `app.js`:
  - 모듈 상태 `let agents = null;`(null = 아직 못 받음 → 패널 생략).
  - `async function loadAgents()`: `fetch("/api/agents")`, `r.ok` 이면 `agents = (await r.json()).agents`. 네트워크 예외·비 2xx 는 삼키고 `agents` 는 null 유지(패널 생략). 끝에 `renderTick()`. 예외를 밖으로 던지지 않는다.
  - `main()` 에서 `connect(p, s)` 다음, `pollLimits()` 앞에서 **1회만** 호출. 주기 호출 없음. "no sessions" 조기 반환 경로에서는 호출하지 않는다.

## 4. 데이터 흐름

1. 사용자가 `npm start` (또는 `node src/server/main.js --port 8770`) 실행 → `loadConfig`(검증 실패 시 exit 1) → `createServer` → 콘솔에 `agent-ui: http://127.0.0.1:8770` 과 projects root 출력.
2. 브라우저가 `/` 로드(Host 검증 통과) → `app.js` 가 URL 의 세션 또는 `/api/sessions/latest` 로 대상 세션 결정.
3. `app.js` 가 `EventSource('/api/run/<p>/<s>/stream')` 연결 → 서버가 `getWatcher` 로 세션 watcher 를 얻는다(없으면 생성 후 `start()`; 첫 poll 에서 메인/서브에이전트 파일 전체를 읽어 RunState 구축).
4. 서버가 `snapshot` 전송 → 클라이언트가 `state = {run, events}` 로 교체하고 `renderHeader`, `renderGoal`, `renderFlow`, `resetLog` 호출(로그는 ts 정렬).
5. Claude Code 가 jsonl 에 줄을 덧붙임 → 다음 poll(≤ pollMs) 에서 tailer 가 새 줄만 읽음 → `applyRecord`/`applyMeta` 로 RunState(서버 메모리, watcher 인스턴스 안) 갱신 → throttle 후 `update` 전송. poll 중 예외는 로그 1회 후 다음 poll 에서 계속.
6. 클라이언트는 `update` 수신 시 `state.run` 교체, `lastSeq` 보다 큰 newEvents 만 `state.events` 에 이어 붙이고(최근 1000개만 보관), 헤더/goal/flow 다시 그리기, `appendLog` 로 새 행만 append 또는 정렬 위치에 삽입.
7. 상태 저장 위치: 원본은 트랜스크립트 파일(읽기만), 파생 상태는 서버 메모리의 `SessionWatcher` 1개/세션, 화면 상태는 브라우저 메모리(`state`, 로그 DOM 의 `el._log`, 플로우 DOM 의 `el._refs`). 서버의 디스크 쓰기는 없다. (R15) 사용 한도는 4.2 의 별도 흐름이며, 디스크에 쓰는 것은 Claude Code 가 실행하는 statusLine 스크립트뿐이다(`~/.claude/agent-ui/` 아래 2개 파일과 그 임시 파일).
8. 구독자가 0 인 상태로 `idleWatcherMs` 가 지나면 watcher 정지·폐기(구독 없이 생성된 watcher 포함).

### 4.1 화면 매핑 (레퍼런스 개념 → 로그 데이터)

| 레퍼런스 요소 | 매핑 | 데이터가 없을 때 |
|---|---|---|
| 상단 타이틀 | `run.title ?? "session " + sessionId 앞 8자`, 옆에 `projectKey` 회색 | - |
| 범례 | 고정 4색: goal/조건=주황 `--c-goal: #ff9e3d`, 메인 에이전트=보라 `--c-main: #b48cff`, judge=파랑 `--c-judge: #5fb3ff`, 워커/기타=초록 `--c-worker: #4fd18b` | - |
| THE GOAL: 현재 turn/모델 | `turn {main.turns} · {main.model.label}` | 모델 null → `model n/a` |
| 조건 문구 | `run.goal.text` (최대 240자 표시, 넘으면 "…") . 그 아래 `run.currentPrompt` 가 goal 과 다르면 "latest: …" 1줄 | `n/a` |
| turns n/30 | `turns {main.turns}` (분모 없음) | - |
| tokens | `fmtTokens(run.totals.tokens)` | - |
| (R15) 사용 한도 블록 | tokens 행 바로 아래 `div.g-limits`(점선 위 경계). 행 2개(5h, 7d), 각 행 2줄: 1줄 = 라벨(`5h`/`7d`, 회색) · 가로 막대 · `76% left`(굵게, 수준 색). 2줄 = 왼쪽 `used 24%`(회색), 오른쪽 `resets in 2h 13m`(본문색 `--text`, 강조). 막대: 왼쪽부터 **사용한 부분**을 수준 색으로 채우고(`width = fillPct%`, fillPct = 사용량), 나머지 **남은 부분**은 줄무늬 트랙(`--line`/`--bg` 사선 반복)으로 구분. 수준 색: normal `--c-worker`(초록), warn(잔여 < 20) `--c-goal`(주황), danger(잔여 < 10) `--fail`(빨강). 블록 맨 아래 `lim-note` 1줄(사유/신선도) | 파일 없음: 두 행 `n/a`, 막대 점선 빈 트랙, 노트 `limits n/a · Pro/Max only, shown after first response`. 윈도우 하나만 없음: 그 행만 `n/a · no data`. 리셋 시각 경과: `reset` / `window reset` / `awaiting update`, 막대 점선 빈 트랙. 오래됨(15분 초과): 값 유지, 행 불투명도 0.6, 노트 `as of 25m 03s ago` |
| verdict | `run.verdict.status` (+ `run.verdict.text` 1줄) | 판정 노드 없음 → `n/a` |
| running 시간 | main.status 가 running 이면 `now - currentPrompt.ts`, idle 이면 `idle · last activity {fmtElapsed} ago`. R14 이후 알림으로 깬 턴도 running 이 되며, 이때도 기준은 마지막 사람 프롬프트 시각 그대로다(턴 시작 시각 필드는 이번에 추가하지 않음, 8장 참고) | `n/a` |
| judge 모델 설명 | `run.verdict.judgeId` 노드(3.5 최신 judge)의 `model.label` + `agentType` | `judge: n/a` |
| (R17) 등록 에이전트 | THE GOAL 패널 맨 아래(judge 줄 다음) `REGISTERED AGENTS (N)` + `+`/`−` 버튼, 행마다 name(역할 색) · 모델 label(패밀리 색), 마우스오버 시 description(3.16) | 목록 0개 → `none`. `/api/agents` 실패 → 패널 자체 생략. 모델 없음 → `inherit` |
| 메인 에이전트 박스 | 모델 label(보라 테두리), `activity`, `turn N`, 경과(`now - run.startedAt`), `permissionMode` | activity null → `—` |
| 중간 레이어 박스(점수 막대) | "model usage": `run.modelUsage` 를 label 별 output 토큰 가로 막대(최댓값 대비 비율 %, 최댓값 0 이면 분모 1, 모델 패밀리 색). **값 텍스트는 `fmtTokens(outputTokens)`(R8)** | 서브에이전트 0개여도 표시(메인 모델 1줄) |
| 병렬 워커 박스 | (R16) role 이 `main` 이 아닌 노드 전부(`worker` 와 `judge`), `run.nodes` 순서(startedAt 순). judge 는 테두리만 파랑(`.box.judge`), 내용은 워커와 동일. 박스: `agentType ?? id 앞 7자`, `description`, 모델 label, `{status} · tools N · {경과}`, `activity` | 워커 0개 → 점선 빈 박스 1개 "no subagents" |
| 워커 경과 | `startedAt` 이 null 이면 `—`. 아니면 `fmtElapsed((endedAt ? Date.parse(endedAt) : now) - Date.parse(startedAt))`. endedAt 은 3.5 toRunView 보정값이므로 meta.finished 로만 완료된 노드도 마지막 활동 시각에서 멈춘다(R7) | - |
| 진행률 % | 표시하지 않음. running 이면 무한 진행 막대(CSS 애니메이션), completed 면 꽉 찬 막대, failed 면 빨간 막대, pending/stale/idle 이면 빈 막대, pending 이면 `not started` | - |
| ~~최종 judge 박스~~ | **(R16 폐기)** 하단 단일 judge 박스, `pickJudge`, `after turn N`, `previous: N`, 흐린 `judge: n/a` 박스는 그리지 않는다. judge 는 위 "병렬 워커 박스" 행에서 실행마다 카드 1개. 판정 문구는 THE GOAL 패널 verdict 행(`run.verdict`)에서만 보인다 | - |
| session log | 3.11.1 | - |

- (R16 이후 화면에 표시하지 않음, `AgentNode.spawnedAtMainTurn` 필드와 reducer 규칙은 유지) "after turn N" = judge 노드의 `spawnedAtMainTurn`. reducer 는 메인의 `Agent`/`Task` tool_use 를 볼 때 `pendingSpawnTurn[toolUseId] = main.turns` 를 기록하고, 이후 `toolUseResult`(async 또는 동기)의 tool_use_id 나 `meta.toolUseId` 로 노드와 연결될 때 그 값을 노드에 복사한다. null 이면 `after turn n/a`.
- 상태별 시각 규칙: `running` → 테두리 글로우(`box-shadow: 0 0 12px var(--role-color)`) + 들어오는 연결선에 흐르는 점 애니메이션; `pending`/`idle`/`completed` → 글로우 없음, 연결선 정지 점선; `completed` 는 불투명도 0.75, `pending`/`stale`/데이터 없음 박스는 0.45; `failed` 는 테두리 `#ff5c5c`.
- 연결선 (R16 정정): SVG 오버레이 1장. 메인→중간(usage) 1개, 중간→각 카드(워커·judge) 1개씩. 워커→judge 선은 없다. flex-wrap 으로 아래 줄에 내려간 카드는 usage 대신 위 줄의 가로 중심이 가장 가까운 카드 아래 중앙에서 선을 시작한다(3.11 `renderFlow`). 경로는 출발 박스 아래 중앙 → 도착 박스 위 중앙의 세로 3차 베지어. 흐르는 점 = `stroke-dasharray: 2 8` + `stroke-dashoffset` CSS 애니메이션(1s linear infinite), 도착 노드가 running 일 때. 창 크기 변경 시 `ResizeObserver` 로 다시 계산(매 `renderFlow` 끝에도 다시 계산). 플로우 DOM 은 구조 서명(노드 id:role 목록, 모델 label 목록. judgeId 는 R16 에서 제외)이 바뀔 때만 다시 만들고 나머지는 제자리 갱신.
- 모델 표시 색: 박스 테두리는 **역할 색**(범례), 박스 안 모델 배지 글자색은 **패밀리 색**(`--m-opus: #c9a2ff`, `--m-sonnet: #7fc8ff`, `--m-haiku: #7ee2a8`, `--m-unknown: #9a9a9a`). unknown 은 배지에 원본 label 그대로.
- 레이아웃: 전체 다크 배경 `#0d0f12`, 모노스페이스 `ui-monospace, "Cascadia Mono", Consolas, monospace`, 터미널 창 상단 바에 신호등 점 3개(`#ff5f57`, `#febc2e`, `#28c840`). 그리드: 좌측 goal 패널 300px 고정 + 중앙 플로우 가변, 하단 log 높이 240px 스크롤. 워커 행은 `flex-wrap`, 박스 최소 폭 200px.
- (R15) 사용 한도 블록 CSS(`public/styles.css` 끝에 추가, 새 CSS 변수 없음). 패널 내부 폭 272px(300 − 좌우 padding 14×2)에서 깨지지 않도록 고정 폭은 라벨 22px 뿐이고 막대는 `minmax(0, 1fr)` 로 줄어든다:
  ```css
  .g-limits { border-top: 1px dashed var(--line); padding: 4px 0; }
  .g-limits.stale .lim { opacity: 0.6; }
  .lim { margin: 2px 0 4px; }
  .lim-top { display: grid; grid-template-columns: 22px minmax(0, 1fr) auto; gap: 8px; align-items: center; }
  .lim-label { color: var(--dim); }
  .lim-track { display: block; height: 8px; border-radius: 2px; overflow: hidden; background: repeating-linear-gradient(135deg, var(--line) 0 3px, var(--bg) 3px 6px); }
  .lim-fill { display: block; height: 100%; width: 0; }
  .lim-val { white-space: nowrap; text-align: right; font-weight: bold; }
  .lv-normal .lim-fill { background: var(--c-worker); }  .lv-normal .lim-val { color: var(--c-worker); }
  .lv-warn .lim-fill { background: var(--c-goal); }      .lv-warn .lim-val { color: var(--c-goal); }
  .lv-danger .lim-fill { background: var(--fail); }      .lv-danger .lim-val { color: var(--fail); }
  .ls-na .lim-track, .ls-expired .lim-track { background: transparent; border: 1px dashed var(--line); }
  .ls-na .lim-val, .ls-expired .lim-val { color: var(--dim); font-weight: normal; }
  .lim-sub { display: flex; justify-content: space-between; flex-wrap: wrap; gap: 0 8px; padding-left: 30px; font-size: 11px; color: var(--dim); }
  .lim-reset { color: var(--text); white-space: nowrap; }
  .lim-note { color: var(--dim); font-size: 11px; word-break: break-word; }
  ```
  - 가장 긴 값(`100% left` 9자, `resets in 23h 59m` 17자)에서도 1줄에 들어간다(약 7.2px/자 기준 막대 폭 ≥ 160px). 더 좁아지면 `.lim-sub` 가 줄바꿈되고 막대가 줄어들 뿐 넘치지 않는다. 기존 `.g-row`/`.bar`/`.u-*`/`.l-*` 클래스를 재사용하거나 바꾸지 않는다(이름 충돌 방지로 `lim-` 접두사).

### 4.2 사용 한도 흐름 (R15)

1. Claude Code(Pro/Max 로그인)가 응답을 받으면 300ms 디바운스 후 `statusLine.command` 를 실행하고 세션 JSON 을 stdin 으로 준다.
2. `scripts/statusline.mjs` 가 `rate_limits` 의 두 윈도우만 파싱한다. 없거나 깨졌으면 파일을 건드리지 않고 빈 출력으로 끝난다.
3. 있으면 `~/.claude/agent-ui/rate-limits.json` 을 읽어 3.12 규칙으로 병합하고 임시 파일 → rename 으로 교체한다. `updatedAtMs` = 지금.
4. 스크립트가 `5h 76% left · 7d 58% left` 한 줄을 stdout 에 쓰고 종료 코드 0 → Claude Code 터미널 상태 줄에 표시.
5. 브라우저 `app.js` 가 시작 시 1회 + 5초마다 `GET /api/limits` → 서버 `LimitsReader.read()` 가 stat 을 보고 바뀌었을 때만 파일을 다시 읽어 `{status, limits}` 반환.
6. 클라이언트는 `limitsResp` 를 보관하고, 1초 타이머의 `renderTick` 이 `renderGoal(…, Date.now(), limitsResp)` → `limitView` 가 `resetsAtMs - now` 로 남은 시간을, `updatedAtMs` 로 신선도를 계산 → `buildLimits` 로 DOM 생성.
7. 상태 저장 위치: 원본 = 한도 파일(스크립트만 씀), 서버 = `LimitsReader` 의 `key`/`last`(메모리), 브라우저 = `limitsResp`. 세션 SSE·Run·watcher 와 독립이며 세션을 바꿔도 같은 값이 보인다.
8. 리셋 시각이 지나면 Claude Code 가 그 윈도우를 빼고 스크립트를 다시 실행한다. 이번 입력에 그 윈도우가 없으므로 파일의 이전 값이 유지되고, 화면은 `nowMs >= resetsAtMs` 로 `reset · awaiting update` 를 보인다. 다음 응답에서 새 `resets_at` 이 오면 3.12 병합 규칙 3번으로 교체된다.

### 4.3 statusLine 적용 절차 (메인 에이전트 전용, 13g)

구현자는 이 절차를 수행하지 않는다. 13a~13f 완료·`npm test` 통과 후, 사용자 승인 하에 메인 에이전트가 수행한다.

- 넣을 항목(정확히 이 JSON, 최상위 키로 추가):
  ```json
  "statusLine": {
    "type": "command",
    "command": "node D:/mayadep/agent-ui/scripts/statusline.mjs"
  }
  ```
  - 경로는 슬래시(`/`) 표기, 공백이 없으므로 따옴표 없음(Git Bash·PowerShell 양쪽에서 같은 문자열로 동작, 1.3). 프로젝트 경로가 공백을 포함하게 바뀌면 `"node \"D:/path with space/scripts/statusline.mjs\""` 처럼 JSON 안에서 `\"` 로 감싼다.
  - `refreshInterval` 은 **넣지 않는다**. 값은 API 응답 때만 바뀌고 Claude Code 가 응답·리셋 시각마다 이미 재실행하므로 타이머 재실행은 새 정보를 주지 않는다. 오히려 쉬는 세션이 주기적으로 `updatedAtMs` 를 갱신해 신선도 표시(3.14)가 실제 데이터 나이를 가리게 된다.
  - `padding` 은 넣지 않는다(기본 0).
  - `--dump` 는 넣지 않는다. 13h 에서 파일이 생기지 않을 때만 진단용으로 `"node D:/mayadep/agent-ui/scripts/statusline.mjs --dump"` 로 잠시 바꾸고, 확인 후 원래 문자열로 되돌린다(같은 규칙·별도 백업).
- 절차:
  1. 사전 확인: `~/.claude/settings.json` 을 `JSON.parse` 로 읽는다. 파싱 실패 → 중단·보고. **`statusLine` 키가 이미 있으면 덮어쓰지 않고 중단·보고**한다. `disableAllHooks: true` 가 있으면 상태 줄이 실행되지 않으므로 중단·보고.
  2. 사전 점검: `node D:/mayadep/agent-ui/scripts/statusline.mjs < D:/mayadep/agent-ui/test/fixtures/statusline/input-docs.json` 이 종료 코드 0(문서 예시는 리셋 시각이 과거라 출력은 빈 문자열이 정상). 이 점검은 실제 `~/.claude/agent-ui/rate-limits.json` 을 만들 수 있으므로 끝난 뒤 그 파일을 삭제한다(문서 예시 값이 화면에 남지 않게).
  3. 백업: `~/.claude/settings.json` 을 같은 폴더의 `settings.json.bak-agent-ui-<YYYYMMDD-HHMMSS>`(로컬 시각) 로 바이트 그대로 복사하고, 복사본이 원본과 바이트 동일한지 확인.
  4. 적용: 파싱한 객체에 `statusLine` 키만 추가해 `JSON.stringify(obj, null, 2) + "\n"` 로 저장(UTF-8, BOM 없음). 다른 키는 추가·삭제·값 변경 금지(키 순서는 JSON.parse/stringify 가 보존, 새 키는 맨 뒤).
  5. 검증: 저장 파일을 다시 파싱해 (a) `statusLine` 이 위 JSON 과 deep-equal (b) `statusLine` 을 뺀 나머지가 백업을 파싱한 객체와 deep-equal. 하나라도 실패 → 즉시 6 의 롤백.
  6. 롤백 방법: 백업 파일을 `~/.claude/settings.json` 으로 다시 복사(바이트 그대로). 기능만 끄고 싶을 때는 `statusLine` 키 하나만 삭제해도 된다. 한도 파일(`~/.claude/agent-ui/`)은 삭제해도 무방(다음 응답에서 다시 생김).
  7. 반영: 실행 중인 Claude Code 세션은 설정 변경을 다음 갱신 때 반영하거나 재시작이 필요할 수 있다. 사용자에게 "상태 줄 추가로 footer 키 힌트(`esc to interrupt` 등)가 숨겨진다" 는 점을 함께 알린다(1.3).

### 4.4 등록 에이전트 흐름 (R17)

1. 페이지 로드 시 `app.js` `main()` 이 `connect` 직후 `loadAgents()` 를 1회 호출 → `GET /api/agents`.
2. 서버(`route()`, Host 검증 후)가 `listAgents(cfg.agentsDir, cfg.judgeAgentTypes)` 로 `~/.claude/agents/*.md` 를 그 자리에서 읽어 `{ agents }` 반환. 서버 메모리에 보관하지 않는다.
3. 클라이언트가 모듈 변수 `agents` 에 저장하고 `renderTick()`. 이후 1초 타이머의 `renderTick` 이 매번 `renderGoal(…, agents)` 로 패널을 다시 만든다(접힘 상태는 `panels.js` 모듈 변수에서).
4. 요청이 실패하면 `agents` 는 null 로 남고 패널은 그려지지 않는다. 재시도·폴링 없음. 에이전트를 새로 등록하면 사용자가 새로고침한다.
5. 상태 저장 위치: 원본 = `~/.claude/agents/*.md`(읽기만), 서버 = 없음, 브라우저 = `agents`(app.js), `agentsCollapsed`(panels.js) + `localStorage["agent-ui.agentsCollapsed"]`(`"1"`/`"0"`). 세션 SSE·Run·watcher 와 독립.

## 5. 하지 말아야 할 것

- npm 패키지(프레임워크, 번들러, 차트 라이브러리, chokidar, ws, jsdom 등)를 추가하지 않는다. `package.json` 에 `dependencies`/`devDependencies` 를 만들지 않는다. DOM 이 필요한 로직은 `LogIndex`/`limitView` 처럼 순수 함수로 분리해 테스트한다.
- `~/.claude` 아래 어떤 파일도 쓰거나 이동·삭제하지 않는다. `settings.json` 에 훅을 추가하지 않는다. 트랜스크립트는 읽기 전용으로만 연다. (R15 예외 두 가지만 허용: ① `scripts/statusline.mjs` 가 `~/.claude/agent-ui/` 폴더를 만들고 그 안의 `rate-limits.json`, `statusline-input.json`(`--dump` 일 때만)과 그 임시 파일만 쓰기·삭제 ② 메인 에이전트가 4.3 절차로 `settings.json` 에 `statusLine` 키 1개 추가)
- 실제 트랜스크립트를 테스트 픽스처로 복사하지 않는다(프롬프트/개인정보 포함). 픽스처는 손으로 쓴 가짜 데이터만 쓴다.
- 같은 `message.id` 의 여러 줄 usage 를 모두 더하지 않는다(토큰이 수 배로 부풀어 오른다). message.id 당 마지막 값 1회만 합산한다. turns 도 줄 수가 아니라 고유 message.id 수로 센다.
- `<synthetic>` 을 모델로 표시하거나 노드 모델을 그것으로 덮어쓰지 않는다.
- 서브에이전트 ↔ Agent 호출을 시작 순서나 시간 근접성으로 추정하지 않는다. 반드시 `toolUseResult.agentId`(+tool_use_id), `meta.toolUseId`, task-notification 의 `task-id` 로만 연결한다. 연결 근거가 없으면 연결하지 않는다.
- 로그에 없는 값(진행률 %, turn 상한 30, 점수)을 지어내지 않는다. 없으면 4.1 표대로 생략하거나 `n/a`.
- 매 poll 마다 파일 전체를 다시 읽지 않는다(세션 파일은 1 MB 를 쉽게 넘는다). 축소 감지 시에만 전체 재읽기.
- `fs.watch` 를 유일한 변경 감지 수단으로 쓰지 않는다(Windows 에서 append 이벤트 누락/중복). 폴링을 기본으로 한다.
- 화면에 프롬프트/도구 입력 원문 전체를 보내지 않는다. 서버에서 `clip` 한 문자열만 Run/Event 에 담는다(goal 240자, 그 외 3장 상한).
- `innerHTML` 에 트랜스크립트 유래 문자열을 넣지 않는다.
- `0.0.0.0` 이나 루프백 외 주소에 바인딩하지 않는다. URL 경로의 projectKey/sessionId 를 검증 없이 `path.join` 하지 않는다.
- 레퍼런스처럼 워커 박스를 3개로 고정하지 않는다. 실제 서브에이전트 수만큼 그린다.
- graph-flow(`D:\mayadep\graph-flow`) 코드를 복사하거나 수정하지 않는다.
- (R1) update 마다 `resetLog` 로 로그 전체를 다시 그리지 않는다. `resetLog` 는 snapshot 에서만 호출한다.
- (R1) 로그 정렬을 서버에서 하지 않는다(서버 seq 의미를 바꾸지 않는다). ts 를 문자열 비교로 정렬하지 않는다(`Date.parse` 값으로 비교; 원본 형식이 `Z`/오프셋으로 섞일 수 있음). ts 가 없는 이벤트를 버리거나 `NaN` 키로 비교하지 않는다.
- (R1) 정렬 위치를 찾기 위해 행 전체를 다시 정렬하거나 DOM 을 순회해 키를 읽지 않는다. `LogIndex.rows` 를 이진 탐색한다.
- (R2) `Event.verdict` 에 judge 의 resultText 나 판정 문구를 넣지 않는다. 이미 그려진 로그 행을 나중에 고쳐 판정을 채우지 않는다. 판정 문구는 `Run.verdict.text` 하나로만 전달한다.
- (R2) handback 을 기다리려고 완료 알림 이벤트를 지연·보류하거나 poll 순서를 서브에이전트 먼저로 바꾸지 않는다.
- (R3) Host 검증에서 `cfg.port` 와 비교하지 않는다(포트 0 이면 항상 실패). 포트 없는 Host 를 허용하지 않는다. `Host` 의 접두/포함 검사(`startsWith("localhost")` 등)로 판정하지 않는다(`localhost.evil.com` 우회). Origin/Referer 검사로 Host 검증을 대체하지 않는다.
- (R4) 정수 옵션을 `parseInt`/`Number` 만으로 받아들이지 않는다(`parseInt("80abc")` = 80, `Number("1e3")` = 1000, `Number("")` = 0). `/^\d+$/` 를 먼저 통과해야 한다. 잘못된 값을 기본값으로 조용히 대체하지 않는다.
- (R5) poll 예외로 프로세스를 종료하거나 watcher 를 stop 하지 않는다. 매 poll 마다 같은 에러를 반복 출력하지 않는다. 예외 후 tailer 오프셋을 되감아 같은 레코드를 다시 적용하지 않는다.
- (R7) `applyMeta` 에서 상태의 `endedAt` 을 `lastActivityAt` 으로 저장하지 않는다(뷰에서만 보정).
- (R14) main.status 를 `running` 으로 바꾸거나 `turnEnded` 를 해제하는 코드를 `wakeMain` 밖에 두지 않는다. (W0~W2) 외 근거를 추가하지 않는다.
- (R14) `queue-operation` enqueue 로 메인을 깨우지 않는다(메인이 바쁠 때도 기록되며 실제 전달은 뒤따르는 `user` 알림 레코드다).
- (R14) (W2) 를 `handleNotification` 의 반환값(이벤트 유무)에 묶지 않는다. 같은 알림이 queue-operation 에서 먼저 처리돼 `user` 레코드에선 null 이 나오므로 깨움이 누락된다.
- (R14) `<synthetic>` assistant, `isSidechain:true` 레코드, 서브에이전트 소스 레코드로 메인을 깨우지 않는다. 서브에이전트 노드의 기존 running/재개 규칙을 메인에 재사용하지 않는다.
- (R14) 턴 종료를 timestamp 비교(예: assistant ts 가 종료 레코드 ts 보다 늦으면 running)로 판정하지 않는다. 판정은 레코드 적용 순서만 쓴다(1.2 조사 근거). 첫 로드용 별도 분기·후처리(파일 끝에서 상태 재계산 등)를 두지 않는다.
- (R14) 종료 레코드마다 `turn_end` 를 내도록 `turnEnded` 가드를 없애지 않는다. `turn_end` 중복 방지는 `turnEnded` 하나로만 한다.
- (R14) 이 변경을 위해 Run/Event/AgentNode 스키마, 클라이언트(`public/`), watcher, 기존 픽스처 파일을 바꾸지 않는다. 새 테스트 레코드는 테스트 파일 안에서 객체 리터럴로 만든다.
- (R15, settings.json) **구현자는 `~/.claude/settings.json` 을 읽기 외 어떤 방식으로도 건드리지 않는다**(테스트에서도). 적용은 4.3 절차로 메인 에이전트만. 메인 에이전트도: `statusLine` 키 추가 외 변경 금지(기존 키·값·hooks 불변), 이미 `statusLine` 이 있으면 덮어쓰거나 병합하지 않고 중단, 백업 없이 적용 금지, 사용자 승인 없이 적용 금지. `refreshInterval`·`padding`·`--dump` 를 기본 적용에 넣지 않는다.
- (R15) 한도 값을 statusLine stdin 외 경로로 얻지 않는다: 비공식 usage API 호출, OAuth/자격 증명 파일(`~/.claude/.credentials.json` 등) 읽기, claude.ai 스크래핑, 트랜스크립트에서 `You've hit your session limit` 문구로 추정 모두 금지. 스크립트와 서버는 네트워크에 접근하지 않는다.
- (R15) 스크립트가 stdin 원문 전체를 기본 저장하지 않는다. `rate-limits.json` 에는 3.12 스키마 필드만 쓴다(cwd, transcript_path, model, cost 등 금지). 원문 덤프는 `--dump` 인자일 때만, `statusline-input.json` 한 파일에 덮어쓴다(누적 파일·타임스탬프 파일 금지).
- (R15) 스크립트가 비 0 종료 코드로 끝나거나 stdout 에 오류 메시지·스택을 쓰지 않는다(상태 줄이 비거나 오류가 노출됨). 오류는 stderr 한 줄만. `rate_limits` 가 없거나 깨진 입력에서 한도 파일을 삭제하거나 빈 값으로 덮어쓰지 않는다.
- (R15) 한도 파일을 `fs.writeFileSync(target)` 로 직접 덮어쓰지 않는다(Claude Code 가 실행 중인 스크립트를 취소할 수 있어 반쯤 쓴 파일이 남음). 반드시 같은 폴더 임시 파일 → `renameSync`. 파일 잠금(lock 파일)은 만들지 않는다.
- (R15) 병합에서 "마지막 기록 무조건 우선" 으로 덮어쓰지 않는다(쉬던 세션의 낮은 값이 최신 값을 덮음). 3.12 `mergeWindow` 규칙만 쓴다.
- (R15) 리셋 시각이 지난 윈도우를 사용량 0/잔여 100% 로 표시하지 않는다. 값이 없는 윈도우·파일 없음을 0% 로 표시하지 않는다. `n/a` + 사유.
- (R15) 표시 %를 `Math.round`/`toFixed` 로 반올림하지 않는다(잔여 과대 표시, 임계값 경계 불일치). 잔여는 `Math.floor`, 사용은 `100 - 잔여표시`. 임계값 숫자(20, 10)를 CSS·`limitView` 본문에 직접 쓰지 않고 `LIMIT_WARN_REMAINING`/`LIMIT_DANGER_REMAINING` 상수만 참조한다.
- (R15) 서버에서 한도 파일 경로를 요청(URL·쿼리·헤더)으로 만들지 않는다. CLI 옵션도 추가하지 않는다. 서버는 한도 파일에 쓰지 않는다. 요청마다 `LimitsReader` 를 새로 만들지 않는다. `fs.watch`/서버 쪽 폴링 타이머를 두지 않는다.
- (R15) 한도를 `Run`, SSE `snapshot`/`update` 페이로드, `SessionWatcher` 에 넣지 않는다. 별도 SSE 이벤트도 만들지 않는다(3.9 의 `GET /api/limits` 하나).
- (R15) 남은 시간을 서버 시각으로 계산해 보내지 않는다. 클라이언트가 `resetsAtMs - Date.now()` 로 1초마다 계산한다. 1초 타이머에서 `/api/limits` 를 요청하지 않는다(요청은 `LIMITS_POLL_MS` 간격만).
- (R15) `buildLimits`/`renderGoal` 에서 `innerHTML` 을 쓰지 않는다. `public/js/limits.js` 모듈 최상위에서 `document` 에 접근하지 않는다.
- (R16) judge 를 다시 하단 단일 박스로 모으거나 최신 judge 만 그리고 나머지를 숨기지 않는다. judge 카드용 별도 빌더·별도 행을 만들지 않는다(역할 클래스 `box judge` 와 CSS 변수 `--role-color` 만으로 구분). 구조 서명에 judgeId 를 다시 넣지 않는다(판정 노드가 바뀔 때마다 플로우 DOM 이 재생성돼 애니메이션이 끊김).
- (R16) 줄바꿈된 카드의 연결선을 usage 에서 직접 그어 윗줄 카드를 가로지르게 두지 않는다. 연결선 출발점을 카드 인덱스·열 수 계산(`i % cols` 등)으로 정하지 않는다(카드 폭이 가변이라 열 수가 고정이 아님). 반드시 실제 `getBoundingClientRect` 위치로 고른다.
- (R16/R17) judge 분류 목록을 `flow.js`·`panels.js`·`agents.js` 에 하드코딩하지 않는다. 역할은 서버가 `cfg.judgeAgentTypes` 로 정해 `role` 필드로 내려준다.
- (R17) `/api/agents` 경로를 요청(URL·쿼리·헤더)으로 만들지 않는다. `agentsDir` CLI 옵션을 추가하지 않는다. 서버가 `~/.claude/agents/` 에 쓰지 않는다.
- (R17) 프런트매터 파싱을 위해 YAML 라이브러리를 추가하지 않는다. 등록 목록에 프롬프트 본문(프런트매터 뒤 내용)이나 `tools` 등 name/description/model 외 필드를 내려보내지 않는다. description 은 서버에서 200자로 자른다.
- (R17) 파일 하나를 못 읽었다고 목록 전체를 실패시키거나 500 을 내지 않는다(그 항목만 건너뜀). 폴더가 없으면 404 가 아니라 `200 { agents: [] }`.
- (R17) 프로젝트별 `.claude/agents/`, 플러그인 에이전트 폴더를 읽지 않는다(1장 비목표). 등록 목록을 SSE/Run 에 넣거나 클라이언트 타이머로 폴링하지 않는다. 변경 감지가 필요해지면 `LimitsReader` 같은 서버 쪽 mtime 캐시로 하고 이 문서를 먼저 고친다.
- (R17) 접힘 상태를 DOM 에서 읽어 복원하지 않는다(1초마다 패널을 다시 만들므로 사라짐). `localStorage` 접근을 `try/catch` 없이 하지 않는다(저장소 차단 환경에서 모듈 로드가 실패함). 접기/펴기 때 `renderGoal` 전체를 다시 호출하지 않는다.
- (R15) 스크립트가 다른 프로젝트 파일(`src/…`)을 import 하거나 서버가 `scripts/statusline.mjs` 를 import 하지 않는다(스크립트는 단일 파일로 독립 실행, 두 쪽의 스키마 호환은 13b end-to-end 테스트로 보장). 테스트가 실제 `~/.claude/agent-ui` 에 쓰지 않는다(자식 프로세스는 `USERPROFILE`/`HOME` 을 임시 폴더로, 함수 테스트는 `dir` 인자로).

## 6. 결정 기록

| 결정 | 검토한 대안 | 선택 이유 |
|---|---|---|
| 데이터 소스 = 트랜스크립트 jsonl 폴링 읽기 | (B) Claude Code hooks 로 이벤트 push: 실시간성 좋음, 그러나 전역 settings 수정 필요·설치 전 세션은 못 봄·graph-flow 경험상 서브에이전트 id ↔ 호출 연결을 추정해야 함·모델명이 훅 입력에 없음. (C) 수동 JSON: 구현 쉬우나 실제 실행을 못 봄 | 설정 변경 없이 과거/현재 세션 모두 표시, 모델(`message.model`, `resolvedModel`)·토큰·연결키(`agentId`, `toolUseId`)가 전부 파일에 있음(1.2). 단점: 비공개 형식이라 바뀔 수 있음 → reducer 가 모르는 필드/type 을 무시하도록 설계, 형식 변화는 reducer 한 곳만 고치면 됨. (C) 는 픽스처 디렉터리를 `--projects-root` 로 가리키는 방식으로 이미 지원됨 |
| 변경 감지 = stat+바이트 오프셋 폴링 750ms | `fs.watch`(Windows 에서 신뢰성 낮음), `fs.watchFile`(내부적으로 폴링, 파일 단위라 새 서브에이전트 파일 발견은 별도 필요) | 단순하고 결정적. 세션 1개당 파일 수십 개 stat 은 부담 없음 |
| 브라우저 푸시 = SSE | WebSocket: 양방향이지만 표준 라이브러리에 서버 구현 없음(직접 프레이밍 필요 또는 `ws` 의존성) | 단방향 푸시만 필요, `EventSource` 자동 재연결, 의존성 0 |
| 스택 = Node 24 표준 라이브러리 서버 + 정적 vanilla JS/CSS/SVG | Vite+React: 컴포넌트화 편하나 의존성 수백 개·빌드 단계. Python 표준 라이브러리: 설치돼 있으나(graph-flow) 사용자가 Node 안을 제시, 프론트와 언어 통일 이점 없음 | Node 설치 확인됨, 화면 영역 4개 수준이라 프레임워크 불필요, `node --test` 로 테스트도 의존성 0 |
| 서버에서 파생 상태 계산(reducer), 클라이언트는 렌더만 | 원본 레코드를 그대로 브라우저로 보내 클라이언트에서 계산 | 원문 노출 최소화(5장), 테스트를 Node 에서 순수 함수로 가능, 대용량 세션 전송 회피 |
| 전송 단위 = 매 update 마다 Run 전체 + 새 이벤트만 | JSON patch 차분 | Run 은 노드 수십 개 수준이라 작음. 차분 로직 버그 위험 제거 |
| goal = 첫 사람 프롬프트, latest = 마지막 사람 프롬프트 | 마지막 프롬프트만 goal 로 | 레퍼런스의 "목표"는 세션 전체 조건이라 첫 요청이 더 가까움. 현재 작업은 latest 로 함께 보임 (8장 질문 2) |
| judge = `agentType` 이 설정 목록(기본 `judge`, `reviewer`, `verifier`, `tester`, `security-reviewer`. R16/R17 에서 `tester`, `security-reviewer` 추가)에 속하는 서브에이전트 | 별도 모델을 쓰는 서브에이전트를 judge 로 / judge 생략 | 사용자 파이프라인(설계→구현→검토)의 검토자가 판정 역할에 해당. 모델 기준은 워커도 다른 모델을 쓸 수 있어 오분류. 설정으로 바꿀 수 있음 |
| 중간 레이어 = 모델별 output 토큰 막대 | 도구 호출 수 막대 / 박스 생략 | 레퍼런스의 막대 그래프 자리를 실제 데이터로 채우면서 "모델" 주제와 일치 (8장 질문 3) |
| 테두리 = 역할 색, 모델 배지 = 패밀리 색 | 모델 패밀리 색 하나로 통일 | 범례(역할)를 레퍼런스대로 유지하면서 같은 역할 안에서도 모델 차이가 보임 (8장 질문 4) |
| 포트 8770 | 8765/8766 | graph-flow 가 사용 중 |
| (R1) 로그 표시 순서 = ts 오름차순, 동률 seq (기존 "seq 순" 결정을 뒤집음) | (A) seq 순 유지: 구현 단순, 그러나 메인/서브에이전트 파일을 따로 읽어 서브에이전트 활동이 시간과 무관하게 뭉쳐 보임. (B) 서버가 poll 단위로 레코드를 ts 병합 정렬해 seq 를 시간순으로 부여: 다음 poll 에 더 이른 레코드가 오면 여전히 역전, 서버 복잡도 증가 | 사용자 요청. 클라이언트 정렬은 서버 seq 의미(적용 순서, 중복 제거 키)를 유지하면서 표시만 고침 |
| (R1) ts 없는/파싱 불가 이벤트 = seq 상 직전 유효 키 상속, 없으면 0 | (A) 맨 뒤(+∞): 이후 정상 이벤트가 영원히 그 앞에 끼어 "맨 뒤" 행이 고정됨. (B) 버림: 정보 손실 | 그 이벤트를 낳은 레코드와 같은 파일의 직전 레코드 근처에 놓일 가능성이 가장 높고, 결정적이며 상태가 숫자 1개 |
| (R1) 로그 갱신 = `LogIndex` 증분(append/이진탐색 삽입), snapshot 에서만 reset | (A) 매 update 전체 재구성(현 구현): 최대 1000행 DOM 재생성, 스크롤·선택 끊김. (B) 순서 역전이 있을 때만 전체 재구성: 서브에이전트 이벤트는 거의 항상 역전이라 사실상 (A) 와 같음 | 정렬 위치 계산을 DOM 없는 순수 클래스로 분리해 Node 테스트 가능. 삽입은 O(log n) 탐색 + DOM 1회 |
| (R2) Event.verdict = done/failed 만, 판정 문구는 Run.verdict.text 만 | (A) handback 적용 후 기존 agent_done 이벤트의 verdict 를 갱신해 재전송: 이벤트 불변성 깨짐, 클라이언트에 행 갱신 프로토콜 필요. (B) poll 순서를 서브에이전트 먼저로: 서브에이전트 완료 알림 외 다른 순서 문제 유발, 같은 poll 에 안 들어오면 여전히 실패 | 가장 단순. Run 은 매 update 마다 통째로 오므로 handback 이 늦게 읽혀도 judge 박스·goal 패널의 판정 문구가 자연히 채워짐. 로그 행은 "완료됐다" 사실만 표시 |
| (R3) Host 헤더 화이트리스트(포트 필수, 실제 listen 포트 비교) | (A) 검증 없음: DNS rebinding 으로 외부 페이지가 로컬 데이터 읽기 가능. (B) Origin 검사: 같은 출처 GET/EventSource 는 Origin 을 안 보낼 수 있어 판정 불가 | 3개 문자열 비교로 끝나는 가장 단순한 rebinding 방어 |
| (R5) poll 예외 = 같은 메시지 최초 1회 + 복구 1회 로그 | (A) 매번 로그: 750ms 마다 폭주. (B) 시간 기반 rate limit: 상태·시간 의존 테스트 복잡 | 메시지 문자열 1개 상태로 충분, 결정적 테스트 가능 |
| (R6) fmtTokens 는 toFixed 결과로 단위 승격 판단 | 원값 기준 경계(`v < 1e6`) | 원값 기준이면 999950 → `"1000.0k"` 가 나옴. 표시 문자열 기준이 직관적 |
| (R14) 메인 깨움 = 비-synthetic·비-sidechain 메인 assistant + 알려진 서브에이전트 task-notification `user` 레코드 (+기존 사람 프롬프트), `turnEnded` 해제는 깨움과 한 함수로 | (A) assistant 만: 알림 레코드와 첫 assistant 사이(수 초) 동안 idle 로 보이지만 단순. (B) `queue-operation` 도 근거로: 메인이 바쁠 때 enqueue 가 턴 중간에 기록되어 무해하나, idle 중 enqueue 후 dequeue 없이 끝나는 경우 running 고착 위험. (C) 종료 레코드 대신 timestamp 로 턴 경계 추정: 파일 간 순서 문제(1.2)와 무관한 메인 파일 내부 순서가 이미 결정적이라 불필요하게 복잡. (D) `turnEnded` 가드 제거: 두 subtype 이 같이 오는 턴(119건)에서 `turn_end` 2회 | 사용자 승인 규칙. 실제 로그 96개에서 종료 레코드 뒤 user 없이 assistant 가 오는 경우 0건이라 레코드 순서만으로 상태가 결정적이고, 첫 로드와 증분 적용이 같은 결과를 낸다. 알림 레코드는 메인에 실제 전달된 시점이라 (A) 의 공백을 메운다 |
| (R15) 데이터 소스 = statusLine 명령 스크립트가 파일로 남김 | (A) 비공식 usage API/자격 증명 파일: 문서화되지 않아 언제든 깨지고 토큰 취급 위험. (B) 트랜스크립트의 한도 초과 문구 추정: 수치 없음. (C) 훅 입력·OTEL: 필드 없음(확인) | 유일한 공식 경로(1.3). 대가로 settings.json 1키 변경이 필요하며 사용자가 승인 |
| (R15) 브라우저 전달 = 별도 `GET /api/limits` + 클라이언트 5초 폴링 | (A) 기존 SSE snapshot/update 에 `limits` 필드 추가: 세션과 무관한 전역 값을 세션 watcher 가 알아야 하고, 한도만 바뀔 때 update 를 낼 경로가 없어 watcher 에 파일 폴링을 추가해야 함. Run 스키마·http 테스트 영향. (B) 같은 SSE 연결에 `limits` 이벤트 추가: 전역 허브(타이머·구독 관리) 신설 필요, 코드량 최다 | 값은 API 응답 때만 바뀌고(분 단위) 남은 시간은 클라이언트가 계산하므로 5초 지연은 무의미. 기존 Run/SSE/watcher/테스트 무변경, 서버는 요청 시 stat 1회. 세션 미선택·SSE 재연결과 독립 |
| (R15) 여러 세션 동시 기록 = 윈도우별 병합(새 윈도우는 resetsAt 큰 쪽, 같은 윈도우는 used 최대) | (A) 마지막 기록 무조건 우선: 쉬던 세션이 재실행될 때 낡은 낮은 값으로 덮음. (B) 세션별 파일 + 서버가 합침: 파일 정리 문제, 서버 로직 증가. (C) 잠금 파일: 취소된 스크립트가 잠금을 남길 위험 | 한 윈도우 안 사용량은 단조 증가라는 성질만으로 결정적. rename 원자성으로 파일은 항상 완전. 경합으로 빠진 갱신은 다음 실행에서 회복 |
| (R15) 같은 윈도우 판정 허용 오차 60초 | 정확히 같은 `resets_at` 만 같은 윈도우로 | 실계정에서 `resets_at` 이 응답마다 초 단위로 흔들릴 가능성(미검증)에 대비. 5시간 윈도우 간격보다 충분히 작아 다른 윈도우와 혼동 없음 |
| (R15) 입력 없음·깨짐 = 파일 유지(삭제 안 함) | 파일 삭제 또는 빈 값 기록 | 한 세션의 부재(첫 응답 전, 다른 계정 방식)가 다른 세션의 유효 값을 지우면 안 됨. 만료는 `resetsAtMs`, 오래됨은 `updatedAtMs` 로 화면이 판단 |
| (R15) 디버그 덤프 = `--dump` 명령 인자, 기본 꺼짐, 최근 1건 덮어쓰기 | 환경변수: `command` 가 Git Bash 또는 PowerShell 로 실행되어 인라인 환경변수 문법이 셸마다 다름. settings `env` 키는 settings 추가 변경이 필요 | 인자는 두 셸에서 같은 문자열로 동작. 실계정 필드 확인(실계정 미검증 위험 대응)용으로만 잠시 켬 |
| (R15) `refreshInterval` 미설정 | 60초 설정 | 4.3 참조. 신선도 표시의 의미(마지막 응답 무렵)를 지키고 세션당 주기적 node 실행을 피함 |
| (R15) 표시 = 잔여 내림, 사용 = 100 − 잔여, 수준 판정은 내림 전 값 | 반올림 표시 | 잔여를 과대 표시하지 않고, `19% left` 가 보이면 항상 warn 색 — 숫자와 색이 어긋나지 않음 |
| (R15) 막대 = 사용한 만큼 왼쪽→오른쪽으로 채우고 색은 잔여 수준(녹색/주황/빨강), 남은 부분은 줄무늬 트랙. 글자는 `N% left` 유지 | 남은 양을 채우는 줄어드는 막대 | 사용자 요청(2026-10-29): 줄어드는 막대 대신 사용량이 차오르는 일반 진행 막대. 잔여 확인은 `% left` 글자와 색이 맡는다 |
| (R15) 스크립트 단일 파일, 서버는 자체 검증(`normalizeLimits`) | 공통 스키마 모듈을 둘이 import | 사용자 요구(단일 파일·독립 실행). 스키마 중복은 필드 4개 수준이고 end-to-end 테스트가 호환을 보장 |
| (R16) judge = 워커 행에서 실행마다 카드 1개(파란 테두리), 단일 judge 박스 폐기 | (A) 기존 단일 박스 + `previous: N`: 검토를 여러 번 돌리면 이전 실행의 상태·모델·활동이 보이지 않음. (B) judge 전용 하단 행에 카드 나열: 행이 하나 더 생기고 연결선(워커→judge)이 카드 수의 곱으로 늘어남 | 사용자 요청. 같은 빌더·같은 행을 재사용해 코드가 줄고(`pickJudge` 삭제), 역할은 테두리 색으로 충분히 구분. 판정 문구는 goal 패널 verdict 행이 계속 담당 |
| (R16) 줄바꿈 카드의 연결선 = 위 줄에서 가로 중심이 가장 가까운 카드에서 시작 | (A) 모두 usage 에서: 아래 줄 선이 윗줄 카드를 가로지름. (B) 열 인덱스 계산: 카드 폭 가변이라 열이 고정이 아님 | 실제 렌더 좌표만으로 결정, 추가 상태 없음. 3줄 이상에서 두 줄 위 카드를 고를 수 있는 한계는 3.11 에 기록 |
| (R17) 등록 에이전트 = 별도 `GET /api/agents`, 페이지 로드 시 1회, 서버 캐시 없음 | (A) SSE snapshot 에 포함: 세션과 무관한 전역 값이 Run 스키마에 섞임. (B) 클라이언트 폴링/서버 mtime 캐시: 등록 변경은 드물어 비용 대비 이득 없음 | 가장 단순. 파일 수십 개 수준이라 요청 시 직접 읽어도 부담 없음. 필요해지면 `LimitsReader` 방식 mtime 캐시로 확장(1장 비목표) |
| (R17) 프런트매터 = 자체 최소 파서(한 줄 `key: value`, 따옴표 한 쌍 제거, `\|`/`>` 블록 접기) | YAML 라이브러리 | 의존성 0 원칙. 필요한 키는 name/description/model 3개뿐이고 실제 에이전트 파일의 description 이 블록 스칼라·따옴표를 쓰는 경우를 덮음 |
| (R17) 역할 분류 = 에이전트 name 에 `classifyRole` | 프런트매터의 별도 필드 | Claude Code 의 `subagent_type` 이 에이전트 name 이라 서브에이전트 노드 분류(3.3)와 같은 결과. 설정 하나(`judgeAgentTypes`)로 두 곳이 일치 |
| (R17) 접힘 상태 = `panels.js` 모듈 변수 + `localStorage`(try/catch) | DOM 속성에 보관 / 서버 저장 | 패널이 1초마다 다시 만들어져 DOM 보관은 사라짐. 새로고침 후 유지는 사용자 편의, 저장소 차단 시에도 동작 |

## 7. 구현 단계

| 단계 | 내용 | 완료 조건 (테스트/검증) |
|---|---|---|
| 1 | `package.json`, `src/config.js`, `src/core/models.js`, `test/models.test.js` | (완료) `npm test` 통과. 3.2 의 예시 5개 + `null`/`""`/`"<synthetic>"` → null, `"claude-opus-5-5[1m]"` → `{family:"opus", version:"5.5", label:"opus 5.5", variant:"1m"}` 를 단언. `loadConfig(["--port","x"])` 가 throw |
| 2 | `src/core/summarize.js`, `src/core/roles.js`, 테스트 | (완료) 3.4 규칙별 1개 이상 케이스. `parseTaskNotification` 이 1.2 형식 문자열에서 `{taskId, toolUseId, status:"failed", summary}` 추출, 태그 없는 문자열 null. `isHumanPrompt` 가 task-notification/tool_result/isMeta/`<command-` 레코드에 false |
| 3 | `src/core/tailer.js`, `test/tailer.test.js` | (완료) 임시 파일로: (a) 2줄 쓰고 readNew → 2개 (b) 줄 중간까지 쓰고 readNew → 0개, 나머지 쓰고 → 1개 (c) 한글 문자의 바이트 중간에서 끊어 써도 복원 (d) 잘못된 JSON 줄 → badLines 1 (e) 파일을 더 작게 덮어쓰면 reset true (f) 없는 파일 → 빈 결과 |
| 4 | 픽스처 작성 | (완료) 픽스처 각 줄이 `JSON.parse` 가능 |
| 5 | `src/core/reducer.js`, `test/reducer.test.js` | (완료) 기존 조건 유지. 단 "reviewer `verdict.status:"done"`·text" 는 `Run.verdict` 에 대한 조건이며, 이벤트 verdict 조건은 10c 로 대체 |
| 6 | `paths.js`, `session-watcher.js`, `http.js`, `main.js`, `test/http.test.js` | (완료) 기존 조건 유지 |
| 7 | `public/index.html`, `styles.css`, `js/dom.js`, `js/format.js`, `js/panels.js`, `js/log.js`, `js/app.js` | (완료) 기존 조건 유지. 단 "log 행이 seq 순" 은 10a/10b 의 "ts 순" 으로 대체 |
| 8 | `public/js/flow.js` | (완료) 기존 수동 체크리스트 유지 |
| 9 | 실제 세션 검증 | (완료) 보고로 남김 |
| 10a | `public/js/log.js`: `eventTimeMs`, `sortEvents`(3.11.1 key 규칙으로 교체), `MAX_ROWS` export, `LogIndex`, `resetLog`(LogIndex 사용), `appendLog` 신설 | `test/log.test.js` 통과(11 의 log 항목). `log.js` 를 Node 에서 import 해도 예외 없음(모듈 최상위에서 `document` 미접근) |
| 10b | `public/js/app.js`: update 처리에서 `lastSeq` 필터 + `appendLog` 사용, `resetLog` 는 snapshot 에서만 | `grep -n resetLog public/js/app.js` 결과가 snapshot 핸들러 1곳뿐. 수동: 서브에이전트가 도는 실제 세션에서 서브에이전트 행이 시간순 위치에 끼어 들어가고, 개발자 도구 Elements 에서 update 시 기존 행 노드가 교체되지 않음(행에 임의 속성을 붙여 두고 update 후에도 남아 있는지 확인) |
| 10c | `src/core/reducer.js`: `handleNotification` 의 judge resultText verdict 분기 삭제(항상 `"done"`/`"failed"`), `toRunView` 의 completed/failed endedAt 보정 | `test/reducer.test.js` 추가 항목(11 의 reducer 항목) 통과. 픽스처에서 reviewer 의 `agent_done` 이벤트 verdict === `"done"` 이고 `run.verdict.text` 는 handback 첫 줄 |
| 10d | `src/server/http.js`: `isAllowedHost` export, handler 최상단 Host 검증(403), `server.address().port` 사용 | `test/http.test.js` Host 항목 통과. 기존 http 테스트(fetch/http.get 이 `127.0.0.1:<port>` Host 를 보냄) 전부 계속 통과 |
| 10e | `src/config.js`: `/^\d+$/` 정수 파서, `--port` 0~65535, `--poll-ms` ≥ 1, 에러 메시지 3.10 대로 | `test/config.test.js` 통과. `node src/server/main.js --port 70000` 실행 시 stderr 에 `agent-ui: invalid value for --port: 70000`, 종료 코드 1 |
| 10f | `src/core/session-watcher.js`: `poll()`·flush·stale 재확인 try/catch, `lastPollError` 기반 로그 1회/복구 1회 | `test/watcher.test.js` 의 poll 예외 항목 통과 |
| 10g | `public/js/format.js` `fmtTokens` 규칙 교체, `public/js/flow.js` `pickJudge` export 및 사용, 모델 막대 값 `fmtTokens` | `test/format.test.js` 경계 항목, `test/flow.test.js` 통과. 수동: model usage 막대 값이 `12.3k` 형식. (R16 에서 `pickJudge`·`test/flow.test.js` 삭제, 14단계가 대체) |
| 10h | 전체 회귀 | `npm test` 전부 통과(기존 + 11 신규). 실제 세션으로 서버 기동해 콘솔 에러 0, 로그 ts 순, judge 박스 판정 문구 표시(R16 이후: goal 패널 verdict 행에 판정 문구 표시) |
| 11 | 누락 테스트 추가(10a~10g 와 함께 작성) | 아래 목록 각 항목이 독립 `test(...)` 로 존재하고 통과 |
| 12a | (R14) `src/core/reducer.js`: 비공개 `wakeMain`, `notificationTarget` 추가. `isHumanPrompt` 분기의 두 줄을 `wakeMain(state)` 로 교체 | `grep -n 'turnEnded = false\|status = "running"' src/core/reducer.js` 에서 main 관련 대입이 `wakeMain` 본문에만 있다(서브에이전트 노드의 `node.status = "running"` 2곳, `ensureNode(..., "running")` 은 그대로). 기존 `npm test` 전부 통과 |
| 12b | (R14) `assistant` 분기에 (W1), `user` 알림 분기에 (W2) 적용(3.5 의 위치·순서대로) | 7.2 테스트 전부 통과. 기존 픽스처 테스트의 `main.status === "idle"`, `turn_end` 1회 단언(`test/reducer.test.js` 91·98행)이 수정 없이 통과 |
| 12c | (R14) `test/reducer.test.js` 에 7.2 목록 추가 | 7.2 각 항목이 독립 `test(...)` 로 존재. 12b 적용 전 코드에서 7.2 의 1·5번이 실패함을 확인(회귀 재현) 후 12b 적용 시 통과 |
| 12d | (R14) 실제 세션 확인 | 서버 기동 후 백그라운드 서브에이전트를 띄운 세션에서 메인 턴 종료 → 서브에이전트 완료 알림 → 메인 응답 중 메인 박스 글로우(running), 응답 종료 후 글로우 없음(idle)과 session log 에 `turn_end` 행 추가. 같은 세션을 브라우저 새로고침(첫 로드)해도 최종 상태 동일 |
| 13a | (R15) `scripts/statusline.mjs`(3.12 전체), `test/statusline.test.js` 의 함수 단위 항목(7.3 S1~S10) | 7.3 S1~S10 통과. `node -e "import('./scripts/statusline.mjs')"` 가 아무것도 출력하지 않고 파일도 만들지 않음(import 시 main 미실행). `grep -n "process.exit(" scripts/statusline.mjs` 결과 0건 |
| 13b | (R15) 픽스처 3개(2.1), `test/statusline.test.js` 의 자식 프로세스·end-to-end 항목(7.3 S11~S16) | 7.3 S11~S16 통과. 자식 프로세스는 `process.execPath` + 스크립트 절대 경로, `env: { ...process.env, USERPROFILE: tmp, HOME: tmp }`. 테스트 전후로 실제 `~/.claude/agent-ui/rate-limits.json` 의 존재·mtime 이 변하지 않음 |
| 13c | (R15) `src/core/limits.js`(3.13), `test/limits.test.js`(7.3 L1~L7) | 7.3 L1~L7 통과 |
| 13d | (R15) `src/config.js` `limitsFile`, `src/server/http.js` `/api/limits`, `test/http.test.js` 추가(7.3 H1~H3) | 7.3 H1~H3 통과, 기존 http 테스트 전부 통과(기존 `cfg` 에 `limitsFile: <임시 경로>` 추가). `loadConfig([]).limitsFile` 이 `defaultLimitsFile()` 과 같음 |
| 13e | (R15) `public/js/format.js` `fmtCountdown`, `public/js/limits.js`(3.14), `test/format.test.js`·`test/limits-view.test.js`(7.3 F1, V1~V12) | 7.3 F1, V1~V12 통과. `limits.js` 를 Node 에서 import 해도 예외 없음 |
| 13f | (R15) `panels.js` `renderGoal` 4번째 인자, `app.js` 폴링, `styles.css` | `npm test` 전부 통과. `grep -n innerHTML public/js/limits.js public/js/panels.js` 0건. 수동(픽스처 값으로 `~/.claude/agent-ui/rate-limits.json` 대신 `cfg.limitsFile` 을 임시 파일로 지정한 서버, 또는 13h 실제 값): tokens 행 바로 아래 5h/7d 두 행, 잔여 % 굵게, `resets in …` 이 1초마다 줄어듦. 그 임시 한도 파일의 five_hour `usedPercentage` 를 손으로 85, 95 로 고쳐 저장하면 5초 안에 각각 주황, 빨강. 창 폭을 줄여도 goal 패널(300px) 안에서 가로 스크롤·넘침 없음. 파일 삭제 시 `n/a` + Pro/Max 사유 |
| 13g | (R15) **메인 에이전트**: 사용자 승인 후 4.3 절차로 `statusLine` 적용 | 백업 파일 존재·원본과 바이트 동일, 4.3 의 5 검증 (a)(b) 통과. 구현자는 이 단계를 수행하지 않는다 |
| 13h | (R15) 실계정 검증(메인 에이전트 + 사용자) | Pro/Max 로그인 세션에서 응답 1회 후: 터미널 상태 줄에 `5h N% left · 7d M% left`, `~/.claude/agent-ui/rate-limits.json` 생성, 값이 Claude Code `/usage` 또는 claude.ai 사용량 화면과 ±1%p 이내, agent-ui 화면 표시 일치. 파일이 생기지 않으면 4.3 의 `--dump` 로 잠시 전환해 `statusline-input.json` 의 실제 `rate_limits` 형태를 확인하고, 문서와 다르면 **설계 공백**으로 architect 에 보고(구현자가 임의 수정하지 않음). 확인 후 `--dump` 제거 |
| 14a | (R16, 완료 `051bfc3`) `public/js/flow.js`: judge 를 워커 행 카드로, 단일 judge 박스·`pickJudge` 삭제, 서명에서 judgeId 제거, usage→각 카드 연결선과 줄바꿈 카드 출발점 규칙(3.11). `public/styles.css` `.box.judge`. `test/flow.test.js` 삭제 | `npm test` 전부 통과. `grep -rn pickJudge public test` 0건. `grep -n "judge" public/js/flow.js` 에 단일 judge 박스 생성 코드 없음. 수동: reviewer 를 2회 이상 돌린 세션에서 judge 카드가 실행 수만큼 파란 테두리로 보이고, 창 폭을 줄여 카드가 2줄이 되면 둘째 줄 카드의 선이 첫 줄 카드 아래에서 시작해 카드를 가로지르지 않음 |
| 14b | (R16, 완료) `src/config.js` 기본 `judgeAgentTypes` 에 `tester` 추가, `test/config.test.js` 기본값 단언 갱신 | `test/config.test.js` 통과 |
| 14c | (R16, 구현됨) 3.11 "알려진 한계" 수정: 출발 후보를 `b.top` 보다 위 줄 중 `bottom` 이 가장 큰 줄의 카드로 좁힘 | 수동: 카드가 3줄 이상일 때 셋째 줄 카드의 선이 둘째 줄 카드에서 시작. 구현 완료: 후보를 바로 위 줄(`bottom` 이 가장 큰 줄)의 카드로 한정 |
| 15a | (R17, 완료 `ca9ecc8` + 보강) `src/core/agents.js`(3.15), `test/agents.test.js` | 7.4 A1~A5 통과 |
| 15b | (R17, 완료) `src/config.js` `agentsDir`·`security-reviewer`, `src/server/http.js` `/api/agents`, `test/http.test.js`(`cfg.agentsDir` 임시 폴더) | 7.4 A6~A7 통과, 기존 http 테스트 전부 통과. `loadConfig([]).agentsDir === defaultAgentsDir()`, `loadConfig([]).judgeAgentTypes` 가 5개 기본값 |
| 15c | (R17, 완료) `public/js/panels.js` `renderGoal` 5번째 인자·`buildAgents`, `public/js/app.js` `loadAgents`, `public/styles.css` `.g-agents`/`.ag-*` | `npm test` 전부 통과. `grep -n innerHTML public/js/panels.js` 0건. 수동: goal 패널 맨 아래 `REGISTERED AGENTS (N)`, judge 계열 이름 파랑·나머지 초록, 행 마우스오버 시 description 툴팁. `−` 클릭 시 목록 숨김·버튼 `+`, 1초 뒤에도 유지, 새로고침 후에도 유지. 서버를 `/api/agents` 404 로 막으면 패널 없음, 다른 영역 정상 |

### 7.1 11단계 테스트 목록

모든 테스트는 의존성 없이 `node:test` + `node:assert/strict` 로 쓴다. 파일 I/O 는 `fs.mkdtempSync(os.tmpdir())` 임시 폴더만 쓴다. 타이밍 의존 테스트의 대기 상한은 2초.

| 파일 | 테스트 | 단언 |
|---|---|---|
| `test/log.test.js` | eventTimeMs | `""`, `"bad"` → null, ISO → `Date.parse` 값 |
| 〃 | sortEvents ts 정렬 | ts 역순 seq 입력 → ts 오름차순, 같은 ts 는 seq 순 |
| 〃 | sortEvents 무효 ts | seq 0(ts T5), 1(ts ""), 2(ts T1) → 순서 [2, 0, 1] (seq1 은 T5 상속). 첫 이벤트가 ts "" 면 맨 앞 |
| 〃 | LogIndex append | ts 증가 이벤트 3개 add → 모두 `op:'append'`, index 0,1,2 |
| 〃 | LogIndex insert | T10, T20 뒤에 T15 add → `{op:'insert', index:1, evict:0}`. 같은 ts 이면서 seq 가 큰 이벤트는 append |
| 〃 | LogIndex 중복 | 이미 본 seq 이하 add → `op:'drop'`, size 불변 |
| 〃 | LogIndex MAX_ROWS | maxRows=3 에 4번째 append → `evict:1`, size 3. 가득 찬 상태에서 모든 행보다 이른 이벤트 → `op:'drop'`. 중간 삽입 → `op:'insert'`, `evict:1` |
| 〃 | LogIndex reset | 5개 reset(maxRows 3) → 반환 길이 3, ts 순 마지막 3개. 이후 add 의 무효 ts 는 reset 집합의 마지막 유효 키 상속 |
| ~~`test/flow.test.js`~~ | ~~pickJudge~~ | **R16 에서 삭제**(함수와 파일 모두 없음). 최신 judge 선택은 아래 reducer 항목(`verdict.judgeId`)이 계속 검증한다 |
| `test/reducer.test.js` | judge 여러 개 최신 선택 | startedAt 다른 reviewer 2개 → `verdict.judgeId` = 늦은 것. startedAt null(pending) judge 가 있으면 그것 |
| 〃 | judge agent_done verdict | 완료 알림을 handback 보다 먼저 적용해도, 나중에 적용해도 이벤트 verdict === `"done"`, 그리고 handback 적용 후 `toRunView().verdict.text` = handback 첫 줄 |
| 〃 | 동기 Agent 결과 | 메인 Agent tool_use(id `t1`, subagent_type `implementer`) → user tool_result(`tool_use_id:"t1"`) + `toolUseResult:{agentId:"s1", status:"completed"}` → 노드 s1 `completed`, agentType `implementer`, spawnedAtMainTurn = 해당 시점 main.turns, `agent_done` 이벤트 verdict `"done"`. `is_error:true` 면 `failed`/`agent_failed`/`"failed"` |
| 〃 | meta.toolUseId 만으로 연결 | 메인 Agent tool_use(id `t9`) 를 main.turns=2 시점에 적용, async 결과 없이 `applyMeta(st, "m1", {agentType:"reviewer", toolUseId:"t9"})` → `spawnedAtMainTurn === 2`, role `judge` |
| 〃 | meta.finished endedAt | 서브에이전트 레코드(ts T) 적용 후 `applyMeta(..., {finished:true})` → 상태 `endedAt` null 유지, `toRunView` 노드 `endedAt === T`, status `completed` |
| `test/watcher.test.js` | reset 경로 재전송 | 픽스처 복사본으로 `new SessionWatcher(...)`(start 안 함), `poll()` 1회, 구독, 메인 파일을 더 짧은 내용으로 덮어쓰고 `poll()` → 구독자가 `{type:'reset'}` 수신, 이후 `snapshot().run` 이 새 내용 기준(예: nodes/turns 감소). http 수준: SSE 연결 중 같은 조작 → 두 번째 `snapshot` 이벤트 수신 |
| 〃 | throttle 묶기 | `pushThrottleMs: 200`, 구독 후 append+`poll()`, 즉시 다시 append+`poll()` → 300ms 안에 `update` 정확히 1회, newEvents 에 두 줄의 이벤트 모두 포함 |
| 〃 | idleWatcherMs 폐기 | `getWatcher`(idleWatcherMs 50) → subscribe 후 unsubscribe → 150ms 대기 → 같은 인자 `getWatcher` 가 다른 인스턴스 반환, 이전 인스턴스 `timer === null`. 구독 중에는 150ms 후에도 같은 인스턴스 |
| 〃 | poll 예외 | `console.error` 를 임시 스텁, `watcher.mainTailer.readNew` 를 같은 Error 를 던지는 함수로 교체 → `poll()` 3회 모두 throw 안 함, `console.error` 1회. 다른 메시지로 바꿔 1회 → 추가 1회. 원래 함수 복구 후 `poll()` → "poll recovered" 1회, 이후 정상 poll 에서 추가 출력 없음 |
| `test/paths.test.js` | listSessions 64 KiB head/tail | 임시 root/`P`/`<uuid>.jsonl`: 첫 줄 `cwd:"C:/a"`, 64 KiB 넘는 채움 줄들, 가운데(앞 64 KiB 와 뒤 64 KiB 어디에도 걸리지 않는 위치)에 `ai-title "mid"`, 마지막 줄 `ai-title "last"` → title `"last"`, cwd `"C:/a"`. 가운데에만 title 이 있는 파일 → title null. 64 KiB 미만 파일 → head 만으로 title/cwd |
| `test/http.test.js` | Host 403 | `http.request` 로 `headers: {Host: "evil.com:<port>"}` → 403 + `{error:"forbidden host"}`; `Host: "localhost:<port>"`, `"[::1]:<port>"` → `/api/sessions` 200; `Host: "127.0.0.1"`(포트 없음) → 403; `Host: "127.0.0.1:<다른 포트>"` → 403; SSE 경로도 403. `isAllowedHost("LOCALHOST:8770", 8770) === true`, `isAllowedHost(undefined, 8770) === false`, `isAllowedHost("localhost.evil.com:8770", 8770) === false` |
| `test/config.test.js` | config 검증 | throw: `--port -1`, `70000`, `1.5`, `1e3`, `""`, `80abc`; `--poll-ms 0`, `1.5`, `x`; `--host 0.0.0.0`, `--host 192.168.0.1`; 값 없는 `--port`. 통과: `--port 0`, `--port 65535`, `--poll-ms 1`, `--host ::1`. 에러 메시지가 3.10 문구와 일치 |
| `test/format.test.js` | fmtTokens 경계 | `999→"999"`, `999.6→"999"`, `1000→"1.0k"`, `999949→"999.9k"`, `999950→"1.00M"`, `999999→"1.00M"`, `1240000→"1.24M"`, `-5→"0"`, `NaN→"0"` |
| `test/summarize.test.js` | promptText 자리표시자 | `"fix [Image #1] this [Pasted text #2 +40 lines] now"` → `"fix this now"`; `"[Image #1]"` 만 → `""` 이고 `isHumanPrompt` false |

### 7.2 12단계 테스트 목록 (R14, `test/reducer.test.js`)

공통: 레코드는 테스트 안의 객체 리터럴로 만든다(기존 픽스처 수정 금지). 메인 소스 `{kind:"main"}`, 서브에이전트 소스 `{kind:"subagent", agentId:"s1"}`. timestamp 는 T1 < T2 < … 순으로 증가. 메인 assistant 레코드는 모두 서로 다른 `message.id` 와 `model:"claude-opus-5-5"`(7번의 synthetic 제외). "알려진 s1" 은 메인 `assistant`(tool_use `Agent`, id `t1`) 뒤 `user` tool_result(`tool_use_id:"t1"`) + `toolUseResult:{status:"async_launched", agentId:"s1"}` 로 만든다. 알림 텍스트는 `<task-notification><task-id>s1</task-id><status>completed</status><summary>done</summary></task-notification>`. `ends(st)` = `st.events.filter(e => e.kind === "turn_end").length`. main 상태는 `toRunView(st, Date.parse(마지막 ts), cfg)` 의 `nodes[0].status` 로 본다(stale 방지를 위해 nowMs 는 마지막 ts).

| # | 테스트 | 입력 순서 | 단언 |
|---|---|---|---|
| 1 | 알림만으로 시작된 턴 | 사람 프롬프트 → 알려진 s1 생성 → 메인 assistant(text) → `system:turn_duration` → `queue-operation` enqueue(알림 텍스트) → (여기서 단언 A) → `user`(`origin:{kind:"task-notification"}`, 같은 알림 텍스트) → (단언 B) → 메인 assistant(새 message.id, text) → (단언 C) → `system:stop_hook_summary` | A: main `idle`, `ends === 1`(enqueue 는 깨우지 않음, s1 은 `completed`). B: main `running`, `applyRecord` 반환 `changed === true`(중복 알림이라 `newEvents` 는 비어 있어도). C: main `running`. 끝: main `idle`, `ends === 2`, 마지막 이벤트 kind `turn_end` |
| 2 | 알림 없이 assistant 로 깸 | 1번과 같되 `user` 알림 레코드를 빼고 enqueue 뒤 바로 메인 assistant → `turn_duration` | assistant 적용 직후 main `running`. 끝: main `idle`, `ends === 2` |
| 3 | 일반 프롬프트 턴 | 사람 프롬프트 → 메인 assistant(tool_use `Bash`) → `user` tool_result → 메인 assistant(text) → `turn_duration` | 프롬프트 직후와 각 assistant 직후 main `running`, 끝 main `idle`, `ends === 1` |
| 4 | 중복 종료 레코드 | (a) 사람 프롬프트 → 메인 assistant → `stop_hook_summary` → `turn_duration`. (b) 같은 구성에 종료 순서를 `turn_duration` → `stop_hook_summary`. (c) 1번 시나리오 끝에 `turn_duration` 하나 더 | 각 경우 main `idle`. (a)(b) `ends === 1`, (c) `ends === 2`(1번의 2회에서 늘지 않음). `turn_duration` 은 `durationMs: 5000`, `stop_hook_summary` 는 durationMs 없음 → (a) 의 turn_end 텍스트 `"turn ended"`, (b) 는 `"turn ended (5s)"` |
| 5 | 첫 로드 | 1번 레코드 배열을 새 `createRunState` 에 `for` 한 번으로 순서대로 적용(중간 `toRunView` 호출 없음, watcher 첫 poll 과 같은 방식). 별도로 마지막 `stop_hook_summary` 를 뺀 배열, 그리고 마지막 메인 assistant 와 `stop_hook_summary` 를 뺀 배열(알림 레코드로 끝남)도 각각 새 상태에 적용 | 전체: main `idle`, `ends === 2`, `nodes[0].turns === 3`(spawn assistant + 턴별 assistant 2개). 마지막 종료 레코드를 뺀 배열: main `running`, `ends === 1`. 알림으로 끝나는 배열: main `running`, `ends === 1` |
| 6 | 턴 중간 알림 | 사람 프롬프트 → 알려진 s1 생성 → `user` 알림 → 메인 assistant → `turn_duration` | 알림 직후 main `running`(변화 없음), `ends === 1` |
| 7 | synthetic 은 깨우지 않음 | 사람 프롬프트 → 메인 assistant → `turn_duration` → 메인 assistant(`model:"<synthetic>"`, text `"API Error: x"`) → `stop_hook_summary` | synthetic 직후 main `idle`. 끝 `ends === 1`(turnEnded 해제 안 됨) |
| 8 | sidechain·서브에이전트는 깨우지 않음 | 사람 프롬프트 → 메인 assistant → `turn_duration` → 메인 소스 assistant(`isSidechain:true`) → 서브에이전트 소스 s1 assistant → 서브에이전트 소스 `system:turn_duration` → 메인 소스 `user` 알림(`isSidechain:true`) | 각 단계 후 main `idle`, `ends === 1`. 서브에이전트 소스 assistant 직후 s1 노드는 기존 규칙대로 `running`(노드 자동 생성) |
| 9 | 알려지지 않은 알림은 깨우지 않음 | 사람 프롬프트 → 메인 assistant → `turn_duration` → 메인 `user` 알림(task-id `bgshell1`, 노드 없음, `permissionMode` 필드 없음) | main `idle`, `changed === false`, `ends === 1` |

### 7.3 13단계 테스트 목록 (R15)

공통: `node:test` + `node:assert/strict`, 의존성 없음. 파일 I/O 는 `fs.mkdtempSync(path.join(os.tmpdir(), "agent-ui-lim-"))` 임시 폴더만. 시각은 상수로 주입한다: `R5 = 1738425600000`(five_hour resetsAtMs), `R7 = 1738857600000`(seven_day), `NOW = R5 - 7980000`(리셋 2h 13m 전). 실제 `~/.claude` 에 쓰는 테스트는 없다.

| # | 파일 | 테스트 | 단언 |
|---|---|---|---|
| S1 | `test/statusline.test.js` | parseWindow 정상·단위 | `{used_percentage: 23.5, resets_at: 1738425600}` → `{usedPercentage: 23.5, resetsAtMs: R5}`. `resets_at: R5`(이미 ms) → `resetsAtMs: R5` |
| S2 | 〃 | parseWindow 거부 | `null`, `[]`, `"x"`, used `"23"`(문자열), used `NaN`, used `Infinity`, resets 누락, resets `0`, resets `-5`, resets `"1738425600"` → 모두 null. used `-3`, `120` 은 그대로 보존(보정 안 함) |
| S3 | 〃 | parseRateLimits | 문서 예시 객체 → 두 윈도우. `rate_limits` 없음/`null`/배열 → null. `five_hour` 만 → `seven_day: null`. 두 윈도우 모두 무효 → null. `spend_limit` 만 → null |
| S4 | 〃 | mergeWindow 규칙 | (1) inc null → old 그대로 (2) old null → inc (3) inc.resetsAtMs = old + 61 000 → inc (낮은 used 여도) (4) inc.resetsAtMs = old − 61 000 → old (높은 used 여도) (5) 차이 ±30 000 이고 used 40 vs 30 → `{usedPercentage: 40, resetsAtMs: max}`, 인자 순서를 바꿔도 같은 결과 |
| S5 | 〃 | mergeLimits 기존 파일 형식 | existing `null`, `"x"`, `{version: 2, …}` → 입력 윈도우만 반영. existing 의 윈도우 하나가 `{usedPercentage: "1"}` 처럼 무효 → 그 윈도우는 null 취급. 반환 `version 1`, `updatedAtMs === nowMs`, `sessionId` 전달값 |
| S6 | 〃 | statusText | 문서 예시 윈도우 + `NOW` → `"5h 76% left · 7d 58% left"`. five_hour 만 → `"5h 76% left"`. `nowMs = R5` 이상(5h 만료) → `"7d 58% left"`. null → `""`. used 100 → `"5h 0% left"`, used −3 → `"5h 100% left"`, used 80.5 → `"5h 19% left"` |
| S7 | 〃 | writeFileAtomic | 기존 파일이 있는 경로에 쓰기 → 내용 교체, 폴더에 `.tmp` 파일 0개. 대상 경로가 **디렉터리**면 throw, 폴더에 `.tmp` 0개, 디렉터리 그대로 |
| S8 | 〃 | runStatusline 입력별 파일 동작 | 임시 `dir`: (a) 문서 예시 raw → 반환 `"5h 76% left · 7d 58% left"`(nowMs=NOW), `rate-limits.json` 내용 = 3.12 스키마(키 정확히 `version, updatedAtMs, sessionId, five_hour, seven_day`, sessionId `"test-session-abc"`, 원문의 `model`/`workspace` 없음) (b) 이어서 rate_limits 없는 raw → `""`, 파일 바이트 불변 (c) 깨진 JSON `"{"` 와 `""` → `""`, 파일 바이트 불변 (d) 빈 dir 에서 rate_limits 없는 raw → 파일 생성 안 됨 |
| S9 | 〃 | runStatusline 한쪽 윈도우·병합 | 문서 예시로 쓴 뒤 five_hour 만 있는 입력(같은 윈도우, used 30) → 파일 five_hour 30, seven_day 는 41.2 유지. 다시 같은 윈도우 used 25 → 30 유지(낮은 값 무시), `updatedAtMs` 는 갱신 |
| S10 | 〃 | runStatusline 쓰기 실패·덤프 | `dir` 가 **파일** 경로(mkdir 실패) → throw 없이 정상 텍스트 반환, `process.stderr.write` 스텁에 `agent-ui statusline:` 로 시작하는 1줄. `dump: false` → `statusline-input.json` 없음. `dump: true` + 깨진 raw → 반환 `""`, `statusline-input.json` 내용 = raw 원문 |
| S11 | 〃 | 자식 프로세스 정상 | `spawnSync(process.execPath, [script], { input: 문서 예시 파일 내용, env: {…, USERPROFILE: tmp, HOME: tmp} })` → `status === 0`, stdout `""`(문서 예시는 리셋 시각이 과거), `tmp/.claude/agent-ui/rate-limits.json` 의 five_hour `{23.5, R5}`, seven_day `{41.2, R7}`. 입력의 `resets_at` 을 지금+2h 로 바꾼 사본 → stdout 이 `/^5h \d+% left · 7d \d+% left\n$/` |
| S12 | 〃 | 자식 프로세스 부재·깨짐 | `input-no-rate-limits.json`, `"{"`, 빈 입력 각각 → `status === 0`, stdout `""`, stderr 에 스택 없음, 파일 미생성 |
| S13 | 〃 | 자식 프로세스 한쪽 윈도우 | `input-five-hour-only.json` → `status === 0`, 파일 five_hour 30, seven_day null |
| S14 | 〃 | 동시 기록 | 같은 tmp HOME 으로 `spawn` 8개를 동시에 실행(같은 윈도우 resets, used 10·20·…·80) 후 모두 종료 대기 → 모두 종료 코드 0, 최종 파일이 `JSON.parse` 가능하고 3.12 스키마, five_hour.used ∈ {10…80}, 폴더에 `.tmp` 0개. 이어서 used 5 로 1회 순차 실행 → used 값이 줄지 않음 |
| S15 | 〃 | `--dump` | 인자 `--dump` → `statusline-input.json` 이 입력과 같은 내용. 인자 없음 → 미생성 |
| S16 | 〃 | end-to-end | S11 로 만든 tmp 파일을 `createServer({ ...DEFAULTS, projectsRoot: <빈 임시>, limitsFile: <그 파일> })` 로 제공 → `GET /api/limits` 200 `{status:"ok", limits:{five_hour:{usedPercentage:23.5, resetsAtMs:R5}, seven_day:{41.2, R7}, updatedAtMs:<유한수>}}`, `sessionId` 키 없음. 그 응답을 `limitView(resp, NOW)` 에 넣으면 5h 행 `valueText "76% left"`, `resetText "resets in 2h 13m"`, 7d 행 `"58% left"`(`updatedAtMs` 가 NOW 보다 미래라 stale false) |
| L1 | `test/limits.test.js` | normalizeLimits 정상 | 3.12 예시 → `{updatedAtMs, five_hour, seven_day}` 만(sessionId·version 제거) |
| L2 | 〃 | normalizeLimits 거부 | `null`, `[]`, version 2, updatedAtMs 누락/`"1"`/0 → null. 윈도우 `{usedPercentage: NaN}`, resetsAtMs 0 → 그 윈도우만 null. used 150 은 보존 |
| L3 | 〃 | read 파일 없음 | `{status:"missing", limits:null}`. 이후 파일 생성 → `ok` |
| L4 | 〃 | read 깨진 파일 | `"{"` → `invalid`. 64 KiB 초과 파일 → `invalid`. 디렉터리 경로 → `invalid` |
| L5 | 〃 | read 캐시 | 첫 read 후 `fs.readFileSync` 를 호출 횟수 세는 스텁으로 감싸고(테스트 끝에 복구) 같은 파일 read 2회 → 호출 0회, 같은 객체 반환. 내용·크기를 바꿔 쓰면(mtime 변경 보장 위해 `fs.utimesSync` 로 +2s) → 1회 다시 읽고 새 값 |
| L6 | 〃 | read 일시 오류 | 정상 read 후 `fs.readFileSync` 를 `EBUSY` 코드 Error 를 던지는 스텁으로 바꾸고 파일 mtime 변경 → 직전 `ok` 결과 반환, throw 없음. 스텁 복구 후 → 새 값 |
| L7 | 〃 | defaultLimitsFile | `path.join(os.homedir(), ".claude", "agent-ui", "rate-limits.json")` 와 같음 |
| H1 | `test/http.test.js` | /api/limits 정상·부재 | `cfg.limitsFile` 임시 경로에 유효 파일 → 200 `status "ok"`, `Cache-Control: no-store`. 파일 삭제 → 200 `{status:"missing", limits:null}`. 깨진 내용 → 200 `status "invalid"` |
| H2 | 〃 | 경로 고정 | `/api/limits/x`, `/api/limits/..%2F..%2Fsettings.json` → 404. `/api/limits?file=C:/x` → 정상 응답(쿼리 무시, cfg 파일 기준) |
| H3 | 〃 | Host 검증 | `Host: evil.com:<port>` 로 `/api/limits` → 403 `{error:"forbidden host"}`. POST → 405 |
| F1 | `test/format.test.js` | fmtCountdown 경계 | `0→"0s"`, `59999→"59s"`, `60000→"1m 00s"`, `309000→"5m 09s"`, `3599999→"59m 59s"`, `3600000→"1h 00m"`, `7980000→"2h 13m"`, `86399000→"23h 59m"`, `86400000→"1d 00h"`, `(6*86400+23*3600)*1000→"6d 23h"`, `-1→"0s"`, `NaN→"0s"`, `"x"→"0s"` |
| V1 | `test/limits-view.test.js` | 정상 | 3.14 의 예 그대로 단언(행 2개, 순서 five_hour·seven_day, label `5h`·`7d`) |
| V2 | 〃 | 경계 0/100 | used 0 → `100% left`, `used 0%`, normal, fillPct 0. used 100 → `0% left`, `used 100%`, danger, fillPct 100 |
| V3 | 〃 | 소수 | used 23.5 → `76% left`/`used 24%`. used 0.4 → `99% left`/`used 1%`. used 99.9 → `0% left`/`used 100%`, danger. 모든 경우 표시 잔여 + 표시 사용 = 100 |
| V4 | 〃 | 범위 밖 | used −5 → `100% left`, fillPct 0, normal. used 130 → `0% left`, fillPct 100, danger |
| V5 | 〃 | NaN·타입 | used `NaN`, `"50"`, `null`, resetsAtMs `NaN` → 그 행 `na`, `"n/a"`, `"no data"`. 다른 행은 정상 |
| V6 | 〃 | 임계값 | used 80 → remaining 20 → normal. 80.5 → `19% left`, warn. 90 → remaining 10 → warn. 90.01 → `9% left`, danger. 상수를 import 해 `100 - LIMIT_WARN_REMAINING` 등으로 입력을 만든다 |
| V7 | 〃 | 리셋 경과 | `nowMs === R5` 와 `R5 + 1` → five_hour `expired`, `valueText "reset"`, `resetText "awaiting update"`, fillPct 0, level none. `valueText` 가 `"100% left"` 가 아님 |
| V8 | 〃 | 신선도 | `updatedAtMs = NOW - LIMITS_STALE_MS` → stale false, note null. `NOW - LIMITS_STALE_MS - 1000` → stale true, note `"as of 15m 01s ago"`, 행 값은 정상 표시 유지. `updatedAtMs = NOW + 60000`(미래) → stale false |
| V9 | 〃 | status 별 n/a | `undefined` → note `LIMIT_NOTES.loading`. `{status:"missing"}` → `LIMIT_NOTES.missing`(두 행 `n/a`). `invalid`, `error` 각각 해당 문구. `{status:"bogus"}`, `"x"`, `null` → `error`. `{status:"ok", limits:null}` → `invalid` |
| V10 | 〃 | 윈도우 둘 다 없음 | `{status:"ok", limits:{updatedAtMs: NOW, five_hour:null, seven_day:null}}` → 두 행 na, note `LIMIT_NOTES.empty` |
| V11 | 〃 | nowMs 비정상 | `nowMs = NaN` → `error` 처리(note `LIMIT_NOTES.error`), throw 없음 |
| V12 | 〃 | 순수성 | 같은 입력 객체로 2회 호출 → 결과 deep-equal, 입력 객체 불변(`structuredClone` 비교) |

### 7.4 15단계 테스트 목록 (R17)

공통: `node:test` + `node:assert/strict`. 파일 I/O 는 `fs.mkdtempSync(path.join(os.tmpdir(), "agent-ui-agents-"))` 임시 폴더만. 실제 `~/.claude/agents` 를 읽는 테스트는 없다. `test/agents.test.js` 의 judge 목록은 상수 `["judge","reviewer","verifier","tester"]` 를 넘긴다.

| # | 파일 | 테스트 | 단언 |
|---|---|---|---|
| A1 | `test/agents.test.js` | parseFrontmatter 기본 | `"---\nname: a\r\nmodel: claude-opus-5-5\n---\nbody: x"` → `{name:"a", model:"claude-opus-5-5"}`(CRLF 혼용 허용, 본문의 `body:` 무시). 프런트매터 없음 → `{}` |
| A2 | 〃 | parseFrontmatter 따옴표·블록 | `name: "my-agent"` → `my-agent`, `model: 'opus'` → `opus`, `description: \|` + 들여쓴 두 줄 → `"첫 줄 둘째 줄"`, `tools: >-` + 들여쓴 두 줄 → `"Read, Grep"`, 블록 뒤 `next: x` 는 별도 키 `"x"` |
| A3 | 〃 | listAgents 정렬·분류 | 임시 폴더에 `reviewer.md`(name·description·model opus), `coder.md`(name 없음), `notes.txt` → 이름 `["coder","reviewer"]`, coder `role "worker"`·`model null`, reviewer `role "judge"`·`model {family:"opus", label:"opus 5.5"}`, txt 무시 |
| A4 | 〃 | listAgents 폴더 없음 | 없는 경로 → `[]`, throw 없음 |
| A5 | 〃 | listAgents 절단·건너뜀 | description 500자 → 길이 200. `dir.md` 라는 이름의 **디렉터리**(읽기 실패) → 건너뛰고 나머지(`long`)만 반환 |
| A6 | `test/http.test.js` | GET /api/agents | `cfg.agentsDir` = 임시 폴더(`reviewer.md`: name reviewer, model opus), `cfg.judgeAgentTypes` = `DEFAULTS` 값 → 200, `agents.length === 1`, `agents[0].name === "reviewer"`, `role === "judge"` |
| A7 | 〃 | 하위 경로 404 | `/api/agents/x` → 404 |

## 8. 열린 질문 (결정 완료)

> 결정: 1~5 모두 아래 제안/기본값대로 채택. judge 없는 세션은 흐린 `judge: n/a` 박스로 둔다. 나중에 수정 가능. **(R16 정정)** 단일 judge 박스 자체가 폐기되어 judge 없는 세션에는 judge 카드가 없고 goal 패널에 `verdict n/a`, `judge: n/a` 만 보인다. 질문 1 의 기본 목록은 R16/R17 에서 `judge, reviewer, verifier, tester, security-reviewer` 로 바뀌었다. 2026-10-29 리뷰 반영(R1~R13)에서 새로 생긴 열린 질문은 없다.
>
> R14 에서 범위 밖으로 결정한 것(구현자가 채우지 않는다): (1) 알림으로 깬 턴의 goal 패널 running 시간은 마지막 사람 프롬프트 기준 그대로 둔다(턴 시작 시각 필드 추가는 Run 스키마 변경이라 별도 승인 필요). (2) `<synthetic>` assistant 나 사용자 중단 뒤 종료 레코드가 없는 턴을 idle 로 돌리는 규칙은 두지 않는다(기존과 같이 30분 뒤 stale).

> R16·R17 에서 새 열린 질문은 없다(사후 문서화). 범위 밖으로 둔 것: 프로젝트별 `.claude/agents`·플러그인 에이전트 표시, 등록 목록 폴링, 3줄 이상 카드 연결선 한계 수정(7장 14c, 선택).
>
> R15 에서 새 열린 질문은 없다(사용자 요구와 승인 범위 안에서 모두 결정). 다만 아래는 **사용자가 알아야 할 위험/제약**이며 구현자가 채우는 항목이 아니다:
> - 구독자 전용: `rate_limits` 는 claude.ai Pro/Max 로그인에서만, 세션의 첫 API 응답 후에만 온다. API 키 사용자·첫 응답 전에는 계속 `n/a`.
> - 실계정 미검증: 필드 형태는 공식 문서 기준이다. 실제 값의 단위(`resets_at` 초/ms)·윈도우별 `resets_at` 흔들림 여부는 13h 에서 확인한다. 다르면 설계 공백으로 architect 에 돌린다.
> - 값은 "마지막 Claude Code 응답 시점" 기준이다. claude.ai 웹·다른 기기 사용분은 다음 응답 전까지 반영되지 않는다(15분 넘으면 `as of … ago` 표시).
> - 상태 줄을 켜면 Claude Code footer 의 키 힌트(`esc to interrupt`, `? for shortcuts` 등)가 숨겨지고, 상태 줄에는 한도 한 줄만 보인다.
> - `~/.claude/settings.json` 을 바꾼다(`statusLine` 1키, 백업·롤백 절차 4.3). 작업 공간 신뢰 전, `disableAllHooks`, 관리 정책(`allowManagedHooksOnly`)이 있으면 실행되지 않는다.
> - 응답마다 node 프로세스가 1회 실행된다(수십 ms). 여러 세션 동시 기록 시 드물게 한 번의 갱신이 빠질 수 있으나 다음 응답에서 회복되고 값이 뒤로 가지 않는다.
> - 여러 계정을 번갈아 쓰면 같은 파일을 공유해 섞일 수 있다(범위 밖).

1. **judge 정의**: `agentType` 이 `judge`/`reviewer`/`verifier` 인 서브에이전트를 judge 박스로 보내는 기본값이 맞는가? 판정 서브에이전트가 없는 세션은 judge 박스를 흐린 `n/a` 로 남길지, 아예 숨길지.
2. **goal 패널**: goal = 세션 첫 사람 프롬프트 + "latest" 1줄로 현재 프롬프트를 함께 보이는 방식이 맞는가, 아니면 goal 을 항상 최신 프롬프트로 할지.
3. **중간 레이어**: 레퍼런스의 점수 막대 자리를 "모델별 output 토큰 막대"로 채우는 것에 동의하는가(대안: 도구 호출 수, 또는 박스 생략). 워커 진행률 %는 근거 데이터가 없어 무한 진행 막대로 대체하는데 괜찮은가.
4. **색상 체계**: 테두리=역할 색, 모델 배지=패밀리 색(opus 보라 계열, sonnet 하늘, haiku 연두)의 이중 체계가 괜찮은가, 아니면 한 가지로 통일할지.
5. **동기 서브에이전트 결과 형식 미확인**: 로컬 로그에 foreground Agent 호출 결과가 한 건도 없다. 3.5 의 가정(`toolUseResult.agentId` 존재, is_error 로 실패 판정)대로 두고 9단계 실검증에서 확인하는 방식으로 진행해도 되는가. 중첩 서브에이전트(spawnDepth ≥ 2)의 파일 위치도 같은 `subagents/` 폴더라고 가정한다.
