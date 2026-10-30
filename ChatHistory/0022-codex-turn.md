<!-- Capture ID: c893547bb0485e1cd2569003b2bc1ed1f367c6b1dd4ae0a9aa5e3f2205630339
Source: codex-hooks
Captured: 2026-10-30T12:33:19.592Z
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
- 0021-codex-turn.md: ChatHistory/0021-codex-turn.md
- 0017-codex-turn.md: ChatHistory/0017-codex-turn.md
- 0018-codex-turn.md: ChatHistory/0018-codex-turn.md
- 0019-codex-turn.md: ChatHistory/0019-codex-turn.md

## My request:
# Step 09 — 3명 이상 참가자의 동적 미디어 송수신 관리

현재 프로젝트는 `ts-0001-ai-webrtc-practice`입니다.

이번 작업은 **Step 09 — 3명 이상 참가자의 동적 미디어 송수신 및 종료 생명주기 관리**입니다.

Step 07의 SFU 송신과 Step 08의 2인 양방향 수신을 기반으로, 동일 회의방에 3명 이상이 참여하여 서로의 영상·음성을 송수신하고, 참가·퇴장·연결 유실·재입장 과정에서 미디어 자원과 사용자 상태가 일관되게 유지되도록 구현해주세요.

기존 다중 회의방 소속, 단일 활성 미디어 회의방, 채팅과 미디어 연결의 분리 정책은 유지합니다.

이번 Step은 신규 미디어 전송 기술을 추가하는 작업이 아니라 **기존 송수신 기능을 동적인 다자간 환경에서 안정적으로 관리하는 작업**입니다.

## 1. 프로젝트 현황 확인

작업 전 실제 로컬 저장소를 확인해주세요.

- `AGENTS.md`
- `README.md`
- `docs/Concept.md`
- `docs/PLAN.md`
- `docs/Step06.md`, `docs/Step07.md`, `docs/Step08.md`
- `docs/MultiRoomPolicyImpact.md` (존재하는 경우)
- `00-conventions`의 `AI Task Prompt Convention` Draft (접근 가능한 경우)
- 서버의 WebSocket 세션 및 회의방 관리 코드
- `server/src/application.ts`
- `server/src/media.ts`
- `server/src/shared/mediaProtocol.ts`
- `server/src/shared/protocol.ts`
- `client/src/useSession.ts`
- `client/src/useSfuSender.ts`
- `client/src/MediaPanel.tsx`
- `client/src/RemoteMedia.tsx`
- 기존 미디어·Signaling·브라우저 테스트
- `.codex/`와 `ChatHistory/` 자동 기록 구성

이전 작업 보고만으로 구현 상태를 판단하지 말고, 실제 파일과 Git 변경 상태를 확인해주세요.

현재 프로젝트는 TypeScript strict, React/Vite, Node.js, WebSocket, mediasoup 및 mediasoup-client 기반입니다.

Step 07은 완료 상태이며, Step 06의 물리 웹캠 검증과 Step 08의 실제 음성 청취 검증은 보류되어 있습니다.

이번 Step에서 수행하지 않은 물리 장치 검증을 임의로 완료 처리하지 마세요.

## 2. 목표와 완료 기준

독립적인 브라우저 세션 A, B, C가 동일한 회의방에 미디어 연결했을 때 다음 동작을 구현합니다.

1. A는 B와 C의 미디어를 수신합니다.
2. B는 A와 C의 미디어를 수신합니다.
3. C는 A와 B의 미디어를 수신합니다.
4. 참가자가 추가되면 기존 참가자와 신규 참가자 사이에 필요한 Consumer가 생성됩니다.
5. 참가자가 미디어 연결을 종료하면 다른 참가자의 해당 Consumer와 원격 타일이 정리됩니다.
6. 참가자가 재입장하면 새로운 연결 상태에 맞춰 송수신 관계를 다시 구성합니다.
7. 정상 퇴장·탭 닫기·WebSocket 단절 등 종료 경로에서도 자원이 누적되지 않습니다.
8. 한 회의방의 종료나 참가자 변화가 다른 회의방의 소속·채팅·유효한 미디어 연결에 영향을 주지 않습니다.

**Consumer가 생성됐거나 참가자 타일이 표시됐다는 사실만으로 완료 처리하지 마세요.**

3명 이상이 서로의 RTP를 실제로 수신하는지, 영상 프레임이 디코딩되는지, 수신 대상이 정확한지 검증해주세요.

실제 사람의 음성 청취와 가상 장치 자동화 검증은 별도로 구분합니다.

## 3. 기존 미디어 연결 정책 유지

### 3.1. 다중 회의방 소속

한 사용자는 1111, 2222 등 여러 회의방에 동시에 참여할 수 있습니다.

기존 WebSocket 하나로 전체·회의방 채팅을 이용합니다.

방 목록 선택과 채팅 화면 선택은 SFU 연결 대상에 영향을 주지 않습니다.

### 3.2. 단일 활성 미디어 회의방

참가자당 활성 미디어 회의방은 최대 하나입니다.

- 1111에 미디어 연결한 참가자는 1111의 다른 활성 참가자 미디어만 송수신합니다.
- 2222의 채팅은 계속 이용할 수 있습니다.
- 2222 미디어는 자동 송수신하지 않습니다.
- 1111에서 2222로의 미디어 전환은 명시적인 사용자 동작으로만 수행합니다.
- 기존 방의 송수신 자원 정리 후 새 방의 연결을 생성합니다.

송신과 수신이 서로 다른 회의방에 활성화되지 않도록 서버에서도 보장해주세요.

### 3.3. 수신 전용 연결

Step 08의 수신 전용 연결을 유지합니다.

로컬 카메라·마이크를 획득하지 않은 참가자도 명시적인 미디어 연결을 통해 같은 방의 다른 참가자 영상을 보고 음성을 수신할 수 있어야 합니다.

논리적인 회의방 입장과 수신 전용 미디어 연결은 구분합니다.

수신 전용 참가자 때문에 불필요한 Producer 또는 로컬 트랙이 생성되지 않도록 해주세요.

## 4. 동적 Producer 발견과 Consumer 관리

Step 08의 초기 Producer 조회, 신규 Producer 이벤트 및 Consumer 생성 흐름을 우선 재사용해주세요.

### 4.1. 기존 참가자가 먼저 연결한 경우

A와 B가 미디어 송신 중인 회의방에 C가 새로 연결하면:

- C는 A와 B의 기존 Producer를 발견합니다.
- C는 A·B의 오디오와 비디오 종류에 맞는 Consumer를 생성합니다.
- A와 B는 C의 신규 Producer를 발견합니다.
- A와 B는 C의 미디어를 수신합니다.
- 자기 자신의 Producer는 원격 Consumer로 생성하지 않습니다.

### 4.2. 참가자 연결 순서

A → B → C, C → A → B 등 연결 순서가 달라도 최종 송수신 관계가 일치해야 합니다.

서로 다른 참가자가 거의 동시에 Producer를 생성하는 경우도 고려해주세요.

초기 Producer 목록 조회와 신규 Producer 이벤트의 순서가 뒤바뀌거나 중복 도착해도 동일 Producer에 대한 Consumer가 중복 생성되지 않아야 합니다.

### 4.3. Producer·Consumer 식별

다음 관계를 일관되게 관리해주세요.

- roomId
- participantId
- mediaId 또는 활성 미디어 연결 식별자
- producerId
- consumerId
- 송신자와 수신자
- media kind
- 생성·연결·종료 상태

현재 구현의 객체 소유권과 Map 구조를 우선 활용해주세요.

새로운 전역 상태 관리 라이브러리나 복잡한 이벤트 시스템은 필요성이 확인되지 않는 한 추가하지 않습니다.

### 4.4. 중복과 비동기 경합

다음 상황을 처리해주세요.

- 신규 Producer 이벤트 중복
- 초기 목록과 이벤트의 중복
- 여러 Producer의 빠른 연속 생성
- Consumer 생성 중 Producer 종료
- Consumer 생성 중 수신자 퇴장
- 생성 완료 전에 같은 Producer에 대한 재요청
- 과거 연결의 늦은 Signaling 응답
- 종료된 미디어 연결의 오래된 이벤트

이미 종료된 연결의 이벤트가 새로운 연결에 Consumer를 생성하지 않도록 현재 roomId와 mediaId 및 요청 세대 정보를 확인해주세요.

## 5. 동적 참가·퇴장 처리

### 5.1. 정상 참가

참가자가 회의방에 논리적으로 입장하는 것만으로 미디어 연결을 자동 생성하지 않습니다.

사용자가 명시적으로 해당 회의방에 미디어 연결한 시점에 필요한 송수신 자원을 구성합니다.

### 5.2. 정상 미디어 종료

A·B·C가 연결된 상태에서 B가 미디어 송수신을 종료하는 경우:

- B의 Send Transport·Producer 종료
- B의 Recv Transport·Consumer 종료
- A와 C가 수신하던 B의 Consumer 정리
- A와 C 화면의 B 원격 미디어 타일 제거 또는 상태 갱신
- A와 C 사이의 송수신 유지
- B의 논리 회의방 소속과 채팅 유지

Step 06의 로컬 트랙은 SFU 연결 종료와 독립적으로 관리합니다.

### 5.3. 특정 회의방 퇴장

참가자가 여러 회의방에 소속된 상태에서 하나의 회의방을 퇴장하면 해당 방의 소속 및 해당 방에 연결된 미디어 자원만 정리합니다.

퇴장 대상이 활성 미디어 회의방이면 송수신 연결을 종료합니다.

퇴장 대상이 활성 미디어 회의방이 아니라면 현재 송수신 연결을 유지합니다.

다른 회의방의 소속과 채팅 상태를 임의로 제거하지 마세요.

### 5.4. 탭 닫기 및 WebSocket 단절

다음 종료 경로를 처리해주세요.

- 정상적인 브라우저 탭 닫기
- WebSocket 정상 종료
- WebSocket 비정상 단절
- 기존 heartbeat timeout
- 클라이언트 새로고침
- 서버 연결 정리
- SFU Transport 또는 worker 비정상 종료

실제 네트워크 단절은 즉시 감지되지 않을 수 있습니다. 기존 heartbeat와 WebRTC 연결 상태 감지를 활용하고, 비정상 단절 감지에 걸린 시간을 측정해주세요.

클라이언트의 종료 메시지 전달 성공을 자원 정리의 유일한 전제로 사용하지 마세요.

### 5.5. 재입장과 재연결

B가 연결 종료 후 다시 접속하면 기존 WebSocket 세션 정책에 따라 새로운 participantId를 부여받을 수 있습니다.

재입장 시 이전 참가자의 Consumer·Transport·타일이 그대로 남지 않도록 합니다.

새로운 세션의 미디어 연결은 새로운 자원 소유권을 기준으로 생성합니다.

기존의 명시적 미디어 연결 정책을 유지하며, 새 세션에서 사용자 동작 없이 마이크·카메라를 자동 송신하지 마세요.

## 6. Producer 종료와 원격 참가자 UI

Producer가 종료되면 이를 소비 중인 다른 참가자의 Consumer와 원격 미디어 표시도 정리되어야 합니다.

다음 사항을 확인해주세요.

- 같은 participantId의 Audio/Video Consumer를 하나의 참가자 타일에 표시
- 오디오만 존재하는 참가자 처리
- 비디오만 존재하는 참가자 처리
- 수신 전용 참가자 처리
- Producer 하나만 종료된 경우 해당 종류만 정리
- 모든 원격 Producer가 종료된 경우 불필요한 미디어 타일 제거
- 새 연결로 복귀한 참가자의 중복 타일 방지
- 프로필 변경 시 현재 원격 타일에 반영
- 다른 방 참가자의 미디어 표시 금지

참가자의 논리적 회의방 소속과 현재 송신 중인 미디어 종류는 다르므로, 원격 미디어 타일이 사라졌다는 이유만으로 회의방 참가자 목록에서도 제거하지 마세요.

별도 참가자 목록과 미디어 타일은 각각 올바른 상태를 반영하도록 유지해주세요.

## 7. 서버 자원 소유권과 방별 격리

서버는 WebSocket 연결에서 발급한 participantId를 신뢰 기준으로 사용합니다.

클라이언트가 제공한 participantId를 그대로 신뢰하지 않습니다.

다음 사항을 검증해주세요.

- 실제 참가자의 회의방 소속
- 활성 미디어 회의방
- roomId와 Router의 관계
- mediaId와 현재 활성 연결의 관계
- Send/Recv Transport 소유권
- Producer·Consumer 소유권
- Producer 원본 송신자
- Consumer 수신자
- 종료·재연결 중인 자원의 상태

다음 요청을 거절합니다.

- 소속되지 않은 방의 Producer 조회·Consumer 생성
- 활성 미디어 방이 아닌 다른 방의 미디어 접근
- 다른 참가자의 Transport 사용
- 다른 참가자의 Consumer 종료·재개
- 이미 닫힌 Producer를 대상으로 한 Consume
- 오래된 mediaId의 요청
- 두 회의방에 동시에 활성 미디어 연결을 만들려는 요청

참가자 한 명의 실패 또는 비정상 요청으로 다른 참가자의 정상적인 미디어 연결이 종료되지 않도록 합니다.

기존 WebSocket 4,096-byte 제한과 메시지 유효성 검증 정책은 유지합니다.

## 8. 회의방 자원 생명주기

기존 단일 worker·회의방별 Router 정책을 유지합니다.

특히 다음 상황을 검토해주세요.

1. 첫 참가자 미디어 연결
2. 두 번째·세 번째 참가자 연결
3. 마지막 송신자 종료
4. 수신 전용 참가자만 남은 경우
5. 회의방의 마지막 논리 참가자 퇴장
6. 다른 회의방에 참가자가 남아 있는 경우
7. Router 또는 worker 비정상 종료

현재 구현의 Router 지연 생성 및 정리 정책을 확인하고 실제 소유 관계에 맞춰 정리해주세요.

논리적 회의방이 비어 종료되는 경우에는 해당 방의 Router·Transport·Producer·Consumer를 정리합니다.

다른 방에서 사용하는 worker를 잘못 종료하지 않도록 합니다.

한 방의 Router 종료로 다른 방의 SFU 미디어 송수신이 중단되지 않아야 합니다.

중복 close 호출과 생성·종료 경합에서도 자원 누수가 발생하지 않도록 해주세요.

## 9. 다자간 송수신 검증

### 9.1. 3인 기본 시나리오

독립된 브라우저 세션 A, B, C를 사용합니다.

동일 회의방 1111에 연결하고, 가능하면 가상 카메라·마이크를 이용해 세 참가자가 각각 송신하도록 합니다.

다음을 확인해주세요.

- A는 B·C의 미디어 수신
- B는 A·C의 미디어 수신
- C는 A·B의 미디어 수신
- 자기 자신의 원격 Consumer 생성 없음
- 참가자별 타일과 participantId 일치
- 각 Consumer의 원본 Producer·roomId 일치
- 브라우저와 SFU의 RTP 통계 증가
- 영상 디코딩 프레임 증가

세 참가자가 각각 오디오·비디오 Producer를 한 개씩 가진 경우, 정상 연결 상태에서는 참가자당 원격 Consumer가 종류별로 다른 두 사람에 대해 생성되는지 확인해주세요.

수신 전용 참가자나 단일 종류 송신 참가자에서는 실제 Producer 수에 따라 기대 Consumer 수를 조정해주세요.

### 9.2. 순차 입장

다음 순서를 검증해주세요.

- A → B → C
- C → A → B
- 먼저 연결한 참가자가 나중에 입장한 참가자를 수신
- 나중에 연결한 참가자가 기존 송신자를 수신
- 초기 목록과 신규 이벤트 중복 방지

### 9.3. 빠른 입퇴장

다음 동작을 반복해주세요.

- C 입장 → 종료 → 재입장
- B 종료 직후 C 신규 연결
- Producer 생성 중 퇴장
- Consumer 생성 중 퇴장
- 연결 전환과 퇴장 요청 경합
- 빠른 재접속과 늦은 이벤트

반복 테스트 후 Consumer·Transport·Producer 수가 실제 활성 연결 수와 일치해야 합니다.

단순히 UI에서 오류가 보이지 않는 것만으로 자원 정리를 통과 처리하지 마세요.

### 9.4. 비정상 종료

다음 상황을 테스트해주세요.

- 탭 강제 종료
- WebSocket 연결 강제 단절
- heartbeat에 의한 유실 감지
- 서버 또는 SFU worker 종료
- 브라우저 새로고침
- Signaling 연결 종료와 미디어 종료 경합

가능한 경우 종료 감지에 걸린 시간을 측정하고, 자원 정리 시점과 비교해주세요.

실제 네트워크 차단을 재현하지 못했다면 Mock·강제 종료 테스트와 구분해 기록해주세요.

### 9.5. 다중 회의방 격리

A와 B는 1111, 2222에 모두 참여하고, C는 1111에, D는 2222에 참여하는 구성을 검증해주세요.

- A·B·C는 1111에서 송수신
- D는 2222에만 미디어 연결
- D는 1111의 미디어를 수신하지 않음
- A·B는 2222 채팅을 계속 이용 가능
- A가 2222 채팅을 열어도 1111 송수신 유지
- A가 1111에서 퇴장하면 A의 해당 미디어 자원만 종료
- B·C의 1111 송수신 유지
- A의 2222 소속과 채팅 유지
- A가 2222로 명시적 전환하면 해당 방에서만 연결
- 1111과 2222의 Router·Producer·Consumer 격리 확인

### 9.6. 수신 전용과 단일 트랙

다음 형태도 검증해주세요.

- 카메라·마이크 모두 송신
- 마이크만 송신
- 카메라만 송신
- 수신 전용 연결
- 미디어를 전혀 연결하지 않은 논리적 참가자

수신 전용 사용자가 다른 참가자의 미디어를 정상 구독할 수 있어야 합니다.

미디어 미연결 사용자는 논리적 회의방 참여와 채팅만 유지하며, 사용자 동작 없이 수신 연결을 생성하지 않습니다.

## 10. 자원 정리 검증 및 누수 방지

가능한 경우 테스트 전후 다음 자원의 수를 비교해주세요.

- 논리 회의방 수
- 방별 참가자 수
- 활성 미디어 슬롯 수
- Router 수
- Send Transport 수
- Recv Transport 수
- Producer 수
- Consumer 수
- 원격 참가자 타일 수
- 브라우저 측 활성 미디어 연결 수

서버 내부 자원 수를 테스트용으로 확인할 필요가 있다면 기존 구조를 우선 활용해주세요.

외부에 불필요한 운영 API를 추가하지 말고 테스트 전용 접근 방식을 검토해주세요.

반복 시작·종료 후 종료된 참가자의 자원이 누적되지 않아야 합니다.

정상 종료 및 비정상 종료의 자원 정리 경로를 구분해 검증해주세요.

최종적으로 테스트 관련 Node.js 프로세스, SFU worker, 점유 포트 및 브라우저 임시 프로필이 남아 있는지 확인해주세요.

## 11. 기존 기능 회귀 검증

가능한 범위에서 Step 01~08 기능을 검증해주세요.

- TypeScript strict 검사
- Client/Server 빌드
- HTTP `/health`
- WebSocket 세션·프로필
- 다중 회의방 생성·입장·퇴장
- 전체 채팅 및 회의방 채팅
- WebSocket 초과 payload 종료 처리
- 로컬 미디어 종류별 획득과 트랙 정리
- 로컬 미디어 비동기 경합
- SFU worker·Router 생성·종료
- Step 07 Send Transport·Producer 송신
- Step 08 Recv Transport·Consumer 수신
- 초기 Producer 조회·신규 이벤트
- 자동 재생 제한 처리
- 수신 전용 연결
- 단일 활성 미디어 회의방 정책
- ChatHistory 기록기 테스트

Step 08의 자동화 검증 결과를 보존하되, 신규 Step 09 변경으로 발생하는 회귀가 없는지 확인해주세요.

테스트 본문의 성공과 프로세스 정상 종료를 별도로 판단해주세요.

## 12. 문서화

`docs/Step09.md`를 신규 작성해주세요.

다음 내용을 포함합니다.

- Step 09 목표와 구현 범위
- 2인 송수신에서 3인 이상으로 확장된 구조
- 동적 Producer 발견과 Consumer 관리
- 참가자 입장·퇴장에 따른 상태 변화
- 정상·비정상 종료 처리
- heartbeat와 연결 유실 감지
- 참가자 재접속 및 재입장 정책
- 방별 미디어 자원 소유권
- 단일 활성 미디어 회의방 정책
- 여러 회의방 간 채팅과 미디어 격리
- 수신 전용 참가자와 단일 트랙 처리
- 비동기 요청·이벤트 경합 및 중복 방지
- SFU 자원 수와 정리 검증 결과
- Chrome·Edge 3인 이상 자동화 테스트 결과
- 실제 물리 장치 검증과 가상 장치 검증 구분
- 남은 위험과 미검증 항목
- 설계 선택 이유 및 Trade-off
- Step 10 미디어 제어 구현 시 고려할 사항

`README.md`에는 실제 구현한 기능, 실행·검증 명령 및 Step 09 문서 링크를 반영해주세요.

`docs/Concept.md`, `docs/PLAN.md`는 현재 구현과 새로 확정한 정책을 기록하는 데 필요한 범위에서만 변경해주세요.

Step 06의 물리 웹캠 검증과 Step 08의 실제 청취 미검증 상태는 유지합니다.

Step 09도 `PLAN.md`에 명시된 완료 기준을 실제로 충족했을 때만 완료 처리해주세요.

가상 장치 검증만으로 실제 사람의 청취까지 확인했다고 기록하지 마세요.

## 13. 작업 범위 제한

이번에는 Step 09만 구현합니다.

다음 항목은 구현하지 않습니다.

- Step 10의 카메라 ON/OFF 및 마이크 음소거·해제
- Step 11의 장치 목록 조회·전환
- Step 12의 마이크 입력 레벨 분석
- 화면 공유·녹화 및 파일 전송
- 인증·DB·Redis·Docker
- 분산 SFU 및 다중 worker 확장
- Mesh 기반 미디어 연결
- 여러 회의방 동시 미디어 송수신
- 대규모 UI 재설계
- 불필요한 신규 패키지와 아키텍처 변경

기존 Signaling·Transport·Producer·Consumer 구조를 최대한 재사용해주세요.

Step 09의 목표는 **동적인 다자간 참가·퇴장과 안정적인 자원 정리**이지, 새로운 미디어 기능을 추가하는 것이 아닙니다.

기존 `AGENTS.md`, `.codex/`, `ChatHistory/` 및 자동 기록 설정을 유지해주세요.

사용자 프롬프트와 Codex 응답은 기존 자동 기록을 사용하며 같은 대화를 수동으로 중복 기록하지 마세요.

Git Commit·Push는 실행하지 마세요.

## 14. 작업 완료 보고

작업 완료 후 다음 내용을 보고해주세요.

1. 신규·수정 파일 목록
2. 기존 Step 08 대비 주요 구조 변경
3. 새 패키지와 버전 (있는 경우)
4. 3인 이상 Producer·Consumer 연결 방식
5. 초기 Producer 조회와 신규 이벤트 처리
6. 동적 참가·퇴장 및 재입장 처리
7. 정상·비정상 연결 종료 및 heartbeat 처리
8. 원격 참가자 타일과 프로필 동기화
9. 다중 회의방 미디어 격리 검증
10. 수신 전용·단일 트랙 참가자 검증
11. 서버 자원 소유권과 잘못된 요청 거절 검증
12. 송수신 RTP 및 영상 프레임 검증 결과
13. 자원 개수 및 종료 후 누수 검증
14. Step 01~08 회귀 검증 결과
15. 물리 장치와 자동화 검증 결과 구분
16. 주요 설계 판단과 Trade-off
17. 미완료·미검증 사항
18. Step 09 완료 기준 충족 여부

실제로 실행한 테스트와 실행하지 않은 테스트를 명확히 구분해주세요.

작업 완료 시 잔류 프로세스·포트·SFU worker를 확인하고, 테스트를 위해 생성한 임시 프로필이나 fixture를 정리해주세요.

현재 로컬 저장소의 실제 구현을 기준으로 Step 09의 구현·검증·문서화를 수행해주세요.

기존 정책과 충돌하거나 작업 범위를 크게 확대해야 하는 문제가 있다면 원인을 분석하고 대안을 보고해주세요.

```

## Codex Response

````text
Step 09 구현과 가상 장치 검증을 완료했습니다. **실제 사람의 음성 청취는 미검증이므로 Step 09 전체 완료는 보류**했습니다. Step 06·08의 보류 상태와 Step 07 완료 상태도 유지했습니다.

- 기존 활성 슬롯·Producer 발견·Consumer Map을 재사용해 다자간 송수신을 관리합니다.
- `producer.close`는 해당 원본만 종료하도록 변경했습니다. 다른 종류의 송신·수신·논리 소속·채팅은 유지됩니다.
- 초기 목록과 신규 이벤트의 중복, 이전 mediaId의 이벤트, 종료 중 늦은 응답을 처리하고 임시 종료 기록이 누적되지 않도록 보강했습니다.
- 참가자별 타일·공통 프로필·수신 전용 연결을 유지하고 원격 참가자·트랙 개수를 표시합니다.
- 기본 비활성인 내부 진단 기능으로 서버 Map과 worker·Router 덤프를 대조했습니다. 외부 HTTP·WebSocket 진단 API는 추가하지 않았습니다.
- 신규 패키지는 없습니다. 기존 mediasoup 3.32.0·mediasoup-client 3.25.3을 유지했습니다.

| 검증 | 결과 |
|---|---|
| TypeScript strict·Client/Server 빌드 | 통과 |
| SFU Signaling·소유권·경합·자원 정리 | 16/16 |
| WebSocket·프로필·방·채팅·HTTP·payload | 19/19 |
| worker·Router | 5/5 |
| ChatHistory 기록기 | 26/26 |
| 로컬 미디어 단위 테스트 | 6/6 |
| Chrome 2개·Edge 2개 독립 세션 | 3인 상호 RTP 증가·영상 디코딩/재생 통과 |
| 동적 참가 | 순차·동시 시작, C 종료·재연결 5회, 새로고침·탭 종료 통과 |
| 미디어 종류·방 격리 | 마이크만·카메라만·수신 전용, 다른 방 채팅·미디어 유지 통과 |
| Step 06~08 브라우저 회귀 | 로컬 미디어·송신·수신 모두 정상 종료 |

3명이 audio/video를 각각 송신할 때 **참가자당 원격 Consumer 4개, 총 12개**를 확인했습니다. 반복 종료 후 기대 자원 수로 복귀했고, 다른 방 Router 장애 중에도 정상 방의 RTP 증가를 확인했습니다.

테스트용 heartbeat 300ms에서는 pong 미응답 후 약 **572ms**에 정리됐습니다. 운영 heartbeat는 기존 30초입니다. 실제 네트워크 차단 시간으로 해석하지 않았습니다.

변경 파일은 다음과 같습니다.

- 신규: [Step09.md](D:/01.Portfolio/TypeScript/ts-0001-ai-webrtc-practice/docs/Step09.md), `scripts/sfu-multi-server.cjs`, `scripts/sfu-multi.browser.cjs`, `scripts/sfu-multi.scenarios.cjs`
- 클라이언트: `App.tsx`, `MediaPanel.tsx`, `useSfuSender.ts`
- 서버: `application.ts`, `media.ts`
- 테스트·명령: `scripts/media.browser.cjs`, `scripts/sfu-ws.test.cjs`, `package.json`
- 문서: `README.md`, `docs/PLAN.md`

실행 방법은 기존과 같습니다.

```powershell
npm run dev:server
npm run dev:client
```

개발 서버를 종료한 뒤 다자간 자동 검증을 실행합니다.

```powershell
npm run test:sfu:multi:browser
```

초기 브라우저 실행 두 번은 기능 본문 이후 프로필 삭제에서 실패했습니다. 잔류 브라우저 정리를 보강한 최종 실행은 종료 코드 0을 확인했습니다. 마지막 점검에서 관련 프로세스·worker·개발 포트·임시 프로필은 모두 0개였습니다.

실제 청취·물리 웹캠·LAN/NAT·장시간 부하는 미검증입니다. 상세 자원 개수, RTP 표본, 실패 이력과 설계 판단은 [Step09.md](D:/01.Portfolio/TypeScript/ts-0001-ai-webrtc-practice/docs/Step09.md)에 기록했습니다. 기존 ChatHistory·자동 기록 설정을 유지했으며 Git Commit·Push는 실행하지 않았습니다.
````
