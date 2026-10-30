# 0002 — ChatHistory Git 관리 정책 수정

- Source: manual-backfill
- Original Request Time: 1:18 PM (사용자 제공, 날짜 미제공)
- Original Order: 1/3 (이번에 제공된 과거 대화 내 순서)
- Backfilled At: 2026-10-30T14:00:42+09:00 (Asia/Seoul)
- 기록 범위: 이번 메시지로 사용자가 제공한 과거 요청과 최종 답변 인용문. 당시 전체 대화나 IDE 컨텍스트를 추가로 복원하지 않았다. 아래 본문은 요약이 아니며, 제공된 Markdown 표기와 경로를 유지했다. 과거 응답의 검증 결과는 당시 보고 내용이며 이번 작업에서 재실행한 결과가 아니다.

## User Prompt

````text
`.gitignore`에 `ChatHistory/`가 추가된 것을 확인했습니다.

하지만 `ChatHistory/`는 사용자 프롬프트와 Codex 응답을 GitHub에 커밋하여 개발 과정을 기록하기 위한 디렉터리입니다.

따라서 다음과 같이 수정해주세요.

1. `.gitignore`에서 `ChatHistory/` 제외 규칙을 제거해주세요.
2. `ChatHistory/`에 생성되는 Markdown 기록 파일은 Git에서 추적할 수 있어야 합니다.
3. 민감 정보가 포함될 수 있다는 이유로 디렉터리 전체를 제외하지 마세요.
4. 대신 민감 정보가 기록되거나 커밋되지 않도록 처리 방안을 검토해주세요.
5. `AGENTS.md`에도 ChatHistory를 Git으로 관리한다는 정책을 명확하게 반영해주세요.

현재 진행 중인 대화 자동 기록 기능의 나머지 요구사항은 그대로 유지해주세요.

Git Commit 및 Push는 실행하지 마세요.
````

## Codex Response

````text
`ChatHistory/`를 Git으로 관리하도록 수정했습니다.

- `.gitignore`: `ChatHistory/` 제외 규칙 제거. `.chat-history/` 임시 상태만 제외합니다.
- `AGENTS.md`, `docs/ChatHistory.md`: Git 관리 정책과 민감 정보 처리 절차 반영.
- 기록기·테스트: 민감 값이 의심되면 원문을 변형하지 않고 해당 대화의 저장을 보류하도록 보완했습니다.

커밋 전 스테이징된 기록은 다음 명령으로 검사할 수 있습니다.
```
node scripts/chat-history.cjs --check-staged
```

**23개 테스트가 통과**했고, Markdown 기록의 Git 추적 가능 여부와 기존 기록의 무변경을 확인했습니다. 패턴 검사는 미탐이 가능하므로 직접 검토도 필요하며, 커밋을 자동 차단하지는 않습니다.

기존 자동 기록 요구사항은 유지했습니다. Commit·Push는 실행하지 않았습니다.
````
