# 0003 — Hook 실행 경로 이동성 수정

- Source: manual-backfill
- Original Request Time: 1:26 PM (사용자 제공, 날짜 미제공)
- Original Order: 2/3 (이번에 제공된 과거 대화 내 순서)
- Backfilled At: 2026-10-30T14:00:42+09:00 (Asia/Seoul)
- 기록 범위: 이번 메시지로 사용자가 제공한 과거 요청과 최종 답변 인용문. 당시 전체 대화나 IDE 컨텍스트를 추가로 복원하지 않았다. 아래 본문은 요약이 아니며, 제공된 Markdown 표기와 경로를 유지했다. 과거 응답의 검증 결과는 당시 보고 내용이며 이번 작업에서 재실행한 결과가 아니다.

## User Prompt

```text
`.codex/hooks.json`을 검토한 결과, `command`에 개인 PC의 절대 경로가 하드코딩되어 있습니다.

Repository를 다른 경로로 이동하거나 다른 환경에서 Clone하더라도 동작하도록 수정해주세요.

요구사항:

1. 개인 PC의 절대 경로를 제거합니다.
2. 프로젝트의 Git 루트를 기준으로 `scripts/chat-history.cjs`를 실행하도록 구성합니다.
3. Windows 환경과 VS Code Codex 확장에서 정상 실행되는지 확인합니다.
4. 기존 `UserPromptSubmit`, `Stop` 이벤트와 기록 기능은 유지합니다.
5. `.gitignore`의 `/\.chat-history/` 규칙과 `ChatHistory/` Git 관리 정책은 유지합니다.
6. 수정 후 Hook 실행 및 자동 기록 동작을 검증하고, 실패한 테스트는 명확히 보고해주세요.

이번 작업에서는 Hook 실행 경로와 관련된 부분만 수정해주세요.

Git Commit과 Push는 실행하지 마세요.
```

## Codex Response

```text
Hook의 개인 PC 절대 경로를 제거했습니다. 이제 `git rev-parse --show-toplevel`로 Git 루트를 찾아 기록기를 실행합니다.

변경 파일:

- [.codex/hooks.json](./.codex/hooks.json): Git 루트 기준 실행
- [scripts/chat-history.cjs](./scripts/chat-history.cjs): Windows 짧은 경로 정규화
- [테스트](./scripts/chat-history.test.cjs), [문서](./docs/ChatHistory.md): 경로 이동 검증 추가

**최종 26개 테스트 모두 통과했습니다.** Windows cmd와 PowerShell에서 저장소 이동, 한글·공백·특수 문자 경로, 하위 폴더 실행과 기록 생성을 확인했습니다. 초기 실패 2개는 경로 정규화로 해결했습니다.

VS Code 확장의 실제 대화 이벤트는 직접 검증하지 못했습니다. 변경된 Hook을 재검토·신뢰 승인한 뒤 새 로컬 대화에서 확인해야 합니다.

기존 이벤트와 기록 기능, `.gitignore`, ChatHistory Git 관리 정책은 유지했습니다. Commit·Push는 실행하지 않았습니다.
```
