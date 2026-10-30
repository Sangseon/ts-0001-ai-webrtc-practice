# Step 08 — SFU를 통한 2인 양방향 미디어 수신

## 범위와 현재 판단

2026-10-30, 기존 Step 07 송신 경로에 별도 Recv Transport와 Consumer를 추가했다. 다중 논리 회의방 소속·채팅은 유지하고 **송수신의 활성 회의방은 참가자당 하나**로 제한한다. 명시적인 수신 전용 연결도 지원하며 로컬 장치를 요청하지 않는다.

Windows 루프백의 Chrome·Edge 가상 장치에서 실제 ICE/DTLS, 양방향 오디오·비디오 RTP, 디코딩·영상 프레임 재생을 검증했다. 오디오 요소의 재생과 물리 스피커에서의 청취는 구분한다. **실제 음성 청취·물리 웹캠은 미검증이므로 PLAN의 Step 08 전체 완료는 보류한다.** Step 06 물리 장치 검증 보류와 Step 07 완료 상태는 유지한다. 3명 이상 전체 동적 송수신은 이번 검증 범위가 아니다.

## 환경과 참고 자료

| 항목 | 실제 환경 |
| --- | --- |
| OS·런타임 | Windows, Node.js 24.22.1, npm 12.2.1 |
| 클라이언트 | React 19.3.1, Vite 8.3.5, TypeScript 7.0.2 strict |
| SFU·Signaling | mediasoup 3.32.0, mediasoup-client 3.25.3, ws 8.22.0 |
| 네트워크 | HTTP/WS 127.0.0.1:3000, Vite 127.0.0.1:5173, SFU UDP/TCP 40000~40100 |
| 가상 장치 브라우저 | Chrome 156.0.8078.49, Edge 156.0.4314.50, 별도 임시 프로필의 headless 세션 |

신규 패키지는 없다. worker·방별 Router·Opus/VP8 코덱·루프백 주소를 재사용하며 Node·OS 권한·방화벽 설정을 변경하지 않았다.

공식 [서버 API](https://mediasoup.org/documentation/v3/mediasoup/api/#transport-consume), [클라이언트 API](https://mediasoup.org/documentation/v3/mediasoup-client/api/#transport-consume), [RTC 통계](https://mediasoup.org/documentation/v3/mediasoup/rtc-statistics/)와 설치된 타입을 확인했다. 서버 Consumer의 paused 생성 → 클라이언트 consume → 서버 resume 순서를 적용했다. 접근 가능한 [AI Task Prompt Convention](https://github.com/Sangseon/00-conventions/blob/master/docs/ai-task-prompt.md)도 확인했으며 현재 코드·실행 결과를 기준으로 판단했다.

## 구조와 소유권

- `server/src/media.ts`: 기존 참가자별 활성 슬롯 안에 Send Transport·Producer와 별도로 Recv Transport·Consumer Map을 둔다. 수신 전용 `receive`도 같은 슬롯을 예약한다. 다른 방·다른 mediaId의 두 번째 연결은 거절한다.
- `server/src/application.ts`: 기존 WebSocket 세션 ID를 사용해 미디어 요청과 참가자별 이벤트를 전달한다. 논리 방·채팅 상태 구조는 변경하지 않았다.
- `server/src/shared/mediaProtocol.ts`, `protocol.ts`: 요청·응답·이벤트 타입과 런타임 검증을 공유한다. 요청은 계속 4,096 bytes 이하이며 허용 필드·식별자·kind·capabilities 형식을 검증한다. mediasoup의 `canConsume`와 실제 API 검증도 거친다.
- `client/src/useSession.ts`: 기존 소켓 하나에 requestId별 RPC와 미디어 이벤트 구독을 추가한다.
- `client/src/useSfuSender.ts`: 기존 이름·송신 API를 유지하고 같은 연결 시도에 수신을 확장했다. 활성 시도는 Ref가 소유하고, 화면에는 연결 상태와 원격 트랙 목록을 제공한다.
- `client/src/RemoteMedia.tsx`: participantId별 타일과 비디오·오디오 재생을 담당한다. 프로필은 기존 공통 상태에서 읽는다.

서버는 논리 소속뿐 아니라 활성 roomId/mediaId, 수신 Transport ID, Consumer ID와 요청 세션의 소유권을 검증한다. Producer는 같은 활성 방의 다른 참가자에게서만 찾는다. 자기 Producer·타인 Transport/Consumer·다른 방의 ID·종료된 시도·중복 Consumer를 거절한다. 방 Router는 기존 지연 생성 캐시를 공유한다.

## Signaling과 수신 순서

공통 외형은 `kind: request`, `type: media.request`, `requestId`, `roomId`, `mediaId`, `action`, `payload`다. 응답은 `media.result`이며 오류는 기존 `MEDIA_ERROR` 또는 입력 검증 오류다.

| 추가 action | payload | 결과 |
| --- | --- | --- |
| receive | 빈 객체 | Recv Transport ICE/DTLS 파라미터. 슬롯이 없으면 수신 전용으로 예약 |
| recv.connect | transportId, dtlsParameters | 수신 Transport 연결 |
| producers | 빈 객체 | 다른 참가자의 producerId, participantId, kind 목록 |
| consume | transportId, producerId, rtpCapabilities | paused Consumer의 id, producerId, participantId, kind, rtpParameters |
| consumer.resume | consumerId | 클라이언트 준비 후 서버 재개 |
| consumer.close | consumerId | 해당 수신 Consumer만 종료 |
| recv.close | 빈 객체 | 해당 수신 Transport·Consumer만 종료, 송신 보존 |

`stats`는 기존 송신 통계를 유지하고 recvIceState/recvDtlsState와 Consumer별 outbound 패킷·바이트·paused 상태를 추가한다. `close`는 활성 슬롯의 송수신 전체를 정리한다. 기존 create/connect/produce/producer.close 의미와 형식은 유지한다.

추가 이벤트는 `media.producer.added`, `media.producer.removed`, `media.consumer.closed`다. 모두 수신자의 현재 roomId/mediaId를 포함하고 같은 활성 방의 참가자에게만 전달한다. Producer 이벤트의 메타데이터는 producerId/participantId/kind이며 프로필을 복제하지 않는다. 기존 `media.closed`는 전체 슬롯 종료에 사용한다.

1. Router capabilities로 Device를 로드한다. 송신이면 기존 Send Transport를 만들고 별도 Recv Transport를 연결한다. 수신 전용이면 Send Transport·Producer 없이 Recv Transport만 만든다.
2. 수신 이벤트 처리기를 준비하고 초기 Producer 목록을 조회한다. 준비 전 이벤트도 같은 시도 안에 보관한다.
3. Producer ID별 pending 집합과 Consumer Map으로 초기 목록·신규 이벤트를 합친다. 수신 생성은 클라이언트 큐로 순서대로 처리한다.
4. 서버가 소속·소유권·canConsume을 검사하고 paused Consumer를 만든다.
5. 브라우저 `recvTransport.consume()`가 트랙을 준비한 뒤 `consumer.resume`을 요청한다. 첫 consume 중 Recv Transport의 connect 이벤트를 RPC에 연결한다.
6. 준비된 트랙을 타일에 반영한다. 종료 이벤트와 이전 시도의 늦은 응답은 mediaId/roomId 및 종료 Producer·Consumer 집합으로 걸러낸다.

서버 송신과 수신의 비동기 작업 잠금은 분리한다. 전체 종료는 양쪽 진행 중 작업의 완료를 기다려 다음 시도가 이전 자원을 되살리지 못하게 한다. 수신 중 Producer 종료는 해당 Consumer를 정리하며 다른 정상 송신을 종료하지 않는다. 종료와 통계 수집이 겹치면 이미 닫힌 Consumer의 통계 실패를 현재 연결의 장애로 취급하지 않는다.

## UI와 자원 생명주기

방 목록 선택·채팅 화면·미디어 대상 선택은 독립적이다. `SFU 송신 시작`은 선택된 로컬 트랙을 송신하며 같은 방의 원격 미디어도 수신한다. `선택한 방 수신만 연결`은 로컬 장치 없이 해당 방만 수신한다. 방 소속만으로 자동 구독하지 않는다.

상대의 audio/video Consumer가 각각 있어도 participantId별 타일 하나로 묶는다. 프로필 변경은 공통 프로필 상태를 통해 반영한다. 영상 요소에는 video 트랙만, 오디오 요소에는 audio 트랙만 연결하므로 같은 오디오가 이중 출력되지 않는다. 원격 요소는 음소거하지 않는다. 로컬 미리보기는 기존 muted 정책을 유지한다.

`play()` 성공·실패를 표시하고 재생 버튼을 제공한다. 수신 전용 환경에서는 실제 브라우저 자동 재생 차단도 관찰했다. 사용자의 명시적 클릭으로 재개할 수 있다. “재생 중”은 브라우저 재생 파이프라인 상태이며 실제 소리 청취 완료라는 뜻이 아니다.

`SFU 송수신 종료`, 활성 방 퇴장·전환·WebSocket 종료·heartbeat·worker/Router 장애·컴포넌트 해제는 관련 송수신 자원을 정리한다. 다른 논리 방 퇴장이나 채팅 전환은 현재 미디어를 종료하지 않는다. 전환은 이전 서버 close 확인 후 새 시도로 진행한다. 수신 종료는 Consumer와 원격 요소의 srcObject를 정리하고 **로컬 카메라·마이크 트랙을 stop하지 않는다.** 기존 로컬 종료 버튼은 송신 중인 전체 미디어 연결도 종료하고 실제 로컬 트랙을 stop한다. 이후 수신 전용으로 다시 연결할 수 있다.

worker 장애 후 미디어는 자동 복구하지 않는다. 기존 채팅은 유지하지만 미디어 재시작에는 서버 재시작 후 명시적인 재접속·방 참여·연결이 필요하다. 정상적인 단순 연결 종료는 같은 세션에서 새 mediaId로 재시도할 수 있다. WebSocket 재접속은 새 참가자 ID이며 소속·미디어 자동 복원은 하지 않는다.

## 실행과 테스트

저장소 루트의 두 터미널에서 `npm run dev:server`, `npm run dev:client`를 실행한다. Chrome·Edge에서 http://127.0.0.1:5173 을 열고 같은 방에 참여한 뒤 로컬 미디어와 SFU 연결을 각각 시작한다. 장치 없는 세션은 수신 전용 버튼을 사용한다.

```powershell
npm run typecheck
npm run build
npm run test:sfu:ws              # 기존 7개 + Step 08 수신 3개
npm run test:sfu:receive:browser # 개발 서버를 먼저 종료; 임시 프로필·가상 장치
npm run test:sfu:browser         # Step 07 송신 회귀
npm run test:media:browser       # Step 06 가상 장치·주입 오류 회귀
npm run test:media
npm run test:ws
npm run test:sfu
node --test scripts/chat-history.test.cjs
```

브라우저 fixture는 테스트 소유 서버·브라우저만 실행·종료하고 임시 프로필을 제거한다. SFU 중단 시나리오에서는 테스트 자식 프로세스 계보에 속한 worker 하나만 중단한다. 실제 OS/브라우저 권한 설정은 변경하지 않는다.

## 실제 검증 결과

| 항목 | 결과 |
| --- | --- |
| strict 검사·Client/Server 빌드 | 통과 |
| SFU Signaling | 10/10 통과. 기존 7개 유지, paused/resume·범위·소유권·중복·수신 생성/consume 취소·독립 종료·heartbeat 검증 |
| 기존 WebSocket | 19/19 통과. /health, 세션·프로필·다중 방·전체/방 채팅·payload 1009 포함 |
| 기존 worker·Router | 5/5 통과. 반복 생성·종료·worker 장애 포함 |
| 기록기 | 26/26 통과 |
| 로컬 미디어 단위 | 6/6 통과 |
| Chrome·Edge 로컬 미디어 회귀 | 단일·동시 선택 각 3회, 늦은 응답·해제·StrictMode·주입 오류·트랙 ended 통과 |
| Chrome·Edge 송신 회귀 | 오디오만·비디오만·동시 송신, 명시적 전환·로컬 트랙 재사용·DTLS 실패·timeout 통과 |
| Chrome·Edge 수신 | 2인 양방향 RTP·실제 영상 프레임, A/B 선행 순서, 마이크만 송신, 수신 전용, 방 전환·격리·채팅 독립성 통과 |
| 수신 경합·프로필·재접속 | Producer 신규 이벤트 3회 중복 주입에도 Consumer 중복 없음, 공통 닉네임·아바타 타일 갱신, WS 종료 후 원격 트랙·PeerConnection 정리 및 새 ID의 명시적 재연결 통과 |
| 자동 재생 | 브라우저 차단 상태 및 명시적 사용자 클릭으로 재개 확인. 강제 play 실패 주입도 별도 확인 |
| SFU 경유 | 양쪽 통계·SFU 포트의 원격 ICE 후보 확인, 테스트 소유 worker 중단 시 원격 트랙/연결 정리·채팅 유지 |

브라우저 수신은 실제 WebRTC/RTP 경로를 사용한 가상 장치 검증이다. 오류 주입·중복 이벤트 주입은 별도의 경합 검증이며 물리 네트워크 장애를 재현했다고 주장하지 않는다.

최종 서버·기록기 통합 실행은 60/60, 별도 로컬 미디어 단위 테스트는 6/6으로 종료 코드 0이었다. 수신 브라우저의 기본 전체 시나리오 1회와 중복 이벤트·프로필·WS 재접속을 추가한 최종 전체 시나리오 1회가 각각 종료 코드 0으로 끝났다. 로컬 미디어·송신 브라우저 회귀도 각각 정상 종료했고 런타임 예외는 0개였다. 마지막 점검에서 테스트 관련 Node 프로세스·mediasoup worker, 3000/4173/5173 리스너, fixture 임시 프로필은 모두 0개였다. 기존 `ChatHistory/0020-codex-turn.md`의 SHA256도 작업 전후 일치했다.

통과한 한 실행의 첫 유효 통계와 2.2초 대기 후 표본은 다음과 같다. UI 갱신은 1초 주기이고 RTX·헤더·샘플 시각 차이로 양쪽 수치가 완전히 같을 필요는 없다.

| 수신 경로 | 브라우저 packetsReceived / bytesReceived | SFU outbound packets / bytes | framesDecoded |
| --- | --- | --- | --- |
| Chrome audio | 41→141 / 2,032→9,180 | 41→141 / 3,344→13,692 | 해당 없음 |
| Chrome video | 38→155 / 35,382→146,717 | 38→155 / 36,602→151,681 | 16→56 |
| Edge audio | 133→233 / 8,222→14,745 | 133→233 / 12,478→22,201 | 해당 없음 |
| Edge video | 153→269 / 144,549→252,547 | 150→267 / 146,671→258,749 | 53→93 |

비디오 요소의 videoWidth·실제 표시 프레임 수·paused=false를 함께 확인했다. 오디오는 live 트랙·RTP 증가·muted=false·paused=false·currentTime 진행을 확인했지만 사람이 실제 소리를 듣지는 않았다. 브라우저 PeerConnection의 선택된 원격 후보는 모두 SFU 루프백의 40000~40100 포트였다. 브라우저 간 직접 PeerConnection을 만들지 않는다.

초기 테스트의 즉시 통계 확인은 직전 스냅샷을 읽어 실패했고, CDP가 DOM/MediaStream 참조를 값으로 직렬화하려는 테스트 문제도 있었다. 상태 갱신 대기와 참조 비반환으로 수정했다. 수신 전용의 자동 재생 차단은 재생 대기 UI와 실제 CDP 사용자 입력을 통해 검증했다. WS 자체 종료 뒤 항상 idle 문구가 된다는 테스트 가정도 수정해 실제 활성 방·트랙·PeerConnection 제거를 확인했다. 실패한 실행을 통과로 계산하지 않았다.

## 실제 장치 수동 검증과 남은 항목

현재 PC의 물리 웹캠 부재와 Step 06에서 사용자가 확인한 이어폰 마이크 획득 기록은 그대로 유지한다. **이번 Step에서 실제 이어폰 마이크의 SFU 송신·상대 음성 청취를 수행하지 않았다.** 가상 마이크 성공으로 대체 완료하지 않는다.

1. 두 독립 브라우저에서 같은 방에 참여한다. 실제 이어폰 마이크가 있는 A는 카메라 체크를 해제하고 마이크만 획득한다.
2. A는 SFU 송신, B는 같은 방 수신 전용으로 연결한다. A 송신·B 수신 및 SFU Consumer 패킷·바이트 증가를 확인한다.
3. A에서 말하고 B에서 원격 음성 재생 버튼을 클릭해 실제 청취한다. 헤드셋을 사용하고 한 PC 양쪽 스피커의 피드백에 주의한다. 실제 양방향 청취에는 각 세션에서 사용할 입력/출력 환경을 확보한다.
4. 자동 재생 대기 시 버튼으로 재개하고 출력 장치·OS 음량은 사용자가 확인한다. 코드가 권한이나 설정을 우회하지 않는다.
5. SFU 연결 종료 후 원격 타일·트랙·연결 정리, 로컬 미디어 종료 후 장치 해제도 직접 확인한다. 물리 웹캠이 준비되기 전 실제 영상은 계속 미검증으로 남긴다.

LAN/NAT·다른 PC·TURN·TCP 강제 fallback·Firefox/Safari·장시간 부하·모든 HMR 타이밍은 미검증이다. 기존 payload 극단 반복의 간헐 1006 이력을 이번 변경으로 해결했다고 주장하지 않는다. 가상 장치의 오디오 재생 성공은 물리 출력이나 음질·에코 검증이 아니다.

WebSocket 자체가 먼저 종료되면 후속 media.close RPC 응답을 받을 수 없어 종료 확인 실패 문구가 남을 수 있다. 실제 원격 자원 정리와 이 응답 실패는 구분한다. 새 세션에서 명시적으로 연결하면 상태가 갱신된다. 이번 단계에서 기존 Step 07의 종료 응답 정책을 별도로 재설계하지 않았다.

## 선택 이유와 Step 09

기존 활성 슬롯과 Hook을 확장해 송신 경로·소유권·단일 활성 방 전환을 보존했다. 별도 전역 상태·패키지·SFU 프로세스는 추가하지 않았다. 방별 Producer 검색은 현재 소규모 활성 슬롯을 순회하므로 대규모 인덱스 최적화보다 단순성을 우선했다. 한 수신 작업씩 처리해 중복 생성과 순서 경합을 줄이며 대규모 병렬 구독은 다루지 않는다.

Step 09에서는 3명 이상 동적 참가·퇴장·빠른 재입장·장기간 자원 개수를 확장 검증해야 한다. 현재 필요한 신규/종료 이벤트는 구현했으나 이를 전체 다자간 관리 완료로 표시하지 않는다. 활성 방 소속·미디어 소유권과 채팅 선택의 분리는 계속 유지한다.

자동 기록 설정과 기존 ChatHistory 파일을 보존하며 동일 대화를 수동으로 중복 기록하지 않았다. Git Commit·Push는 실행하지 않았다.
