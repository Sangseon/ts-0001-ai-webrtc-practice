# Step 04 — 다중 회의방 생성·입장·퇴장과 참가자 목록

2026-10-30 Windows·Node.js 24.22.1·npm 12.2.1에서 논리적 회의방 관리를 구현했다. 기존 WebSocket 연결·participantId·프로필을 재사용한다. 실제 WebRTC 연결이나 SFU 자원은 생성하지 않는다.

## 사전 정책 확인

작업 시작 시 HEAD는 `318a3e9 docs: [step-04] update multi-room participation policy`였다. PLAN·Concept·README·Step03의 후속 정책을 비교해 다음 사항의 일치를 확인했다.

- 사용자·회의방은 다대다(M:N) 관계다.
- 여러 방에 동시에 참여하고, 특정 방 퇴장은 다른 소속을 유지한다.
- 연결 종료·heartbeat는 모든 참여 방에서 해당 사용자를 제거한다.
- 방 소속과 실제 미디어 연결은 별개다.
- Step 01의 실행 구조, Step 02의 독립 SFU 검증, Step 03의 연결별 ID·공통 프로필 기준은 유지한다.

구현을 막는 단일 방 제한은 없었다. 기존 Step 03의 초과 payload 종료 코드 경합은 별도로 확인했고, 사용자의 추가 지시에 따라 수정하지 않았다. 새 테스트·브라우저 검증 결과와 구분해 아래에 기록한다.

## 범위와 파일

회의방 생성·목록·다중 입장·방별 퇴장, 방별 참가자·공통 프로필 동기화, 빈 방 삭제와 전체 연결 종료 정리를 구현했다. 추가 패키지·설정·프로젝트 구조 변경은 없다.

```text
server/src/
  rooms.ts                  신규: 방·소속의 기준 상태와 생성·입퇴장
  application.ts            변경: 요청 처리·이벤트 전달·연결 종료 연계
  shared/protocol.ts        변경: 방 메시지 타입·런타임 검증
client/src/
  Rooms.tsx                 신규: 생성·목록·참여·선택·방별 참가자 UI
  useSession.ts             변경: 기존 소켓으로 방 요청·상태 처리
  App.tsx                   변경: 회의방 UI 연결
  style.css                 변경: 회의방 이름 입력 기본 스타일
scripts/ws.test.cjs          변경: 기존 7개 유지, 방 관리 테스트 7개 추가
docs/Step04.md               신규: 이 문서
docs/PLAN.md                 변경: 완료 상태·기존 이슈 구분
README.md                    변경: 실제 범위·구조·확인 방법·학습 결과
```

package.json·lockfile, SFU 코드·테스트, AGENTS.md, 기존 ChatHistory·.codex·기록기는 변경하지 않았다. 같은 대화를 수동으로 중복 기록하지 않았다.

## 상태 관리와 M:N 관계

기존 `sessions: Map<WebSocket, { participant, alive }>`가 프로필의 기준 상태다. 방마다 닉네임·아바타를 복제하지 않는다.

`createRoomStore()`는 다음 데이터만 저장한다.

```text
Map<roomId, { roomId, name, participantIds: Set<participantId> }>
```

소속의 기준은 방별 참가자 Set 하나다. 사용자별 참여 방은 `joined(participantId)`로 계산한다. 같은 ID가 여러 Set에 들어갈 수 있어 M:N 관계를 표현하고, 같은 방에서는 Set과 중복 검사로 중복 등록을 막는다.

역방향 인덱스를 저장하지 않아 동기화해야 할 상태를 줄였다. 대신 사용자의 방 조회·종료 시 전체 방을 순회한다. 작은 단일 서버 실습 규모에 맞는 선택이며 대규모 접속을 위한 최적화는 하지 않았다.

방별 참가자 snapshot은 해당 Set에 있는 ID를 기존 세션 프로필에서 조회해 만든다. 참가자 수는 같은 Set의 size에서 계산하므로 별도 카운터를 유지하지 않는다.

## 생성·입장·퇴장 정책

| 동작 | 처리 |
| --- | --- |
| 생성 | 서버 randomUUID()로 roomId 발급, 생성자를 즉시 등록. 기존 소속은 유지 |
| 이름 | 앞뒤 공백 제거, Unicode 코드 포인트 1~40자, 빈 값·공백만·제어 문자 거절 |
| 같은 이름 | 허용. 이름 대신 roomId로 식별 |
| 입장 | 실제 요청 소켓의 participantId를 대상 방 Set에 추가 |
| 중복 입장 | ALREADY_JOINED 오류, 상태·이벤트 변경 없음 |
| 특정 방 퇴장 | 그 Set에서 본인 ID만 제거. 다른 방·WebSocket 세션 유지 |
| 미참여 방 퇴장 | NOT_JOINED 오류. 이미 삭제된 방이면 ROOM_NOT_FOUND |
| 없는 방 | ROOM_NOT_FOUND 오류 |
| 마지막 참가자 제거 | 즉시 방 삭제, 전체 방 목록 동기화 |
| 재접속 | 새 participantId, 방 목록만 수신. 기존 소속 자동 복원 없음 |
| 서버 재시작 | 메모리 방·소속 초기화 |

정상 close·error·heartbeat 제거는 동일한 `remove(socket)` 경로를 사용한다. 모든 참여 방에서 ID를 제거하고 빈 방을 삭제한 뒤 세션을 제거한다. 그다음 남은 소속자에게 방 snapshot을, 전체 접속자에게 목록을 전달한다. 세션이 이미 없으면 즉시 반환하므로 중복 정리가 상태를 다시 변경하지 않는다.

서버 전체 종료는 전송을 중단하고 heartbeat를 해제하며 소켓·세션·방 저장소·HTTP 리스너를 정리한다. 비동기 close 이벤트만으로 방 정리를 기다리지 않는다.

## 메시지와 전달 범위

기존 `kind`, `type`, `requestId`를 유지했다. 아래 필드 외 참가자 ID 등의 추가 필드는 거절한다.

| 요청 type | payload | 성공 응답 |
| --- | --- | --- |
| room.create | name | room: { roomId, name, participants } |
| room.join | roomId | room: { roomId, name, participants } |
| room.leave | roomId | roomId |

```json
{
  "kind": "request",
  "type": "room.join",
  "requestId": "3db44396-894c-4e88-a27d-83c08d6f15b4",
  "roomId": "ca18960a-15d7-4387-a99f-842aeb1254d7"
}
```

| 이벤트 type | 내용 | 수신 범위 |
| --- | --- | --- |
| rooms.changed | rooms: [{ roomId, name, participantCount }] | 최초 접속자 또는 목록 변경 시 전체 연결 |
| room.state | roomId, participants | 해당 방에 현재 소속된 연결만 |
| 기존 participant.* | 서비스 전체의 접속·프로필·종료 | 기존 Step 03 범위 유지 |

최초 연결은 기존 session.ready 후 rooms.changed를 받는다. 최초 방 소속은 없다. 방별 참가자 목록은 입장 성공 응답부터 받으며, 참여하지 않은 방의 이름·인원은 보여도 방별 참가자 이벤트는 보내지 않는다. 기존 전체 접속자 프로필 동기화와 방 소속 전달 범위는 구분한다.

성공 요청은 한 메시지 처리 안에서 **상태 변경 → 요청자 성공 응답 → 현재 방 소속자에게 room.state → 전체 rooms.changed** 순서로 처리한다. 퇴장한 사람은 성공 응답으로 자신의 소속을 제거하며, 이후 해당 방 snapshot은 받지 않는다. 방이 삭제됐으면 room.state를 보내지 않고 전체 목록에서 제거한다.

프로필 변경은 기존 응답·전역 participant.updated 이후 참여 중인 각 방에 room.state를 보낸다. 다른 방 소속이나 요청자의 전역 세션을 바꾸지 않는다.

서버 처리는 비동기 중단 없이 직렬로 실행하고, 단일 WebSocket의 전달 순서를 따른다. 방 목록·참가자는 delta 대신 전체 snapshot으로 교체해 같은 snapshot을 중복 반영해도 인원이 누적되지 않게 했다. 여러 연결의 요청은 서버가 처리한 순서로 반영한다. requestId는 응답 대응용이며 별도 재전송·명령 중복 제거 정책은 추가하지 않았다.

## 런타임 검증

- 기존 JSON·kind·type·requestId 검증과 프로필 요청 형식을 유지한다.
- room.create의 name, room.join/leave의 roomId를 각 요청별 필수·허용 필드와 함께 검사한다.
- 클라이언트 participantId를 받지 않고 요청 소켓의 ID만 사용한다. 위조 필드·잘못된 구조·비소속 퇴장은 오류로 응답하고 상태를 변경하지 않는다.
- 새 오류 코드는 INVALID_ROOM_NAME, ROOM_NOT_FOUND, ALREADY_JOINED, NOT_JOINED다. 기존 오류 응답 형태와 requestId 대응은 유지한다.
- 브라우저의 서버 메시지 가드에도 방 요약·snapshot·성공 응답을 추가했다.
- 기존 직접 검증 방식을 확장했다. 현재 요청 수에는 별도 스키마 패키지나 범용 dispatcher를 추가할 필요가 없었다.

## 클라이언트 UI와 생명주기

기존 useSession의 소켓·Effect를 재사용한다. 방 생성·입퇴장·화면 선택·프로필 변경으로 새 연결을 만들지 않는다. StrictMode의 시작 타이머와 cleanup도 유지한다.

- rooms는 전체 방 요약 목록이다.
- joinedRooms는 본인이 참여한 roomId별 참가자 snapshot이다. 참여 여부는 이 키 집합으로 판단한다.
- selectedRoomId는 화면에서 보는 방이다. 선택 자체는 요청을 보내지 않는다.
- 전체 방과 현재 참여 방을 각각 표시한다. 미참여 방을 선택하면 입장 안내가 나오고, 참여한 방을 선택하면 참가자와 그 방의 퇴장 버튼을 표시한다.
- 생성·입장 성공 시 해당 방을 화면에 선택한다. 퇴장은 선택된 방만 대상으로 요청하며 다른 소속은 유지한다.
- 참가자 snapshot과 전체 요약의 변경·삭제를 반영하고, 연결 종료·재접속 시작 시 방·소속·선택 상태를 비운다.

요청은 현재 규모에 맞춰 프로필·방 요청을 하나씩 직렬 처리한다. 기존 pending Ref·saving 상태와 8초 응답 대기 제한을 공유하고, 요청 중에는 추가 변경 버튼을 비활성화한다. 복수 대기 요청 Map은 추가하지 않았다. 응답 처리에서 type을 명시적으로 구분해 기존 participant 객체 분기와 방 이벤트가 섞이지 않게 했다.

## 실행·테스트·수동 확인

```powershell
# 두 터미널에서 각각 실행
npm run dev:server
npm run dev:client

# 타입 검사와 양쪽 빌드
npm run typecheck
npm run build

# 기존 7개 + 방 관리 7개
npm run test:ws

# SFU 회귀
npm run test:sfu
npm run sfu:check

# 기록기 회귀
node --test scripts/chat-history.test.cjs
```

개발 화면은 http://127.0.0.1:5173, HTTP 상태 경로는 http://127.0.0.1:3000/health다. 빌드 후 `npm run start:server`, 별도 터미널의 `npm run preview:client`로 http://127.0.0.1:4173을 확인할 수 있다.

1. 독립된 Chrome·Edge 세션 A·B·C를 열어 서로 다른 ID와 세 명의 전역 접속 목록을 확인한다.
2. A가 방 1과 방 2를 만든다. 두 방에 모두 참여한 상태인지 확인한다.
3. B는 방 1, C는 방 2에 입장한다. A가 방 선택을 바꿔 두 참가자 목록을 확인한다.
4. 미참여 방을 선택하기만 했을 때 소속이나 참가자 수가 바뀌지 않는지 확인한다.
5. A의 닉네임·아바타를 바꿔 B·C의 각 방과 전체 목록에 반영되는지 확인한다.
6. A가 방 1만 퇴장한다. A·C의 방 2와 B의 방 1이 유지돼야 한다.
7. 브라우저 종료·연결 종료와 마지막 참가자 퇴장으로 빈 방 삭제를 확인한다. 다시 연결하면 새 ID이며 이전 방에는 참여하지 않아야 한다.

## 실제 검증 결과

| 항목 | 실제 결과 |
| --- | --- |
| 사전 정책·환경 | 정책 커밋 318a3e9와 로컬 문서 일치, Node 24.22.1·npm 12.2.1 확인 |
| 타입 검사·양쪽 빌드 | 통과 |
| 기존 WS 테스트 | 최초 7/7 통과. 이후 기존 초과 payload 항목의 1006/1009 경합 재현. 재실행 전체 14/14 통과. 기존 결함 미해결 |
| 새 방 테스트 | 7개 통과. 생성·자동 입장·초기 목록·M:N·이벤트 범위·프로필 공유·부분 퇴장·빈 방 삭제 확인 |
| 잘못된 요청 | 이름 공백·길이·제어 문자·타입·누락, 없는 방, 중복 입장, 미참여·반복 퇴장, 참가자 ID 위조 거절 및 실패 후 정상 요청 확인 |
| 순서·동기화 | 응답→방 snapshot→전체 목록 순서와 빠른 입퇴장 10회에서 요청 대응·정확한 인원 확인 |
| 종료 정리 | 정상 close·강제 terminate·pong 미응답 각각 모든 소속 제거, 빈 방 삭제·다른 참가자 방 유지·새 ID·소속 미복원 확인 |
| 서버 종료·초기화 | 소켓·HTTP 리스너 종료와 새 application의 빈 목록 확인 |
| Chrome·Edge | Chrome 2개·Edge 1개, 각각 다른 임시 프로필의 실제 headless 브라우저에서 입력·라디오·버튼·폼을 조작 |
| 3개 브라우저 UI | 자동 입장·다중 소속·전체 목록 인원·선택만으로 소속 불변·양방향 방 프로필 반영·지정 방 퇴장·빈 방 삭제 확인 |
| 브라우저 종료·재접속 | 실제 브라우저 종료 후 남은 방 목록 정리, 연결 종료 후 방 삭제·새 ID·소속 미복원 확인 |
| 서버 중단·재시작 | 화면 방 상태 초기화·수동 재접속·서버 빈 방 목록 확인 |
| 빌드 화면·HTTP | Chrome preview에서 연결·방 생성 확인, /health 기존 JSON 확인, 수집한 브라우저 runtime exception 없음 |
| SFU | 기존 5/5 통과, sfu:check 실제 worker·Router 생성·종료 확인 |
| ChatHistory | 기존 26/26 테스트 통과 |

브라우저 검증은 개발 명령과 동일한 tsx watch·Vite 진입점을 실행했다. 종료 시 테스트 프로세스는 정리했다. WebSocket 테스트는 내부 Map을 노출하지 않고 실제 메시지·목록·방 이벤트의 수신 범위를 확인한다. 테스트 중 EADDRINUSE 로그는 기존 포트 충돌 시나리오의 의도된 출력이다.

## 남은 문제·미검증 사항과 완료 판단

- 기존 Step 03의 초과 payload 종료 코드 경합이 재현됐다. 사용자는 이를 별도 작업으로 유지하도록 명시했다. `socket.on('error')`의 즉시 terminate 처리와 기존 테스트 기대값은 변경하지 않았다. 재실행 통과를 결함 해결로 보고하지 않는다. 배경은 [MultiRoomPolicyImpact.md](./MultiRoomPolicyImpact.md)를 따른다.
- Step 04의 논리 회의방 완료 기준은 새 통합 테스트와 3개 브라우저에서 충족했다. 기존 결함은 Step 04가 새로 만든 회귀와 구분해 별도 미해결 항목으로 남긴다. 전체 회귀가 항상 안정적으로 통과한다고 주장하지 않는다.
- 사람의 육안·실제 창 클릭, Firefox·Safari·다른 OS, 물리 네트워크 단절, 기본 30초 heartbeat 대기 실측, HMR·8초 응답 timeout·대량 접속·장시간 부하는 이번에 검증하지 않았다.
- heartbeat 자동 테스트는 간격을 단축했다. 브라우저 자동 검증은 실제 headless 브라우저 조작이며 물리 네트워크 단절 시험을 대신하지 않는다.
- 기존 esbuild postinstall 및 DevTools Hook shim/Fast Refresh 경고가 남아 있다. 패키지·설치 설정을 변경하지 않았다.
- 채팅·미디어·인증·DB·미디어 자동 전환은 구현하지 않았다. mediasoup Router를 방과 연결하지 않았다.
- 이번 최종 응답의 자동 기록 저장 여부는 Stop Hook 이후 확인해야 한다. Git Commit·Push는 실행하지 않았다.

## 후속 Step 고려사항

Step 05는 기존 WebSocket에 채팅 요청을 추가하고 대상 roomId와 실제 소속을 검증해야 한다. 전체 메시지는 연결당 한 번, 방 메시지는 그 방 소속자에게 전달한다. 현재 방별 전달·정리 구조를 재사용할 수 있지만 채팅은 아직 없다.

Step 07은 논리적 소속과 별도로 미디어 연결 대상·자원 소유권을 결정해야 한다. 현재 여러 방 소속이나 화면 선택은 미디어 연결을 만들지 않는다. 동시 송수신·공유 트랙·Router/worker 배치는 해당 Step에서 결정하고, 특정 방 퇴장이 다른 방의 유효한 미디어 자원을 닫지 않도록 해야 한다.
