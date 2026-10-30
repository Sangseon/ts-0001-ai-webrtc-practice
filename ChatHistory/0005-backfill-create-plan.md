# 0005 — docs/PLAN.md 작성 대화 복원

- Source: manual-backfill
- Original Session ID: 01a18af7-f766-7f92-8dc3-8820573a559c
- Original Turn ID: 01a18b37-b015-79f0-8a5c-ea72f3e86b1c
- Original Request At: 2026-10-30T14:10:45.033+09:00
- Original Final Response At: 2026-10-30T14:16:18.436+09:00
- Backfilled At: 2026-10-30T14:51:11+09:00
- 원문 출처: 로컬 세션 rollout-2026-10-30T13-01-09-01a18af7-f766-7f92-8dc3-8820573a559c.jsonl의 해당 턴 UserMessage와 final_answer.
- 복원 범위: IDE 컨텍스트를 포함한 사용자 요청 전체와 Codex 최종 응답 전체. 중간 진행 메시지와 도구 실행 내역은 제외했다.
- 보존 방식: 원문 문자열을 수정·요약하지 않았다. 구역 제목·코드 펜스와 구분용 줄바꿈은 기록 형식이며 원문에 포함되지 않는다. 응답의 검증 결과는 당시 보고 내용이다.

## User Prompt

````text
# Context from my IDE setup:

## Active file: ChatHistory/0001-create-agents.md

## Open tabs:
- 0001-create-agents.md: ChatHistory/0001-create-agents.md
- 0003-codex-turn.md: ChatHistory/0003-codex-turn.md
- 0003-backfill-hook-git-root.md: ChatHistory/0003-backfill-hook-git-root.md
- 0002-backfill-chat-history-git-policy.md: ChatHistory/0002-backfill-chat-history-git-policy.md
- 0004-backfill-auto-history-verification.md: ChatHistory/0004-backfill-auto-history-verification.md

## My request:
현재 프로젝트는 `ts-0001-ai-webrtc-practice`입니다.

`README.md`, `docs/Concept.md`, `AGENTS.md`를 확인하고, 프로젝트의 전체 개발 계획을 `docs/PLAN.md`에 작성해주세요.

이번 프로젝트는 Codex를 활용한 TypeScript 기반 WebRTC 바이브 코딩 실습입니다.

다음 사항을 기준으로 계획을 수립해주세요.

1. `docs/Concept.md`의 기능 요구사항과 구현 범위를 유지합니다.
2. 다자간 화상회의는 SFU 방식으로 구현합니다. Mesh 방식으로 대체하지 않습니다.
3. 브라우저 클라이언트, Node.js 애플리케이션 서버, SFU 미디어 서버의 역할과 통신 흐름을 정의합니다.
4. WebSocket 기반 Signaling·채팅과 WebRTC 기반 미디어 전송의 역할을 구분합니다.
5. TypeScript 기반 기술 스택을 검토하고 주요 기술의 선택 이유와 Trade-off를 설명합니다.
6. SFU 라이브러리는 적합한 후보와 선택 기준을 검토합니다. 현재 단계에서 확정할 필요가 없다면 결정 시점도 명시합니다.
7. 기능 간 의존성을 고려하여 실제 구현 순서를 Step별로 정의합니다.
8. 각 Step에는 구현 범위, 주요 작업, 완료 기준, 검증 방법을 포함합니다.
9. 각 Step은 독립적으로 작업하고 검증할 수 있도록 지나치게 크지 않은 단위로 구성합니다.
10. 프로젝트의 초기 목표는 로컬 개발 환경에서 3명 이상이 다자간 화상회의를 이용하고, 채팅·프로필·장치 설정 기능을 확인하는 것입니다.

추가 조건:

- `docs/Concept.md`에 작성된 예상 구현 순서를 반드시 따를 필요는 없습니다. 기술적 의존성을 분석해 적절한 순서를 제안해주세요.
- 불필요한 기술 도입이나 과도한 설계를 피해주세요.
- 회원가입, 데이터 영속화, 녹화, 화면 공유, 대규모 배포 등 초기 범위에 없는 기능은 추가하지 마세요.
- 이번 작업에서는 `docs/PLAN.md`만 작성해주세요.
- 애플리케이션 코드 구현, 프로젝트 초기화, 패키지 설치 및 다른 문서 변경은 진행하지 마세요.
- 기존 ChatHistory 자동 기록 기능을 사용하고, 같은 대화를 별도 파일로 중복 기록하지 마세요.
- Git Commit 및 Push는 실행하지 마세요.

작업을 완료하면 전체 Step 구성, 기술 선택 이유, 주요 위험 요소 및 미결정 사항을 요약해서 보고해주세요.

````

## Codex Response

````text
[docs/PLAN.md](/D:/01.Portfolio/TypeScript/ts-0001-ai-webrtc-practice/docs/PLAN.md)만 작성했습니다. 각 Step에 구현 범위, 주요 작업, 완료 기준, 검증 방법을 포함했습니다.

전체 구성은 다음과 같습니다.

1. TypeScript 실행 기반
2. SFU 환경 검증·선택
3. WebSocket 세션·프로필
4. 회의방·참가자 관리
5. 전체·회의방 채팅
6. 로컬 미디어·미리보기
7. SFU 연결·송신
8. 2인 양방향 수신
9. 3인 이상 참가·퇴장·자원 정리
10. 카메라·마이크 제어
11. 장치 목록·전환
12. 마이크 입력 레벨
13. 예외 처리·통합 검증

기술은 React·Vite·TypeScript, Node.js·`ws`를 권장했습니다. SFU는 Signaling과 미디어 제어를 직접 학습하기 좋은 mediasoup를 우선 검토하고, LiveKit과 비교해 **Step 02에서 확정**합니다. [mediasoup 설계](https://mediasoup.org/documentation/v3/mediasoup/design/)

주요 위험은 Windows native worker 실행, 미디어 포트·ICE 연결, 브라우저 권한·자동 재생, 장치 공유와 자원 정리입니다. 패키지 버전·SFU·코덱·포트·검증 장비는 관련 Step에서 결정하도록 명시했습니다.

13개 Step의 필수 항목과 문서 구조를 확인했고, 변경 파일은 `PLAN.md`뿐입니다. 앱 구현·초기화·설치·실행 검증·Commit·Push는 수행하지 않았습니다.
````
