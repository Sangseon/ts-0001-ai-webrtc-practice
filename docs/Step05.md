# Step 05 — 전체 채팅과 회의방 채팅

2026-10-30 Windows, Node.js 24.22.1, npm 12.2.1에서 구현·검증했다. 기존 WebSocket 연결 하나와 세션 프로필·M:N 회의방 소속을 사용한다. 서버에 채팅 이력이나 새 프로필 저장소를 만들지 않았다. 추가 패키지는 없다.

## 구현 파일과 책임

| 파일 | 변경 |
| --- | --- |
| server/src/shared/protocol.ts | ChatTarget·ChatRequest·ChatMessage, 요청과 서버 응답 런타임 검증, 길이·보관 개수 상수 |
| server/src/application.ts | 채팅 요청 검증 후 성공 응답·대상별 이벤트 전달 |
| client/src/useSession.ts | 기존 소켓 재사용, 채팅 이벤트·응답 분리, 제한된 내역·마지막 프로필 관리 |
| client/src/Chat.tsx | 신규: 전체·참여 방 선택, 메시지 입력·목록·작성자·시각 |
| client/src/App.tsx, style.css | 채팅 컴포넌트 연결과 안전한 줄바꿈·긴 본문 표시 |
| scripts/ws.test.cjs | 실제 WebSocket 채팅 테스트 3개 추가, 기존 16개 유지 |
| README.md, docs/PLAN.md | 현재 구현 범위·학습 결과·진행 상태·종료 결함 후속 기록 정합성 |

폴더 구조를 재편하지 않고 `client/src/Chat.tsx`와 이 문서만 추가했다. 기존 자동 기록기·Hook·AGENTS.md·패키지 설정과 Step 01~04 기록은 유지한다.

## 메시지 계약과 검증

요청은 하나의 `chat.send` 타입을 사용하며 scope로 구분한다. 기존 `kind`, `type`, `requestId` 규칙을 유지한다. 두 요청을 나누는 것보다 공통 본문 검증과 응답을 공유하기 쉽고, TypeScript 판별 유니온으로 roomId의 필수 여부를 표현할 수 있다.

```json
{"kind":"request","type":"chat.send","requestId":"request-1","scope":"global","body":"안녕하세요"}
```

```json
{"kind":"request","type":"chat.send","requestId":"request-2","scope":"room","roomId":"서버가-발급한-ID","body":"이 방에만 전달"}
```

서버는 정확한 필드 집합, JSON·요청 식별자·scope·roomId를 검사한다. global 요청의 roomId, 임의 participantId·sentAt·messageId 등 추가 필드는 거절한다. 잘못된 구조는 INVALID_MESSAGE, 본문은 INVALID_CHAT, 존재하지 않는 방은 ROOM_NOT_FOUND, 비소속 방은 NOT_JOINED 오류로 응답하며 이벤트는 보내지 않는다. 기존 직접 타입 가드를 확장해 외부 스키마 패키지는 추가하지 않았다.

본문은 앞뒤 공백을 제거한 Unicode 코드 포인트 1~500자다. 내부 공백·줄바꿈·탭은 유지하고 나머지 C0 제어 문자와 DEL은 거절한다. WebSocket 전체 메시지 4,096-byte 제한도 유지하므로 본문 외 JSON 필드와 이스케이프까지 포함해 이 한도를 적용한다. HTML·스크립트 문자열도 일반 텍스트로 취급한다.

성공 응답은 다음과 같다. 이는 서버 검증·수락 결과이며 사용자의 화면 표시 완료를 보장하지 않는다.

```json
{"kind":"response","type":"chat.send","requestId":"request-1","ok":true,"messageId":"서버-UUID","scope":"global"}
```

회의방 성공 응답에는 `scope: 'room'`과 대상 `roomId`도 포함한다. 확정 이벤트는 `{kind:'event', type:'chat.message', message}`이며 message에 `messageId`, `scope`, 방인 경우 `roomId`, `participantId`, `body`, `sentAt`을 포함한다. UUID와 ISO 시각은 서버가 생성하고 작성자는 요청한 실제 소켓의 세션에서 결정한다. 닉네임·아바타는 메시지마다 복제하지 않는다.

## 전달 범위와 처리 순서

서버는 하나의 동기 메시지 처리 안에서 **구조·본문 검증 → 실제 세션과 방 소속 확인 → 메시지 확정 → 요청자 성공 응답 → 대상별 이벤트 전송**을 수행한다. 요청자도 이벤트를 받아 표시하며 성공 응답만으로 메시지를 추가하지 않는다.

- 전체: 현재 세션 Map을 한 번 순회해 OPEN인 각 소켓에 한 번 전달한다. 방 미참여자와 다중 참여자도 동일하다.
- 회의방: `createRoomStore()`의 해당 방 participantIds Set과 각 연결 세션의 participantId를 대조한다. 소속된 연결만 전송 대상이다.
- 전송과 퇴장이 연속이면 서버가 처리한 순서를 따른다. 퇴장 전에 처리한 메시지는 유효하고, 퇴장 후에는 전송·수신 대상에서 제외된다. 다른 방의 소속과 채팅은 유지된다.
- 삭제된 방에는 새 메시지를 보낼 수 없다. 연결 종료·heartbeat 때 기존 모든 소속 정리를 재사용한다.

공통 send는 OPEN 소켓만 사용한다. 동기 송신 예외는 해당 소켓을 종료하고 다른 수신자 처리를 계속한다. 비동기 전송 오류는 기존 ws error·close 경로가 처리하며 CLOSING 소켓을 불필요하게 terminate하지 않는다. 요청 ID는 응답 대응용이고 재전송·중복 명령 제거·영구 전달 보장은 추가하지 않았다.

## 브라우저 내역과 프로필

`useSession`은 수신 순서의 메시지 배열을 관리하고 scope·roomId로 채널을 구분한다. 동일 messageId 이벤트는 한 번만 반영한다. 채널별 최근 100개, 모든 채널 합계 최근 500개로 제한해 오래된 메시지부터 제거한다. 화면 전환은 배열을 필터링할 뿐이며 입장·퇴장이나 새 WebSocket 연결을 만들지 않는다.

작성자 표시는 participantId별 공통 캐시를 참조한다. 최초 접속자 snapshot과 joined·updated 이벤트로 갱신하므로 이미 수신한 메시지에도 닉네임·아바타 변경이 반영된다. 다른 작성자가 종료하면 메시지가 남아 있는 동안 마지막 프로필을 유지한다. 캐시는 현재 접속자와 보관 메시지 작성자만 남겨 메시지가 모두 사라진 과거 작성자는 제거한다. 서버에는 별도 프로필 복제나 과거 메시지 저장소가 없다.

본인이 특정 방에서 퇴장하거나 방이 삭제되면 그 방 내역을 삭제한다. 다른 방과 전체 내역은 유지한다. 본인 연결 종료·수동 재접속·새로고침은 모든 내역·이전 프로필 캐시를 초기화하며 과거 내역을 조회하거나 복원하지 않는다. localStorage·IndexedDB는 사용하지 않는다.

## UI와 실행

채팅 선택 상자에 전체 채팅과 현재 참여 방만 표시한다. 선택한 방을 퇴장하면 전체 채팅으로 표시가 돌아가며 미참여 방에 전송할 수 없다. 본문, 작성자 닉네임·아바타, 서버 시각, 본인 표시 `(나)`를 제공한다. React 텍스트 자식으로 렌더링하며 HTML 직접 삽입이나 Markdown 해석을 하지 않는다.

기존 pending 요청 한 개와 8초 대기 제한을 채팅·프로필·회의방 요청이 공유한다. 요청 중 또는 연결 종료 시 전송을 비활성화하고 기존 오류 영역에 실패를 표시한다. 이 직렬 UI는 단순하지만 고속 다중 요청 UI는 아니다. 자동 재전송이나 낙관적 메시지 추가는 없다.

```powershell
# 루트에서 별도 터미널 두 개
npm run dev:server
npm run dev:client

npm run typecheck
npm run build
npm run test:ws
npm run test:sfu
npm run sfu:check
node --test scripts/chat-history.test.cjs
```

개발 화면은 http://127.0.0.1:5173, 서버는 http://127.0.0.1:3000/health다. 빌드 결과 실행은 `npm run start:server`, `npm run preview:client`를 사용한다.

수동 확인은 Chrome 두 세션·Edge 한 세션 A/B/C를 열고, A는 방 1·2, B는 방 1, C는 방 2에 참여시킨다. 전체 채팅은 모두, 방 1은 A/B, 방 2는 A/C만 수신하는지 확인한다. 화면 전환 뒤 내역 유지, 작성자 프로필 변경, A의 방 1 퇴장 뒤 방 2 유지, 스크립트 문자열 표시, 연결 종료·재접속 초기화를 차례로 확인할 수 있다.

## 실제 검증 결과

| 항목 | 실행 결과 |
| --- | --- |
| 환경 | Windows, Node 24.22.1·npm 12.2.1, 추가 설치 없음 |
| strict 타입 검사·Client/Server 빌드 | 통과 |
| WebSocket 통합 | 19/19 통과: 기존 16개 + 채팅 3개 |
| 전체 전달 | 방 미참여자 포함 A/B/C/로비에 같은 ID·본문·작성자·서버 시각, 중복 이벤트 없음 |
| 방 전달 | A의 M:N 참여, 방 1 A/B·방 2 A/C 격리, 다른 방·로비 수신 없음 |
| 검증·소유권 | 빈 값·공백·501자·잘못된 타입·scope·누락 roomId·없는 방·비소속·ID/시각 위조·추가 필드 거절, 오류 후 정상 전송 |
| 순서·정리 | 전송→퇴장→전송의 승인/거절, 퇴장 후 수신 제외·다른 방 유지, 종료 모든 소속 제거·삭제 방 거절 |
| 이력 부재 | 신규 접속·방 입장 시 과거 메시지 미전달 |
| 실제 브라우저 | Chrome 2개·Edge 1개, 서로 다른 임시 프로필의 headless 세션에서 실제 입력·제출·선택 조작 |
| 브라우저 채팅 | 전체·방별 내역 격리와 전환 유지, 닉네임·아바타 변경의 기존 메시지 반영, HTML 문자열 실행 없이 텍스트 표시 |
| 브라우저 생명주기 | 부분 퇴장 뒤 다른 방 유지, 타인 종료 후 마지막 프로필 유지, 본인 종료·재접속 새 ID·빈 내역 |
| 보관 개수 | 실제 브라우저에 전체 105개·5개 방 각각 100개를 전달해 채널별 100개·합계 500개, 가장 오래된 전체 내역 제거 확인 |
| 브라우저 예외 | 수집한 Runtime.exceptionThrown 0건 |
| HTTP | 기존 WS 테스트의 /health 200·JSON과 없는 경로 404 통과, 브라우저 검증 시 실제 개발 서버 health 응답 |
| 초과 payload | 기존 4,096/4,097-byte 경계 및 10회 1009 반복, heartbeat·shutdown 경합 통과 |
| SFU | 5/5 통과, sfu:check 실제 worker·Router 생성·종료·subprocessClosed 확인 |
| ChatHistory | 기록기 26/26 통과 |

EADDRINUSE 출력은 기존 포트 충돌 테스트의 의도된 결과다. 브라우저 검증기는 일시 파일로 실행하고 완료 후 제거했다. 실행 중 이전 payload 진단의 Node 프로세스가 남아 있음을 발견해 명령줄이 일치하는 소유 PID와 자식을 정리했다. 개발 서버·브라우저도 종료 후 정리했다.

중간 최종 실행 한 번은 19개 테스트 본문이 끝나도 러너가 종료되지 않아 완료로 처리하지 않았다. 이전 진단의 부모 PowerShell 반복 루프가 자식 테스트를 다시 생성하고 있었으므로 해당 부모까지 정리했다. 대기 중이던 이번 실행도 중단한 뒤 최종 독립 `npm run test:ws`를 실행해 19/19 요약과 종료 코드 0을 확인했다. 이 한 번의 성공으로 기존 극단적 payload stress의 모든 종료 경합이 해결됐다고 판단하지 않는다.

최종 점검에서 해당 테스트·개발 Node 프로세스 0개, 포트 3000·4173·5173 리스너 0개, mediasoup-worker 0개였고 `git diff --check`도 통과했다.

## 제약과 후속 단계

- 사람이 보는 창의 육안 확인, Firefox·Safari·다른 OS, 물리 네트워크 단절·고부하·장시간 운용·8초 timeout·HMR은 이번에 검증하지 않았다. 이번 빌드 산출물의 preview 브라우저 재실행은 하지 않았다.
- 일반 텍스트·HTML의 안전한 렌더링과 보관 상한은 브라우저에서 확인했으며 읽음 확인·화면 표시 완료 응답·서버 저장·재전송 보장은 없다.
- 기존 payload 결함은 애플리케이션의 불필요한 terminate 경로가 별도 수정된 상태를 유지한다. 과거 stress의 간헐 1006을 모두 해결한 것으로 확대 해석하지 않는다. 상세 이력은 Step03·Step04 후속 기록을 따른다.
- 서버는 신뢰할 수 있는 로컬 개발 상대를 가정한다. 인증·rate limit·대량 연결 운영 대책은 이번 실습 범위에 없다.
- Step 07 Signaling은 같은 WebSocket의 별도 type으로 확장하고 requestId·roomId·실제 소속과 자원 소유권을 검증해야 한다. 채팅 이벤트와 Signaling 응답을 혼동하지 않고 미디어 payload를 채팅 메시지에 넣지 않는다.
- Step 05 완료 기준인 범위 격리·다중 방 채팅·프로필 연동·안전한 표시를 실제 WS와 브라우저로 확인했다. Step 06 이후 기능은 구현하지 않았다.
- AGENTS.md·ChatHistory·.codex·자동 기록 설정을 유지했다. 이 대화는 수동 중복 기록하지 않았고 최종 응답의 자동 저장 여부는 Stop Hook 이후 확인해야 한다. Git Commit·Push는 실행하지 않았다.
