# QC — Step 01~13 구현 품질 점검표

## 목적과 사용법

이 문서는 [Concept](./Concept.md)와 [PLAN](./PLAN.md)의 Step 01~13 구현을 **코드 품질** 관점에서 검수할 때 사용한다. 사용자 동작·물리 장치 인수는 [QA](./QA.md)에서 기록한다. 현재 표는 기준과 점검 대상을 마련한 상태다. `정적 확인`은 파일·설정의 존재를 확인했다는 뜻이며 해당 구현의 품질 PASS가 아니다. Step 13의 과거 테스트 결과는 [Step13](./Step13.md)에 보존한다.

판정은 `PASS / FAIL / PARTIAL / BLOCKED / NOT RUN`을 사용한다. 심각도는 `치명 / 높음 / 보통 / 낮음 / 해당 없음`으로 적는다. 각 행의 **결과·문제·심각도·개선 필요**는 실제 점검과 재현 증거가 확보될 때 갱신한다. 결함은 `QC-DEF-001`처럼 별도 ID를 부여하고 재현 절차·환경·로그·수정 Step을 비고에 남긴다. `NOT RUN`은 결함이 없다는 뜻이 아니다.

### 현재 저장소 구조와 검사 범위

- `client/src`: React UI, WebSocket 세션 Hook, 로컬 트랙·장치·입력 미터, SFU 송수신 Hook. `server/src`: HTTP/WS 서버, 방·SFU 상태, `shared/protocol.ts`와 `shared/mediaProtocol.ts` 메시지 계약. `scripts`: 단위·통합·브라우저 시나리오 및 ChatHistory 기록기. 공통 계약은 현재 서버의 `shared`에 있고 클라이언트가 이를 참조하는 구조다.
- 현재 관리 소스/테스트 파일은 `.ts` 15개, `.tsx` 7개, `.cjs` 23개, `.js`와 `.mjs`는 각 0개다(`client`, `server`, `scripts`의 해당 확장자 기준; 생성된 `dist` 제외). 소스는 TypeScript, 테스트·브라우저 하네스와 기록기는 CommonJS다. 이는 전환 필요성을 조사할 근거이지 곧바로 결함은 아니다.
- [공통 tsconfig](../tsconfig.base.json)은 `strict: true`; [client 설정](../client/tsconfig.json)은 `src`·Vite 설정, [server 설정](../server/tsconfig.json)은 `src`를 포함한다. `scripts/*.cjs`는 이 두 `tsc` 프로젝트에 포함되지 않는다. JavaScript 테스트의 런타임 검증과 타입 검사 사각지대는 Step 15에서 평가한다.
- 실제 실행 명령은 [package.json](../package.json)을 따른다. 새 패키지·테스트 환경 변경 여부도 Step 15~16에서 별도로 판정한다. 접근 가능한 외부 `00-conventions` 원문은 이번 문서 작성 시 가져오지 못했으므로 프로젝트의 [AGENTS](../AGENTS.md)와 로컬 문서를 우선한다.

## QC 점검 기록

아래 표의 `확인 대상`은 상대 경로다. 표를 실제로 사용할 때 각 행의 결과·문제·심각도·개선 필요·비고를 채우고, 파일의 정확한 줄 번호나 테스트 로그를 비고에 추가한다. 표의 긴 셀은 검수 완료 후 별도 결함 ID로 연결할 수 있다.

| QC ID | Step | 영역 | 점검 항목 | 기대 기준 | 확인 대상 | 확인 방법 | 결과 | 발견 문제 | 심각도 | 개선 필요 | 개선 Step·비고 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| QC-001 | 01, 13 | A 구성 | 실행·빌드 경로 | 문서 명령과 실제 script·포트 일치 | [package](../package.json), [README](../README.md), [index](../server/src/index.ts) | 명령·설정 대조, 실행/종료 | PARTIAL | 파일·명령 존재만 정적 확인 | 해당 없음 | 미정; 실행 점검 Step 15/19 |
| QC-002 | 01~13 | A 구성 | 모듈 책임·의존성 | client/server/shared/scripts 역할과 순환 의존성 설명 가능 | [client](../client/src), [server](../server/src), [scripts](../scripts) | import/require 방향·중복 추적 | NOT RUN | 미점검 | 해당 없음 | Step 15 |
| QC-003 | 01~13 | A 구성 | 불필요 파일·설정 | 생성물·테스트 fixture·소스 구분, 죽은 코드 없음 | [gitignore](../.gitignore), [package](../package.json), [scripts](../scripts) | 추적 파일·참조·실행 경로 조사 | NOT RUN | 미점검 | 해당 없음 | Step 15 |
| QC-004 | 01, 03~12 | B TypeScript | strict 실제 적용 범위 | client/server 소스가 strict 검사되고 제외 파일 명시 | [base](../tsconfig.base.json), [client](../client/tsconfig.json), [server](../server/tsconfig.json) | include/옵션 확인 후 `npm run typecheck` | PARTIAL | strict 설정 확인; 이번 QC에서 재실행 안 함 | 해당 없음 | Step 15 |
| QC-005 | 03~12 | B TypeScript | any·타입 단언·null | 불필요한 우회 없이 경계값·null 처리 | [client](../client/src), [server](../server/src) | `rg -n 'any| as |!\.' client/src server/src` 후 맥락 검토 | NOT RUN | 미점검 | 해당 없음 | Step 15 |
| QC-006 | 03~12 | B TypeScript | unknown·런타임 계약 | 네트워크 JSON은 검증 후 사용, TS 타입만 신뢰하지 않음 | [protocol](../server/src/shared/protocol.ts), [mediaProtocol](../server/src/shared/mediaProtocol.ts), [application](../server/src/application.ts) | 파서·필드 거절·위조 테스트 추적 | NOT RUN | 미점검 | 해당 없음 | Step 15 |
| QC-007 | 03~12 | B TypeScript | client/server 메시지 일치 | 요청·응답·이벤트 필드·오류가 양쪽에서 일치 | [protocol](../server/src/shared/protocol.ts), [session](../client/src/useSession.ts), [sender](../client/src/useSfuSender.ts) | 타입·런타임 분기·테스트 대조 | NOT RUN | 미점검 | 해당 없음 | Step 15 |
| QC-008 | 03~12 | B TypeScript | 비동기 오류·취소 | 오래된 응답·실패가 새 상태를 덮지 않음 | [session](../client/src/useSession.ts), [sender](../client/src/useSfuSender.ts), [media](../client/src/useLocalMedia.ts) | 세대값·catch·cleanup 추적 | NOT RUN | 미점검 | 해당 없음 | Step 15 |
| QC-009 | 01~13 | C 언어 혼용 | 확장자·검사 사각지대 | TS 소스와 CommonJS 테스트의 근거·제약 문서화 | [package](../package.json), [scripts](../scripts), [base](../tsconfig.base.json) | 확장자 집계·tsconfig include 확인 | PARTIAL | 15 ts·7 tsx·23 cjs, cjs는 tsc 범위 밖 | 보통 | 평가 필요 | Step 15; 전환 결정 전 결함 아님 |
| QC-010 | 01~13 | C 언어 혼용 | CommonJS 필요성과 전환 비용 | Node 테스트/하네스·기록기의 실행 방식 유지 여부 판단 | [scripts](../scripts), [package](../package.json) | require·Node test·tsx 의존·성능 비교 | NOT RUN | 미점검 | 해당 없음 | Step 15 |
| QC-011 | 03~05 | D WebSocket | 세션·프로필·방 소유권 | 소켓 ID가 권한 기준, M:N 소속과 공통 프로필 일치 | [application](../server/src/application.ts), [rooms](../server/src/rooms.ts) | Map 변경 경로·[WS 테스트](../scripts/ws.test.cjs) | NOT RUN | 미점검 | 해당 없음 | Step 15/19 |
| QC-012 | 03~05 | D WebSocket | 입력 크기·검증·채팅 범위 | 4096-byte 제한, 위조 거절, 방별 전파 격리 | [protocol](../server/src/shared/protocol.ts), [application](../server/src/application.ts) | 초과 payload·잘못된 JSON/ID·이벤트 범위 추적 | NOT RUN | 미점검 | 해당 없음 | Step 15/16 |
| QC-013 | 03~05, 13 | D WebSocket | close·heartbeat·정리 | 정상/비정상/timeout에 중복 정리·방 누수 없음 | [application](../server/src/application.ts), [WS 테스트](../scripts/ws.test.cjs) | 종료 이벤트 순서·세션/방 수 확인 | NOT RUN | 미점검 | 해당 없음 | Step 16 |
| QC-014 | 07~09 | E SFU | 제어·RTP 분리 | WS는 Signaling, WebRTC는 SFU RTP, 방별 Router | [media](../server/src/media.ts), [sender](../client/src/useSfuSender.ts) | 소유 Map·Transport 연결 경로 추적 | NOT RUN | 미점검 | 해당 없음 | Step 15 |
| QC-015 | 07~09 | E SFU | 자원 소유·권한 | mediaId·roomId·participantId·Transport·Producer·Consumer 검증 | [media](../server/src/media.ts), [mediaProtocol](../server/src/shared/mediaProtocol.ts) | 잘못된 소유권 요청·종료 경로 검사 | NOT RUN | 미점검 | 해당 없음 | Step 15/19 |
| QC-016 | 08~09 | E SFU | 수신 전용·중복 방지 | 초기 목록/이벤트 경합에도 Producer당 Consumer 하나 | [sender](../client/src/useSfuSender.ts), [receive](../scripts/sfu-receive.scenarios.cjs) | 동시 입장·재입장·닫힌 Producer 검증 | NOT RUN | 미점검 | 해당 없음 | Step 15/19 |
| QC-017 | 07~09 | E SFU | 단일 활성 방·정리 순서 | 방 전환 시 이전 자원만 종료, 다른 방 채팅 유지 | [media](../server/src/media.ts), [multi](../scripts/sfu-multi.scenarios.cjs) | 전환 중 늦은 응답·Router/worker 수 비교 | NOT RUN | 미점검 | 해당 없음 | Step 15/19 |
| QC-018 | 06, 10 | F 로컬 미디어 | 트랙 소유·카메라 제어 | 로컬 Hook 소유, OFF stop·ON 새 Producer, SFU 종료와 분리 | [local](../client/src/useLocalMedia.ts), [sender](../client/src/useSfuSender.ts) | stopTracks/ended·미리보기 참조 추적 | NOT RUN | 미점검 | 해당 없음 | Step 15/19 |
| QC-019 | 10~11 | F 로컬 미디어 | 마이크 pause·replaceTrack | 음소거 의도·서버 paused 유지, 이전 트랙 정리 | [sender](../client/src/useSfuSender.ts), [devices](../client/src/useMediaDevices.ts) | 교체 실패·음소거 중 전환·RTP 추적 | NOT RUN | 미점검 | 해당 없음 | Step 15/19 |
| QC-020 | 11~12 | F 로컬 미디어 | 장치·Web Audio 생명주기 | devicechange/ended/RAF/AudioContext 누수 없음 | [devices](../client/src/useMediaDevices.ts), [meter](../client/src/useMicrophoneMeter.ts) | Effect 정리·반복 시작/종료 | NOT RUN | 미점검 | 해당 없음 | Step 15/19 |
| QC-021 | 01~13 | G 테스트 | 목적·증거 수준 | Mock·가상 브라우저·실제 물리 인수 구분 | [scripts](../scripts), [Step13](./Step13.md) | assertion과 완료 주장 대조 | NOT RUN | 미점검 | 해당 없음 | Step 15/19 |
| QC-022 | 03~13 | G 테스트 | 중복·환경 의존성 | fixture·타이밍·하네스 재사용, 실패 원인 확인 가능 | [scripts](../scripts) | timeout/고정 대기·중복 setup·로그 검토 | NOT RUN | 미점검 | 해당 없음 | Step 15/16 |
| QC-023 | 02~13 | G 테스트 | 프로세스·포트 정리 | 본문 PASS와 Node/worker/브라우저 종료를 별도 판정 | [scripts](../scripts), [Step13](./Step13.md) | 종료 코드·열린 핸들·포트·임시 프로필 확인 | PARTIAL | Step 13에서 첫 `test:ws` 본문 성공 후 러너 비종료 | 보통 | 예 | Step 16; 원인 미확인 |
| QC-024 | 07, 11, 13 | H 알려진 문제 | Signaling timeout 간헐 실패 | 재현 여부·Close 순서·대기 조건을 분리 | [scenario](../scripts/sfu-browser.scenarios.cjs), [session](../client/src/useSession.ts), [Step13](./Step13.md) | 제한 반복·이벤트 로그·종료 코드 | PARTIAL | 과거 첫 실패 뒤 재실행 통과, Step 13 2회 재현 안 됨 | 보통 | 조사 | Step 16; 해결로 표시 금지 |
| QC-025 | 01~13 | H 알려진 문제 | ChatHistory 누락 이력 | Hook 테스트와 실제 턴 저장을 구분, 기존 기록 보존 | [hook](../.codex/hooks.json), [recorder](../scripts/chat-history.cjs), [history](./ChatHistory.md) | 이벤트 조건·기록 파일·번호·실제 세션 증거 확인 | PARTIAL | 과거 강제 종료·모델 변경 때 backfill 이력 | 보통 | 조사 | Step 15/19; 이번 대화 기록 성공은 Stop 뒤 확인 |
| QC-026 | 01~13 | H 문서 정합성 | 코드·Step 문서·README·PLAN | 실제 구현/검증과 완료·보류 상태 일치 | [Concept](./Concept.md), [PLAN](./PLAN.md), [Step13](./Step13.md), [README](../README.md) | 요구사항↔코드↔테스트 매핑 | NOT RUN | 미점검 | 해당 없음 | Step 15/20 |

## 결과 기록과 인수 경계

검수자는 점검 일시·Git 커밋·OS/Node/브라우저 버전·실행 명령·종료 코드·파일/로그 근거를 각 행의 비고 또는 별도 결함 기록에 남긴다. QC 전체 완료는 모든 행이 실제로 점검되어 잔여 FAIL/PARTIAL/BLOCKED의 처리 결정이 있을 때만 선언한다. 이번 문서 작성에서는 일부 **정적 사실만 확인**했고, 코드 품질 전체 QC를 실행하지 않았다. 물리 장치·사람의 청취는 QC PASS로 대체하지 않는다.
