# Step 10 — 카메라 ON/OFF와 마이크 음소거·해제

## 범위와 검증 경계

기존 단일 활성 미디어 방·다중 논리 소속·수신 전용·다자간 Consumer 관리에 장치 제어를 추가했다. 카메라는 Track/Video Producer를 종료하고 새로 획득한다. 마이크는 기존 Audio Producer를 유지한 채 pause/resume한다. 장치 목록·선택·전환, 입력 레벨 분석은 구현하지 않았다.

구현과 자동화 결과는 Windows 루프백·가상 장치 범위다. 사용자의 요청에 따라 실제 장치 수동 검증은 생략했다. 물리 웹캠·이어폰 마이크 제어·사람의 청취·카메라 LED는 미검증으로 남긴다. **Step 10의 구현·자동 검증과 실제 장치 인수를 구분하며 전체 완료는 보류한다.** Step 06의 물리 검증 보류, Step 07 완료, Step 08·09의 실제 청취 대기는 유지한다.

## 환경과 API 확인

Node.js 24.22.1, npm 12.2.1, TypeScript 7.0.2 strict, React 19.3.1, Vite 8.3.5, ws 8.22.0, mediasoup 3.32.0, mediasoup-client 3.25.3을 유지한다. 신규 패키지와 시스템·브라우저 권한 설정 변경은 없다.

Step 10은 Chrome 2개·Edge 1개의 독립 headless 프로필과 가상 장치를 사용했다. 검증 종료 시 확인한 설치 버전은 Chrome 156.0.8078.74, Edge 156.0.4314.50이다.

공식 [서버 Producer API](https://mediasoup.org/documentation/v3/mediasoup/api/#producer-pause), [클라이언트 Producer API](https://mediasoup.org/documentation/v3/mediasoup-client/api/#producer-pause)와 설치된 Producer/Consumer 구현을 확인했다. 클라이언트 pause는 기본 disableTrackOnPause로 track.enabled를 바꾸며, 서버 pause와 자동 연동되지 않는다. 서버 Consumer의 producerPaused도 클라이언트 Consumer 객체로 자동 전달되지 않으므로 기존 WebSocket으로 상태를 알린다. [AI Task Prompt Convention](https://github.com/Sangseon/00-conventions/blob/master/docs/ai-task-prompt.md)도 확인했다.

## 변경 구조

| 파일 | 역할 |
| --- | --- |
| client/src/useLocalMedia.ts | 기존 소유 Stream 안의 비디오만 제거·재획득. 마이크와 전체 미디어 수명 분리 |
| client/src/useSfuSender.ts | 제어 상태·의도, 송신 RPC 직렬화, 카메라 세대·늦은 응답 정리, 안전한 마이크 재개 |
| client/src/LocalMedia.tsx | 실제 비디오 트랙 유무로 미리보기 표시 |
| client/src/MediaPanel.tsx, App.tsx | 제어 버튼·처리 상태·오류 및 Step 표시 |
| client/src/RemoteMedia.tsx | 활성 미디어 참가자 상태와 공통 프로필·원격 트랙 표시 |
| client/src/useSession.ts | 기존 소켓의 media.peers 이벤트 전달 |
| server/src/media.ts | Audio Producer pause/resume, 초기 paused 생성, 활성 참가자 상태 snapshot, 실제 paused 통계 |
| server/src/shared/mediaProtocol.ts, protocol.ts | 요청·응답·이벤트 타입과 런타임 검증 |
| scripts/sfu-controls.browser.cjs, sfu-controls.scenarios.cjs | 신규. 3인 제어·RTP·반복·경합 자동 검증 |
| scripts/media.browser.cjs | 기존 fixture 재사용, 획득한 과거 트랙도 보존해 ended 검증 |
| scripts/sfu-ws.test.cjs | 서버 제어·소유권·paused 생성·종료 경합 테스트 추가 |
| scripts/sfu-multi.scenarios.cjs | 원격 참가자 표시와 실제 수신 트랙 타일의 개수 구분 |
| package.json | test:sfu:controls:browser 추가 |
| README.md, docs/Concept.md, docs/PLAN.md, docs/Step10.md | 현행 정책·실제 결과·미검증 범위 |

기존 MediaPanel이 로컬 Stream을 소유하고, SFU Hook은 Producer에 stopTracks:false를 적용한다. 원격 Consumer 트랙은 별도 소유다. 프로필과 논리 방 상태를 복제하거나 새 소켓·worker를 만들지 않는다.

## 카메라 제어

OFF는 현재 시도의 Video Producer만 클라이언트·서버에서 닫고, 로컬 Hook이 해당 비디오 트랙의 ended listener를 제거한 뒤 stop·Stream.removeTrack을 수행한다. preview.pause와 srcObject=null로 참조도 제거한다. Audio Track·Audio Producer·Send/Recv Transport·원격 Consumer·논리 소속은 유지한다.

ON은 `{video:true,audio:false}`로 카메라만 획득한다. 기존 소유 Stream에 새 트랙을 추가하고 음소거 미리보기를 연결한 뒤 기존 Device·Send Transport로 새로운 Video Producer를 만든다. 마이크는 다시 요청하지 않는다. Step 09의 신규 원본 이벤트가 B/C의 새 Consumer 생성을 유도한다. SFU 원본만 외부에서 닫혀 로컬 비디오가 여전히 live인 경우에는 그 기존 트랙을 재사용할 수 있다. 정상 OFF 이후 ON은 반드시 새 트랙이다.

카메라 상태는 미획득·연결 중·송신 중·끄는 중·꺼짐·다시 켜는 중·실패·연결 종료로 구분한다. 초기 로컬 획득 진행·실패는 기존 로컬 미디어 상태에 표시한다. SFU 제어 오류는 별도로 표시한다.

획득 중 OFF는 새 카메라 세대를 무효화한다. 중복 ON은 Ref로 막고, 이전 권한 요청이 끝나기 전에는 새 요청을 시작하지 않는다. 권한 요청 자체는 취소할 수 없어 늦게 반환된 트랙을 즉시 정리한다. 방 전환·연결 종료·해제 때도 현재 시도와 카메라 세대를 확인한다. 새 Producer 생성까지 진행됐다면 취소된 Producer도 닫는다.

NotFoundError·NotAllowedError·NotReadableError 등은 기존 안내를 재사용한다. 카메라 획득/미리보기 실패는 해당 새 비디오만 정리하고 정상 마이크·원격 수신을 유지한다. 서버 종료 확인이 실패하면 정상 OFF로 숨기지 않고 전체 SFU 연결 정리를 시도한다. 로컬 마이크 원본의 소유권은 그대로다.

## 마이크 제어와 안전한 전환

음소거는 다음 순서다.

1. live Audio Producer와 실제 오디오 트랙을 확인한다.
2. 클라이언트 Producer.pause로 로컬 enabled=false를 적용한다. zeroRtpOnPause:true도 사용한다.
3. 기존 소켓으로 서버 producer.pause를 요청한다.
4. 서버가 실제 세션·소속·활성 roomId/mediaId·Transport·Producer 소유권과 audio kind를 검증한 뒤 native Producer.pause를 완료한다.
5. 성공 응답을 받은 뒤 음소거됨으로 확정한다. 원격 Consumer는 유지하며 SFU producerPaused 상태가 전달을 막는다.

해제는 로컬을 비활성화한 채 서버 resume 성공을 먼저 확인한 뒤 클라이언트 Producer.resume으로 enabled=true를 복구한다. Audio Producer ID와 기존 Consumer ID는 유지한다. 응답 오류·종료·늦은 응답이면 로컬 음소거를 유지하고 오류를 표시한다. 실패를 성공으로 표시하거나 로컬을 먼저 켜지 않는다. 실패 후에는 음소거를 다시 확인한 뒤 명시적으로 해제한다.

미획득·송신 중·음소거 처리 중·음소거됨·음소거 해제 중·오류·연결 종료를 구분한다. track.readyState가 ended면 성공 처리하지 않는다. 외부 장치 종료의 기존 로컬 Hook 오류·전체 정리 정책은 유지한다. 음소거는 장치 해제가 아니므로 마이크 트랙은 live 상태로 남는다.

음소거 의도는 MediaPanel 수명 동안 유지한다. 방 전환·SFU 재연결 때 새 Audio Producer를 **서버 생성 시점부터 paused:true**로 만들고 로컬 트랙도 미리 비활성화한다. 명시적 해제 없이 전환 중 음성이 전송되지 않는다. 페이지 새로고침은 새 상태지만 장치·SFU를 자동 시작하지 않는다.

카메라 OFF도 트랙 부재와 의도로 유지한다. 카메라만 사용하다 OFF하면 살아 있는 트랙이 0개가 되더라도, 명시적 방 전환은 장치를 자동 획득하지 않고 `ready` 송신 대기 상태를 허용한다. 이때 Send Transport의 ICE/DTLS는 첫 송신 전 new일 수 있다. ON을 누르면 그 Transport를 연결해 새 카메라를 송신한다.

## 원격 상태와 Signaling

기존 media.request에 producer.pause·producer.resume action을 추가했다. payload는 transportId와 producerId뿐이며 허용되지 않은 필드를 거절한다. 성공 응답은 producerId와 실제 paused다. 존재하지 않는/닫힌/타인/다른 방/이전 mediaId의 원본과 video kind 제어는 거절한다. 입력 4,096-byte 제한은 유지한다.

produce에는 audio에 한해 선택적 paused boolean을 허용한다. 기존 요청 형식도 유효하며, 서버가 초기 native Producer 생성에 적용한다. 영상에는 paused 필드를 받지 않는다. 기존 producer.close는 개별 카메라 원본 종료에 재사용한다.

`media.peers` 이벤트와 기존 producers 응답은 활성 방의 다른 참가자에 대해 participantId·sending·video·audio·muted를 전달한다. 단조 증가 revision으로 목록 응답이 늦게 도착해도 최신 상태를 덮어쓰지 않는다. roomId/mediaId를 확인하고 해당 활성 방에만 보낸다. 닉네임·아바타는 기존 공통 프로필에서 읽는다.

Consumer가 없어도 활성 참가자 표시를 유지한다. 카메라 OFF/미사용, 마이크 음소거, 미송신, 수신 전용을 구분한다. 실제 수신 트랙 수와 논리 방 참가자 수도 구분한다. 마이크 상태 이벤트는 클라이언트 Audio Consumer.pause/resume에도 반영하지만, 실제 전달 차단의 기준은 서버 Producer다. 음소거만으로 Consumer를 닫거나 재생성하지 않는다.

stats는 서버 Producer.paused·Consumer.producerPaused와 클라이언트 Producer.paused·trackEnabled·trackState를 표시한다. video는 video 요소, audio는 별도 audio 요소에서 재생해 중복 출력을 피하며 기존 자동 재생 오류/재생 버튼도 유지한다.

## 경합과 수신 전용 정책

같은 종류의 중복 제어는 Ref와 버튼 상태로 제한한다. 처리 중 비활성 버튼 클릭은 새 의도로 수락하지 않는다. 카메라 ON 중 OFF 취소는 별도로 수락한다. 마이크 제어와 카메라 생성/종료의 송신 RPC는 같은 시도의 큐로 직렬화하지만 카메라 권한 대기가 마이크 제어를 막지는 않는다. 기존 수신 큐와도 분리한다.

수신 전용에는 Send Transport·Producer가 없으므로 제어 버튼을 비활성화한다. 음소거 해제로 새 마이크를 획득하지 않는다. 처음 마이크를 송신하려면 기존 로컬 종류 선택·획득·SFU 송신 연결을 명시적으로 수행한다. 마이크 없이 카메라만 송신하는 사용자도 마이크 버튼은 비활성이다.

## 실행과 자동화

기존처럼 두 터미널에서 npm run dev:server, npm run dev:client를 실행한다. 로컬 미디어·방 참여·SFU 송신 연결 후 카메라 ON/OFF와 마이크 버튼을 사용한다. 로컬 전체 종료와 SFU 전체 종료는 별도 버튼이다.

```powershell
npm run typecheck
npm run build
npm run test:sfu:controls:browser # 개발 서버 종료 후 Chrome·Edge 3인 가상 장치
npm run test:sfu:ws
npm run test:sfu:multi:browser
npm run test:sfu:receive:browser
npm run test:sfu:browser
npm run test:media:browser
npm run test:media
npm run test:ws
npm run test:sfu
node --test scripts/chat-history.test.cjs
```

기존 fixture의 독립 임시 프로필·fake camera/mic·테스트 전용 IPC 계측을 재사용한다. Stream에서 제거한 과거 트랙도 별도 참조 배열에 보관해 실제 ended를 확인한다. 전용 프로필 경로와 소유 프로세스만 정리하며 사용자 브라우저 설정을 바꾸지 않는다.

## 검증 내용과 측정 한계

3인 audio/video의 기준 자원은 Send 3·Recv 3·Producer 6·Consumer 12다. A 카메라 OFF는 Producer 5·Consumer 10, ON은 다시 6·12이며 Transport ID는 유지한다. 새 카메라 Track ID와 Video Producer/Consumer ID를 확인하고, 마이크 트랙·Producer ID는 유지한다. 음소거는 6·12를 유지하며 paused 상태만 바뀐다. 서버 Map과 Router.dump의 실제 native 개수도 비교한다.

카메라 OFF/ON 5회 이상과 마이크 음소거/해제 5회 이상을 수행한다. 원격 RTP 패킷·바이트·framesDecoded 증가와 videoWidth·표시 프레임을 함께 확인한다. 단순 Consumer 생성이나 아이콘만으로 통과시키지 않는다.

음소거는 클라이언트 paused/track.enabled=false, 서버 Producer.paused, 원격 native Consumer.producerPaused=true와 기존 Consumer ID를 먼저 확인한다. 1초 통계 주기로 상태가 반영된 뒤 2.4초 관찰 구간에서 SFU outbound 오디오 패킷·바이트와 원격 inbound 패킷이 증가하지 않는지 비교한다. 해제 후 같은 ID에서 RTP 증가를 확인한다. 이 유한한 루프백 표본이 모든 네트워크의 무한 시간 무전송이나 실제 청취를 증명하지는 않는다. RTCP·다른 미디어 트래픽 전체가 0이라는 주장도 아니다.

교차 제어, 같은 참가자의 카메라/마이크 동시 조작, 두 참가자 독립 제어, 빠른 중복 클릭, 권한 대기 취소·종료·방 전환, 오류 후 재시도, 지연 pause 중 Transport/WS 종료, 음소거 전환과 수신 전용을 검증한다. 제어 중 장치 실패는 주입이며 물리 장치 장애와 구분한다.

### 최종 실행 결과

| 검증 | 결과 |
| --- | --- |
| strict 검사·Client/Server 빌드 | 통과 |
| SFU Signaling·제어·소유권·경합 | 18/18, 종료 코드 0 |
| HTTP·WS·프로필·방·채팅·payload | 단독 19/19, 종료 코드 0, 기존 1009 기대값 유지 |
| worker·Router | 5/5, 실제 생성·종료·실패·worker 사망 포함 |
| ChatHistory 기록기 | 26/26 |
| 로컬 미디어 단위 | 6/6 |
| Step 10 3인 브라우저 | 카메라 5회·마이크 5회 이상, RTP/프레임·ID·native 개수·권한 오류 주입·취소·교차 제어·방 전환·Transport/WS 종료 통과 |
| 카메라 OFF의 경계 조건 | 카메라 OFF 중 마이크 해제, 카메라만 사용하다 OFF 후 트랙 0개 전환·명시적 ON 통과 |
| 외부 Audio Track 종료 | ended 주입 시 기존 오류·정리, 음소거 해제 차단, 자동 재획득 없음, 명시적 로컬 획득·재연결 통과 |
| Step 09 브라우저 회귀 | 4개 독립 프로필의 3인 실제 RTP·프레임·반복·방 격리·Router 장애·자원 수 통과, 정상 종료 |
| Step 08 브라우저 회귀 | 양방향 실제 RTP·재생·수신 전용·자동 재생 차단/재개·재접속·worker 중단 통과, 정상 종료 |
| Step 07 브라우저 회귀 | 단일/동시 송신·명시적 전환·DTLS 실패·timeout·로컬 트랙 재사용 통과, 정상 종료 |
| Step 06 브라우저 회귀 | Chrome·Edge 단일/동시 획득 각 3회, 주입 오류·늦은 응답·중복 시작·StrictMode·해제·모든 트랙 ended 통과, 정상 종료 |

단위·서버 통합 테스트는 총 74개이며 브라우저 시나리오는 별도다. 마지막 Step 10 전체 실행은 종료 코드 0, browser runtime exception 0개였다. 추가 경계 검증 중 종료 코드를 확인하지 못한 실행은 정상 통과로 계산하지 않고 재실행했다. 물리 장치 테스트 성공으로 표시하지 않았다.

마지막 점검에서 관련 Node·worker·테스트 프로필 소유 Chrome/Edge 프로세스, 3000/4173/5173 리스너, fixture 임시 프로필은 모두 0개였다. 테스트 전용 일회성 로그도 정리한다. 기존 AGENTS·.codex·ChatHistory에는 변경이 없으며 CRLF를 고려한 git diff --check가 통과했다.

음소거 첫 관찰 구간에서 B/C의 SFU 오디오 outbound packetCount는 각각 1,185→1,185, 1,117→1,117이었고, 같은 Consumer의 브라우저 inbound packets도 그대로였다. 같은 구간의 native Producer.paused와 Consumer.producerPaused는 true였고 클라이언트 Producer.paused=true·track.enabled=false·track.readyState=live도 확인했다. 해제 후 같은 ID의 패킷이 다시 증가했다.

카메라 첫 재획득 후 B/C의 video packetsReceived는 29→145, 139→258, framesDecoded는 17→56, 55→95로 증가했다. 첫 음소거 해제 후 같은 Audio Consumer의 packetsReceived는 1,185→1,254, 1,232→1,332로 증가했다. 표본은 재실행마다 달라지며 다른 시점의 카운터를 서로 동일하다고 비교하지 않는다.

### 발견한 테스트 문제

초기 카메라 정리 검증은 이미 Stream에서 제거된 과거 트랙을 그 Stream에서 다시 찾으려다 실패했다. fixture가 모든 획득 트랙 참조를 보관하도록 수정해 ended 검증을 강화했다.

기존 consume/close 경합 테스트는 네트워크로 연속 전송한 두 요청 중 consume이 반드시 미완료일 것이라고 가정했다. consume이 먼저 정상 완료되는 경우도 유효하므로, 성공했다면 close 후 그 Consumer ID를 재개할 수 없고 native 자원 수가 기준으로 복귀하는지 확인한다. 취소 오류는 MEDIA_ERROR여야 한다. heartbeat 강제 종료 소켓의 마지막 알림 전달을 보장한다고 가정하지 않고, 살아 있는 다른 참가자의 이탈 이벤트와 native 자원 제거를 확인한다. 종료 코드 기대값을 1006으로 바꾸지는 않았다.

기존 WS·SFU·기록기 묶음 실행은 완료되지 않아 통과로 처리하지 않았다. 확인된 테스트 소유 프로세스를 정리한 뒤 WS를 단독 실행해 19/19·종료 코드 0, SFU·기록기를 별도 실행해 31/31·종료 코드 0을 확인했다. 이 기존 종료 대기 현상을 이번 기능 수정으로 해결했다고 주장하지 않는다.

## 실제 장치 수동 절차와 남은 위험

사용자의 현재 PC에는 물리 웹캠이 없고 이어폰 마이크가 있다. 이번에는 실제 장치 수동 검증을 생략했으며 다음 항목을 완료로 표시하지 않는다.

1. 서로 다른 사용자 3명이 헤드셋으로 같은 방에 연결한다. 실제 마이크를 명시적으로 획득하고 SFU 송신한다.
2. 한 사용자가 음소거할 때 다른 두 사람이 실제 소리 중단을 확인한다. 해제 후 같은 Producer/Consumer ID와 청취 재개를 확인한다.
3. 물리 웹캠이 준비되면 OFF 시 실제 track ended·장치 LED/점유 해제, ON 시 새 영상과 다른 두 사람의 재생을 확인한다.
4. 카메라 OFF·음소거 상태로 방을 전환해 자동 해제되지 않는지 확인한다. 종료 후 미디어 연결·장치 사용 표시도 확인한다.

가상 장치 성공을 실제 이어폰 마이크·음질·청취·카메라 점유 해제 검증으로 대체하지 않는다. LAN/NAT·다른 OS·Firefox/Safari·장시간/부하·모든 HMR 타이밍·실제 물리 네트워크 단절은 미검증이다. 기존 초과 payload 극단 반복의 간헐 1006 이력과 WS 자체 종료 후 종료 확인 실패 안내가 남을 수 있는 제약도 유지한다.

기존 소유 Hook과 Send Transport를 재사용하고 서버 pause를 실제 전달 차단 기준으로 삼았다. 활성 참가자 snapshot은 작은 로컬 실습에서 단순하지만 대규모 전체 상태 전송 최적화는 하지 않는다. Step 11에서 장치를 바꿀 때도 새 트랙 소유권과 이전 트랙 정리, 카메라 OFF·음소거 의도를 유지하고 재개 성공 전에 음성이 나가지 않도록 해야 한다.

AGENTS·기존 ChatHistory·자동 기록 설정을 유지하고 동일 대화를 수동으로 중복 기록하지 않는다. Git Commit·Push는 실행하지 않는다.
