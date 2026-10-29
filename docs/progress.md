# agent-ui 진행 기록 (이어서 작업용)

마지막 갱신: 2026-10-29 · 기준 커밋: `0a3009f` (origin/main 과 동일, 작업 트리 깨끗)

## 1. 프로젝트 요약
- Claude Code 세션 로그(`~/.claude/projects/**.jsonl`)를 읽어 에이전트 실행을 보여주는 로컬 웹 뷰어.
- 언어: 순수 JavaScript 한 가지. 서버는 Node.js(ES 모듈, 외부 패키지 0개), 프런트는 프레임워크 없는 브라우저 JS + SVG. 빌드 단계 없음.
- 실행: `npm start` (기본 `http://127.0.0.1:8770`), 테스트: `npm test` (Node 내장 러너, **192개 통과**).
- 설계 문서: `docs/design.md` (상태 "확정", 변경 이력에 R16·R17 포함). 사용법은 `README.md`.

## 2. 이번 세션에서 한 일 (커밋 순)
| 커밋 | 내용 |
|---|---|
| `051bfc3` | reviewer 등 judge 를 하단 단일 박스 대신 **실행마다 별도 카드**(파란 테두리)로 표시. 기본 judge 목록에 `tester` 추가. 줄바꿈으로 내려간 카드의 연결선이 위 카드를 가로지르지 않게 수정. 옛 `pickJudge` 테스트 삭제 |
| `ca9ecc8` | 좌측 패널 `judge:` 아래 **REGISTERED AGENTS** 목록(`~/.claude/agents/*.md`), `+`/`−` 접기 버튼(상태는 localStorage 유지), `/api/agents`, 기본 judge 에 `security-reviewer` 추가 |
| `5abc298` | 프런트매터 파싱 보강(따옴표 제거, `\|` `>` 블록 값), 테스트 추가, 연결선 후보를 "바로 위 줄"로 한정, `docs/design.md` 에 R16·R17 반영 |
| `0a3009f` | 프런트엔드 중복 정리 리팩터링(동작 변경 없음) |

## 3. 현재 구조 메모
- `src/core/`: `reducer.js`(레코드 → RunState), `roles.js`(judge/worker 분류), `agents.js`(등록 에이전트 목록), `session-watcher.js`, `tailer.js`, `limits.js`, `models.js`, `paths.js`, `summarize.js`
- `src/server/`: `http.js`(라우팅·SSE·Host 검증), `main.js`
- `public/js/`: `app.js`, `panels.js`(좌측 패널), `flow.js`(플로우 다이어그램), `log.js`, `limits.js`, `format.js`, `dom.js`
- API: `/api/sessions`, `/api/sessions/latest`, `/api/limits`, `/api/agents`, `/api/run/<projectKey>/<sessionId>[/stream]`
- 기본 judge 목록: `judge, reviewer, verifier, tester, security-reviewer` (`--judge-types` 로 변경)
- 범위 밖(의도): 프로젝트별 `.claude/agents`, 플러그인 에이전트는 표시하지 않음. 목록은 페이지 로드 시 1회만 읽음.

## 4. 전역 설정 변경 (이 저장소 밖, 복사해도 따라가지 않음)
- 새 에이전트: `~/.claude/agents/security-reviewer.md`, `refactorer.md`, `researcher.md`
- `~/.claude/CLAUDE.md` 의 "에이전트 사용 규칙"에 보안 검토·리팩터링·조사 항목 추가. 백업: `CLAUDE.md.bak-20261029`, `CLAUDE.md.bak-researcher-20261029`
- 사용자 지시(자동 결정): 레이아웃 같은 후속 제안과 불필요해진 파일 삭제는 묻지 않고 진행. push/배포/전역 설정 수정은 먼저 묻는다.

## 5. 남은 일 / 다음 단계
- **Rust 이전 (사용자 계획)**: 폴더를 통째로 복사해 새 폴더에서 작업. 원본(JavaScript)은 그대로 둔다.
  - 범위 제안: **서버만 Rust 로**, 프런트(`public/`)는 그대로 재사용. 현재 테스트 192개를 "같은 동작이어야 한다"는 기준으로 삼는다.
  - 선택 이유: 이 뷰어는 병목이 없어 속도 이득은 없다. 실질 이점은 단일 실행 파일 배포(프런트를 바이너리에 포함)와 학습.
  - 시작 순서 제안: `architect` 로 이전 설계(`docs/design.md` 보강) → `implementer` 구현 → `reviewer`/`tester` 검증.
  - 옮길 때 주의: SSE 스트림, 파일 tail/폴링, Host 헤더 검증(DNS rebinding 방어), 경로 순회 방어, 한도 파일 읽기, 프런트매터 파서(`\|` `>` 블록 처리).
- 선택 사항: 등록 에이전트 목록에 프로젝트별 `.claude/agents` 추가, 목록 폴링(필요해지면 `limits.js` 처럼 mtime 캐시).
