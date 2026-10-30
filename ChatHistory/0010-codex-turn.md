<!-- Capture ID: 6f329fd9f1b1abed6d893591f4ebf8dd271040bb39321f66d7c5f47bfd9b5478
Source: codex-hooks
Captured: 2026-10-30T07:01:46.444Z
-->

# ChatHistory

Text below is copied verbatim from the indicated source; wrapper newlines are not part of the source text.
Scope: UserPromptSubmit.prompt and Stop.last_assistant_message; no attachments, intermediate messages, or tool output.

## User Prompt

```text
# Context from my IDE setup:

## Active file: README.md

## Open tabs:
- README.md: README.md
- AGENTS.md: AGENTS.md
- Step02.md: docs/Step02.md
- 0008-codex-turn.md: ChatHistory/0008-codex-turn.md
- Step01.md: docs/Step01.md

## My request:
현재 프로젝트 `ts-0001-ai-webrtc-practice`의 `README.md` 작성 형태를 개선하고 싶습니다.

다음 문서들을 참고해주세요.

**README 작성 규칙**\
[https://github.com/Sangseon/00-conventions/blob/master/docs/repository-readme.md](https://github.com/Sangseon/00-conventions/blob/master/docs/repository-readme.md)

**참고할 다른 프로젝트의 README**

- [https://github.com/Sangseon/js-0001-manual-jwt-token-practice/blob/master/README.md](https://github.com/Sangseon/js-0001-manual-jwt-token-practice/blob/master/README.md)
- [https://github.com/Sangseon/js-0002-manual-dynamodb-load-test-practice/blob/master/README.md](https://github.com/Sangseon/js-0002-manual-dynamodb-load-test-practice/blob/master/README.md)
- [https://github.com/Sangseon/py-0001-manual-login-automation-practice/blob/master/README.md](https://github.com/Sangseon/py-0001-manual-login-automation-practice/blob/master/README.md)

현재 프로젝트의 README와 위 문서들을 비교하여 다음 기준으로 수정해주세요.

### 작성 방향

1. Repository README Convention의 `Learning Repository` 구조를 우선 기준으로 적용합니다.
2. 참고 프로젝트 3개의 공통적인 문서 구성, 설명 방식, 문장 길이 및 표현 스타일을 분석하여 반영합니다.
3. 현재 프로젝트는 `practice` 유형이며, AI 활용 방식은 `Mode: ai`입니다.
4. `Overview`, `Topics`, `Focus`, `Tech Stack`, `Scope`, `Implementation`, `What I Learned`, `AI Usage`, `How to Run`, `References` 등의 구성을 참고합니다.
5. 학습 목표, 실제 구현 내용, 구현 예정 내용을 명확히 구분합니다.
6. `What I Learned`에는 실제 구현하거나 검증한 내용만 작성합니다.
7. `AI Usage`에는 Codex를 활용한 개발 및 사용자의 검토·검증 방식을 간결하게 설명합니다.
8. 실행 명령과 기술 스택은 현재 프로젝트의 실제 구현 상태를 기준으로 작성합니다.
9. Step별 상세 구현 및 검증 결과는 `docs/StepXX.md`에 두고, README에는 핵심 내용과 관련 문서 링크만 유지합니다.
10. 불필요하게 장황한 설명이나 반복되는 내용은 정리합니다.

### 주의사항

- 참고 프로젝트의 기술 내용이나 설명 문장을 그대로 복사하지 마세요.
- 참고 README마다 차이가 있다면 공통적인 스타일을 우선 적용하고, 최종적으로 Repository Convention을 따릅니다.
- 현재 프로젝트의 `AGENTS.md`, `docs/Concept.md`, `docs/PLAN.md` 및 Step별 문서를 확인해주세요.
- 아직 구현하지 않은 기능을 완료한 것처럼 작성하지 마세요.
- 프로젝트 진행 상태를 과장하지 않고, 학습용 포트폴리오에 적합한 간결하고 일관된 README를 작성해주세요.
- 기존에 유효한 실행 명령과 문서 링크는 보존해주세요.
- 이번 작업에서는 `README.md`만 수정해주세요.
- 소스 코드, 설정 파일 및 다른 문서는 수정하지 마세요.
- Git Commit 및 Push는 실행하지 마세요.

작업 완료 후 참고한 README들의 공통적인 특징과 현재 README에서 개선한 내용을 간단히 보고해주세요.

```

## Codex Response

```text
[README.md](D:/01.Portfolio/TypeScript/ts-0001-ai-webrtc-practice/README.md)만 수정했습니다.

참고 문서들의 공통점은 짧은 설명과 항목 목록, 학습 목표·구현 범위 구분, 목적별 실행 명령입니다. [JWT](https://github.com/Sangseon/js-0001-manual-jwt-token-practice/blob/master/README.md), [DynamoDB](https://github.com/Sangseon/js-0002-manual-dynamodb-load-test-practice/blob/master/README.md), [로그인 자동화](https://github.com/Sangseon/py-0001-manual-login-automation-practice)

이를 반영해 Topics를 추가하고, 완료·예정 범위를 표로 정리했습니다. 학습 결과와 AI 활용 설명은 간결하게 다듬고 실행 절차는 목적별로 구분했습니다.

기존 명령 9개와 모든 링크 보존, 문서 구조·공백 검사를 통과했습니다. 다른 파일은 변경하지 않았으며, 문서 작업이므로 빌드·실행은 재검증하지 않았습니다. 미완료 사항과 Commit·Push는 없습니다.
```
