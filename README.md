# agent-ui

Claude Code 에이전트 실행을 웹에서 보는 읽기 전용 뷰어. 메인·서브에이전트가 어떤 모델로 무엇을 하는지 에이전트별 모델과 함께 보여준다.

## 요구사항
- Node.js 20 이상 (`engines.node: ">=20"`)
- 외부 의존성 0개 (npm install 불필요, 빌드 단계 없음)

## 실행
```
npm start
```
기본 주소는 http://127.0.0.1:8770 이다. 옵션은 `npm start -- --port 9000` 처럼 넘긴다.

| 옵션 | 기본값 | 검증 규칙 |
|---|---|---|
| `--port` | 8770 | 0~65535 정수 (숫자만, `80abc`·`1e3` 거부) |
| `--host` | 127.0.0.1 | 루프백만 허용: `127.0.0.1`, `localhost`, `::1` |
| `--projects-root` | `~/.claude/projects` | 문자열 경로 |
| `--judge-types` | `judge,reviewer,verifier,tester` | 쉼표 구분 agentType 목록 (파란 judge 카드로 분류) |
| `--poll-ms` | 750 | 1 ~ 2147483647 정수 |

알 수 없는 옵션이나 잘못된 값은 오류 메시지와 함께 종료한다.

## 화면 구성
- 헤더·범례: 세션 제목과 projectKey, 역할 색 범례(goal 주황, 메인 보라, judge 파랑, 워커 초록). 상단 선택 박스로 세션을 고른다.
- THE GOAL 패널(좌측): 현재 turn·모델, 목표(첫 사람 프롬프트)와 latest, turns, tokens, 사용 한도, verdict, 실행 시간.
- 플로우 다이어그램(중앙): main 에이전트 박스 → model usage(모델별 output 토큰 막대) → 서브에이전트 카드(워커·judge 모두 실행마다 하나씩, judge는 파란 테두리). 실행 중인 노드는 테두리가 빛나고 연결선에 점이 흐른다.
- session log(하단): 이벤트를 시각 순으로 표시한다.
- 모델 배지 글자색: opus 보라, sonnet 하늘, haiku 연두, 그 외 회색(원본 이름 표시). 박스 테두리는 모델이 아닌 역할 색이다.

## 동작 원리
`~/.claude/projects/<projectKey>/<sessionId>.jsonl` 과 `<sessionId>/subagents/agent-<id>.jsonl`(+`.meta.json`) 트랜스크립트를 읽기 전용으로 폴링(바이트 오프셋 증분 읽기)해 상태를 만들고, 변경분을 SSE 로 브라우저에 푸시한다. 서브에이전트 연결은 `agentId`, `toolUseId`, task-notification 의 task-id 로만 한다. Claude Code 설정이나 훅은 건드리지 않는다.

## HTTP API
GET 만 허용한다 (그 외 405).

| 경로 | 설명 |
|---|---|
| `/` | `public/index.html` |
| `/static/*` | `public/` 정적 파일 (`.js`, `.css`, `.html`) |
| `/api/sessions?limit=N` | 최근 세션 목록 (기본 30, 최대 200) |
| `/api/sessions/latest` | 가장 최근 세션의 `projectKey`, `sessionId` (없으면 404) |
| `/api/limits` | 5h/7d 사용 한도 파일 내용 |
| `/api/run/<projectKey>/<sessionId>` | 세션 스냅샷 (Run) |
| `/api/run/<projectKey>/<sessionId>/stream` | SSE: `snapshot`, `update` 이벤트 |

## 사용 한도(5h/7d) 표시
한도 값은 Claude Code 의 statusLine 명령 입력으로만 얻을 수 있어, 별도 설정이 필요하다. 설정하지 않으면 해당 영역은 `n/a` 로 남는다.

1. `~/.claude/settings.json` 을 먼저 백업한다 (예: `settings.json.bak`).
2. 최상위에 아래 키를 추가한다. `<절대경로>` 는 이 프로젝트 경로이며, 역슬래시 대신 슬래시를 쓴다 (예: `D:/mayadep/agent-ui`).
   ```json
   "statusLine": {"type":"command","command":"node <절대경로>/scripts/statusline.mjs"}
   ```
3. Claude Code 를 다시 시작하거나 다음 갱신을 기다린다.

- Pro/Max 구독자 전용이며 세션의 첫 응답 이후에 표시된다 (API 키 사용자는 계속 `n/a`).
- 스크립트는 `rate_limits` 만 파싱해 `~/.claude/agent-ui/rate-limits.json` 에 저장하고, 터미널 상태 줄에 `5h 76% left · 7d 58% left` 형태로 출력한다. 서버는 이 파일을 읽기만 한다.
- 이미 `statusLine` 이 있으면 덮어쓰지 말고 직접 판단한다. 상태 줄을 켜면 Claude Code footer 의 키 힌트 일부가 숨겨질 수 있다.
- 끄려면 `settings.json` 에서 `statusLine` 키를 삭제하거나 백업을 복원한다. `~/.claude/agent-ui/` 는 지워도 된다.

## 테스트
```
npm test
```
`node --test "test/*.test.js"` 를 실행한다. 픽스처는 손으로 쓴 가짜 데이터다.

## 한계
- 사용 한도는 구독자 전용이고, 값은 마지막 Claude Code 응답 시점 기준이다 (15분 넘으면 `as of … ago` 표시).
- 동기(foreground) 서브에이전트 호출과 중첩 서브에이전트(spawnDepth 2 이상)는 실제 로그로 검증하지 못했다.
- 비공개 트랜스크립트 형식에 의존하므로 Claude Code 업데이트로 형식이 바뀌면 reducer 수정이 필요할 수 있다.
- 워커 진행률 %와 비용(USD)은 로그에 근거가 없어 표시하지 않는다.
- 여러 계정을 번갈아 쓰면 한도 파일이 섞일 수 있다.

## 보안
- 루프백 주소에만 바인딩한다 (`0.0.0.0` 등은 `--host` 에서 거부).
- DNS rebinding 방어로 Host 헤더가 실제 listen 포트를 포함한 `127.0.0.1:<포트>`, `localhost:<포트>`, `[::1]:<포트>` 와 일치해야 하며, 아니면 403 을 반환한다.
- URL 의 projectKey/sessionId 는 검증 후에만 경로로 사용한다. 인증은 없으며 원격 접속은 지원하지 않는다.
