# Step 07 — SFU 연결과 미디어 송신

2026-10-30 Windows·Node.js 24.22.1·npm 12.2.1에서 구현했다. Chrome·Edge 가상 장치로 실제 ICE/DTLS 연결과 브라우저 송신·SFU 수신 RTP 증가를 확인했다. 물리 마이크 송신·웹캠은 이번에 검증하지 않았다. Step 06의 물리 웹캠·트랙 종료 인수 미완료 상태는 유지한다.

## 범위와 선택

Step 06의 실제 획득 트랙을 그대로 사용해 SFU로 송신한다. 마이크만이면 Audio Producer, 카메라만이면 Video Producer, 둘이면 각각 하나씩 생성한다. 미디어 없이도 다중 회의방·전체/방 채팅을 이용할 수 있다. 수신 Transport·Consumer·원격 재생은 Step 08 범위이며 구현하지 않았다.

설치 버전은 mediasoup 3.32.0, mediasoup-client 3.25.3이다. 새 직접 의존성은 브라우저 Device·Send Transport·Producer를 위한 mediasoup-client 하나다. Node >=22 조건을 현재 Node 24가 충족한다. npm 설치는 10개 패키지를 추가했고 60개 감사에서 취약점 0건을 보고했다. 기존 esbuild 설치 스크립트 차단 경고는 유지했다. 시스템 프로그램·Node 버전·방화벽·OS 권한은 변경하지 않았다.

공식 [mediasoup-client API](https://mediasoup.org/documentation/v3/mediasoup-client/api/)의 Device·Transport·Producer·stopTracks와 [서버 API](https://mediasoup.org/documentation/v3/mediasoup/api/), [RTC 통계](https://mediasoup.org/documentation/v3/mediasoup/rtc-statistics/)를 설치된 타입·실행 결과와 대조했다. 요청의 Convention Draft는 [AI Task Prompt Convention](https://github.com/Sangseon/00-conventions/blob/master/docs/ai-task-prompt.md)을 참고했고 프로젝트 요구사항·실제 코드·검증 범위를 우선했다.

## 파일과 구조

| 파일 | 역할 |
| --- | --- |
| server/src/media.ts | 신규: worker·방 Router·참가자 활성 슬롯·취소·소유권·통계·종료 |
| server/src/shared/mediaProtocol.ts | 신규: action·DTO·런타임 검증 |
| server/src/shared/protocol.ts | 기존 요청·응답·이벤트에 미디어 계약 추가 |
| server/src/application.ts | 기존 한 WebSocket에서 Signaling 처리, 방 퇴장·세션 정리와 연계 |
| server/src/sfu.ts | 기존 worker 종료 함수를 export해 재사용, Step 02 동작 유지 |
| client/src/useSession.ts | 같은 소켓에 requestId별 비동기 미디어 응답 대기와 종료 이벤트 구독 추가 |
| client/src/useSfuSender.ts | 신규: Device·송신 자원·전환·경합·브라우저/SFU 통계 |
| client/src/MediaPanel.tsx | 신규: 로컬 미디어 소유 Hook과 송신 UI 연결 |
| client/src/LocalMedia.tsx | 독립 컴포넌트 유지, 재사용 가능한 Controls 분리 |
| client/src/App.tsx | MediaPanel 연결 |
| scripts/sfu-ws.test.cjs | 신규: 실제 worker 기반 Signaling·소유권·정리 테스트 |
| scripts/sfu.browser.cjs, sfu-browser.scenarios.cjs | 신규: Chrome·Edge 실제 RTP·전환·실패·복구 검증 |
| scripts/media.browser.cjs | 기존 브라우저/임시 프로필 fixture를 SFU 검증에서도 재사용 |
| package.json, package-lock.json | mediasoup-client 고정 버전·검증 명령 |
| README.md, docs/Concept.md, docs/PLAN.md | 현재 구현·단일 활성 방 정책·진행 상태 |

기존 방 저장소·채팅 프로토콜·소속 정책은 유지한다. AGENTS.md·.codex·기록기와 과거 Step 문서는 수정하지 않는다.

## 논리 소속과 단일 활성 송신 방

사용자는 1111·2222 두 방에 동시에 소속될 수 있다. 각 방 채팅도 계속 이용하지만 송신 자원은 한 방으로 제한한다. 화면에서 보는 회의방, Chat의 선택 채널, MediaPanel의 송신 대상 선택, sender의 activeMediaRoomId는 각각 독립적이다. 대상 선택만으로 연결하지 않고 시작·전환 버튼이 필요하다.

서버는 participantId별 슬롯 하나를 **비동기 생성 전에 예약**한다. 슬롯은 roomId·mediaId·Transport·Producer를 소유한다. 생성 중·DTLS 처리 중·Producer 처리 중도 예약에 포함한다. 정리 중인 비동기 작업이 남으면 새 슬롯 생성을 거절한다.

송신 시도마다 새 mediaId를 사용한다. 종료된 mediaId는 해당 WebSocket 세션에서 재사용하지 않는다. 오래된 close는 새 시도를 닫지 않고, 취소 후 늦은 create도 거절한다. 종료 ID는 세션당 128개로 제한하며 한도 이후에는 새 WebSocket 세션이 필요하다. 한도에 도달해도 기존 자원 정리·방 퇴장·채팅은 막지 않는다.

## worker·Router·Transport·Producer

worker는 첫 미디어 요청에서 한 번 지연 생성하며 서버 종료까지 유지한다. 기존 Opus 48kHz/2채널·VP8 90kHz 코덱과 worker 종료 함수를 재사용한다. 방 Router는 첫 capabilities 요청 때 생성하고 같은 방 참가자가 재사용한다. 송신을 중지해도 논리 방이 남아 있으면 Router를 유지한다. 마지막 참가자 이탈로 방이 삭제되면 Router와 관련 자원을 닫는다. 비동기 생성 중 방이 삭제돼도 늦게 생성된 Router를 폐기한다.

각 슬롯은 Send Transport 하나와 실제 트랙 종류별 Producer 최대 하나씩을 가진다. 포트는 UDP/TCP 40000~40100, listen IP는 127.0.0.1이며 UDP를 우선한다. 공개 주소·STUN/TURN·방화벽 변경은 도입하지 않았다. 루프백 외 환경은 별도 설계·검증이 필요하다.

worker가 죽으면 모든 슬롯을 정리하고 미디어 요청은 오류로 처리한다. 자동 worker 재시작은 없으며 서버 재시작이 필요하다. HTTP·WebSocket·채팅은 유지한다. 특정 Router·Transport 실패는 관련 슬롯을 정리한다.

## Signaling 계약·검증

기존 kind·type·requestId 구조를 유지한다. 모든 미디어 요청은 다음 형태다.

```json
{"kind":"request","type":"media.request","requestId":"UUID","roomId":"방-UUID","mediaId":"시도-UUID","action":"create","payload":{}}
```

| action | payload | 성공 data |
| --- | --- | --- |
| capabilities | 빈 객체 | routerId, capabilities |
| create | 빈 객체 | id, iceParameters, iceCandidates, dtlsParameters |
| connect | transportId, dtlsParameters | connected:true |
| produce | transportId, kind, rtpParameters | producerId |
| stats | 빈 객체 | iceState, dtlsState, producers의 packets·bytes |
| close | 빈 객체 | closed:true |
| producer.close | transportId, producerId | 소유권 확인 후 이 시도 전체 종료, closed:true |

성공은 `type:'media.result'`, roomId·mediaId·action·data를 포함한다. 실패는 기존 error 응답과 MEDIA_ERROR 또는 INVALID_MESSAGE를 사용한다. 자원이 서버에서 종료되면 요청자에게 `media.closed` 이벤트로 roomId·mediaId·reason을 전달한다. 응답과 이벤트의 도착 순서에 의존하지 않고 현재 시도 ID를 확인한다.

요청 최상위와 action별 payload의 정확한 필드를 검사해 임의 participantId를 받지 않는다. connect는 Transport 소유권·DTLS role/fingerprint 형식을 검사한다. produce는 kind·RTP 객체·코덱·payload type·clock rate·인코딩 기본 구조를 검사한 뒤 mediasoup의 실제 파라미터 검증을 거친다. 현재 코덱은 Opus/VP8/RTX이며 simulcast는 구현하지 않아 인코딩을 최대 하나로 제한한다. 잘못된 RTP를 기존 유효 파라미터로 간주하지 않는다.

서버는 실제 소켓의 세션 ID와 방 Set 소속을 대조하고 roomId·mediaId·Transport·Producer 소유권을 확인한다. 타인 자원·다른 방 자원·이미 종료된 자원은 거절한다. 중복 connect/동일 kind Producer는 추가 생성 없이 거절한다. 실제 native 연결/생성 실패는 해당 슬롯을 정리한다. 다른 슬롯과 채팅은 유지한다.

최대 요청 payload 4,096 bytes는 유지한다. 클라이언트도 전송 전 UTF-8 길이를 검사한다. 미래의 큰 RTP/Signaling 계약은 별도 검토가 필요하며 이번에는 한도를 늘리지 않았다.

## 로컬 트랙 소유권·전환·실패

Step 06 Hook은 원본 트랙을 소유한다. Producer는 `stopTracks:false`로 생성하므로 송신 종료·Transport 교체가 로컬 트랙을 stop하지 않는다. clone·추가 getUserMedia는 사용하지 않는다. 로컬 미디어 종료·장치 ended는 송신도 정리하지만 방·채팅은 유지한다. WebSocket 유실은 송신을 정리하고 로컬 트랙은 사용자 종료 또는 컴포넌트 해제까지 유지한다.

전환은 **클라이언트 송신 자원 종료 → 서버 close 응답과 진행 중 생성 작업 정리 확인 → 새 mediaId로 새 방 연결** 순서다. 두 방 동시 송신은 허용하지 않는다. 기존 close 확인에 실패하면 새 연결을 계속 만들지 않고 WebSocket을 닫아 세션 자원 정리를 유도한다. 새 방 실패 시 옛 자원은 이미 닫혔으므로 복구됐다고 표시하지 않는다.

클라이언트는 시도 객체를 각 await 전후 확인하고 오래된 응답을 버린다. 서버도 생성 완료 후 슬롯·소속이 여전히 유효한지 확인해 늦은 Transport·Producer를 닫는다. 생성·연결·정리 중 작업은 서버 drain barrier로 추적한다. 같은 자원 종료는 중복 안전하다.

Signaling 응답 대기는 requestId별 8초이며 만료하면 WebSocket을 닫는다. 클라이언트 연결 준비와 서버의 Producer 미생성 Transport 준비에는 15초 제한을 둔다. 실제 ICE/DTLS 실패·끊김도 종료한다. 통계 조회는 1초 간격, 동시에 한 번만 수행한다.

## 실행과 물리 이어폰 마이크 수동 절차

```powershell
# 두 터미널에서 각각
npm run dev:server
npm run dev:client

npm run typecheck
npm run build
npm run test:sfu:ws
# 개발 서버 종료 후 전용 테스트가 임시 서버·브라우저를 실행
npm run test:sfu:browser

# 기존 회귀
npm run test:ws
npm run test:media
npm run test:media:browser
npm run test:sfu
npm run sfu:check
node --test scripts/chat-history.test.cjs
```

1. 일반 Chrome/Edge에서 localhost:5173을 열고 카메라 체크를 해제해 실제 이어폰 마이크만 로컬 획득한다. Step 06의 획득 성공은 사용자 확인이 있지만 이번 SFU 송신은 별도 검증해야 한다.
2. 두 회의방에 참여하고 미디어 대상을 한 방으로 선택한 뒤 SFU 송신을 시작한다. Transport connected, 서버 ICE connected/completed·DTLS connected와 오디오 Producer 하나를 확인한다.
3. 2~3초 간격으로 통계의 브라우저 packetsSent/bytesSent와 SFU packets/bytes가 각각 증가하는지 확인한다. 이 단계는 상대방 청취 검증이 아니다.
4. 다른 방 채팅·전체 채팅으로 화면을 바꿔 송신 방이 유지되는지 확인한다. 명시적으로 미디어 대상을 바꾸고 전환 버튼을 눌러 이전 자원 종료·새 방 통계 증가·두 방 소속 유지도 확인한다.
5. SFU 송신 종료 후 로컬 마이크가 live인지 확인하고, 로컬 미디어 종료 후 ended·장치 사용 해제를 별도로 확인한다.
6. 웹캠이 생기면 카메라만·동시 송신도 별도 기록한다. 현재 물리 웹캠·물리 RTP 송신·직접 청취는 미검증이다.

## 실제 검증 결과

브라우저 테스트는 Chrome 156.0.8078.49·Edge 156.0.4314.50의 독립 임시 프로필과 가상 장치를 사용한다. 가상 소스이지만 RTP 연결은 Mock이 아니라 실제 브라우저 WebRTC↔native mediasoup worker의 루프백 전송이다. 권한·하드웨어 인수와 구분한다.

| 검증 | 결과 |
| --- | --- |
| strict·Client/Server 빌드 | 통과 |
| SFU Signaling 통합 | 7/7, 실제 worker 사용, 종료 코드 0 |
| Router | 같은 방 재사용·다른 방 분리, 생성 중 방/시도 취소 처리 |
| 단일 슬롯·소유권 | 동시 create·비소속·없는 방·타인 Transport/Producer·다른 방 접근·종료 ID 재사용 거절 |
| 잘못된 요청 | 위조 participantId·잘못된 DTLS·실제 native RTP 실패에서 다른 슬롯 유지 |
| 종료 | 정상 close·강제 terminate·heartbeat·활성 방 퇴장·로컬 종료·서버 shutdown·worker 사망 정리 |
| 생성 경합 | create 직후 close·늦은 create·오래된 close가 새 슬롯을 덮어쓰지 않음 |
| 한도 | 종료 ID 128개에 도달해도 기존 자원 정리·채팅 유지 |
| Chrome·Edge 실제 송신 | 각 브라우저에서 마이크만·카메라만·동시 송신의 실제 ICE/DTLS·RTP 증가 |
| 미디어 선택 | 선택하지 않은 종류의 Producer 없음, 로컬 트랙 없으면 시작 비활성화 |
| 채팅·전환 | 1111 송신 중 2222/전체 채팅 확인·2222 전송 후에도 활성 방 유지, 명시적 전환만 새 방 연결 |
| 전환·트랙 | 이전 Transport ID 폐기·옛 stats 거절·새 Transport RTP 증가, getUserMedia 호출 증가 없이 원본 live 트랙 재사용 |
| 실패·복구 | 잘못된 대상 방을 주입한 전환 실패 후 미연결·로컬 live 유지, 정상 재시도 |
| 기존 종료 실패 | close의 대상 방을 잘못 전달하도록 주입해 종료 확인 실패 시 새 방을 연결하지 않고 WebSocket을 닫음, 새 세션 복구 후 기존 로컬 트랙 사용 가능 |
| 실제 DTLS 실패 | 잘못된 fingerprint 주입으로 연결 실패·정리·정상 재시도 |
| Signaling 지연 | create를 종료 뒤 늦게 전송해도 복원되지 않음, capabilities 응답을 누락하면 실제 8초 timeout 후 소켓·송신 정리 |
| 기존 WS 회귀 | 19/19, /health·세션·프로필·M:N·전체/방 채팅·4,096-byte 한도·1009 회귀 포함 |
| Step 06 회귀 | Mock 6/6, Chrome·Edge 단일/동시·미선택·트랙 종료·해제 경합 통과 |
| Step 02 회귀 | 5/5와 별도 sfu:check 실제 worker·Router 생성·종료 |
| 기록기 | 26/26 |

### 실제 RTP 카운터 예시

각 연결에서 첫 유효 통계와 테스트의 2.2초 대기 후 통계를 비교했다. UI 수집 주기는 1초여서 실제 샘플 간격은 약 2~3초다. 다음은 통과한 가상 장치 실행 중 한 회차의 값이다. UUID·카운터는 재실행마다 달라진다.

| 경로 | 브라우저 packetsSent / bytesSent | SFU inbound packetCount / byteCount |
| --- | --- | --- |
| Chrome 오디오 | 21→121 / 1,001→5,892 | 21→121 / 1,505→8,796 |
| Chrome 비디오 | 11→120 / 6,361→108,822 | 4→109 / 3,746→105,367 |
| Edge 오디오 | 21→121 / 1,077→6,065 | 20→120 / 1,521→8,896 |
| Edge 비디오 | 19→123 / 12,516→111,758 | 7→111 / 6,132→107,922 |

동시 송신에서도 두 종류 모두 증가했다. Chrome 오디오는 15→115 packetsSent, 비디오는 23→132였고 SFU에서도 각각 증가했다. 브라우저는 Producer.getStats의 outbound-rtp packetsSent·bytesSent, 서버는 Producer.getStats의 inbound-rtp packetCount·byteCount를 종류별 합산한다. 헤더·RTX·샘플 시각 차이가 있어 두 API의 byte 수나 패킷 수가 반드시 같다고 가정하지 않고 각 경로의 증가를 검증했다.

종료된 객체에 getStats를 강제로 반복하지 않는다. 이전 Transport·Producer의 클라이언트 close와 서버 슬롯 종료·옛 시도 stats 거절을 확인하고 새 연결 ID의 통계 증가를 검증했다. 종료 이후 네트워크 패킷 캡처로 무송신을 별도 측정한 것은 아니다.

### 검증 중 발견한 사항

초기 SFU 통합 테스트는 본문 이후 테스트 클라이언트 소켓이 남아 러너가 대기했다. 테스트 fixture에 서버 종료 후 소유 클라이언트 terminate·close 대기를 명시하고, 서버의 worker subprocess 종료와 HTTP listener 종료 확인도 유지했다. 취소 테스트의 직접 peer close 대기도 같은 fixture 정리로 분리했다. 정상 종료하지 않은 실행과 timeout 한 번은 통과로 처리하지 않았고, 최종 7/7과 정상 프로세스 종료를 확인했다. 서버 shutdown이 모든 peer의 Close 핸드셰이크를 보장한다고 주장하지 않는다.

최종 점검에서 해당 테스트·개발 Node 프로세스 0개, 포트 3000·4173·5173 리스너 0개, mediasoup-worker 0개였으며 `git diff --check`도 통과했다. 브라우저 fixture가 소유한 임시 프로필은 삭제했고 일회성 진단 코드는 제거했다. 테스트 스크립트는 재실행을 위해 저장했다.

## 제약·완료 판단·Step 08

Step 07의 핵심 기준인 실제 ICE/DTLS·브라우저/SFU RTP 증가와 단일 활성 방·전환·정리·소유권 검증을 현재 Windows 루프백·가상 장치 범위에서 충족했다. Step 06 전체 완료를 이 결과로 변경하지 않는다.

미검증은 물리 이어폰 마이크 SFU 송신·웹캠, 다른 OS·Firefox/Safari·LAN/NAT·방화벽 차단·UDP 불가 시 TCP 강제 fallback, 장시간·고부하, 모든 가능한 HMR/컴포넌트 해제 타이밍과 고의적 네트워크 단절이다. 잘못된 DTLS·지연 Signaling은 주입 테스트이며 실제 외부망 장애 전체를 대신하지 않는다. 기존 payload 극단적 stress의 간헐 1006 이력을 해결했다고 주장하지 않는다.

Step 08은 같은 Router에 수신 Transport·Consumer를 추가하고, 현재 활성 미디어 방의 자원 소유권과 브라우저 코덱·재생 준비를 연결해야 한다. 여러 논리 방에 소속됐다는 이유로 모든 방의 미디어를 자동 구독하지 않는다. 단일 worker 장애는 전체 미디어에 영향을 주며 확장·자동 복구는 이번 범위 밖이다.

현재 구현은 로컬 실습용이며 인증·TURN·분산 SFU·저장소·수신 기능을 추가하지 않았다. 기존 자동 기록을 유지하고 수동 중복 기록·Git Commit·Push는 실행하지 않았다.
