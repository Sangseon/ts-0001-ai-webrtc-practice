# 0001 — AGENTS.md 작성

## User Prompt

사용자 메시지 원문(IDE 컨텍스트 포함):

```text
# Context from my IDE setup:

## Active file: README.md

## Open tabs:
- README.md: README.md

## My request:
현재 프로젝트는 `ts-0001-ai-webrtc-practice`입니다.

먼저 `README.md`와 `docs/Concept.md`를 읽고 프로젝트의 목적과 구현 범위를 파악해주세요.

이번 프로젝트는 Codex AI를 활용한 TypeScript 기반 바이브 코딩 실습입니다.

다음 조건을 반영하여 Repository 루트에 `AGENTS.md`를 작성해주세요.

1. `docs/Concept.md`를 프로젝트 요구사항의 기준으로 사용합니다.
2. 다자간 화상회의는 SFU 방식으로 구현합니다.
3. 개발 계획은 추후 `docs/PLAN.md`에 Step별로 정의합니다.
4. 사용자가 요청한 Step만 구현하며 다음 Step을 임의로 진행하지 않습니다.
5. 불필요한 기능이나 과도한 설계를 추가하지 않습니다.
6. 각 작업 완료 후 변경 파일, 구현 내용, 검증 결과 및 미완료 사항을 설명합니다.
7. 기획·설계·개발 문서는 `docs/`에서 관리하고, `AGENTS.md`는 Repository 루트에 둡니다.
8. 사용자 프롬프트와 Codex 응답은 `ChatHistory/`에 순서대로 보존할 예정입니다. 자동 기록 방식은 별도로 구성하며, 기록하지 않은 대화를 기록했다고 표시하지 않습니다.
9. Git Commit 및 Push는 사용자가 직접 수행합니다. Codex는 임의로 실행하지 않습니다.
10. 주요 기술적 선택에는 선택 이유를 설명합니다.

이번 작업에서는 `AGENTS.md`만 생성해주세요.

`PLAN.md` 작성, 애플리케이션 코드 구현 및 라이브러리 설치는 진행하지 마세요.

작성이 완료되면 적용한 규칙을 간단히 설명해주세요.
```

## Codex Response

해당 요청에 대한 최종 답변 원문이다. 아래 답변은 첫 번째 작업 완료 당시의 결과를 설명한다. 중간 진행 메시지와 도구 실행 내역은 기록 범위에 포함하지 않는다.

```markdown
루트에 [AGENTS.md](../AGENTS.md)를 생성했습니다.

- `docs/Concept.md`를 요구사항 기준으로 지정하고 SFU 구현 방향과 선택 이유를 명시했습니다.
- 추후 `docs/PLAN.md`에 따라 요청한 Step만 구현하며, 임의로 다음 Step이나 기능을 추가하지 않도록 했습니다.
- 문서 위치, 대화 기록의 사실성, 완료 보고 항목, 주요 기술 선택의 이유 설명, Commit·Push 직접 수행 원칙을 반영했습니다.

검증 결과 `AGENTS.md`만 새로 생성되었습니다. `PLAN.md` 작성, 코드 구현, 라이브러리 설치는 수행하지 않았으며, 이번 요청의 미완료 사항은 없습니다.
```
