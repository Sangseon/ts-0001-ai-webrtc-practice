# Step 13 — 예외 처리 및 전체 통합 인수 검증

## 목적·범위와 현재 판정

2026-11-02의 로컬 저장소 `89cd353`(Step 12까지 반영)를 기준으로 Concept 요구사항과 PLAN 인수 표를 실제 코드·테스트에 대조했다. 새 제품 기능이나 패키지는 추가하지 않았다. 기존 테스트를 순차 실행했고, 실제로 재현된 문제와 최초 실패를 재실행 결과와 함께 기록한다. 이 문서의 `PASS`는 명시된 검증 환경의 성공, `PARTIAL`은 일부 기준만 확인, `BLOCKED`는 물리 장치·사용자 환경 제약, `NOT RUN`은 실행하지 않은 검증, `FAIL`은 재현된 실패를 뜻한다.

Step 01~12에서 계획한 기능은 구현돼 있다. 이번에 실행한 로컬 자동화의 기능 단정과 실제 사용자 인수는 구분한다. WebSocket 테스트 러너가 한 번 본문 성공 후 종료되지 않아 **전체 자동화 검증은 PARTIAL**로 판단한다. 실제 물리 웹캠·마이크·상대 음성 청취·다른 PC 검증을 이번 요청에 따라 수행하지 않았으므로 **프로젝트 전체 인수는 보류**한다. Step 06·08·09·10·11·12의 기존 물리 인수 보류 상태도 유지한다.

## 실행 환경과 시스템 구성

- Windows 11 Home x64 `10.0.22631`, Node.js `24.22.1`, npm `12.2.1`, TypeScript `7.0.2` strict, React `19.3.1`, Vite `8.3.5`, ws `8.22.0`, mediasoup `3.32.0`, mediasoup-client `3.25.3`.
- Chrome `156.0.8078.74`와 Edge `156.0.4314.58`의 독립 임시 프로필. 로컬 `localhost`/`127.0.0.1`에서 가상 카메라·마이크를 사용했다. 장치 전환의 서로 다른 마이크 ID는 Mock이며 두 물리 마이크가 아니다. `--mute-audio`는 스피커 출력만 억제했고 RTP·Web Audio 입력 검증은 유지했다.
- `application.ts`의 HTTP `/health`와 단일 WebSocket `/ws`가 세션·프로필·방·채팅·Signaling을 처리한다. 실제 음성·영상은 `useSfuSender.ts`의 Send/Recv Transport와 `media.ts`의 단일 worker·논리 방별 Router를 통해 RTP로 전송한다. 참가자는 여러 논리 방에 소속될 수 있으나 실제 활성 미디어 방은 하나다. 채팅 화면 선택만으로 미디어 연결은 바뀌지 않는다.
- `useLocalMedia.ts`가 카메라·마이크 트랙을 소유하고 `useMediaDevices.ts`가 선택·전환을 관리한다. `useMicrophoneMeter.ts`는 공유 또는 테스트 전용 오디오 트랙을 Web Audio로만 분석하며 SFU 송신·서버 음소거 상태를 바꾸지 않는다.

## 요구사항 추적 및 PLAN 인수 판정

각 행의 테스트는 아래 실행 표에 적은 명령으로 **이번 작업에서 다시 수행**했다. 브라우저 검증은 가상 장치를 쓰는 실제 Chrome·Edge 실행이며 Mock·오류 주입·물리 인수와 구분한다.

| Concept/PLAN 요구사항 | 구현·시나리오·실제 증거 | 문제·최종 판정 |
| --- | --- | --- |
| 3인 SFU 영상·음성 | `server/src/media.ts`, `client/src/useSfuSender.ts`, `RemoteMedia.tsx`; 4개 브라우저 프로필의 A·B·C는 각자 다른 2명의 Audio/Video Consumer 4개, 총 12개를 가졌다. 브라우저·SFU RTP 증가, 비디오 수신 45→157 패킷·17→57 디코딩 프레임, 오디오 45→145 패킷을 관찰했다. ICE/DTLS와 원격 요소 재생도 브라우저 테스트에서 확인했다. | 가상 장치 실전 RTP는 PASS. 실제 세 사람의 영상 시청·음성 청취는 BLOCKED. **PARTIAL** |
| 전체·회의방 채팅 | `application.ts`, `rooms.ts`, `useSession.ts`, `Chat.tsx`; `test:ws`에서 전체 1회 전달, 방별 한정, 미참여·퇴장 후 차단, 작성자·시각 서버 확정, 위조 거절, HTML 텍스트 표시. 4인 브라우저에서 2222 채팅 중 1111 미디어 유지. | 로컬 자동화 **PASS** |
| 다중 회의방 소속·미디어 격리 | `rooms.ts`, `media.ts`, `MediaPanel.tsx`; A·B의 1111/2222 소속, C의 1111·D의 2222 연결, 특정 방 퇴장 후 다른 소속 유지, 명시적 전환, 다른 방 Producer/Consumer/Transport 접근 거절과 방별 Router 수 비교. | 로컬 자동화 **PASS**. 물리·LAN 회의는 별도 미검증 |
| 닉네임·아바타·세션 | `application.ts`, `useSession.ts`, `RemoteMedia.tsx`, `Chat.tsx`; 서로 다른 ID, 프로필 변경·잘못된 값 거절, 원격 타일·참가자 목록·기존 채팅 표시 동기화, 새로고침 후 새 ID와 자동 미디어 복원 없음. | 로컬 자동화 **PASS**. 중복 닉네임의 개별 UI를 이번에 별도 전용 사례로 실행하지 않아 그 세부 항목은 NOT RUN |
| 카메라 OFF/ON·마이크 음소거 | `useSfuSender.ts`, `MediaPanel.tsx`; 카메라 5회 종료·새 트랙/Producer 생성, 오디오·Recv 유지. 마이크 5회 pause/resume에서 Audio Producer·Consumer ID 유지, 서버 paused·원격 상태와 음소거 구간 Consumer 패킷 2095→2095·2030→2030 확인. | 가상 장치 PASS, 실제 카메라 영상·상대 음성 청취 BLOCKED. **PARTIAL** |
| 장치 목록·선택·전환 | `useMediaDevices.ts`, `useLocalMedia.ts`, `useSfuSender.ts`; 가상 카메라 2개와 Mock 마이크 A/B의 각 5회 교체·음소거 중 5회 교체, `replaceTrack` 후 Producer/Transport 유지와 원격 RTP 증가, 실패·장치 누락·devicechange 주입. | 다른 물리 장치와 실제 분리·재연결 BLOCKED. **PARTIAL** |
| 마이크 입력 레벨 | `useMicrophoneMeter.ts`, `microphoneLevel.ts`, `LocalMedia.tsx`; RMS 단위 3/3, Chrome·Edge 가상 마이크 실제 Web Audio 샘플의 표시값 3/100, 제어 무음/신호와 5회 정리, 음소거 중 서버 paused·RTP 차단 유지. | 실제 사람 발화에 따른 변화 BLOCKED. **PARTIAL** |
| 정상·비정상 종료와 자원 | `application.ts`, `media.ts`, 클라이언트 Hook; WebSocket 정상/terminate/heartbeat·4,096-byte 제한과 1009 Close, 재입장 5회, 새로고침 감지 282ms·탭 닫기 106ms(테스트 환경), 마지막 논리 방 종료 뒤 native 자원 0. | 해당 자동화 경로 PASS. 실제 외부망 단절·운영 30초 heartbeat 시간은 NOT RUN. **PARTIAL** |
| 오류 후 재사용 | 로컬 미디어의 권한 거부·없음·사용 중·늦은 응답·재시도, 수신 자동 재생 거절 후 명시적 재생, 잘못된 DTLS·worker/Router 종료·새 WebSocket 세션 뒤 수동 재연결을 주입 테스트. 서버 재시작은 `test:ws`의 새 애플리케이션에서 상태 초기화 확인. | 주입·로컬 경로 PASS. 물리 OS 권한 변경과 실제 LAN 오류 회복은 BLOCKED/NOT RUN. **PARTIAL** |

Concept의 채팅 범위와 프로필 동기화는 현재 자동화에서 충족했다. 3명 이상의 실제 음성·영상 확인, 물리 장치 제어·전환·발화 레벨은 가상 RTP·프레임·분석 성공만으로 충족되지 않는다. 따라서 Concept과 PLAN의 최종 완료 기준을 낮추지 않았다. 사용자 흐름은 `test:sfu:multi:browser`, 제어·장치·미터·WebSocket 테스트를 **순차 단계**로 조합해 검증했다. 요청에 허용된 방식이며, 20개 동작을 하나의 연속 브라우저 세션에서 모두 수행한 시험은 NOT RUN이다.

## 실행 명령·종료 코드와 실패 이력

| 명령 | 이번 실행 결과 |
| --- | --- |
| `npm run typecheck`, `npm run build` | 각각 종료 코드 0. Client/Server strict 검사·빌드 통과. Vite의 JS 청크 506.02 kB에 대한 500 kB 경고는 남는다. |
| `npm run test:ws` | **첫 실행 19개 본문 성공 뒤 러너가 종료되지 않아 수동 종료, 코드 -1**. 테스트 전용 Node 프로세스만 정리했다. 동일 명령 재실행은 종료 코드 0·19/19. `/health`, 프로필·방·채팅·4096-byte/1009 포함. 원인은 아직 확인하지 못했다. |
| `npm run test:sfu`, `npm run test:sfu:ws` | 각각 0·5/5, 0·18/18. worker/Router 생성·종료, Signaling 소유권·오류 경합과 300ms 테스트 heartbeat에서 정상 1.9ms, terminate 1.0ms, pong 미응답 560.9ms 감지. |
| `npm run test:media`, `npm run test:meter` | 각각 0·8/8, 0·3/3. Mock 입력·오류·정리와 PCM RMS 계산. |
| `node --test scripts/chat-history.test.cjs` | 0·26/26. 기록기 코드의 테스트 결과이며 이번 턴의 Stop Hook 저장 성공을 뜻하지 않는다. |
| `npm run test:media:browser` | 0. Chrome·Edge 가상 카메라·마이크 단독/동시, 종료·비동기 경합, 권한·장치 오류 주입. |
| `npm run test:sfu:browser` | 최초와 제한된 반복 실행 각각 0·2/2. 실제 ICE/DTLS·RTP 송신, 잘못된 자원 거절, 의도적 Signaling 8초 timeout 후 소켓 종료. Step 11의 간헐적 실패는 이번 2회에 재현되지 않았으며 해결됐다고 판단하지 않는다. |
| `npm run test:sfu:receive:browser` | 0. 2인 양방향·수신 전용·영상 프레임, 자동 재생 거절과 명시적 재시도, SFU worker 중단 후 채팅 보존. |
| `npm run test:sfu:multi:browser` | 0. 4개 프로필, 3인 12 Consumer·RTP/프레임 증가, 5회 재입장·방 격리·native 자원 수·서버 종료. |
| `npm run test:sfu:controls:browser` | 0. 카메라·마이크 5회씩, 음소거 중 원격 패킷 정지와 해제 후 재개, 수신 전용·방 전환. |
| `npm run test:sfu:devices:browser` | 0. 가상 카메라 2개·Mock 마이크 교체, 음소거 중 교체·취소·실패·원격 RTP. |
| `npm run test:meter:browser` | 0. 가상 마이크 Web Audio·제어 신호, 공유/전용 트랙·음소거 격리·분석 자원 정리. |

Step 07 timeout 시나리오는 기존 `scripts/sfu-browser.scenarios.cjs`에서 `capabilities` 요청을 고의로 누락하고, `useSession.ts`의 8초 요청 타이머가 `socket.close()`를 호출한 뒤 화면의 종료 상태를 최대 약 15초 기다린다. 이번 2회는 성공했지만 과거 한 번의 실패는 재실행 통과로 지워지지 않는다. 요청 타이머와 WebSocket Close 핸드셰이크 완료 시점이 다를 수 있고 기존 대기 한도가 충분한지 아직 확인되지 않았다. 근본 원인 없이 타이머를 임의로 늘리거나 제품 종료 정책을 바꾸지 않았다.

첫 `test:ws`의 본문 성공·러너 비종료도 PASS로 합치지 않는다. 독립 재실행이 통과해 기능 회귀는 재현되지 않았으나, 열린 핸들·테스트 종료 경합의 원인을 아직 특정하지 못했다. 이 간헐적 정리 문제와 Step 07 timeout은 후속 재현 시 이벤트·소켓 상태를 계측해 별도로 해결할 대상이다.

## 자원·예외 처리 판정과 한계

`test:sfu:multi:browser`의 3인 정상 상태는 참가자당 4개 Consumer이며, C의 5회 종료·재입장 뒤 기대 Map/native 수가 반복해서 일치했다. 마지막 논리 방이 사라진 상태의 slot·Router·Send/Recv Transport·Producer·Consumer는 모두 0이었다. 다른 논리 참가자가 남은 방의 Router는 현재 정책상 유지될 수 있으므로 누수로 세지 않는다. 테스트 종료 후 브라우저 PeerConnection과 소유 로컬 트랙도 닫힘/ended였다. 테스트 heartbeat 300/500ms와 운영 기본 30초는 구분한다. 실제 물리 네트워크 절단 시간은 측정하지 않았다.

잘못된 JSON·필드·프로필·작성자·방·SFU 자원 ID를 서버에서 거절하고 정상 세션과 다른 방 상태를 유지하는 경로가 통과했다. 4,096-byte 초과 종료의 1009는 `test:ws` 재실행에서 확인했다. 장치 권한·부재·점유, `getUserMedia` 지연·취소, `replaceTrack` 실패, AudioContext 오류, 자동 재생 거절은 **주입/가상 브라우저 검증**이다. 실제 OS 권한 대화상자, 물리 장치 분리, 사람이 듣는 음성과 영상은 이번에 수행하지 않았다.

가상 장치 테스트가 검증하지 못한 항목은 물리 웹캠 영상·실제 이어폰 마이크 발화/청취·세 실제 사람의 상호 회의·두 물리 카메라/마이크 사이 전환·물리 장치 분리/재연결·다른 PC LAN/NAT·장시간 부하다. 사용자가 수동 검증을 생략했고 현재 PC에는 물리 웹캠이 없다. Step 06에서 사용자가 보고한 이어폰 마이크 단독 획득은 기존 기록으로 보존하되 이번 인수에서 재확인했다고 표시하지 않는다. 물리 장치가 준비되면 PLAN의 인수 표 순서로 세 독립 사용자·헤드셋을 사용해 영상, 상대 청취, 발화 미터, 장치 전환·분리·재연결 및 오류 후 명시적 재시도를 확인해야 한다.

## 설계 회고와 최종 판단

하나의 WebSocket에서 채팅·상태·SFU 제어를 처리하고 실제 RTP는 mediasoup SFU로 분리했다. 단일 worker와 방별 Router는 로컬 실습의 자원 관계를 단순하게 한다. 방별 논리 소속과 단일 활성 미디어 방을 구분해 다른 방 채팅을 유지하면서 미디어 자원은 한 방에만 할당한다. 로컬 트랙 소유권은 클라이언트에 두고 `stopTracks:false`로 SFU 종료·방 전환과 장치 종료를 분리했다. 서버 메모리 상태, 단일 worker, 자동 재연결·영속화·TURN 부재는 로컬 학습 범위의 제약이다. 이번 재검증은 RTP 카운터·디코딩 프레임과 실제 청취가 서로 다른 증거라는 점, 그리고 테스트 본문 성공과 프로세스 정상 종료를 따로 판단해야 한다는 점을 확인했다.

**판정:** 계획된 기능 구현은 완료. 실행한 기능별 브라우저·서버 자동 검증은 첫 WebSocket 러너 비종료 때문에 전체 PASS로 합치지 않고 PARTIAL. 실제 물리 장치 인수는 BLOCKED/NOT RUN. 프로젝트 전체 완료는 보류한다. 문서로 현재 변경을 커밋할 수는 있으나 이 미해결 이력과 물리 인수 보류를 함께 남겨야 한다.
