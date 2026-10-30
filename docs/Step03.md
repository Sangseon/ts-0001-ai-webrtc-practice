# Step 03 — WebSocket 세션과 프로필 동기화

2026-10-30 Windows·Node.js 24.22.1·npm 12.2.1에서 구현·검증했다. 현재 HTTP 서버에 WebSocket을 연결해 접속 사용자와 프로필을 서버 메모리에서 관리한다. Step 01·02의 실행 명령과 SFU 검증 진입점은 유지했다.

## 목적과 범위

- 연결마다 서버가 participantId를 발급하고 본인 ID·접속 사용자 목록을 전달한다.
- 접속·프로필 변경·연결 종료를 다른 사용자에게 알린다.
- 닉네임과 고정 아바타를 변경하고 서버에서 요청을 검증한다.
- 기본 연결 오류·요청 실패·비정상 연결 정리를 확인한다.

회의방, 채팅, 미디어 Signaling, 카메라·마이크, Transport·Producer·Consumer는 구현하지 않았다. participantId는 인증된 계정이나 복원 가능한 사용자 ID가 아니다.

## 추가 의존성과 파일

| 항목 | 버전·선택 이유 |
| --- | --- |
| ws | 8.22.0. 기존 HTTP 서버에 붙여 연결·프레임·ping/pong을 처리하는 작은 WebSocket 구현 |
| @types/ws | 8.18.2. 서버 strict 타입 검사에 사용하는 개발 의존성 |
| 메시지 검증 | 추가 패키지 없음. 현재 한 종류의 요청은 작은 타입 가드로 검사 가능 |
| 클라이언트 | 브라우저 내장 WebSocket, React 기본 상태·Effect·Ref 사용 |

[ws 공식 문서](https://github.com/websockets/ws/blob/master/README.md)의 HTTP 서버 연동·broadcast·ping/pong 방식을 참고했다. 브라우저에 서버용 ws 패키지는 넣지 않았다. 압축과 선택적 native 가속 패키지도 추가하지 않았다.

```text
client/src/
  App.tsx                    변경: 연결 상태·프로필 폼·접속자 목록
  useSession.ts              신규: WebSocket 생명주기·응답 대기
  style.css                  변경: 검증용 기본 폼·목록 스타일
server/src/
  index.ts                   변경: 서버 실행·종료 진입점
  application.ts             신규: HTTP·WebSocket·세션·heartbeat
  shared/protocol.ts         신규: 프로필·아바타·메시지 타입과 런타임 검증
  sfu.ts, sfu-check.ts        기존 유지
scripts/ws.test.cjs           신규: 실제 WebSocket 통합 테스트
package.json                 변경: ws·타입 패키지 및 test:ws 명령
package-lock.json            변경: 설치 버전 고정
docs/Step03.md                신규: 이 문서
docs/PLAN.md, README.md       변경: 진행 상태·기능·실행 안내
```

공유 파일은 서버 rootDir 안의 `server/src/shared/`에 두었다. 브라우저는 이 파일만 가져오고 서버 실행 코드는 가져오지 않는다. 공유 파일에는 Node·React·ws 의존성이 없다. 이 선택은 기존 `server/dist/index.js`, SFU 빌드 경로와 테스트를 그대로 유지하기 위한 것이다. 별도 패키지·workspace·빌드 체계는 추가하지 않았다.

## 서버와 세션

`createApplication()`이 기존 HTTP `/health`와 `ws://127.0.0.1:3000/ws`를 구성한다. 테스트는 같은 서버를 임시 포트에서 실행한다.

- `Map<WebSocket, { participant, alive }>`가 현재 상태의 기준이다.
- 서버 `randomUUID()`로 participantId를 생성한다. 연결마다 새 ID를 발급하고, 재접속은 새 세션이다.
- 기본 프로필은 닉네임 `참가자`, 아바타 `bear`다. 닉네임 중복은 허용하고 구분은 ID로 한다.
- 새 연결을 Map에 등록한 뒤 본인에게 전체 snapshot, 기존 연결에 joined 이벤트를 보낸다.
- close·error 시 Map에서 제거하고 left 이벤트를 한 번 전달한다. 정상 종료 시 heartbeat를 해제하고 소켓·HTTP 리스너를 닫는다.
- 30초마다 ping을 보내고 이전 ping 이후 pong이 없으면 다음 검사에서 terminate한다. 실제 네트워크 단절의 감지는 대략 30~60초와 이벤트 루프 지연이 필요하다. 브라우저는 프로토콜 pong을 자동 처리한다.
- HTTP listen 오류가 ws로도 전달되므로 오류 리스너를 두어 정리한다. 포트 충돌도 테스트했다.

메모리 목록은 서버 재시작 시 사라진다. 자동 세션 복원·자동 재연결은 없고 화면의 `다시 연결`로 새 세션을 만든다. 닫힌 세션이나 과거 프로필을 보관하지 않는다.

## 프로필과 런타임 검증

프로필은 `participantId`, `nickname`, `avatarId`로 구성한다. 아바타는 곰(bear), 고양이(cat), 여우(fox), 부엉이(owl)의 고정 목록이며 이모지와 표시 이름을 공통 파일에 둔다.

- 닉네임의 앞뒤 공백은 제거한다. 내부 공백은 유지한다.
- 정리한 닉네임은 Unicode 코드 포인트 기준 1~20자다. 빈 값·공백만 있는 값·제어 문자는 거절한다.
- 아바타는 고정 ID만 허용한다. 외부 URL·이미지 업로드는 없다.
- JSON.parse 결과를 unknown으로 받고, 객체·필수 필드·허용 필드·kind·type·requestId·프로필을 검사한다.
- requestId는 영문·숫자·하이픈 1~64자다. 클라이언트는 UUID를 생성한다.
- 프로필 변경 요청의 최상위와 profile 내부에 participantId 등 추가 필드를 허용하지 않는다. 서버는 요청을 보낸 소켓의 participantId를 유지해 본인 프로필만 변경한다.
- 바이너리 메시지는 구조화된 오류로 거절한다. 4,096 bytes 초과 메시지는 ws가 코드 1009로 해당 연결을 종료하고 세션을 정리한다.
- 클라이언트도 서버 JSON과 알려진 메시지 payload를 검사한다. 알 수 없거나 잘못된 응답이면 오류를 표시하고 연결을 닫는다. 표시 문자열은 React 텍스트로 렌더링한다.

런타임 검사와 TypeScript 타입은 별개다. 현재 메시지 수에 맞춰 직접 검사하므로 외부 스키마 라이브러리를 도입하지 않았다. 이후 메시지가 늘 때도 입력 검사와 소유권 검사는 유지해야 한다.

## 요청·응답·이벤트

메시지는 `kind`로 요청·응답·이벤트를, `type`으로 실제 동작을 구분한다. 현재 처리하는 요청은 profile.update 하나뿐이다.

```json
{
  "kind": "request",
  "type": "profile.update",
  "requestId": "3db44396-894c-4e88-a27d-83c08d6f15b4",
  "profile": { "nickname": "Alice", "avatarId": "fox" }
}
```

requestId는 요청마다 새로 생성한다.

| 구분 | type | 주요 필드 |
| --- | --- | --- |
| 요청 | profile.update | requestId, profile |
| 성공 응답 | profile.update | requestId, ok: true, 서버가 확정한 participant |
| 실패 응답 | error | requestId 또는 null, ok: false, code, message |
| 최초 이벤트 | session.ready | selfId, 본인을 포함한 participants |
| 접속 이벤트 | participant.joined | participant |
| 변경 이벤트 | participant.updated | participant |
| 종료 이벤트 | participant.left | participantId |

오류 code는 INVALID_JSON, INVALID_MESSAGE, UNKNOWN_TYPE, INVALID_PROFILE이다. 유효한 requestId를 읽을 수 있으면 그대로 대응하고, 없거나 잘못되면 null을 반환한다. 잘못된 요청은 상태를 바꾸거나 다른 사용자에게 전파하지 않는다.

프로필 변경 흐름은 **검증 → 연결에 속한 프로필 갱신 → 요청자에게 응답 → 모든 연결에 updated 이벤트**다. 자기 화면도 서버 이벤트를 기준으로 갱신한다. 동일 연결 내 메시지는 순서대로 처리하며 requestId 중복 제거·재전송 정책은 추가하지 않았다.

## 클라이언트와 연결 생명주기

`useSession`이 소켓·대기 요청을 Ref로, 연결 상태·사용자 목록·오류·안내를 React 상태로 관리한다. Effect는 최초 진입과 수동 재접속 때만 실행하며, 프로필 입력·목록 변경으로 연결을 다시 만들지 않는다.

개발 StrictMode의 추가 setup/cleanup에 맞춰 첫 소켓 생성은 취소 가능한 다음 타이머로 지연한다. cleanup은 타이머·핸들러·소켓을 정리하고, 이전 연결의 늦은 이벤트는 무시한다. Effect의 외부 연결 동기화와 cleanup 원칙은 [React 공식 문서](https://react.dev/reference/react/useEffect)를 참고했다.

화면에는 연결 상태, 본인 ID, 닉네임 입력, 아바타 라디오 목록, 변경 버튼, 접속자 목록, 오류·성공 안내가 있다. 서버의 session.ready를 받은 뒤 연결됨 상태로 표시한다. 변경 요청은 한 번에 하나만 보내며 8초간 응답이 없으면 오류를 표시하고 연결을 닫는다. 연결 종료 시 사용자 목록과 본인 ID를 비워 과거 연결 상태가 남지 않게 한다.

## 실행과 수동 확인

```powershell
npm ci

# 터미널 1
npm run dev:server

# 터미널 2
npm run dev:client

# 타입 검사·전체 빌드
npm run typecheck
npm run build

# 실제 WebSocket·SFU 테스트
npm run test:ws
npm run test:sfu
npm run sfu:check
```

브라우저는 현재 페이지의 호스트와 포트 3000의 `/ws`에 연결한다. 개발 화면은 `http://127.0.0.1:5173`, 빌드 preview는 `http://127.0.0.1:4173`이다. 클라이언트·서버 실행 명령과 루프백 바인딩을 유지했으며 TLS·공개 배포는 구성하지 않았다.

수동 재현 절차:

1. Chrome과 Edge에서 개발 화면을 각각 연다. 서로 다른 ID와 동일한 두 명의 목록을 확인한다.
2. A의 닉네임·아바타를 바꾸고 B의 목록을 확인한다. B에서도 바꿔 A의 목록을 확인한다.
3. 공백만 있는 닉네임 또는 21자 닉네임을 제출해 오류와 기존 프로필 유지를 확인한다.
4. A의 연결 종료 또는 브라우저 종료 후 B의 목록이 한 명으로 줄어드는지 확인한다.
5. A를 다시 연결해 이전과 다른 ID가 발급되는지 확인한다.
6. 서버를 중단해 연결 종료·빈 목록을 확인한다. 서버 없이 다시 연결하면 오류가 표시된다. 서버 재시작 뒤 각 화면에서 수동으로 다시 연결한다.
7. `npm run build` 후 별도 터미널의 `npm run start:server`, `npm run preview:client`로 빌드 결과를 확인한다.

## 실제 검증 결과

| 검증 | 결과 |
| --- | --- |
| Node·npm | 24.22.1·12.2.1 확인, 시스템 변경 없음 |
| 실제 WebSocket 통합 테스트 | 7/7 통과, 임시 포트의 실제 HTTP·ws 서버 사용 |
| 세션 | 서로 다른 ID, 최초 전체 목록, joined·left, 재접속 새 ID, 제거 후 신규 snapshot 통과 |
| 프로필 | A→B 닉네임, B→A 아바타 반영, 앞뒤 공백 정리, 신규 snapshot의 확정 상태 통과 |
| 잘못된 요청 | JSON 오류, null·배열, 알 수 없는 type, 필드 누락, 공백·빈·긴·제어 문자 닉네임, 잘못된 아바타, 최상위·중첩 ID 위조, 바이너리 거절 통과 |
| 요청 실패 후 상태 | 원래 프로필 유지, 이후 정상 요청과 HTTP health 정상 확인 |
| 비정상 종료 | 클라이언트 terminate와 pong 미응답 연결 제거 통과. heartbeat 테스트 간격은 60ms로 단축 |
| 크기 제한·종료 | 초과 payload 해당 연결 종료·상태 제거, 서버 shutdown, 포트 충돌 처리 통과 |
| 실제 Chrome·Edge | 별도 임시 프로필의 headless 브라우저에서 폼 입력·라디오 선택·제출·연결 버튼 조작 수행 |
| 브라우저 동기화 | 두 목록·ID, 양방향 닉네임·아바타 변경, 잘못된 닉네임 오류 표시, 입력 중 ID 유지, 종료·재접속 새 ID 확인 |
| 브라우저·서버 종료 | 브라우저 실제 종료 후 상대 목록 제거, 서버 중단 후 빈 목록·연결 오류 표시·재시작 후 수동 재접속 확인 |
| 빌드 화면 | Chrome의 preview에서도 연결·목록 표시 확인, 수집한 브라우저 runtime exception 없음 |
| 타입 검사·빌드 | 클라이언트·서버 모두 통과 |
| HTTP 회귀 | /health 200·기존 JSON, 잘못된 경로 404 통과 |
| Step 02 회귀 | SFU 테스트 5/5, sfu:check의 실제 worker·Router 생성·종료 통과 |
| 기록기 회귀 | 기존 테스트 26/26, 기존 기록 10개 검사 suspicious 0·failed false |

## 제약·미검증 사항

- 실제 브라우저 검증은 DevTools를 통한 headless 조작이다. 사람이 보는 창의 육안 검증, Firefox·Safari·다른 OS는 수행하지 않았다.
- 물리적인 네트워크 단절 대신 클라이언트 강제 종료와 pong 미응답으로 정리를 검증했다. 기본 30초 heartbeat의 실제 대기 시간 측정은 수행하지 않았다.
- 브라우저에서 공백 닉네임 거절은 확인했지만 모든 잘못된 프레임·ID 위조는 Node 통합 테스트에서 확인했다.
- 8초 응답 timeout, 개발 HMR 중 생명주기, 종료·접속 경합의 모든 경우 및 장시간·대량 접속 부하 검증은 수행하지 않았다.
- 기존 esbuild postinstall 차단 및 브라우저 DevTools Hook shim/Fast Refresh 경고가 유지된다. 현재 검사·빌드·UI 동작은 통과했으며 설정을 추가 변경하지 않았다.
- 인증·영속화·자동 재연결·미디어 송수신은 없다. 같은 닉네임이 존재할 수 있으며 ID가 사용자 식별 기준이다.
- AGENTS.md·기존 ChatHistory·.codex·기록기는 유지했다. 이번 대화를 수동으로 중복 저장하지 않았다. 최종 응답의 자동 기록 완료는 Stop Hook 실행 이후 확인해야 한다.
- Git Commit·Push는 실행하지 않았다.

## Step 04에서 고려할 점

participantId와 연결의 소유권을 계속 서버가 결정해야 한다. 변경된 정책에 따라 사용자와 회의방의 다대다(M:N) 소속을 서버 메모리에 추가하고, 방 목록·소속 변경 이벤트를 현재 요청·응답·이벤트 구분에 확장한다. 특정 방 퇴장은 다른 방 소속과 세션을 유지하며, 연결 종료의 중복 안전한 정리 흐름에는 참여 중인 모든 방에서의 이탈을 연결해야 한다. 지금은 회의방 타입·빈 방 정책·방 API를 선행 구현하지 않았다.

2026-10-30 정책 변경 후 회귀 검증에서 초과 payload의 클라이언트 종료 코드가 1009 대신 1006이 되는 기존 경합을 한 차례 관찰했다. 이후 세 차례는 7/7 통과했으나 이슈를 해결한 것은 아니다. 위 표는 Step 03 당시의 검증 기록이며, 후속 결과와 원인 분석은 [MultiRoomPolicyImpact.md](./MultiRoomPolicyImpact.md)를 따른다. 이번 문서 작업에서는 소스·테스트를 수정하지 않았다.

## 2026-10-30 초과 payload 종료 경합 수정

위 후속 회귀에서 남긴 결함을 별도 버그 수정 작업으로 처리했다. 설치된 `ws`는 8.22.0이며 서버의 `maxPayload: 4096` 설정은 유지한다. `ws` Receiver는 누적 payload가 제한을 넘으면 `WS_ERR_UNSUPPORTED_MESSAGE_LENGTH`와 상태 코드 1009를 만들고 내부 `close(1009)`를 먼저 호출한 다음 WebSocket `error` 이벤트를 발생시킨다. 이 순서는 [ws 8.22.0 Receiver 구현](https://github.com/websockets/ws/blob/8.22.0/lib/receiver.js)과 [WebSocket 구현](https://github.com/websockets/ws/blob/8.22.0/lib/websocket.js), heartbeat의 강제 종료 용도는 [ws 공식 README](https://github.com/websockets/ws/blob/8.22.0/README.md#how-to-detect-and-close-broken-connections)에서 대조했다.

기존 애플리케이션은 이 `error` 리스너에서 세션을 제거하고 즉시 `terminate()`했다. 공통 송신 콜백도 전송 오류에 `terminate()`했다. 두 경로 모두 ws가 시작한 Close 프레임 전송과 겹칠 수 있어 클라이언트가 프레임을 받기 전에 TCP 연결을 파괴할 수 있었다.

수정 후 흐름은 다음과 같다.

1. 초과 payload는 ws가 `close(1009)`를 수행하도록 두고 애플리케이션은 해당 오류에서 terminate하지 않는다.
2. WebSocket `error`에서는 payload 오류가 아닌데 소켓이 아직 OPEN인 경우에만 강제 종료한다.
3. 세션·프로필·모든 회의방 소속 정리는 `close` 이벤트 한 곳에서 실행한다. 기존 `remove()`의 중복 안전성은 유지한다.
4. heartbeat의 pong 미응답과 애플리케이션 전체 shutdown은 복구 불가능한 연결을 즉시 닫는 경로이므로 기존 terminate 동작을 유지한다.
5. 공통 `send()`의 비동기 콜백은 더 이상 별도로 terminate하지 않는다. 전송 실패는 WebSocket 자체 error·close 흐름에서 처리한다.

테스트는 4,096-byte 텍스트가 INVALID_JSON 응답 후 연결을 유지하고, 4,097-byte 텍스트는 1009 Close 프레임을 수신하는지 확인한다. 정식 통합 테스트는 완전한 초기 상태를 받은 연결 10개를 한 서버에서 연속 종료해 10/10이 1009인지 검사한다. 오류 연결의 `participant.left`가 한 번만 발생하고 서버·다른 연결이 유지되는 것도 확인한다.

최종 회귀에서는 TypeScript strict 검사, Client·Server 빌드, `/health` 200과 `{"status":"ok"}`, SFU 5/5 및 별도 `sfu:check` worker·Router 생성·종료, ChatHistory 기록기 26/26도 모두 통과했다.

진단 중 초기 상태 수신이 끝나기 전 연결을 극단적으로 빠르게 반복한 별도 stress에서는 애플리케이션 terminate를 제거한 뒤에도 300회 중 2~3회 클라이언트 1006이 관찰됐다. 그때 서버의 ws 내부 상태는 Close 프레임 쓰기 완료(`_closeFrameSent: true`)와 peer Close 미수신을 나타냈다. 초기 상태를 받은 100회 stress도 한 번은 100/100이었지만 다음 실행은 48회째 1006이 발생했다. 이는 애플리케이션의 불필요한 terminate 경합과 구분되는 전송 계층 종료이며, 실제 네트워크 단절·강제 종료·shutdown에서도 1006은 가능하다. 내부 필드는 원인 분리용 일시 진단에만 사용했고 제품 코드나 정식 테스트에는 의존하지 않는다.

따라서 이 문서에서 기록한 **애플리케이션이 초과 payload 처리 중 Close 핸드셰이크를 방해하던 결함은 해결**로 변경한다. 모든 환경·네트워크에서 1009를 절대 보장한다는 뜻은 아니며, Windows 루프백 외 환경과 장시간·고부하 전송은 미검증이다.
