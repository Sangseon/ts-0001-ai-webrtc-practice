<!-- Capture ID: 0550eec829e54363799636f6e6081d4adb8b2337597ea81a33ed09c684d03618
Source: codex-hooks
Captured: 2026-10-30T11:33:42.511Z
-->

# ChatHistory

Text below is copied verbatim from the indicated source; wrapper newlines are not part of the source text.
Scope: UserPromptSubmit.prompt and Stop.last_assistant_message; no attachments, intermediate messages, or tool output.

## User Prompt

```text
# Context from my IDE setup:

## Open tabs:
- PLAN.md: docs/PLAN.md
- Step05.md: docs/Step05.md
- README.md: README.md
- ws.test.cjs: scripts/ws.test.cjs
- application.ts: server/src/application.ts

# Files pasted by the user:

## "# Step 07 — SFU 연결과 미디어 송신 현재 프로젝트는 `ts-0001-ai-webrtc-practice`입니다. 이번 작업은 **S…": C:\Users\DESKTOP_Z790\.codex/attachments/ce66490f-cf47-4f37-968d-ef940565f776/Pasted text.txt

Pasted text contains the user's request.

## My request:


```

## Codex Response

````text
Step 07을 구현했고, **Windows 루프백·Chrome/Edge 가상 장치에서 실제 ICE/DTLS 연결과 RTP 전송을 확인했습니다.** 해당 범위로 PLAN을 완료 처리했습니다. Step 06의 물리 웹캠 미검증 상태는 유지했습니다.

구성은 단일 worker, 회의방별 Router, 참가자별 활성 Send Transport 하나, 획득한 종류별 Producer입니다. 서버가 생성·정리 중인 자원까지 포함해 **참가자당 한 활성 송신 방**을 강제합니다.

방 목록·채팅 화면·미디어 대상 선택은 독립적입니다. 전환은 기존 송신 종료 확인 후 새 방에 연결하며, `stopTracks:false`로 로컬 트랙을 재사용합니다. 채팅 화면 변경이나 다른 방 퇴장은 기존 송신에 영향을 주지 않습니다.

추가 패키지는 `mediasoup-client@3.25.3`입니다. 기존 `mediasoup@3.32.0`을 유지했습니다. Signaling은 기존 WebSocket에서 capabilities·create·connect·produce·stats·close를 처리하며, 실제 세션 소속과 roomId·mediaId·Transport·Producer 소유권을 검증합니다.

검증 결과입니다.

| 항목 | 결과 |
| --- | --- |
| TypeScript strict·Client/Server 빌드 | 통과 |
| 새 SFU Signaling 통합 테스트 | 7/7, 정상 종료 |
| 기존 WebSocket·방·채팅·payload 회귀 | 19/19 |
| 로컬 미디어 단위·Chrome/Edge 회귀 | 6/6 및 브라우저 검증 통과 |
| 기존 SFU·기록기 | 5/5, 실제 worker·Router 종료, 기록기 26/26 |
| 실제 송신 | 두 브라우저에서 마이크만·카메라만·동시 송신 통과 |
| 소유권·경합 | 타인 자원·두 방 동시 생성 거절, 취소·늦은 요청·퇴장 정리 통과 |
| 실패·복구 | 전환 실패, 잘못된 DTLS, 종료 확인 실패, Signaling timeout 검증 |
| 최종 잔류 프로세스·개발 포트·worker | 0 |

실제 카운터 예로 Chrome 오디오는 약 2~3초 동안 브라우저 `21→121 packetsSent`, SFU `21→121 packetCount`로 증가했습니다. 영상과 동시 송신에서도 양쪽 카운터 증가를 확인했습니다.

파일은 신규 8개·변경 12개입니다.

- 신규: `media.ts`, `shared/mediaProtocol.ts`, `MediaPanel.tsx`, `useSfuSender.ts`, SFU 테스트 파일 3개, [docs/Step07.md](D:/01.Portfolio/TypeScript/ts-0001-ai-webrtc-practice/docs/Step07.md)
- 변경: `application.ts`, `sfu.ts`, `shared/protocol.ts`, `useSession.ts`, `LocalMedia.tsx`, `App.tsx`, 기존 브라우저 fixture, 패키지 파일 2개, README·Concept·PLAN

실행은 기존 `npm run dev:server`, `npm run dev:client`입니다. 로컬 미디어 획득과 방 입장 후 별도 미디어 대상을 선택해 송신을 시작합니다.

```powershell
npm run test:sfu:ws
npm run test:sfu:browser
```

브라우저 테스트 전에는 개발 서버를 종료해야 합니다. 상세 파일 목록·RTP 샘플·물리 이어폰 마이크 수동 절차는 Step07 문서에 기록했습니다.

물리 마이크의 **SFU 송신**, 웹캠, LAN/NAT·다른 OS·장시간 부하는 미검증입니다. 원격 수신·Consumer는 구현하지 않았습니다. 초기 테스트 종료 대기와 timeout도 문서에 남겼으며, fixture 정리 보강 후 최종 정상 종료를 확인했습니다.

Git Commit·Push와 수동 대화 중복 기록은 실행하지 않았습니다.
````
