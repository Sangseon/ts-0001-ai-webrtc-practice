# 다중 회의방 참여 정책 — 기존 구현 영향 검증

2026-10-30, Windows·Node.js 24.22.1·npm 12.2.1의 현재 로컬 코드를 기준으로 검토했다. 이번 작업은 요구사항 문서 수정과 기존 회귀 검증이며 Step 04 구현이 아니다. 소스·테스트·설정·의존성은 변경하지 않았다.

## 정책과 문서 변경

- 사용자와 회의방 소속을 다대다(M:N)로 정의한다. 한 연결의 participantId로 여러 방에 참여한다.
- 특정 방 퇴장은 해당 소속만 제거한다. 다른 방과 서비스 WebSocket 연결은 유지한다.
- 연결 종료·heartbeat 정리 시에는 그 연결이 참여한 모든 방에서 이탈한다.
- 프로필은 참가자 공통 상태이며 여러 방에서 같은 participantId를 참조한다.
- 논리적 소속과 실제 WebRTC 미디어 연결은 구분한다. 모든 소속 방의 동시 송수신을 요구하거나 금지하는 정책은 이번에 확정하지 않았다.

PLAN의 공통 통신 흐름, Step 04·05·07~09 및 인수 시나리오를 맞췄다. Concept에는 참여 정책을 추가하고 README에는 구현 예정 범위만 최소 반영했다. Step03 문서의 단일 방 후속 지침을 교체했다. Step01·02의 과거 구현·검증 결과는 수정하지 않았다.

## Step 01 — 현재 실행 기반에는 변경 불필요

근거는 [package.json](../package.json), [client/tsconfig.json](../client/tsconfig.json), [server/tsconfig.json](../server/tsconfig.json), [서버 진입점](../server/src/index.ts), [HTTP·WS 서버](../server/src/application.ts)다.

- 클라이언트·서버 실행 및 빌드 경로는 방 소속과 독립적이다. rootDir·출력 경로·개발 포트 변경이 필요하지 않다.
- HTTP `/health`는 세션·방 상태를 읽지 않는 상태 경로다. 실제 200·JSON 응답과 Content-Type을 다시 확인했다.
- 다중 소속은 기존 메모리 구조와 WebSocket 메시지의 확장 대상이다. 추가 패키지나 Node·npm 변경은 요구하지 않는다.
- 양쪽 strict 타입 검사·빌드가 통과했으므로 Step 01 완료 상태는 유지할 수 있다. 브라우저 UI·다른 체크아웃 경로의 실행은 이번에 재검증하지 않았다.

## Step 02 — 현재 SFU 검증에는 변경 불필요

[sfu.ts](../server/src/sfu.ts)의 createSfu는 worker 하나와 Router 하나를 만들고 함께 정리한다. [sfu-check.ts](../server/src/sfu-check.ts)는 이 생명주기만 실행하며 회의방·participantId·Transport와 연결돼 있지 않다.

- 논리적 다중 소속은 현재 독립 검증 코드의 변경을 요구하지 않는다.
- worker·Router 실제 생성·종료와 SFU 테스트 5개가 다시 통과했다. Step 02 완료 기준은 여전히 유효하다.
- 현재 close()가 worker 전체를 닫는 점은 독립 검증 범위에 맞다. 향후 이를 방 퇴장에 그대로 연결하면 다른 방의 자원까지 닫을 수 있으므로 자원 소유 범위를 먼저 정해야 한다.
- 방별 미디어 상태와 참가자별 자원을 식별하고, 방 하나의 정리와 전체 연결 정리를 구분해야 한다. worker·Router 배치와 공유 여부는 Step 07에서 결정한다. 방 하나당 worker 하나 또는 Router 하나라는 구성을 이번에 확정하지 않았다.

## Step 03 — 확장 가능하지만 현재 다중 소속 기능은 없음

| 검토 대상 | 실제 코드 근거와 판단 | Step 04 확장 지점 |
| --- | --- | --- |
| 연결·소유권 | application.ts의 sessions Map은 소켓별 participant·alive를 보관하고 서버가 UUID를 발급한다. roomId 필드는 없다 | 기존 연결·ID를 유지하고 참가자별 참여 방 집합을 연결 |
| 프로필 | session.participant를 갱신할 때 서버의 participantId를 보존한다. 프로필은 방별로 복제되지 않는다 | 방별 참가자 목록은 ID로 공통 프로필을 참조해 변경 일관성 유지 |
| 전역 접속 목록 | session.ready의 participants와 joined/updated/left는 서비스 전체 접속자 상태다 | 이 의미를 유지하고 방 목록·소속 snapshot 및 방별 이벤트를 별도로 정의 |
| 프로토콜 | shared/protocol.ts의 kind/type 판별 유니온과 requestId는 확장 가능하다. 현재 parseRequest는 profile.update 외 종류를 UNKNOWN_TYPE으로 거절한다 | 방 요청·응답·이벤트 타입과 각 payload의 런타임 검증을 함께 추가 |
| 정리 | remove(socket)은 중복 제거를 방지하고 close·error·heartbeat에서 호출된다 | 세션 삭제 전에 모든 방 소속 정리를 연결. 한 방 퇴장은 remove(socket)을 호출하면 안 됨 |
| 서버 전체 종료 | close()는 소켓 terminate 후 sessions.clear()를 호출한다 | 비동기 close 이벤트만 믿지 말고 전체 종료 시 방 상태도 명시적으로 비운 뒤 Map 정리 |
| 클라이언트 연결 | useSession.ts는 socketRef 하나와 재접속 Effect를 사용한다. 연결 하나가 방 하나라는 의미는 없다 | 방 참여 변경만으로 소켓·ID를 다시 만들지 않음 |
| 클라이언트 상태 | participants는 전역 배열 하나다. 여러 방의 소속·목록을 표현하는 상태는 아직 없다 | roomId별 방 상태·본인 참여 방 집합을 추가하고 전역 프로필과 구분 |
| 클라이언트 이벤트 | isServerMessage 이후 이벤트 else 분기는 participant 객체가 있다고 가정한다 | 새 방 이벤트를 추가할 때 명시적인 type 분기로 바꾸고 방 퇴장을 전역 participant.left로 처리하지 않음 |
| 대기 요청 | pending Ref는 프로필 요청 한 개만 추적한다. 이는 단일 방 전제가 아닌 현재 요청 범위의 제약이다 | 방 요청의 동시 처리 필요에 맞춰 requestId별 추적 또는 명시적 직렬화 결정 |
| UI | App.tsx는 접속 사용자 목록 하나와 본인 프로필 폼을 표시한다 | 방 목록·각 방 참가자 표시·방별 입퇴장 동작을 추가. 표시 중인 방을 전체 소속과 혼동하지 않음 |

근거 파일: [application.ts](../server/src/application.ts), [protocol.ts](../server/src/shared/protocol.ts), [useSession.ts](../client/src/useSession.ts), [App.tsx](../client/src/App.tsx).

코드에는 사용자당 하나의 회의방이라는 암묵적 상태·검사도 발견되지 않았다. 단일 방 제한은 PLAN과 Step03의 후속 지침에 있었다. 따라서 방 집합·메시지·UI의 추가는 Step 04의 정상적인 확장이다. 현재 코드가 이미 여러 방을 지원하거나, 타입을 추가하는 것만으로 동작한다고 판단한 것은 아니다.

## 기존 회귀 이슈 — 정책 변경과 별개

첫 `npm run test:ws` 실행에서 7개 중 6개가 통과하고 다음 항목이 실패했다.

```text
oversized payload closes only the offending socket and removes its session
Expected: 1009
Actual:   1006
scripts/ws.test.cjs:133
```

이후 같은 명령을 소스·테스트 변경 없이 3회 재실행했고 모두 7/7 통과했다. 최초 실패를 재실행 통과로 대체하지 않으며 간헐적 종료 코드 경합이 남아 있다고 판단한다. 실패한 실행에서는 해당 테스트의 코드 비교 이후 단언은 실행되지 않았지만, 재실행에서는 상태 제거·health 검사까지 통과했다.

코드상 가장 유력한 원인은 [application.ts](../server/src/application.ts)의 socket error 리스너가 remove 후 항상 terminate하는 처리다. 설치된 ws의 receiverOnError는 payload 제한 오류에서 close(1009)를 시도한 뒤 error를 발생시킨다. 애플리케이션의 즉시 terminate가 종료 프레임 전달을 중단하면 상대는 비정상 종료 1006을 볼 수 있다. 이번 정책 문서 수정 전의 기존 코드에서 발생했으므로 다중 소속 기능의 회귀로 볼 근거는 없다.

**후속 소스 수정 후보:** application.ts에서 프로토콜 오류의 정상 close handshake와 실제 전송 오류의 즉시 terminate를 구분해야 한다. 세션 정리는 중복 안전하게 유지해야 한다. 기존 테스트 기대값을 단순히 완화하기보다 오류·종료 처리를 먼저 보완하고 해당 테스트 및 전체 회귀를 다시 실행할 것을 권장한다. 수정안과 반복 재현 검증은 이번 작업에서 수행하지 않았다.

Step 01·02의 완료 상태는 유지 가능하다. Step 03의 기존 구현 완료 기록은 보존하되, 현재 회귀가 안정적으로 모두 통과한다고 재확인할 수는 없다. PLAN과 Step03에 이 후속 이슈를 명시했다. Step 04 착수 전 보완을 권장하는 사전 정리 항목이며, 방 모델 자체를 다시 설계해야 하는 장애는 아니다.

## Step 04에서 추가할 구조와 검증

다음은 설계 후보이며 코드는 아직 없다.

- participantId별 참여 roomId 집합, roomId별 참가자 ID 집합 또는 이에 상응하는 다대다 구조. 두 방향을 저장한다면 입퇴장·종료 시 일관성을 보장한다.
- 방 생성·목록·입장·퇴장 메시지와 방 ID 검증, 서버가 요청 연결의 소유권을 확인하는 처리.
- 전역 접속자와 방별 참가자를 구분한 초기 snapshot 및 변경 이벤트.
- 특정 방 퇴장, 연결 전체 종료, 서버 종료의 서로 다른 정리 범위. 중복 입장·반복 퇴장·빈 방 정책은 구현 때 확정한다.
- roomId별 화면 상태와 공통 프로필 참조, 필요한 요청 응답 대응 방식.
- A가 방 1·2에 참여하고 B는 방 1, C는 방 2인 검증. A의 방 1 퇴장 뒤 방 2 유지, 프로필 양쪽 반영, 연결 종료·heartbeat 시 모든 소속 정리를 확인한다.

## Step 05와 Step 07~09 영향

| Step | 반영한 요구사항 | 이번에 미확정으로 남긴 사항 |
| --- | --- | --- |
| 05 | 한 WebSocket에서 범위·roomId로 여러 방 채팅을 구분. 서버는 보내는 연결의 대상 방 소속을 검증. 이벤트도 방 ID를 포함하고 전체 메시지는 연결당 한 번 전달. 한 방 퇴장이 다른 방 채팅에 영향 없어야 함 | 채팅 UI 세부 배치·길이 제한 등 해당 Step의 구현 선택 |
| 07 | 미디어 요청 대상 방과 참가자·자원 소유권을 함께 검증. 논리적 참여와 미디어 연결 구분 | 여러 방 동시 송수신 여부, 대상 선택 UI, 공유 트랙·Router/worker 배치 |
| 08 | 송신자·consumer·타일의 방 구분, 해당 방 같은 producer의 중복 수신 방지 | Step 07에서 정할 미디어 정책을 따르는 구체적인 자원 연결 |
| 09 | 특정 방 퇴장은 그 방 자원만, 연결 종료는 그 연결의 모든 방 자원 정리. 다른 방이 사용 중인 자원은 보존 | 공유를 선택했을 때의 참조·정리 방법 및 실제 다중 미디어 연결 검증 범위 |

논리적 소속과 미디어 연결을 구분해 Step 04에서 미디어를 만들지 않는다. 여러 방에 소속된 사용자가 존재한다는 이유만으로 다른 방 미디어에 접근할 수는 없고 요청 대상 방·자원에 대한 권한을 검사한다. 자원 배치와 송수신 정책은 관련 미디어 Step 착수 시 정해야 한다.

## 이번 실제 회귀 결과

| 명령·검증 | 결과 |
| --- | --- |
| npm run typecheck | Client·Server 통과 |
| npm run build | Client·Server 통과 |
| HTTP /health | 기존 application을 임시 루프백 포트에 실행, 200·application/json; charset=utf-8·{"status":"ok"} 확인 후 종료 |
| npm run test:ws | 최초 6/7, 초과 payload 종료 코드 실패. 이후 재실행 3회 각각 7/7. 간헐 이슈 미해결 |
| npm run test:sfu | 5/5 통과, 실제 worker·Router·실패 정리·반복 종료 검사 |
| npm run sfu:check | 실제 worker PID 30148, Router 생성, closed=true·subprocessClosed=true 확인 |
| node --test scripts/chat-history.test.cjs | 26/26 통과 |

테스트 중 출력되는 EADDRINUSE는 기존 포트 충돌 검증이 의도적으로 발생시키는 로그다. 이번 WebSocket 실패는 그 항목이 아닌 payload 종료 코드 항목이다.

## 남은 검증과 착수 판단

- 다중 회의방 기능·채팅·미디어는 구현하지 않았으므로 실제 동작을 검증할 수 없다. 브라우저 조작·실제 장치·물리 네트워크 단절·대량 부하는 이번에 재검증하지 않았다.
- 초과 payload 종료 코드 경합은 원인 추정과 수정 위치까지 확인했으며 수정·해결 검증은 남아 있다. 현재 테스트 재실행 통과만으로 해결됐다고 보고하지 않는다.
- Step 04 모델 확장을 막는 단일 방 코드 전제나 추가 환경·의존성 요구는 발견하지 못했다. 다만 안정적인 회귀 기준을 확보하기 위해 기존 Step 03 오류 처리를 별도 작업에서 수정·재검증한 뒤 Step 04 구현을 시작하는 것을 권장한다.
- 문서의 Step 04 상태는 미착수로 유지한다. 이번에는 소스·테스트 수정이나 다음 Step 구현을 하지 않았다. 기존 자동 기록 기능을 유지하고 같은 대화를 수동으로 중복 작성하지 않았다. 이번 최종 응답의 저장 완료 여부는 Stop Hook 이후 확인해야 한다.
- Git Commit·Push는 실행하지 않았다.
