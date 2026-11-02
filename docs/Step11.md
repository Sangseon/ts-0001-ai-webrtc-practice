# Step 11 — 카메라·마이크 장치 목록 조회 및 전환

## 목적과 현재 상태

회의 중 카메라·마이크 입력 장치를 바꾸되 기존 SFU 연결과 제어 의도를 유지한다. 장치 조회·선택·트랙 전환을 구현했고, Windows 루프백에서 가상 카메라와 Mock 마이크 선택을 실제 RTP 경로로 검증했다. **서로 다른 물리 장치의 전환·실제 청취는 미검증이므로 PLAN의 전체 완료 기준은 보류**한다. Step 06·08·09·10의 기존 물리 검증 보류도 유지한다.

장치 입력만 다룬다. 출력 장치, 입력 레벨 분석, 화면 공유·녹화, 미디어 회의방 정책 변경은 포함하지 않는다. 신규 패키지·설치·버전 변경은 없다.

## 환경과 변경 파일

2026-11-02 실행 환경: Windows, Node.js 24.22.1, npm 12.2.1, TypeScript 7.0.2 strict, React 19.3.1, Vite 8.3.5, ws 8.22.0, mediasoup 3.32.0, mediasoup-client 3.25.3. Chrome 156.0.8078.74, Edge 156.0.4314.58을 사용했다. 기존 설치 버전과 로컬 Producer 구현을 확인했다. 프로젝트 문서와 접근 가능한 AI Task Prompt Convention Draft를 검토했다.

- 신규 `client/src/useMediaDevices.ts`: 입력 목록·선택·변경 이벤트·조회 세대 관리.
- 수정 `useLocalMedia.ts`: deviceId 조건, 실제 트랙 정보, 교체 후 소유권 이전·정리.
- 수정 `useSfuSender.ts`: Producer.replaceTrack와 현재 시도·종류별 제어 경합 관리.
- 수정 `LocalMedia.tsx`, `MediaPanel.tsx`, `App.tsx`: 장치 선택·적용·실제 사용 표시와 Step 안내.
- 신규 `scripts/devices.fixture.cjs`, `sfu-devices.browser.cjs`, `sfu-devices.scenarios.cjs`: 테스트 전용 장치·오류 주입과 3인 검증.
- 수정 `scripts/media.test.cjs`, `media.browser.cjs`, `package.json`: 단위 테스트·기존 브라우저 하네스 재사용·실행 명령.
- 수정 `scripts/sfu-receive.scenarios.cjs`: 미디어 정리와 WebSocket close UI 갱신을 별도 조건으로 대기.
- 수정 `README.md`, `docs/Concept.md`, `docs/PLAN.md`, 신규 이 문서.

서버·프로토콜·worker 구조와 기존 Step 문서는 변경하지 않았다. 새 운영 API나 서버 장치 저장소도 없다.

## 목록·권한·선택 정책

`enumerateDevices()` 결과에서 videoinput·audioinput만 분류한다. 같은 종류의 중복 deviceId를 제거하고, 이름이 비어 있으면 대체 이름과 권한 제한 안내를 표시한다. ID가 비어 있는 항목은 목록에 장치가 보인다는 사실과 실제 명시 선택 가능 여부를 구분한다. 기본 장치 옵션은 항상 제공한다.

조회 자체는 getUserMedia를 호출하지 않는다. Secure Context/API 미지원, loading·ready·조회 오류, 조회된 장치 없음, 선택 ID가 사라진 상태를 표시한다. 권한 전에는 label·ID·목록이 제한될 수 있으며, 빈 목록을 모든 장치 부재나 권한 거부로 단정하지 않는다. 획득 요청의 NotAllowedError 등은 기존 로컬 오류 안내로 구분한다. 권한 허용 여부를 빈 label만으로 확정하지 않는다.

조회는 마운트·새로고침·획득/교체 종료·devicechange에서 수행한다. 같은 이벤트 루프의 devicechange를 합치고, 조회 세대 번호로 오래된 결과를 버린다. 해제 시 타이머·리스너를 제거한다. StrictMode는 장치 목록을 다시 조회할 수 있지만 자동 미디어 획득을 하지 않는다.

선택 ID는 React 메모리에만 둔다. 새로고침·새 컴포넌트에서는 기본 선택이며 영속 저장하지 않는다. 선택값, 브라우저 기본 장치, 실제 track.getSettings().deviceId·label·track ID를 별도 표시한다. ID는 서버나 다른 참가자에게 전달하지 않는다.

| 선택 | 획득 조건 |
| --- | --- |
| 브라우저 기본 | 해당 종류 true, 브라우저가 그 요청 시점의 기본 장치를 결정 |
| 명시 장치 | 해당 종류 `{ deviceId: { exact: selectedId } }` |
| 선택하지 않은 종류 | false |
| 두 종류 모두 미선택 | getUserMedia 호출 없음 |

명시 ID 오류는 기본 장치로 자동 우회하지 않는다. 기본 선택을 사용하더라도 이미 획득한 트랙을 운영체제 기본값 변경만으로 자동 교체하지 않는다. 이후 사용자가 적용·재획득할 때 브라우저 정책을 사용한다. `default` 등 브라우저 별칭의 실제 장치는 getSettings 표시로 확인한다.

## 카메라·마이크 교체 흐름과 소유권

UI는 **선택 후 별도 적용** 정책이다. 선택만으로 획득하거나 회의방을 바꾸지 않는다. 동일 종류 적용 중에는 선택·적용을 잠그며 중복 요청을 즉시 거절한다. 카메라 OFF·전체 종료는 대기 중 작업을 취소할 수 있다.

1. live인 기존 소유 트랙이 있어야 적용할 수 있다.
2. 해당 종류만 새로 획득하고 종류·개수·readyState를 검사한다. 기존 트랙은 계속 유지한다.
3. `useSfuSender`는 현재 Attempt·Producer·카메라 제어 세대를 확인한다.
4. 송신 중이면 기존 Producer.replaceTrack을 기다린다. 로컬 미리보기만 사용하면 SFU 작업 없이 진행한다.
5. 현재 시도가 여전히 유효하면 로컬 MediaStream에서 이전 트랙을 제거하고 새 트랙을 등록한다. ended 리스너도 이전한다.
6. 이전 트랙을 stop하고 실제 정보·미리보기를 갱신한다.

`useLocalMedia`가 기존·후보 트랙 정리를 소유하며, Producer는 계속 stopTracks:false로 사용한다. replaceTrack은 MediaStream을 자동 갱신하지 않으므로 소유 Hook이 이를 명시적으로 수행한다. Send/Recv Transport, 서버 Producer, 원격 Consumer는 성공적인 장치 교체 중 유지된다. 장치 전환용 Signaling 추가는 없다.

카메라 OFF는 여전히 Video Producer와 로컬 비디오 트랙을 종료한다. 이때 선택만 바꾸면 카메라는 켜지지 않는다. 명시적 ON에서 선택한 카메라만 획득하고 기존 Step 10 흐름으로 새 Video Producer를 만든다. 마이크나 원격 수신은 재생성하지 않는다.

마이크 미획득·수신 전용에서는 선택만 저장하고 최초 획득·송신을 시작하지 않는다. 수신 전용과 독립적으로 이미 로컬 미리보기 트랙을 소유한 경우, 해당 로컬 트랙 교체는 원격 송신을 만들지 않는다.

## 음소거 안전성

새 오디오 트랙에는 기존 트랙 enabled 상태를 먼저 적용한다. 음소거 의도 또는 클라이언트 Producer.paused가 있으면 replaceTrack 전에 enabled=false를 적용한다. 설치된 mediasoup-client의 replaceTrack은 기존 Producer pause 상태에 따라 새 트랙 enabled도 맞춘다.

서버 Producer는 교체 중 pause 상태를 유지하며, 원격 Consumer를 재생성하거나 resume하지 않는다. 마이크 pause/resume과 같은 종류의 장치 전환은 중복 조작을 차단한다. 음소거 해제는 기존 Step 10처럼 서버 확인 후에만 로컬 Producer를 재개한다. 미획득 상태의 해제 동작으로 장치를 획득하지 않는다.

장치 선택은 방 목록·채팅 화면·활성 미디어 방과 독립적이다. 명시적 회의방 전환은 기존 송수신을 정리한 후 로컬 소유 트랙과 선택을 재사용한다. 카메라 OFF·마이크 음소거 의도는 유지된다.

## 실패·장치 제거·비동기 경합

- 획득 실패·replaceTrack 거절: 후보 트랙을 정리하고 기존 live 트랙·기존 연결을 유지한다.
- 교체 확정 후 미리보기/정리 실패: 이미 새 트랙이 적용됐다는 안내를 표시한다. 이전 트랙으로 되돌아갔다고 표시하지 않는다.
- 권한 대기 중 OFF·종료·방 전환·unmount: 현재 Attempt와 로컬 소유 세대 검사를 실패시켜 늦은 스트림을 stop한다. 예전 결과로 새 방 연결을 갱신하지 않는다.
- replaceTrack 처리 중 종료: 기존 Producer 종료와 현재 시도를 확인하고 후보 트랙을 회수한다. SFU 종료가 원래 로컬 트랙까지 자동 종료하는 정책으로 바뀌지는 않는다.
- devicechange: 목록·선택 누락 안내를 갱신하며 자동 장치 전환·권한 요청은 하지 않는다. 목록에서 사라진 선택 ID는 그대로 표시한다.
- 실제 사용 트랙 ended: 기존 Step 06·10 정책을 유지한다. 로컬 소유 스트림의 모든 트랙을 정리하고 오류 상태를 표시하며, 송신 중 연결도 정리한다. 복구는 사용자의 명시적 재획득·재연결이다. 장치 목록에서 사라졌다는 사실만으로 live 트랙을 강제로 종료하지 않는다.

동시에 두 종류를 전환해도 각각의 이전 트랙만 정리한다. 종류별 중복 적용을 차단하는 단순한 정책을 사용하며, 여러 사용자의 최종 선택을 큐로 쌓는 범용 제어 계층은 만들지 않았다.

## 실행과 검증 명령

```powershell
npm run dev:server
# 별도 터미널
npm run dev:client
```

로컬 미디어 영역에서 종류와 기본/명시 장치를 선택하고 시작한다. 방 참여 후 SFU를 연결한다. 장치를 바꾸려면 해당 종류를 선택하고 적용한다. 선택·실제 사용 표시·로컬 미리보기·원격 재생을 각각 확인한다.

```powershell
npm run typecheck
npm run build
npm run test:media
npm run test:ws
npm run test:sfu:ws
npm run test:sfu
node --test scripts/chat-history.test.cjs
npm run test:media:browser
npm run test:sfu:devices:browser
npm run test:sfu:controls:browser
npm run test:sfu:multi:browser
npm run test:sfu:receive:browser
npm run test:sfu:browser
```

브라우저 검증 전 개발 서버를 종료하고 각 명령을 순차 실행한다. 기존 CDP 하네스·Chrome/Edge 임시 프로필·테스트 전용 Node IPC를 재사용한다. 장치·3인 미디어 테스트는 Chrome 2개와 Edge 1개를 사용한다. 내부 자원은 기존 diagnostics로만 검사하며 운영 API를 추가하지 않는다.

브라우저 실행에 `--mute-audio`를 적용했다. 테스트 브라우저의 스피커 출력만 억제하며 캡처 트랙·Producer pause 또는 RTP 송수신을 음소거하지 않는다. 실제 브라우저/SFU 패킷·바이트·framesDecoded 증가로 전송이 유지되는지 확인했다. 실제 청취와 동일한 검증이 아니다.

## 실제 검증 결과

| 구분 | 확인 범위 |
| --- | --- |
| strict·빌드·실행 | Client/Server 타입 검사·빌드 종료 코드 0. Vite·기존 서버 실행, HTTP /health 정상 |
| 단위 테스트 | 8/8: 기존 6개와 입력 분류·중복 제거·빈 label, default/exact/미선택 조건 2개 |
| WebSocket 통합 | 19/19: 세션·프로필·다중 소속·채팅·payload·heartbeat·종료 |
| SFU Signaling 통합 | 18/18: 기존 소유권·송수신·개별 종료·pause/resume·경합 |
| worker·Router 및 기록기 | 31/31 = SFU 5개 + 기록기 26개 |
| 로컬 미디어 브라우저 | Chrome·Edge 종류별 획득 각 3회, 오류 주입·StrictMode·늦은 응답·정리 |
| 기존 SFU 브라우저 회귀 | Step 07 송신, Step 08 양방향·수신 전용·재생 제한·worker 중단, Step 09 3인 RTP·4세션 격리·종료, Step 10 카메라/마이크 5회 반복 모두 최종 종료 코드 0 |
| Step 11 장치 브라우저 | Chrome 가상 카메라 전환 5회·Mock 마이크 전환 5회, Edge에서도 각 종류 교체 |
| 음소거 중 교체 | Mock 마이크 5회 추가 교체, enabled=false·서버 paused·동일 원격 Consumer 유지·RTP 차단 확인 |
| 목록·실패·경합 | 빈/비공개/실패/지연 목록, 제거·재등장, 획득 오류·replace 거절·중복 적용·OFF·방 전환·연결 종료·unmount 주입 |

단위·서버 통합 테스트는 총 76개다. 브라우저 테스트는 별도이며, 각 실행의 프로세스 종료 코드도 확인한다.

첫 장치 시나리오는 통과했다. 확장 검증 중 사용 트랙 ended를 주입한 후 이미 정상적으로 정리된 error 상태에 idle을 요구해 테스트 정리에서 1회 실패했다. 오류 표시를 없애는 구현 변경 대신, error 상태에서 모든 트랙 ended·native 자원 정리를 검사하도록 테스트 조건을 바로잡았고 최종 확장 실행은 통과했다.

Step 08 회귀 중 미디어 자원이 먼저 정리됐지만 WebSocket close에 따른 React 재연결 버튼 갱신 전 클릭해 1회 실패했다. 기존 disconnect는 socket.close를 호출하고, disconnected 표시는 onclose에서 갱신하므로 두 완료 시점은 다르다. 임의 지연이나 오류 무시 없이 실제 disconnected 상태·버튼 존재를 대기하도록 테스트만 보강했다. 제품의 세션 처리 코드는 변경하지 않았다.

장치 시나리오의 고정 2.1초 간격 통계 비교도 한 실행에서 증가를 관찰하지 못해 실패했다. 통계는 UI에서 비동기 표본으로 갱신되므로, 기존 공통 bounded wait 내에서 같은 Consumer의 패킷·영상 디코딩 증가가 실제 관찰될 것을 요구하도록 변경했다. 증가 조건을 제거하거나 같은 값을 성공으로 인정하지 않는다. 이 변경만으로 모든 정체 원인을 해결했다고 간주하지 않고 최종 실행 결과를 별도로 확인한다.

최종 장치 실행은 이 증가 조건·실제 잘못된 exact 카메라 ID 거절·빠른 선택 변경·선택 카메라 최초 획득까지 포함해 통과했고 종료 코드 0이었다. 전체 브라우저 검증에서 최종 실행의 Runtime exception은 0개였다. 미디어 교체 전후 ID 유지·이전 트랙 ended·새 트랙의 RTCRtpSender 적용과 네이티브 자원 수를 함께 검사했다.

### 가상 장치·Mock·실제 RTP의 구분

카메라는 Chromium의 `device-count=2,fps=10`으로 서로 다른 native 가상 카메라를 제공했다. 선택 deviceId가 getSettings와 일치하는지, 새 track ID·이전 ended·실제 RTCRtpSender.track 교체를 확인했다. 물리 웹캠 전환은 아니다.

마이크는 `mock-mic-a`·`mock-mic-b`를 테스트 fixture에서 제공한다. 기반 소스는 같은 Chromium 가상 마이크이며 getSettings의 장치 식별을 Mock으로 분리했다. 서로 다른 두 하드웨어 또는 두 독립 가상 오디오 소스를 검증한 것이 아니다. 이 fixture는 테스트 브라우저에서만 주입되며 제품 코드에는 들어가지 않는다.

SFU 전송·Consumer·브라우저 디코딩은 Mock이 아니다. 각 트랙을 실제 mediasoup-client와 native worker에 연결했다. 성공적인 교체 동안 Producer·Consumer·Send/Recv Transport ID와 native 덤프 자원 수를 비교했다. 최종 기준은 3슬롯·6 Producer·12 Consumer·6 Transport, 종류/참가자 종료 후 기대 수로 복귀, 전체 종료 후 슬롯·Producer·Consumer 0 및 worker 종료다.

종료 코드 0인 장치 실행의 예: 영상 Consumer 패킷 43→51·framesDecoded 15→18, 오디오 패킷 371→471을 관찰했다. 음소거 교체 구간의 두 원격 Consumer 패킷은 566→566, 495→495였고 바이트도 유지됐다. 해제 후 566→666으로 증가했다. 이 수치는 유한한 자동화 측정 구간의 근거이며 모든 환경의 무누출을 수학적으로 보장하는 결과가 아니다. 서버 paused 상태·새 트랙 비활성·동일 ID도 함께 검사했다.

## 자원 사용·자동 기록

### 모델 변경 후 종합 재검토 (2026-11-02)

현재 Git 작업 트리의 Step 11 변경은 기존 클라이언트 미디어 Hook·UI·브라우저 하네스의 확장으로 한정된다. 서버·SFU 프로토콜·패키지 의존성 변경, 중복된 미디어 소유자 또는 별도 장치 저장소는 확인되지 않았다. `useLocalMedia`가 실제 트랙을 소유하고, 송신 중 교체는 `useSfuSender`의 기존 Producer에 `replaceTrack()`을 적용한다. 성공 후 소유 MediaStream을 갱신하고 이전 트랙을 종료한다. 같은 종류의 적용 중에는 선택과 재적용을 잠그며, 다른 종류·방 전환·종료는 현재 시도 검증으로 처리한다. 코드상 확정적인 Step 11 요구사항 누락이나 이 검토에서 재현된 제품 결함은 없어 제품 코드는 추가 수정하지 않았다.

이번 검토에서 **새로 실행**한 `npm run typecheck`, `npm run build`, `npm run test:media`(8/8), `npm run test:ws`(19/19), `npm run test:sfu:ws`(18/18), `npm run test:sfu`(5/5), `node --test scripts/chat-history.test.cjs`(26/26)는 종료 코드 0이었다. 브라우저 명령 `test:media:browser`, `test:sfu:devices:browser`, `test:sfu:receive:browser`, `test:sfu:multi:browser`, `test:sfu:controls:browser`도 각각 종료 코드 0이었다. 장치 테스트는 3인 구성에서 카메라·Mock 마이크 각 5회 교체, 음소거 중 마이크 5회 교체, 실제 원격 RTP 증가와 영상 디코딩, 기존 Producer·Consumer·Transport ID 및 종료 후 native 자원 정리를 다시 확인했다. HTTP `/health`는 WebSocket 통합 및 브라우저 하네스에서 실제 요청으로 확인했다.

기존 `test:sfu:browser`는 **첫 실행에서** `scripts/sfu-browser.scenarios.cjs`의 `signaling timeout closes socket` 조건을 15초 안에 관찰하지 못해 종료 코드 1이었다. 동일 코드의 **한 차례 재실행은** 해당 timeout 시나리오와 전체 송신·RTP 검증을 통과해 종료 코드 0이었다. 첫 실패의 정확한 원인은 확인하지 못했다. 이 시나리오는 Step 11에서 수정하지 않은 기존 송신·WebSocket timeout 경로를 사용하지만, 인과관계를 배제했다고 단정하지 않는다. 재실행 통과를 간헐적 실패의 해결로 표시하지 않으며 후속 재현 시 별도 조사 대상이다.

기존 Step 11 작업 문서의 가상 장치·Mock·물리 장치 구분과 PLAN의 전체 완료 보류는 이번 재검토에서도 유지한다. 모델 전환 전후의 모든 중간 응답을 보존한 단일 ChatHistory Markdown은 현재 확인되지 않아 모델별 변경 시점을 기록만으로 정확히 분할할 수 없다. 로컬 Hook 상태에는 최초 Step 11 요청과 이번 재검토 요청의 프롬프트가 각각 남아 있지만, 확인 시 `ChatHistory/`의 최대 번호는 `0023`이고 두 요청의 최종 응답을 보존한 새 Markdown은 없었다. 기록기 26/26 통과는 이 실제 아카이브 성공을 뜻하지 않는다. 기존 기록을 덮어쓰거나 대화를 수동 중복 작성하지 않는다.

구현·자동 검증 산출물은 현재 커밋 후보로 볼 수 있으나, 요청된 ChatHistory 보존까지 포함한 작업 전체는 실제 Markdown 생성 여부를 확인하기 전 커밋 준비 완료로 판정하지 않는다. Step 07 브라우저 timeout의 간헐적 실패와 물리 장치 미검증도 함께 명시한다.

최초 Step 11 작업 시작 시 Git 변경은 없었다. 기존 AGENTS·.codex·ChatHistory와 기록기 코드를 변경하지 않았다. 그 작업의 응답 작성 시점에는 프롬프트가 `.chat-history`에 저장된 것만 확인됐고, Stop 실행·Markdown 생성은 확인할 수 없었다. 수동 기록은 만들지 않는다.

확인 시 디스크의 기존 Markdown은 0001~0023이었으며, 과거 상태 JSON에는 0024·0025 완료 참조가 있으나 해당 Markdown은 없었다. 이 차이를 이번 작업에서 복구·번호 재할당하거나 과거 파일 덮어쓰기로 해결하지 않았다. 이전 테스트 통과와 현재 턴의 실제 기록 생성은 구분한다.

브라우저 테스트는 병렬로 실행하지 않았다. 관측 시 가용 RAM은 약 16.8GB, CPU 사용률 표본은 22%였고 기존 사용자의 Chrome 프로세스는 종료하지 않았다. 마지막 `sfu:check`도 worker·Router 생성 후 subprocessClosed=true로 종료됐다. 전체 테스트 후 Node·SFU worker·테스트 프로필 소유 Chrome/Edge 프로세스, 3000/4173/5173 TCP 리스너, webrtc-step06 임시 프로필 잔류는 모두 0개였다. 표본 값은 실행 전체의 최대 CPU/메모리 측정이 아니며 강제 종료 위험이 전혀 없다는 보장은 아니다.

## Trade-off와 미검증 항목

새 장치를 먼저 획득하면 실패 시 기존 정상 송신을 유지하기 쉽지만, 두 장치를 잠시 동시에 점유한다. 독점 장치에서는 이 방식이 실패할 수 있으며 기존 정상 트랙 유지와 오류 안내를 우선한다. 자동으로 기존 트랙을 먼저 끄거나 다른 장치를 선택하지 않는다.

물리 웹캠이 없는 현재 PC에서 실제 장치 수동 검증은 요청대로 생략했다. 다음은 미검증이다.

- 두 물리 카메라·마이크 사이의 전환, 실제 USB 분리·재연결, 카메라 영상 변화·LED·점유 해제.
- 실제 이어폰 마이크 교체·청취·음소거 중 사람 음성의 차단과 재개.
- 실제 권한 대화상자 허용·거부, 브라우저/OS의 모든 장치 오류 경로.
- LAN/NAT·다른 PC·장시간 부하와 모든 조합의 타이밍.

실제 인수 시 두 입력 장치를 연결하고 선택·적용 전후 getSettings/track ID와 원격 영상·청취를 비교한다. 음소거 중 마이크를 교체한 뒤 상대에게 음성이 전달되지 않고 명시적 해제 후 재개되는지 확인한다. 사용 장치 분리 시 목록·오류·송신 정리와 자동 대체 없음도 확인한다. 이 인수 전까지 Step 11 전체 완료는 보류한다.

Step 12에서는 현재 소유한 오디오 트랙을 읽는 입력 레벨 분석을 연결하되, 교체·종료 때 이전 분석 연결도 해제해야 한다. 입력 레벨 기능을 이번 Step에서 구현하지 않았다.

## 참고

- [mediasoup-client API](https://mediasoup.org/documentation/v3/mediasoup-client/api/#producer-replaceTrack) — replaceTrack와 트랙 정리 옵션.
- [Media Capture and Streams](https://www.w3.org/TR/mediacapture-streams/) — 장치 조회·권한·트랙 API.
- [Chromium 가상 장치 구성](https://codereview.chromium.org/2715513008) — device-count 테스트 옵션.
- [AI Task Prompt Convention Draft](https://github.com/Sangseon/00-conventions/blob/master/docs/ai-task-prompt.md) — 검증 결과와 범위 구분.
