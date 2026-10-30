<!-- Capture ID: 5a810ab31c43d095b0c6e1380b19e45cef27ea450b684c1d4a7e3ad0280f2e0a
Source: codex-hooks
Captured: 2026-10-30T12:04:55.593Z
-->

# ChatHistory

Text below is copied verbatim from the indicated source; wrapper newlines are not part of the source text.
Scope: UserPromptSubmit.prompt and Stop.last_assistant_message; no attachments, intermediate messages, or tool output.

## User Prompt

```text
# Context from my IDE setup:

## Active file: ChatHistory/0020-codex-turn.md

## Open tabs:
- 0020-codex-turn.md: ChatHistory/0020-codex-turn.md
- media.browser.cjs: scripts/media.browser.cjs
- sfu-browser.scenarios.cjs: scripts/sfu-browser.scenarios.cjs
- sfu.browser.cjs: scripts/sfu.browser.cjs
- 0019-codex-turn.md: ChatHistory/0019-codex-turn.md

## My request:
# Step 08 — SFU를 통한 2인 양방향 미디어 수신

현재 프로젝트는 `ts-0001-ai-webrtc-practice`입니다.

이번 작업은 **Step 08 — SFU를 통한 2인 양방향 미디어 수신** 구현입니다.

Step 07에서 완료한 SFU 송신 기능을 기반으로, 동일한 활성 미디어 회의방에 참여한 두 사용자가 서로의 카메라 영상과 마이크 음성을 수신하고 재생하는 최소 WebRTC 회의를 구현해주세요.

기존의 **다중 회의방 소속 + 단일 활성 미디어 회의방** 정책을 유지하면서, Step 07의 단일 활성 송신 정책을 송수신 전체에 적용합니다.

이번 단계에서는 Recv Transport와 Consumer를 구현하고 실제 RTP 수신 및 브라우저 재생을 검증합니다.

3명 이상 참가자의 완전한 동적 송수신 관리는 Step 09에서 구현합니다.

## 1. 프로젝트 및 기존 구현 확인

작업 전 다음 항목을 실제 로컬 저장소에서 확인해주세요.

- `AGENTS.md`
- `README.md`
- `docs/Concept.md`
- `docs/PLAN.md`
- `docs/Step02.md` ~ `docs/Step07.md`
- `docs/MultiRoomPolicyImpact.md` (존재하는 경우)
- `00-conventions`의 `AI Task Prompt Convention` Draft (접근 가능한 경우)
- 기존 WebSocket 세션·프로토콜 코드
- 기존 회의방·채팅 상태 관리 코드
- `server/src/media.ts`
- `server/src/shared/mediaProtocol.ts`
- `server/src/application.ts`
- `client/src/useSfuSender.ts`
- `client/src/useSession.ts`
- `client/src/MediaPanel.tsx`
- 로컬 미디어 관련 Hook 및 컴포넌트
- 기존 자동화·통합 테스트와 ChatHistory 설정

실제 존재하는 파일명과 구조를 확인하고, 이전 작업 보고와 다르다면 현재 코드를 기준으로 판단해주세요.

현재 기술 구성은 TypeScript strict, React/Vite, Node.js, ws, mediasoup, mediasoup-client입니다. 실제 설치된 버전을 확인해주세요.

Step 07에서 구현한 송신 경로와 소유권·비동기 경합 정책은 유지합니다.

`docs/PLAN.md`상 Step 06의 물리 웹캠 검증 보류 상태와 Step 07의 검증 완료 상태를 임의로 변경하지 마세요.

최근 `ChatHistory/0020-codex-turn` 관련 기록을 수정한 이력이 있으므로 실제 파일·Git 상태를 확인하고 기존 기록을 덮어쓰지 마세요.

## 2. Step 08 목표와 완료 기준

이번 Step에서는 두 개의 독립적인 브라우저 세션 A, B를 사용합니다.

동일한 회의방을 활성 미디어 회의방으로 선택하고 각각 미디어 송신을 시작했을 때 다음 동작을 구현해주세요.

1. A가 송신한 Audio/Video Producer를 B가 발견합니다.
2. B가 SFU로부터 해당 Producer의 미디어를 수신합니다.
3. B가 송신한 Audio/Video Producer를 A가 발견합니다.
4. A도 해당 미디어를 SFU에서 수신합니다.
5. 수신한 비디오 트랙을 상대 참가자의 영상 요소에 표시합니다.
6. 수신한 오디오 트랙을 상대 참가자의 오디오 요소에서 재생합니다.
7. 송수신 대상은 현재 활성 미디어 회의방으로 제한합니다.
8. 브라우저 수신 통계와 SFU 측 전송 통계를 통해 실제 RTP 수신을 확인합니다.
9. 송신·수신 종료 및 회의방 전환 시 해당 미디어 자원을 정리합니다.

**Consumer 객체가 생성됐다는 사실이나 비디오 요소가 존재한다는 사실만으로 완료 처리하지 마세요.**

실제 ICE/DTLS 연결, RTP 수신 통계 증가, 영상 프레임 재생 및 가능한 환경에서의 실제 오디오 청취를 확인해야 합니다.

실제 오디오 청취가 불가능한 자동화 환경이라면 이를 별도 미검증 항목으로 기록하고, 오디오 RTP 수신 및 트랙 상태 검증과 구분해주세요.

## 3. 다중 회의방과 활성 미디어 정책

### 3.1. 송신·수신 대상 일치

사용자는 1111, 2222 등 여러 회의방에 동시에 참여할 수 있습니다.

그러나 실제 미디어 송수신 대상은 하나의 활성 회의방으로 제한합니다.

예를 들어 1111과 2222 모두 참여한 사용자가 1111에 미디어 연결했다면 다음과 같이 동작해야 합니다.

- 1111로 카메라·마이크 송신 가능
- 1111의 다른 참가자가 송신한 미디어만 수신
- 1111 채팅 정상 이용
- 2222의 회의방 소속 유지
- 2222 채팅 송수신 가능
- 2222의 미디어를 수신하거나 재생하지 않음

반대로 2222로 미디어 연결을 전환하면 위 관계가 반대로 적용되어야 합니다.

### 3.2. 채팅 화면과 미디어 연결 분리

다음 상태를 명확히 구분해주세요.

- 회의방 목록에서 선택한 방
- 채팅 내용을 보고 있는 방
- 실제 활성 미디어 회의방

채팅 화면을 전환했다는 이유만으로 Recv Transport나 Consumer를 새로 만들거나 기존 미디어 연결을 종료하지 마세요.

전체 채팅을 선택해도 현재 활성 회의방의 미디어 송수신은 유지되어야 합니다.

### 3.3. 명시적인 미디어 연결

단순히 회의방에 소속되어 있다는 이유만으로 해당 회의방의 미디어를 자동 구독하지 않습니다.

Step 07의 명시적인 미디어 연결 흐름을 기준으로 활성 미디어 세션을 시작합니다.

활성 회의방에 미디어 연결한 사용자는 해당 방의 다른 참가자 Producer만 수신할 수 있습니다.

서버는 참가자 소속뿐 아니라 현재 활성 미디어 회의방과 수신 자원 소유권을 검증해야 합니다.

Step 07의 참가자당 단일 활성 미디어 회의방 제약을 송수신 자원 관리에도 일관되게 적용해주세요.

### 3.4. 미디어 없이 회의방 참여

카메라나 마이크를 사용하지 않아도 기존 WebSocket 회의방 입장과 채팅은 가능해야 합니다.

수신 전용 참여에 대해서는 다음을 구분해주세요.

- 로컬 카메라·마이크 없이 논리적인 회의방만 참여하는 경우
- 로컬 미디어를 송신하지 않지만 명시적으로 특정 회의방의 원격 미디어만 수신하는 경우

두 번째 경우는 Step 07의 송신 시작 UI와 정책에 영향을 주므로, 현재 구조에서 최소 변경으로 지원할 수 있는지 검토해주세요.

가능하다면 단일 활성 미디어 회의방 정책을 유지하면서 수신 전용 연결을 지원해주세요.

다만 이를 위해 기존 송신 구조를 대규모로 개편해야 한다면 임의로 확장하지 말고 현재 제약과 대안을 보고해주세요.

## 4. SFU Recv Transport 구성

기존 worker 및 회의방별 Router를 재사용해주세요.

새로운 SFU worker나 별도 미디어 서버 프로세스를 만들지 않습니다.

다음 흐름을 구현해주세요.

1. 클라이언트에서 활성 회의방의 Router RTP capabilities를 확인합니다.
2. mediasoup-client Device의 RTP capabilities를 확인합니다.
3. 서버에 수신 Transport 생성 요청을 전달합니다.
4. 서버는 참가자의 실제 활성 미디어 회의방 소속과 요청 roomId를 검증합니다.
5. 해당 회의방 Router에 WebRTC Recv Transport를 생성합니다.
6. ICE·DTLS 등 필요한 파라미터를 반환합니다.
7. 클라이언트는 Device의 `createRecvTransport()`로 수신 Transport를 생성합니다.
8. Transport connect 이벤트를 기존 WebSocket Signaling과 연결합니다.
9. ICE/DTLS 연결 상태를 관리하고 실패 시 관련 자원을 정리합니다.

Step 07의 Send Transport와 Recv Transport는 역할을 구분하여 관리합니다.

기존 Send Transport를 임의로 Recv Transport로 대체하거나 송신 자원을 재생성하지 마세요.

다만 서버의 공통 Transport 관리 로직은 실제 구조에 맞는 최소 수준으로 재사용할 수 있습니다.

## 5. Producer 발견 및 Consumer 생성

### 5.1. 초기 Producer 목록

사용자가 활성 미디어 회의방에 연결하면 서버에서 해당 방에 존재하는 다른 참가자의 Producer를 확인할 수 있어야 합니다.

초기 Producer 조회에서는 다음 정보를 구분해주세요.

- roomId
- producerId
- producer를 소유한 participantId
- media kind (audio/video)

필요한 최소 메타데이터만 반환하고 다른 회의방의 Producer 정보는 노출하지 마세요.

본인이 생성한 Producer는 원격 수신 대상으로 취급하지 않습니다.

### 5.2. 신규 Producer 이벤트

이미 미디어 연결 중인 참가자에게 같은 방의 다른 참가자가 새로운 Producer를 생성하면 이를 감지할 수 있도록 합니다.

기존 WebSocket Signaling을 이용해 Producer 생성 이벤트를 알립니다.

신규 Producer 이벤트와 초기 Producer 목록 조회가 중복되거나 순서가 바뀌어도 같은 Producer의 Consumer가 중복 생성되지 않아야 합니다.

Producer ID와 현재 활성 회의방, 연결 시도 상태 등을 이용해 중복을 제어해주세요.

### 5.3. Consumer 생성

다음 사항을 구현해주세요.

- 서버가 해당 Producer의 회의방 및 소유자를 확인
- 수신자가 해당 회의방에 실제 활성 미디어 연결 중인지 확인
- Recv Transport 소유권 검증
- 수신자 RTP capabilities 확인
- Router의 consume 가능 여부 확인
- 서버 Consumer 생성
- Consumer의 ID, producerId, kind, RTP parameters 전달
- 클라이언트에서 `recvTransport.consume()` 실행
- 실제 수신 트랙 생성 및 상태 관리

mediasoup의 Consumer 생성·재개 API 및 현재 설치된 타입을 확인해주세요.

### 5.4. 수신 준비 후 재개

Consumer 생성 시 서버의 초기 paused 정책을 검토해주세요.

서버에서 Consumer를 먼저 생성하되 클라이언트의 Recv Transport 및 Consumer 준비가 완료된 뒤 명시적으로 resume 요청을 보내는 흐름을 우선 검토합니다.

수신 준비가 완료되기 전에 RTP가 전달되어 초기 영상 키프레임 등 필요한 데이터가 누락되지 않도록 해주세요.

클라이언트 Consumer 생성과 서버 resume의 순서를 명확히 관리합니다.

일부 단계가 실패하거나 요청이 취소되면 생성한 자원을 정리합니다.

## 6. 원격 영상·음성 재생 UI

기존 UI에 수신한 상대 참가자의 미디어를 표시할 수 있는 최소 구성을 추가해주세요.

### 6.1. 상대 참가자 표시

각 원격 참가자를 공통 participantId로 식별합니다.

기존 프로필의 닉네임과 아바타 정보를 재사용해주세요.

같은 참가자의 오디오·비디오 Consumer가 각각 존재하더라도 UI에서 중복된 사용자로 표시하지 않습니다.

동일 참가자의 미디어 상태를 하나의 참가자 영역에서 확인할 수 있도록 합니다.

### 6.2. 영상 재생

수신한 비디오 트랙으로 원격 영상 미리보기를 구성합니다.

- 비디오 Consumer 트랙을 MediaStream에 연결
- 원격 video 요소의 `srcObject` 관리
- `autoPlay`, `playsInline` 등 적절한 재생 옵션 사용
- 실제 프레임 재생 여부 확인
- Consumer 종료 시 video 참조 및 수신 리소스 정리

로컬 영상 미리보기와 달리 원격 비디오는 원칙적으로 음소거할 대상이 아닙니다.

다만 오디오 트랙을 별도 audio 요소에서 재생하는 구조라면 중복 오디오 출력이 발생하지 않도록 구성해주세요.

### 6.3. 음성 재생

원격 오디오 트랙을 적절한 audio 요소에 연결해주세요.

브라우저의 자동 재생 제한을 고려해 필요한 경우 사용자가 명시적으로 재생을 시작할 수 있는 UI를 제공합니다.

`play()` 실패를 무시하지 말고 재생 대기 또는 오류 상태를 구분해주세요.

실제로 음성이 출력되지 않는데 트랙 존재만으로 정상 재생이라고 표시하지 마세요.

동일 트랙이 여러 요소에서 중복 재생되지 않도록 해주세요.

마이크와 스피커를 동시에 사용하는 테스트 환경에서는 피드백 및 에코에 주의하되, 별도 오디오 처리 시스템은 구현하지 않습니다.

### 6.4. 수신 상태 표시

다음 정보를 확인할 수 있도록 합니다.

- 현재 활성 미디어 회의방
- 상대 참가자와 프로필
- Audio/Video Consumer 존재 여부
- 원격 트랙 상태
- 수신 Transport 연결 상태
- 미디어 재생 상태
- 필요한 경우 간단한 수신 통계

UI는 검증에 필요한 수준으로 구성하고 기존 채팅·회의방 화면의 대규모 개편은 피합니다.

## 7. 서버 소유권 및 접근 검증

서버는 기존 WebSocket 세션의 participantId를 신뢰 기준으로 사용합니다.

클라이언트가 요청에 포함한 participantId만으로 미디어 자원 소유권을 판단하지 마세요.

다음 관계를 검증해주세요.

- participantId와 현재 WebSocket 세션
- participantId와 회의방 소속
- participantId와 활성 미디어 회의방
- roomId와 Router
- producerId와 원본 송신 참가자
- recvTransportId와 수신 참가자
- consumerId와 수신 참가자 및 Producer
- 미디어 kind 및 RTP capabilities

다음 요청은 거절해주세요.

- 존재하지 않는 회의방의 Consumer 요청
- 참여하지 않은 회의방의 미디어 수신 요청
- 활성 미디어 방이 아닌 다른 방의 Producer 요청
- 다른 참가자의 Recv Transport 사용
- 다른 참가자의 Consumer 종료·재개 요청
- 다른 방의 Producer·Consumer ID 사용
- 잘못된 RTP capabilities 및 파라미터
- 이미 종료된 Producer 또는 Transport 접근
- 동일 Producer에 대한 의도하지 않은 중복 Consumer 생성
- 취소되거나 만료된 미디어 연결 시도의 늦은 요청

현재 서버의 WebSocket payload 제한과 런타임 메시지 검증 정책을 유지합니다.

## 8. 미디어 자원 생명주기

다음 상황을 고려해주세요.

1. 정상적인 수신 Transport 및 Consumer 생성
2. 수신 준비 전 연결 실패
3. Consumer 생성 후 클라이언트 수신 실패
4. Producer가 먼저 종료되는 경우
5. Consumer가 먼저 종료되는 경우
6. 현재 활성 미디어 회의방에서 퇴장하는 경우
7. 활성 미디어 회의방을 1111에서 2222로 전환하는 경우
8. 채팅 화면만 변경하는 경우
9. 송신하지 않는 다른 회의방에서 퇴장하는 경우
10. WebSocket 연결 종료 및 heartbeat 정리
11. SFU worker·Router 종료
12. 클라이언트 컴포넌트 해제
13. 초기 Producer 목록과 신규 Producer 이벤트 경합
14. 수신 요청 중 Producer가 종료되는 경우
15. 종료·전환 이후 오래된 Signaling 응답이 도착하는 경우
16. 재연결·재시도 및 중복 종료

**송신 자원 정리와 수신 자원 정리를 명확히 구분하되, 활성 미디어 회의방의 연결 종료 시에는 관련된 모든 송수신 자원이 정리되어야 합니다.**

원격 Consumer 트랙은 로컬 카메라·마이크 트랙과 소유권이 다릅니다.

수신 종료 과정에서 Step 06의 로컬 카메라·마이크 트랙을 임의로 stop하지 마세요.

Producer 종료 시 연결된 Consumer의 상태가 다른 참가자에게도 적절하게 반영되어야 합니다.

한 방의 종료가 다른 방의 Router, 채팅 또는 정상적인 미디어 연결에 영향을 주지 않도록 해주세요.

## 9. Signaling 프로토콜 확장

기존 Step 07의 WebSocket 메시지 구조를 재사용해주세요.

필요한 경우 다음 기능을 프로토콜에 추가합니다.

- 수신 Transport 생성
- 수신 Transport 연결
- 활성 회의방 Producer 목록 조회
- 신규 Producer 알림
- Consumer 생성
- Consumer 준비 완료 후 재개
- Producer 종료 알림
- Consumer 및 Recv Transport 종료
- 오류 및 종료 상태 동기화

요청·응답·이벤트를 구분하고, 기존 requestId·mediaId·roomId 등 현재 프로젝트에서 사용 중인 식별자 규약을 확인해 일관되게 적용해주세요.

필드가 누락되거나 형식이 올바르지 않은 메시지는 기존 정책에 따라 거절합니다.

WebSocket은 제어 메시지를 전달하고 실제 영상·음성은 WebRTC를 통해 전달합니다.

## 10. 검증 시나리오

### 10.1. 기본 양방향 수신

독립된 두 브라우저 세션 A, B를 준비합니다.

1. A와 B가 같은 회의방 1111에 참여합니다.
2. 각각 카메라·마이크를 획득합니다.
3. 둘 다 1111을 활성 미디어 회의방으로 연결합니다.
4. A가 보낸 비디오를 B가 수신합니다.
5. B가 보낸 비디오를 A가 수신합니다.
6. 양쪽에서 상대 오디오 트랙을 수신합니다.
7. 가능한 실제 장치 환경에서는 상대 음성이 들리는지 확인합니다.
8. SFU를 경유한 RTP 송수신 통계가 증가하는지 확인합니다.

### 10.2. 단일 장치 송수신

다음 시나리오를 확인해주세요.

- A: 마이크만 송신
- B: 카메라·마이크 송신
- A와 B의 수신 트랙 종류 확인
- 존재하지 않는 Video Producer를 Consumer로 생성하지 않음
- 오디오만 있는 참가자도 정상적으로 표시

실제 웹캠이 없는 환경에서는 가상 카메라를 사용해 영상 송수신을 검증해주세요.

### 10.3. 초기 송신자와 후입장자

두 순서를 모두 확인해주세요.

- A가 먼저 송신 → B가 연결 후 기존 A Producer 수신
- B가 먼저 송신 → A가 연결 후 기존 B Producer 수신

초기 목록 조회와 신규 이벤트가 중복될 때도 동일 Producer를 중복 수신하지 않도록 합니다.

### 10.4. 다중 회의방 미디어 격리

A와 B가 1111, 2222에 모두 참여한 상태를 가정합니다.

**시나리오 A**

- A와 B의 활성 미디어 회의방은 1111
- 서로의 1111 미디어 송수신
- 2222 채팅 메시지 정상 송수신
- 2222 미디어 Consumer는 생성되지 않음

**시나리오 B**

- A는 1111에서 송수신 중
- A가 2222 채팅 화면으로 변경
- 기존 1111 송수신 유지
- 2222 채팅 정상 이용

**시나리오 C**

- A가 1111에서 2222로 명시적 미디어 전환
- A의 기존 1111 송수신 자원 종료
- A의 새로운 2222 송수신 연결 생성
- B가 아직 1111에 있다면 서로 다른 활성 회의방의 미디어는 주고받지 않음
- 두 방 채팅은 계속 유지

**시나리오 D**

- A와 B 모두 2222로 전환
- 2222의 양방향 송수신 확인
- 1111의 이전 송수신 자원 잔류 없음

각 시나리오에서 서버의 방별 Producer·Consumer 소유 관계도 확인해주세요.

### 10.5. 종료 및 회귀

- 상대 Producer 종료 시 Consumer 정리
- 원격 참가자 연결 종료 시 타일 정리
- SFU 연결 실패 시 수신 상태 정리
- 연결 종료 후 재시도
- 수신 Consumer 중복 방지
- 클라이언트 미디어 종료와 수신 종료의 분리
- 다른 방 채팅과 참여 상태 보존
- WebSocket 초과 payload 종료 정책 유지

### 10.6. SFU 경유 확인

실제 송수신이 Mesh가 아닌 SFU를 경유하는지 확인해주세요.

- 브라우저와 SFU 양쪽의 RTP 통계 확인
- SFU 중단 시 원격 수신이 끊기는지 검증
- 브라우저 간 직접 미디어 PeerConnection을 생성하지 않는지 확인
- SFU 재시작 또는 연결 단절의 복구 범위 기록

## 11. 테스트와 실제 환경 구분

자동화 테스트가 가능한 항목과 실제 물리 장치 확인이 필요한 항목을 구분해주세요.

### 자동화

- Chrome·Edge 독립 브라우저 세션
- 가상 카메라 및 마이크
- ICE/DTLS 연결
- 브라우저와 SFU RTP 통계
- 원격 비디오 프레임 재생
- Consumer 생성·재개·종료
- 두 참가자의 송수신 자원 매핑
- 방 전환 및 자원 누수
- 각종 Signaling 오류 및 권한 검증

### 실제 장치 수동 검증

현재 사용자 PC에는 물리 웹캠이 없고 이어폰 마이크를 이용할 수 있습니다.

실제 브라우저에서 다음을 확인할 수 있도록 절차를 작성해주세요.

- 실제 이어폰 마이크 획득
- SFU Audio Producer 송신
- 상대 브라우저의 Audio Consumer 수신
- 상대방 음성 재생과 실제 청취
- 재생 제한 발생 시 사용자 동작으로 재개
- 송신·수신 종료 후 장치 및 미디어 연결 상태

다른 물리적 장치나 다른 사용자 세션이 필요한 항목은 실제 검증 가능 여부를 구분해주세요.

가상 마이크 RTP 수신과 실제 음성 청취를 동일한 검증으로 취급하지 마세요.

검증 환경 부족을 이유로 결과를 추정하거나 완료로 표시하지 마세요.

## 12. 기존 Step 01~07 회귀 검증

가능한 범위에서 다음 항목을 실행해주세요.

- TypeScript strict 검사
- Client·Server 빌드
- HTTP `/health`
- WebSocket 세션 및 프로필
- 다중 회의방 소속·퇴장
- 전체 채팅과 회의방 채팅
- 초과 payload 종료 코드 검증
- 기존 로컬 미디어 선택형 획득·종료
- Chrome·Edge 가상 장치 테스트
- Step 07 SFU Signaling 7/7
- Step 07 실제 RTP 송신
- 기존 SFU worker·Router 테스트
- ChatHistory 기록기 테스트
- 프로세스·포트·worker 자원 정리

기존 테스트가 성공했더라도 프로세스가 정상 종료되지 않으면 이를 별도로 보고해주세요.

Step 08 때문에 기존 송신 기능이나 다중 회의방 채팅 동작이 변경되지 않도록 확인해주세요.

## 13. 문서화

`docs/Step08.md`를 신규 작성해주세요.

다음 내용을 포함합니다.

- Step 08 목적과 구현 범위
- 실제 패키지와 실행 환경
- Recv Transport와 Consumer 구성
- 기존 Send Transport·Producer와의 관계
- 활성 미디어 회의방 송수신 정책
- 초기 Producer 목록 및 신규 이벤트 처리
- Consumer 준비·재개 흐름
- 원격 영상·음성 재생 방식
- 자동 재생 제한 처리
- 참가자 프로필 및 미디어 타일 구성
- 송수신 자원 소유권 및 생명주기
- 비동기 경합·오류·종료 대응
- RTP 송수신 검증 결과
- 다중 회의방 격리 테스트
- 실제 장치와 가상 장치 검증 구분
- 설계 선택 이유 및 Trade-off
- 미완료·미검증 항목
- Step 09로 이어지는 확장 고려사항

`README.md`에는 실제 구현한 기능과 실행·검증 명령 및 Step 08 문서 링크를 반영해주세요.

`docs/Concept.md`와 `docs/PLAN.md`는 Step 08에서 확정한 송수신 정책과 구현 결과에 필요한 범위에서만 수정해주세요.

Step 06 미완료 항목은 임의로 완료 처리하지 않습니다.

Step 08의 완료 기준을 실제로 충족했을 경우에만 완료 상태로 변경합니다.

## 14. 작업 범위 제한

이번 작업은 Step 08의 **2인 양방향 SFU 미디어 수신**으로 제한합니다.

다음 기능은 이번 단계에서 구현하지 않습니다.

- Step 09의 3인 이상 완전한 동적 송수신 관리
- Step 10의 송신 중 카메라·마이크 ON/OFF와 음소거
- Step 11의 장치 선택·전환
- Step 12의 마이크 입력 레벨 시각화
- 화면 공유 및 녹화
- Mesh/P2P 미디어 연결
- 여러 회의방 동시 미디어 송수신
- DB, Redis, Docker, 로그인·인증
- 분산 SFU 및 대규모 배포
- 불필요한 UI 재설계나 구조 변경

Step 08의 두 참가자 기본 수신을 위해 필요한 이벤트와 자원 정리는 구현하되, Step 09의 전체 다자간 관리 기능을 불필요하게 선행 구현하지 마세요.

기존 `AGENTS.md`, `.codex/`, `ChatHistory/` 및 자동 기록기 구성을 유지해주세요.

ChatHistory 자동 기록을 사용하고 동일 대화를 수동으로 중복 기록하지 마세요.

Git Commit 및 Push는 실행하지 마세요.

## 15. 작업 완료 보고

작업 완료 후 다음 내용을 보고해주세요.

1. 생성 및 변경한 파일
2. 신규 패키지·버전 및 변경 이유
3. 기존 Step 07 송신 구조와 Step 08 수신 구조의 연결 방식
4. WebSocket Signaling 확장 내역
5. Recv Transport 및 Consumer 관리 방식
6. 초기 Producer 발견과 신규 이벤트 처리
7. Consumer 생성·준비·재개 순서
8. 참가자별 원격 영상·음성 UI
9. 오디오·비디오 실제 수신 검증 결과
10. 자동 재생 제한 및 음성 출력 검증
11. 다중 회의방 송수신 격리 결과
12. 회의방 전환과 자원 정리 결과
13. 소유권 및 비정상 요청 검증
14. 기존 Step 01~07 회귀 검증
15. 실제 장치·가상 장치 검증 구분
16. 주요 설계 판단 및 Trade-off
17. 남은 오류·미완료·미검증 사항
18. Step 08 완료 기준 충족 여부

검증 결과는 실제 실행한 사실을 기준으로 보고해주세요.

기술적인 충돌이나 기존 프로젝트 정책과의 차이가 발생하면 원인을 분석하고, 현재 범위를 크게 확대해야 하는 경우 임의로 변경하지 말고 문제와 대안을 보고해주세요.

현재 로컬 저장소를 기준으로 Step 08 구현·테스트·문서화를 진행해주세요.

```

## Codex Response

````text
Step 08의 **구현과 가상 장치 검증을 마쳤습니다.** 실제 음성 청취는 미검증이므로 전체 완료는 보류했습니다. Step 06의 물리 장치 검증 보류와 Step 07 완료 상태는 유지했습니다.

- 기존 활성 미디어 슬롯에 별도 Recv Transport·Consumer를 추가했습니다. 송수신은 한 활성 회의방으로 제한하며, 로컬 장치 없는 **수신 전용 연결**도 지원합니다.
- 초기 Producer 목록과 신규 이벤트를 병합하고 ID로 중복 수신을 방지합니다. 서버 Consumer 생성 → 브라우저 준비 → 서버 resume 순서를 적용했습니다.
- 서버가 실제 세션·방 소속·활성 mediaId와 Transport·Consumer 소유권을 검증합니다. 기존 WebSocket 하나와 4,096-byte 제한을 유지했습니다.
- 참가자별 타일에 공통 프로필과 영상·음성을 표시합니다. 자동 재생 실패를 안내하고 재생 버튼을 제공합니다.
- 방 전환·종료 시 송수신 자원을 정리합니다. SFU 연결 종료가 로컬 카메라·마이크 트랙을 중지하지 않는 것도 확인했습니다.
- 신규 패키지는 없습니다. mediasoup 3.32.0·mediasoup-client 3.25.3을 그대로 사용합니다.

| 검증 | 결과 |
|---|---|
| TypeScript strict·Client/Server 빌드 | 통과 |
| WebSocket 세션·프로필·방·채팅·payload 회귀 | 19/19 |
| SFU Signaling·수신 소유권·취소·정리 | 10/10 — 기존 7개 포함 |
| worker·Router | 5/5 |
| ChatHistory 기록기 | 26/26 |
| 로컬 미디어 단위 테스트 | 6/6 |
| Chrome·Edge 가상 장치 | 양방향 RTP 증가, 영상 프레임 재생, 마이크 단독 송신, 수신 전용 통과 |
| 방 격리·전환·재접속 | 이전 자원 정리, 채팅 독립성, 명시적 재연결 통과 |
| SFU 경유 | SFU 후보 포트·양쪽 통계 확인, worker 중단 시 미디어 종료·채팅 유지 |
| 종료 후 잔류 | 관련 Node·worker·개발 포트·임시 프로필 0개 |

기존 로컬 미디어·SFU 송신 브라우저 회귀도 통과했습니다. 오디오는 RTP 수신과 브라우저 재생 진행을 확인했으며, **사람의 실제 청취 성공으로 표시하지 않았습니다.**

변경 파일은 다음과 같습니다. 디렉터리 구조 변경은 없습니다.

- 신규: [RemoteMedia.tsx](D:/01.Portfolio/TypeScript/ts-0001-ai-webrtc-practice/client/src/RemoteMedia.tsx), `scripts/sfu-receive.browser.cjs`, `scripts/sfu-receive.scenarios.cjs`, [Step08.md](D:/01.Portfolio/TypeScript/ts-0001-ai-webrtc-practice/docs/Step08.md)
- 클라이언트: `App.tsx`, `MediaPanel.tsx`, `useSession.ts`, `useSfuSender.ts`
- 서버: `application.ts`, `media.ts`, `shared/mediaProtocol.ts`, `shared/protocol.ts`
- 테스트·명령: `scripts/media.browser.cjs`, `scripts/sfu-ws.test.cjs`, `package.json`
- 문서: `README.md`, `docs/Concept.md`, `docs/PLAN.md`

실행은 두 터미널에서 각각 진행합니다.

```powershell
npm run dev:server
npm run dev:client
```

두 브라우저에서 같은 방에 참여한 뒤 송신 또는 수신 전용 연결을 선택합니다. 자동 검증은 개발 서버를 종료한 상태에서 실행합니다.

```powershell
npm run test:sfu:receive:browser
```

상세 프로토콜, RTP 표본, 설계 Trade-off와 실제 이어폰 마이크·청취 수동 절차는 [Step08.md](D:/01.Portfolio/TypeScript/ts-0001-ai-webrtc-practice/docs/Step08.md)에 기록했습니다. 물리 웹캠·실제 청취·LAN/NAT·3인 이상 동적 송수신은 미검증입니다. WebSocket이 먼저 종료되면 종료 확인 실패 안내가 남을 수 있으나, 해당 경로의 실제 미디어 자원 정리는 확인했습니다.

기존 `ChatHistory/0020-codex-turn.md`는 해시가 일치하며 자동 기록 설정도 유지했습니다. Git Commit·Push는 실행하지 않았습니다.
````
