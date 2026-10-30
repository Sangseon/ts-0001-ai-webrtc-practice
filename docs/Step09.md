# Step 09 — 동적 다자간 미디어와 종료 생명주기

## 범위와 완료 판단

2026-10-30, Step 08의 참가자별 활성 슬롯·Producer 발견·Recv Transport·Consumer 구조를 재사용해 동적 다자간 송수신과 자원 정리를 보강했다. 여러 논리 방 소속과 채팅, 참가자당 단일 활성 미디어 방, 명시적인 수신 전용 연결 정책은 유지한다.

Chrome 2개·Edge 2개의 독립 프로필로 A/B/C의 3인 상호 RTP 수신·영상 프레임과 다른 방 D의 격리를 검증한다. 3명이 각각 audio/video를 송신하면 자기 자신을 제외한 다른 두 사람의 Consumer 4개씩, 총 12개다. Producer 수가 달라지면 기대 Consumer 수도 조정한다.

실제 음성 청취·물리 웹캠은 검증하지 않았다. **Step 09는 구현·가상 장치 검증 범위와 실제 청취 인수를 구분하며 전체 완료는 보류한다.** Step 06의 물리 장치 검증 보류, Step 07 완료, Step 08의 실제 청취 대기 상태는 변경하지 않는다. Step 10의 카메라 ON/OFF·음소거 UI나 장치 선택은 구현하지 않았다.

## 환경·참고 자료

Windows, Node.js 24.22.1, npm 12.2.1, TypeScript 7.0.2 strict, React 19.3.1, Vite 8.3.5, ws 8.22.0, mediasoup 3.32.0, mediasoup-client 3.25.3을 사용한다. 추가 패키지·시스템 설치·권한/방화벽 변경은 없다. 주소는 기존 127.0.0.1, 미디어 UDP/TCP 40000~40100이다.

가상 장치 브라우저는 Chrome 156.0.8078.49와 Edge 156.0.4314.50이며, 각각 별도 임시 프로필의 headless 세션을 사용했다.

[mediasoup API](https://mediasoup.org/documentation/v3/mediasoup/api/), 실제 설치된 RouterDump/WorkerDump 타입과 observer 종료 동작을 확인했다. [AI Task Prompt Convention](https://github.com/Sangseon/00-conventions/blob/master/docs/ai-task-prompt.md)도 접근해 확인했으며 현재 코드·검증 범위를 우선했다.

## 기존 구조와 변경

기존 Consumer Map은 2명으로 제한돼 있지 않았다. 별도 다자간 서비스나 전역 상태를 도입하지 않고 같은 경로로 여러 원격 Producer를 구독한다.

| 파일 | 변경 |
| --- | --- |
| server/src/media.ts | producer.close를 개별 원본 종료로 구체화, 송신자에게도 원본 종료 통지, in-process native 자원 계측 |
| server/src/application.ts | 기본 비활성 inspectMedia 옵션. 테스트에서만 snapshot/Router·Transport 장애 주입 접근 허용 |
| client/src/useSfuSender.ts | 자기 Producer 종료 반영, 닫힌 Producer 통계 경합 처리, 종료 이벤트 임시 식별자 정리, roomId/mediaId 확인 |
| client/src/App.tsx, MediaPanel.tsx | Step 표시와 논리 참가자 수와 구분되는 원격 참가자·트랙 개수 |
| scripts/sfu-ws.test.cjs | 3인 native 자원 개수·반복·종료·heartbeat·생성 중 퇴장 검증 추가, 기존 heartbeat fixture 순서 수정 |
| scripts/media.browser.cjs | 4개 독립 세션과 테스트 IPC fixture 재사용, 정확한 임시 프로필 경로로 잔류 브라우저 정리 |
| scripts/sfu-multi-server.cjs | 신규. 테스트 소유 서버와 Node IPC 계측. HTTP/WS 진단 API는 없음 |
| scripts/sfu-multi.browser.cjs, sfu-multi.scenarios.cjs | 신규. 실제 다자간 RTP·영상·방 격리·동적 자원 개수 시나리오 |
| package.json | test:sfu:multi:browser 추가 |
| README.md, docs/PLAN.md, docs/Step09.md | 실제 구현·검증 범위·미완료 상태 기록 |

기존 useSession·공통 메시지 타입·JSON 검증·4,096-byte 제한·프로필·회의방·채팅 저장 구조는 유지한다. RemoteMedia의 participantId별 그룹과 재생 제어도 그대로 재사용한다. Concept의 다중 소속·단일 활성 방 정책과 충돌하지 않아 Concept은 변경하지 않았다.

## Producer 발견과 소비 관계

활성 미디어 연결은 participantId와 roomId/mediaId에 귀속된다. 방별 Router에서 참가자당 Send/Recv Transport를 구분하고, Producer는 송신 슬롯, Consumer는 수신 슬롯이 소유한다. 수신 전용은 Recv Transport만 생성한다.

1. 논리 방 입장만으로 장치나 미디어 연결을 생성하지 않는다.
2. 명시적인 연결 시 Device·Transport를 준비하고 기존 원격 Producer 목록을 조회한다.
3. 같은 활성 방의 신규 Producer 이벤트도 수신한다. ID별 pending 집합과 Consumer Map이 목록·이벤트 중복과 연속 생성을 제어한다.
4. 서버는 실제 연결 세션·소속·활성 방·원본 송신자·수신 Transport 소유권·canConsume을 검증한다. 소비 가능한 각 Producer에 paused Consumer를 생성한다.
5. 브라우저 consume 준비 뒤 서버 resume을 요청한다. 자기 자신의 Producer와 다른 방의 Producer는 소비하지 않는다.
6. 종료된 원본·Consumer ID는 초기 목록/진행 중 요청과의 경합을 막는 동안만 보관하고, 목록 조회와 대기 생성이 끝나면 임시 기록을 해제한다. 목록 응답 전에 종료된 원본을 발견 Map에 다시 삽입하지 않는다.
7. 모든 비동기 단계는 현재 시도 객체와 mediaId/roomId를 확인한다. 오래된 시도의 응답·이벤트는 새 연결을 변경하지 않는다. 서버도 종료 ID를 재사용하지 못하게 한다.

서버 수신 작업은 슬롯별로 직렬화하며 다른 참가자의 작업을 막지 않는다. 클라이언트 큐가 여러 원본의 consume→resume 순서를 관리한다. 종료는 송수신 양쪽의 진행 중 native 작업 완료를 기다린다. 아직 native 결과가 돌아오지 않았더라도 슬롯은 먼저 비활성화하므로 늦은 결과는 닫힌다.

## 개별 원본 종료와 전체 종료

Step 08 당시 producer.close는 전체 슬롯을 닫았다. Step 09에서는 같은 요청 형식을 유지하면서 **해당 Producer만** 닫는다. 전체 종료는 기존 close action을 사용한다. 개별 원본 종료 후 다른 종류·수신 연결·논리 소속·채팅은 유지한다. 자기 Producer 종료도 송신자에게 알려 클라이언트 객체·표시·통계에서 제거한다. 닫힌 Producer의 동시 getStats 실패를 전체 활성 연결 장애로 오인하지 않는다.

원본 종료 시 SFU의 producerclose로 해당 원본을 소비하던 Consumer를 닫고 수신자에게 알린다. 오디오와 비디오는 같은 participantId 타일로 묶이며 한 종류만 사라지면 다른 종류는 유지한다. 모두 사라지면 미디어 타일만 없어지고 논리 참가자 목록은 유지한다. 프로필은 기존 공통 상태를 읽어 변경 사항을 반영한다.

이 개별 종료는 수명주기 처리이며 송신 중 ON/OFF나 pause/resume 사용자 정책을 추가한 것이 아니다. 브라우저 테스트는 기존 제어 요청을 직접 보내 원본 종료를 검증한다. 해당 UI·재개·음소거 정책은 Step 10에서 결정한다.

전체 미디어 종료·활성 방 퇴장·전환·WebSocket 종료·heartbeat·Transport/Router/worker 장애·컴포넌트 해제는 해당 참가자의 송수신 자원을 정리한다. 로컬 원본 트랙은 SFU 종료로 stop하지 않는다. 로컬 미디어 종료 버튼은 실제 획득한 트랙을 중지한다. 다른 논리 방 퇴장·채팅 화면 변경은 활성 미디어에 영향을 주지 않는다.

## 방·연결 생명주기

- Router는 방의 첫 capabilities/미디어 요청 때 지연 생성한다. 미디어 송신자가 0명이 돼도 논리 방이 남아 있으면 Router를 유지한다. 수신 전용만 남은 상태는 유효하다.
- 마지막 논리 참가자 퇴장 때 그 방 Router와 관련 자원을 정리한다. 다른 방 Router와 공유 worker는 닫지 않는다.
- 논리 방이 0개여도 지연 생성된 worker는 서버 수명 동안 대기한다. 전체 서버 종료 때 worker의 subprocess 종료까지 확인한다. 방이 비었다는 이유로 공유 worker를 재시작하지 않는다.
- 한 Router 장애는 그 방 슬롯만 종료한다. 논리 소속·채팅은 남으며 명시적 새 연결로 Router를 다시 생성할 수 있다.
- worker 장애는 공유 worker의 모든 미디어에 영향을 준다. 자동 worker 복구는 없으며 기존 Step 08 동작을 유지한다.
- WebSocket 정상/강제 종료·heartbeat는 같은 멱등 세션 제거 경로를 거쳐 모든 소속과 소유 미디어를 정리한다. 클라이언트의 close RPC 도착만 전제로 삼지 않는다.
- 새로고침·재접속은 새 participantId다. 기존 방 소속이나 로컬 획득·SFU 송신을 자동 복원하지 않는다. 다시 방에 참여하고 명시적으로 시작해야 한다.

## 내부 자원 계측

기본 createApplication의 diagnostics는 undefined다. 테스트가 inspectMedia:true로 만든 프로세스에서만 세션·논리 방·슬롯·Router·Send/Recv·Producer·Consumer 관계를 확인한다. 외부 HTTP/WS에 상태 조회나 장애 주입 API를 추가하지 않았다. 브라우저 fixture의 전용 자식 서버는 부모 Node IPC로만 검사한다.

JS Map 개수뿐 아니라 worker.dump의 routerIds와 각 Router.dump의 transportIds, mapProducerIdConsumerIds, mapConsumerIdProducerId를 대조한다. native Consumer의 원본 Producer와 송신자·수신자가 서로 다르고 같은 방에 속하는지도 검사한다. 종료/생성 요청이 처리 중인 순간은 스냅샷이 원자적이지 않으므로 pending/draining이 0이고 기대 자원 수가 안정된 뒤 비교한다.

| 상태 | 슬롯 | Router | Send | Recv | Producer | Consumer |
| --- | --- | --- | --- | --- | --- | --- |
| 논리 방 2개, 미디어 미연결 | 0 | 0 | 0 | 0 | 0 | 0 |
| A/B/C 모두 audio/video, D는 다른 방 video | 4 | 2 | 4 | 4 | 7 | 12 |
| C 미디어만 종료, 논리 소속 유지 | 3 | 2 | 3 | 3 | 5 | 4 |
| C 재연결 | 4 | 2 | 4 | 4 | 7 | 12 |
| B audio만, C video만 | 4 | 2 | 4 | 4 | 5 | 8 |
| C 수신 전용, A audio/video, B audio | 4 | 2 | 3 | 4 | 4 | 6 |
| A가 활성 1111 퇴장, 2222 소속 유지 | 3 | 2 | 2 | 3 | 2 | 1 |
| A가 D의 2222에 명시적으로 연결 | 4 | 2 | 3 | 4 | 4 | 4 |
| 2222 Router 장애, 1111 B/C 유지 | 2 | 1 | 1 | 2 | 1 | 1 |
| 1111 삭제 후 2222 A/D만 미디어 연결 | 2 | 1 | 2 | 2 | 3 | 3 |
| 모든 논리 방 삭제·전체 종료 | 0 | 0 | 0 | 0 | 0 | 0 |

## 실행·자동 검증

기존 두 터미널에서 npm run dev:server와 npm run dev:client를 실행한다. Chrome·Edge 별도 프로필의 세 참가자가 같은 방에 참여하고 로컬 미디어·명시적 SFU 연결을 시작하면 다른 두 참가자의 타일과 수신 통계를 확인할 수 있다. 장치가 없으면 수신 전용을 선택한다.

```powershell
npm run typecheck
npm run build
npm run test:sfu:multi:browser   # 개발 서버 종료 후 실행, Chrome 2개·Edge 2개
npm run test:sfu:ws             # native worker·소유권·경합·개수·종료 테스트
npm run test:sfu:receive:browser # Step 08 2인 수신·재생 회귀
npm run test:sfu:browser         # Step 07 송신 회귀
npm run test:media:browser       # 로컬 미디어 가상 장치·주입 오류 회귀
npm run test:media
npm run test:ws
npm run test:sfu
node --test scripts/chat-history.test.cjs
```

브라우저 테스트는 별도 임시 프로필의 fake camera/mic를 사용한다. 입력 허용이나 장치 실패 주입은 물리 권한·장치 검증과 구분한다. 실제 OS·사용자 브라우저 설정을 바꾸지 않는다.

## 검증 범위와 관찰

3인 테스트는 A→B→C, C→A→B, 거의 동시 시작을 검사한다. 모든 원격 Consumer의 원본 ID가 서버 상태와 일치하고 자기 소비가 없으며, 브라우저 수신 패킷·바이트와 SFU outbound 수치가 증가하는지 확인한다. 각 video의 framesDecoded 증가와 videoWidth·실제 재생 프레임도 확인한다. 한 참가자마다 타일 2개, Consumer 4개를 기대한다.

실행 표본의 브라우저 수신 패킷·디코딩 프레임은 다음과 같다. 각 참가자의 4개 경로를 모두 확인했으며 UI 통계 주기는 1초, 비교 시 대기는 2.2초다. 시각·헤더/RTX 차이로 SFU와 브라우저 수치가 같다고 가정하지 않는다.

| 수신자 | 첫 원격 audio/video packets | 두 번째 원격 audio/video packets | video framesDecoded |
| --- | --- | --- | --- |
| A | 51→151 / 49→163 | 29→129 / 25→142 | 20→60, 11→50 |
| B | 141→241 / 161→276 | 118→218 / 130→250 | 56→96, 46→86 |
| C | 255→355 / 294→410 | 254→354 / 293→410 | 101→141, 101→142 |

C 종료·재연결은 브라우저에서 5회, Node native 테스트에서도 5회 반복해 같은 기준 개수로 복귀하는지 확인한다. 단일 원본만 종료·모든 원본 종료 후 수신 유지, 공통 프로필 갱신, 오래된 시도 이벤트, 중복 Producer 이벤트, 취소된 수신 요청의 늦은 전송, Producer 생성 중 논리 퇴장도 다룬다.

다중 방은 A/B가 1111·2222, C는 1111, D는 2222에 참여한다. A/B/C는 1111, D는 2222에서만 미디어 연결한다. 2222·전체 채팅 화면 전환과 전송은 1111 활성 연결을 유지한다. A가 활성 방을 퇴장하면 B/C 송수신이 유지되고 A의 2222 소속·채팅은 유지된다. 2222 Router 장애 때도 1111 RTP가 계속 증가하는지 검사한다.

### 비정상 종료 감지 시간

측정은 로컬 루프백의 종료 동작부터 다른 참가자의 이벤트 또는 native 자원 기준 복귀까지다. 한 실행의 표본이며 운영 지연 보장이 아니다.

| 시나리오 | 관찰 |
| --- | --- |
| Node WS 정상 close | 약 1.4ms |
| Node WS terminate | 약 1.1ms |
| 의도적 pong 미응답 | 약 571.8ms, 테스트 heartbeat 300ms |
| 브라우저 새로고침 | 약 277ms |
| 실제 탭 닫기 | 약 103ms |

운영 heartbeat는 기존 30초다. 끊김이 즉시 드러나지 않는 경우 주기 위상에 따라 보통 30~60초 뒤 제거하며 이벤트 루프 지연이 더해질 수 있다. 이 30초 설정의 실제 물리 네트워크 차단 시간은 측정하지 않았다. 테스트 heartbeat 300/500ms는 검증 전용이며 운영 설정을 바꾸지 않는다. Node terminate·pong 미응답·Router/Transport 강제 종료는 실제 패킷 유실이나 케이블 분리와 같지 않다.

초기 기존 heartbeat 테스트는 pong 미응답 클라이언트가 worker 지연 기동 중 먼저 종료돼 수신 슬롯 정리 이벤트를 기다리다 실패했다. worker 기동 이후 그 클라이언트를 연결하도록 fixture 순서를 수정했다. 임의의 운영 지연이나 재시도로 숨기지 않았다.

초기 다자간 브라우저 실행 두 번은 기능 본문을 통과했지만, 탭 닫기로 CDP 채널이 사라지고 실행기에서 넘긴 브라우저 프로세스가 임시 프로필을 잡아 EBUSY로 종료됐다. 이 실행은 정상 통과로 계산하지 않는다. 테스트가 만든 정확한 프로필 경로에 속한 브라우저 프로세스만 정리하도록 fixture를 보강했다. 남은 프로필은 절대 경로를 검증한 뒤 제거했다.

### 최종 자동 검증 결과

| 항목 | 실제 결과 |
| --- | --- |
| TypeScript strict·Client/Server 빌드 | 통과 |
| SFU Signaling·동적 native 자원 | 16/16, 종료 코드 0. 기존 10개와 Step 09의 6개 |
| 기존 WS·프로필·방·채팅·/health·payload | 19/19, 1009 검증 포함 |
| 기존 SFU worker·Router | 5/5, 실제 생성·종료·worker 사망·실패 처리 포함 |
| ChatHistory 기록기 | 26/26 |
| 선택형 로컬 미디어 단위 | 6/6 |
| 다자간 브라우저 | 정리 보강 후 전체 1회 정상 종료. 3인 양방향·4개 독립 세션, 초기/후입장·동시 시작·C 재연결 5회·방 격리·Router 장애·새로고침·탭 닫기 통과 |
| Step 08 브라우저 회귀 | 2인 실제 RTP·프레임·초기/신규 발견·수신 전용·자동 재생 차단/재개·WS 재연결·worker 중단 통과, 종료 코드 0 |
| Step 07 브라우저 회귀 | Chrome·Edge 단일/동시 송신 RTP·전환·잘못된 DTLS·종료 실패·요청 timeout 통과, 종료 코드 0 |
| 로컬 미디어 브라우저 회귀 | Chrome·Edge 단일/동시 획득 각 3회, 미선택·주입 오류·늦은 응답·컴포넌트 해제·StrictMode·트랙 ended 통과, 종료 코드 0 |

WS·SFU 독립 검증·기록기 묶음 실행은 50/50으로 정상 종료했고, 별도 Signaling 16개와 로컬 미디어 단위 6개를 포함해 72개 테스트가 통과했다. 브라우저 테스트는 이 개수와 별도다. 모든 브라우저 시나리오의 runtime exception은 0개였다. 기능 본문만 통과했던 EBUSY 실행이나 수정 전 heartbeat 실패를 정상 통과 횟수에 포함하지 않았다.

최종 점검에서 테스트 관련 Node·mediasoup worker·임시 프로필 소유 Chrome/Edge 프로세스, 3000/4173/5173 리스너, fixture 임시 프로필은 모두 0개였다. 정상 종료한 다자간 fixture의 snapshot은 세션·논리 방·활성 슬롯·native Router가 0이며 worker도 닫힌 상태였다. 과거 ChatHistory 파일은 수정하지 않았고 CRLF를 고려한 git diff --check도 통과했다.

## 물리 장치·미검증 사항·Step 10

실제 이어폰 마이크 획득에 대한 Step 06 사용자 기록은 유지한다. 이번 Step에서 실제 사용자 3명의 음성을 청취하거나 물리 웹캠을 검증하지 않았다. 가상 마이크 RTP와 브라우저 오디오 재생은 실제 스피커 출력·음질·에코 성공을 뜻하지 않는다. 물리 장치가 준비되면 세 사용자·헤드셋으로 각각 다른 두 사람의 음성 청취와 반복 퇴장·재입장을 수동 확인해야 한다.

LAN/NAT·TURN·다른 PC·Firefox/Safari·긴 시간/고부하·실제 네트워크 단절·모든 HMR 타이밍은 미검증이다. 기존 payload 극단 반복에서의 간헐 1006 이력을 이번 변경으로 해결했다고 주장하지 않는다. WebSocket 자체 종료 후 media.close 응답 확인 실패 안내가 남을 수 있는 기존 제약도 유지한다.

작은 서버 Map·단일 worker·방별 Router·수신 큐를 유지해 소유권과 정리 경로를 추적하기 쉽게 했다. 순차 consume은 대규모 병렬 구독보다 단순하지만 대규모 지연·확장성을 보장하지 않는다. 진단용 덤프는 테스트 내부에서만 사용한다. Step 10은 개별 Producer 종료와 사용자 제어 정책을 구분하고 pause/resume·새 Producer·상대 상태 동기화 정책을 해당 단계에서 결정해야 한다.

기존 AGENTS·자동 기록 설정과 ChatHistory를 보존하고 대화를 수동 중복 기록하지 않는다. Git Commit·Push는 실행하지 않는다.
