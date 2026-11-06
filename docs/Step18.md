# Step 18 — 통합 대시보드 UI/UX 구현 및 브라우저 회귀

## 작업 개요와 기준

[Step17](./Step17.md)에서 승인한 통합 대시보드를 기존 React 화면에 적용했다. 이전 화면의 긴 단일 열에서 방 관리, 실제 미디어, 독립 채팅의 위치와 상태를 구분했다. WebSocket·SFU 프로토콜과 서버 정책은 변경하지 않았다. 당시 계획했던 Step 19의 전체 QC·사용자 수동 QA는 수행하지 않았다.

| 영역 | 실제 구현 |
| --- | --- |
| 상단 | 서비스명, WebSocket 상태·오류·재연결, 프로필, 다음 미디어 대상, 실제 활성 미디어 방, 현재 채팅 채널, 연결 종료 |
| 왼쪽 | 방 생성·가입·퇴장·정보 선택, 가입한 방 중 다음 미디어 대상 선택, 송신·수신 전용 연결, 명시적 전환 |
| 중앙 | 실제 `activeMediaRoomId`의 로컬·원격 미디어, 카메라·마이크 제어, SFU 종료, 오류·원격 재생 재시도 |
| 중앙 제어 | 장치 설정·연결 진단 대화상자 버튼. 장치 설정에는 로컬 미디어·장치 전환·입력 미터, 연결 진단에는 participantId·접속자·Transport·Producer·Consumer·통계 |
| 오른쪽 | 전체/가입 방 채팅 채널, 채팅·해당 방 참가자 보기 전환, 현재 채널로만 전송 |

좁은 폭에는 미디어·회의방·채팅으로 이동하는 링크와 장치 설정 대화상자 버튼을 제공한다. 링크와 버튼은 패널이나 Hook을 재마운트하지 않는다.

방 가입 상태, `Rooms.selectedRoomId`의 방 정보 선택, 왼쪽 `target`, 오른쪽 `channel`, 실제 `activeMediaRoomId`는 구분한다. 방 정보나 미디어 대상 선택은 채팅 채널과 실제 SFU 연결을 바꾸지 않는다. 오른쪽 채널 선택은 미디어 대상을 바꾸지 않는다. 중앙은 실제 활성 방에 연결된 상태만 나타낸다. 채팅/참가자 보기 전환과 장치 대화상자 닫기는 내용을 숨기는 동작이며 관련 컴포넌트를 제거하지 않는다.

## 구현 파일과 생명주기

| 파일 | 변경 내용 |
| --- | --- |
| `client/src/App.tsx` | 단일 `useSession` 소유 상태에서 헤더와 대시보드 배치. 다음 미디어 대상과 채팅 채널만 상위에서 공유 |
| `client/src/Rooms.tsx` | 왼쪽 방 목록·가입 상태·정보 표시. 기존 `selectedRoomId` 기능과 테스트 식별자 유지 |
| `client/src/MediaPanel.tsx` | 기존 `useLocalMedia`·`useSfuSender`를 한 번씩 호출하며 연결 대상·중앙 통화·장치 설정·진단을 렌더링. 로컬 스테이지 타일은 공유 트랙을 참조하는 표시용 요소 |
| `client/src/Chat.tsx` | 독립 채널 탭, 채팅/참가자 보기, 채널별 전송. 초안과 패널 상태는 컴포넌트에 유지 |
| `client/src/style.css` | 3열 대시보드, 1199/767/479px 반응형 배치, 상태·버튼·포커스 표시 |
| `scripts/media.browser.cjs`, `scripts/dashboard.browser.cjs`, `scripts/dashboard.scenarios.cjs`, `package.json` | 기존 브라우저 하네스의 계측·정리 경로를 재사용한 대시보드 회귀 명령 추가. Windows 8.3 짧은 경로 때문에 임시 프로필 소유 브라우저를 놓치는 정리 비교를 고유 프로필 이름 기준으로 수정 |
| `README.md`, `docs/PLAN.md`, 이 문서 | 사용법·Step 상태·검증 기록 |

`useSession`, `useLocalMedia`, `useSfuSender`, `useMediaDevices`, `useMicrophoneMeter`의 자원 소유권은 기존 Hook에 남겼다. 반응형 CSS와 보기 전환·대화상자 닫기로 Hook 소유 컴포넌트를 unmount하지 않는다. `LocalStagePreview`는 기존 카메라 트랙으로 별도 `MediaStream` 표시 참조만 만들고 새 장치 획득이나 Producer를 만들지 않는다. 장치 설정을 닫아도 분석 Hook과 미디어 트랙의 기존 종료 정책이 유지된다.

기존 `id`·`data-testid` 기반 브라우저 선택자와 RTP·자원 수 assertion을 제거하지 않았다. 새 테스트는 실제 UI 조작과 SFU 스냅샷·RTP 증가를 함께 확인한다. 패키지 신규 설치는 없으며 기존 npm script에 `test:dashboard:browser`만 추가했다.

## 사용자 흐름과 자동화 증거

새 테스트는 Windows 11의 Chrome·Edge 임시 프로필과 가상 카메라·마이크를 사용한다. 테스트 브라우저는 `--mute-audio`로 스피커 출력을 억제하면서 WebRTC RTP 계측은 유지했다.

| 시나리오 | 확인 내용 | 결과 |
| --- | --- | --- |
| A: 다른 방 채팅 | 1111 미디어 중 2222 채팅·참가자 보기와 메시지 전달; 미디어 ID·대상 유지 | PASS |
| B: 다음 대상만 변경 | `sfu-room`을 2222로 바꿔도 1111 미디어 ID·Producer 스냅샷 유지, 수신 RTP 증가 | PASS |
| C: 명시적 전환 | 연결 버튼으로만 1111 자원 종료·2222 연결. 방별 활성 슬롯 확인 | PASS |
| D: 전환 후 다른 방 채팅 | 2222 미디어 상태에서도 1111 채팅 채널·전송 유지 | PASS |
| E: 전체 채팅 | 전체 메시지 전달 중 2222 미디어·대상 유지 | PASS |

초기 대시보드 검증에서 채팅/참가자 보기 전환과 당시 장치 설정 접기 전후의 채팅 초안·활성 미디어 방·로컬 트랙을 확인했다. 이후 장치 설정을 모달로 바꾼 재검증은 아래 후속 보완 기록을 따른다. 종료 시 두 브라우저의 로컬 트랙 ended, 서버 세션 0, 미디어 슬롯 0, native worker 종료를 확인했다. 3인·4인 SFU 회귀에서는 원격 RTP 증가, 영상 프레임 디코딩, 정상 종료 시 자원 수 복귀를 기존 assertion으로 확인했다. 영상 프레임과 가상 마이크 RTP는 실제 사람의 시청·청취 증거가 아니다.

## 실행한 검증

아래 명령은 순차 실행했다. 본문 통과와 프로세스 종료 코드를 별도로 확인했다.

| 명령 | 결과·종료 코드 | 핵심 근거 |
| --- | --- | --- |
| `npm run typecheck` | PASS, 0 | 클라이언트·서버 strict 검사 |
| `npm run build` | PASS, 0 | 클라이언트·서버 빌드. Vite 500KB 청크 경고 유지 |
| `npm run test:ws` | 19/19, 0 | 세션·프로필·방·채팅, 러너 정상 종료 |
| `npm run test:media` | 8/8, 0 | 로컬 트랙 생명주기 |
| `npm run test:meter` | 3/3, 0 | RMS 입력 레벨 |
| `npm run test:sfu` | 5/5, 0 | worker·Router·SFU 자원 |
| `npm run test:sfu:ws` 첫 실행 | 17 통과·1 timeout/cancel, 1 | `SFU heartbeat cleanup preserves another participant and unrelated rooms`가 20초 제한에 걸림. 다른 사례의 결과는 유지 |
| `node --test --test-name-pattern="SFU heartbeat cleanup preserves another participant and unrelated rooms" scripts/sfu-ws.test.cjs` | 1/1, 0 | 해당 사례 단일 재실행 1.56초 |
| `npm run test:sfu:ws` 재실행 | 18/18, 0 | 전체 재실행 3.52초, heartbeat 감지 558.5ms |
| `npm run test:media:browser` | PASS, 0 | Chrome·Edge 가상 로컬 미디어·오류·StrictMode 정리 |
| `npm run test:meter:browser` | PASS, 0 | 가상 입력·제어 신호와 음소거 중 SFU 독립성 |
| `npm run test:sfu:browser` | PASS, 0 | 실제 ICE/DTLS·오디오/비디오 RTP 증가·Signaling timeout 경로 |
| `npm run test:sfu:receive:browser` | PASS, 0 | 양방향 수신·영상 프레임·수신 전용·자동 재생 재시도 |
| `npm run test:sfu:multi:browser` | PASS, 0 | 4개 독립 세션, 2방, 3인 수신 Consumer 12개, 5회 참가 반복·native 자원 0 정리 |
| `npm run test:sfu:controls:browser` | PASS, 0 | 카메라·마이크 각 5회 조작, 음소거 구간 수신 RTP 패킷 수 정지·해제 후 증가 |
| `npm run test:sfu:devices:browser` | PASS, 0 | 가상 카메라 2개·Mock 마이크 A/B, 각 5회 replaceTrack, 음소거 유지 |
| `npm run test:dashboard:browser` 최초·두 번째·세 번째 | FAIL, 각각 1 | 신규 테스트의 RTP 통계 갱신 대기 누락, 파일의 `join` 이름 충돌, 숨긴 모바일 탭에 포커스 시도. 제품 오류로 확인되지 않았으며 검증 코드를 수정 |
| `npm run test:dashboard:browser` 하네스 수정 직후 | 본문 PASS·정리 FAIL, 1 | `profiles.map(basename)`에서 배열 index가 `basename`의 suffix 인수로 전달됨. 이름 변환 callback을 수정하고 이 실행의 임시 프로필을 정리 |
| `npm run test:dashboard:browser` 최종 재실행 | PASS, 0 | Chrome·Edge의 A~E, 방별/전체 채팅, 2인 미디어, 4개 폭, 런타임 예외 0, 종료 정리 |

대시보드 화면은 두 브라우저에서 1280·900·600·390px로 실제 렌더링했다. 여덟 폭·브라우저 조합 모두 문서 가로 넘침이 없고 미디어 타일·통화 제어·채팅 입력이 DOM에 남아 있는 것을 확인했다. 1280px은 3열, 900px은 방/미디어 2열과 아래 채팅, 600·390px은 미디어 우선 단일 열이다. [Chrome 1280](./assets/step18/chrome-1280.png), [Chrome 390](./assets/step18/chrome-390.png), [Edge 900](./assets/step18/edge-900.png), [Edge 390](./assets/step18/edge-390.png) 외 네 캡처도 같은 폴더에 있다. 모바일 폭은 데스크톱 브라우저의 뷰포트 에뮬레이션이며 실제 모바일 하드웨어 검증이 아니다.

초기 검증에서 채널 탭의 접근 가능한 이름·`aria-selected`, 포커스 가능 여부와 기존 오류의 `role=alert/status`, 당시 접는 패널의 기본 조작 구조를 확인했다. 모달 변경 후 접근성 재검증은 아래 기록을 따른다. 키보드만으로 전체 사용자 흐름을 수동 수행하거나 스크린리더로 점검하지 않았으므로 접근성 인수는 **부분 검증**이다. 스크린샷과 4개 폭 계측은 좁은 화면의 모든 장치·브라우저 조합을 대체하지 않는다.

공통 브라우저 하네스 정리 로직을 바꾼 뒤 `test:media:browser`, `test:meter:browser`, `test:sfu:browser`, `test:sfu:receive:browser`, `test:sfu:multi:browser`, `test:sfu:controls:browser`, `test:sfu:devices:browser`, `test:dashboard:browser`를 순차 재실행했고 모두 본문 PASS·종료 코드 0이었다. 첫 대시보드 실패 실행에서 남은 임시 프로필 두 개는 실제 Chrome·Edge 프로세스의 Windows 짧은 경로와 긴 경로 대조가 일치하지 않아 자동 정리되지 않았다. 해당 프로필 이름의 소유 브라우저만 종료한 뒤 프로필을 수동 정리했다. 마지막 점검에서 `webrtc-step06-*` 프로필 0개, 개발 포트 3000·5173 리스너 0개, mediasoup worker 0개였다. 테스트 전에 존재한 일반 사용자 브라우저는 종료하지 않았다.

## QA 대응과 남은 사항

QA-001~026의 기능 진입점은 유지했다. QA-003/004의 연결·프로필은 상단, QA-005~008의 방·채팅은 왼쪽·오른쪽, QA-009~023의 미디어·장치·미터는 중앙과 장치 설정, QA-024~026의 진단·오류 확인은 중앙·연결 진단에서 접근한다. 기존 QA의 목적·판정·증빙을 바꾸지 않았으며 절차를 새로 실행하지 않았다. 방 정보·미디어 대상·채팅 채널이 각각 다른 UI 조작이라는 수동 확인은 당시 Step 19로 예정했으나 수행하지 않았다.

Step 16의 WebSocket 러너 비종료와 초과 payload 1006 간헐 이력은 이번 UI 변경으로 해결된 것으로 보지 않는다. 이번 `test:sfu:ws`의 최초 heartbeat timeout 원인도 미확인이다. 실제 물리 웹캠·이어폰 마이크, 사람의 영상 시청·음성 청취, 두 물리 장치 전환, LAN/NAT, 실제 모바일 장치와 장시간 사용은 검증하지 않았다.

## 최종 판정

- **UI 구현:** 승인된 대시보드 구조와 독립 상태 조작을 구현했다.
- **자동화 회귀:** 신규·기존 Chrome·Edge 가상 장치 테스트와 타입 검사·빌드가 최종 실행에서 통과했다. 최초 실패·재실행 이력은 위 표에 보존한다.
- **반응형·접근성:** 지정 폭의 실제 브라우저 렌더링과 기본 포커스·상태 속성은 확인했다. 키보드 전체 흐름·스크린리더·물리 모바일은 미검증이다.
- **Step 18:** UI 구현과 자동화 범위는 완료. 전체 프로젝트 인수와 사용자 수동 QA는 당시 Step 19로 계획했으나 수행하지 않았다.

## 후속 보완 — 사용자 화면 검토와 브라우저 종료 점검 (2026-11-06)

기존 Step 18 구현 뒤 사용자가 프로필·채팅·두 설정 패널의 사용성을 지적하고, Windows 작업 전환 화면에서 `WebRTC Practice` 창 두 개를 관찰했다. 이 창의 생성 주체는 확인되지 않았다. 이번 보완은 해당 네 항목에 한정했으며 서버·공유 프로토콜·SFU 동작은 변경하지 않았다.

| 항목 | 확인한 원인 | 수정과 확인 |
| --- | --- | --- |
| 프로필 편집창 | `ProfileMenu`의 `<details>`는 저장 응답과 무관하게 열린 상태를 유지했다. `useSession.updateProfile`은 성공 여부를 반환하지 않았다. | 세션 요청의 일치하는 성공 응답에서만 `Promise<boolean>`을 `true`로 완료하고 편집창을 닫는다. 거절·연결 종료·시간 초과는 `false`로 완료해 창을 유지한다. 닫기·취소 후 늦은 응답은 요청 세대로 구분해 창을 다시 닫지 않는다. 재개방 시 적용된 프로필을 표시한다. |
| 채팅 초안 | `Chat`은 채널 변경 때만 초안을 비웠고, 전송 성공 뒤에는 입력 내용을 유지했다. | 제출 순간의 채널·본문·초안 버전을 보관한다. 성공 응답이 왔을 때 같은 버전·본문만 비우고, 실패·채널 변경·새 입력 뒤의 초안은 보존한다. 전송 중 중복 제출은 기존 `saving`과 로컬 제출 잠금으로 차단한다. |
| 장치 설정·연결 진단 | 두 기능이 중앙 아래 접는 `<details>`에 있어 회의 화면의 길이를 늘렸다. | 중앙 제어부의 버튼에서 각각 네이티브 `<dialog>.showModal()`을 연다. 제목·닫기 버튼·Escape·모달 배경 차단·닫은 뒤 버튼 포커스 복귀와 내부 스크롤을 확인했다. `LocalMediaControls`와 진단 DOM은 닫힌 상태에도 마운트해 기존 Hook·트랙·미터 수명에 영향을 주지 않는다. |
| 브라우저 창 잔류 의심 | 기존 정리 보고는 임시 프로필과 개발 포트 중심이었고, 실행한 브라우저 런처의 종료 코드와 프로필 소유 자식 프로세스 수를 함께 보고하지 않았다. 사용자 관찰 창의 소유권은 확인되지 않았다. | CDP `Browser.close` 뒤 이번 실행에서 만든 고유 임시 프로필 이름으로 브라우저 프로세스를 조회한다. 아직 남은 프로필 소유 PID만 종료하고 실제 런처 종료와 소유 프로세스 0개를 확인한 뒤 프로필을 삭제한다. 이름만으로 모든 Chrome·Edge를 종료하는 경로는 없다. |

`client/src/App.tsx`, `Chat.tsx`, `useSession.ts`, `MediaPanel.tsx`, `style.css`와 브라우저 하네스·시나리오만 이번 보완의 제품·테스트 변경 대상이었다. 기존 Step 18 미커밋 변경도 그대로 보존했다. `scripts/microphone-meter.scenarios.cjs`는 닫힌 모달 안의 안내를 `body.innerText`로 찾던 검사를 해당 모달의 `textContent`로 좁혔다. `scripts/sfu-browser.scenarios.cjs`는 재접속 후 방 가입 상태를 기다리고 방 ID를 읽도록 했다. 두 검사는 안내 문구와 실제 Signaling timeout·RTP assertion을 삭제하지 않았다. 새 패키지·npm 명령·서버 계약은 추가하지 않았다.

### 보완 후 검증과 최초 실패

모든 명령은 순차 실행했다. 아래 종료 코드는 `npm run ...` 프로세스 기준이며, 브라우저 테스트에서는 본문 결과와 `BROWSER_CLEANUP`을 별도로 확인했다.

| 명령 | 결과·종료 코드 | 주요 증거 |
| --- | --- | --- |
| `npm run typecheck`, `npm run build` | 각각 0 | 클라이언트·서버 strict 검사 및 빌드. 기존 Vite 청크 크기 경고 유지 |
| `npm run test:ws`, `test:media`, `test:meter`, `test:sfu`, `test:sfu:ws` | 모두 0 | 순서대로 19/19, 8/8, 3/3, 5/5, 18/18. 이번 실행의 러너 정상 종료 |
| `npm run test:media:browser` | 0 | Chrome·Edge 로컬 미디어·오류·트랙 정리, 소유 프로필 2개·잔류 0개 |
| `npm run test:meter:browser` 첫 실행 | 1 | 실제 가상 입력 레벨까지 확인한 뒤, 닫힌 모달의 안내 문구를 `body.innerText`로 찾다가 timeout. 소유 프로필 3개·잔류 0개 |
| `npm run test:meter:browser` 수정 후 | 0 | 제어 신호 0/50 레벨, 공유·테스트 전용 트랙, 음소거 중 SFU RTP 독립성, 종료 정리. 소유 프로필 3개·잔류 0개 |
| `npm run test:sfu:browser` 첫 실행 | 1 | 송신 RTP 증가 뒤 재접속 직후 생성한 방의 ID를 가입 상태 대기 없이 읽어 null 접근. 소유 프로필 2개·잔류 0개 |
| `npm run test:sfu:browser` 수정 후 | 0 | 오디오·비디오 RTP 증가, ICE/DTLS 연결, Signaling 요청 1건 드롭 후 8010.6ms에 소켓 종료. 소유 프로필 2개·잔류 0개 |
| `npm run test:sfu:receive:browser` | 0 | 양방향 RTP·영상 프레임 디코딩, 수신 전용·자동 재생 재시도. 소유 프로필 2개·잔류 0개 |
| `npm run test:sfu:multi:browser` | 0 | 4세션·2방에서 활성 슬롯 4, Router 2, Producer 7, Consumer 12; 반복 후 native 자원 0. 정상 종료 직후 소유 자식 프로세스 11개를 해당 프로필로 확인해 정리, 최종 잔류 0개 |
| `npm run test:sfu:controls:browser`, `test:sfu:devices:browser` | 각각 0 | 카메라·마이크 제어와 RTP, 장치 교체·음소거 유지. 각 소유 프로필 3개·잔류 0개 |
| `npm run test:dashboard:browser` | 0 | Chrome·Edge에서 프로필 성공/거절/늦은 응답, 전체·방 채팅 성공/거절/초안 경합, 두 대화상자 조작·미디어 유지, A~E 방 독립성. 소유 프로필 2개·잔류 0개 |

브라우저 하네스의 정리 경로를 검증하기 위해 `CHECK_BROWSER_CLEANUP_PROBE=failure` 및 `timeout` 조건으로 대시보드 실행을 각각 한 번 의도적으로 실패시켰다. 두 실행은 **예상한 종료 코드 1**이며 테스트 PASS가 아니다. 각각 Chrome·Edge 런처 2개가 종료 코드 0으로 끝났고, 해당 프로필의 브라우저 잔류·임시 프로필·개발 포트·worker는 0이었다. `test:sfu:multi:browser`에서 실제로 관찰된 소유 자식 11개는 CDP 종료 직후에도 잠시 살아 있을 수 있음을 보여준다. 이전 Windows 화면의 두 창이 테스트 소유였는지, 왜 보였는지는 당시 PID·프로필 근거가 없어 확정할 수 없다.

대시보드 테스트는 모달의 버튼·Escape·포커스 복귀·배경 비활성화와 열린 동안의 Track·SFU 자원 유지, 닫은 뒤 재개방을 자동 확인했다. Chrome·Edge 1280/900/600/390px에서 문서 가로 넘침 없이 기존 영상·통화 제어와 대화상자를 렌더링했다. 추가 캡처는 [Chrome 장치 설정 390px](./assets/step18/chrome-390-devices.png), [Chrome 연결 진단 390px](./assets/step18/chrome-390-diagnostics.png), [Edge 장치 설정 390px](./assets/step18/edge-390-devices.png), [Edge 연결 진단 390px](./assets/step18/edge-390-diagnostics.png)에 있다. 이는 데스크톱 브라우저의 폭 검증이며 실제 모바일 하드웨어 인수가 아니다.

실행 전 일반 Chrome·Edge 프로세스는 25개였고 최종 확인 시 21개였다. 이 수치만으로 개별 창의 소유권이나 사용자가 열어둔 브라우저의 보존 여부를 증명할 수는 없다. 하네스는 생성한 임시 프로필로 확인한 PID에만 종료 요청을 보냈으며 전역 브라우저·Node 종료 명령은 실행하지 않았다. 최종 확인에서 `webrtc-step06-*` 소유 브라우저 0개, 임시 프로필 0개, 3000·5173 포트 리스너 0개, mediasoup worker 0개였다.

Step 16의 WebSocket 비종료·초과 payload 1006 이력과 이전 Step 18의 `test:sfu:ws` 첫 heartbeat timeout 원인은 이번 보완으로 해결됐다고 판단하지 않는다. 물리 카메라·마이크, 사람의 음성 청취, 실제 모바일 장치와 전체 키보드·스크린리더 QA도 수행하지 않았다. 보완 당시 Step 18의 **구현·이번 범위 자동화 검증 완료, 사용자 수동 QA 대기** 상태를 유지했으며 Step 19·20은 착수하지 않았다.

## 프로젝트 종료 결정 (2026-11-06)

사용자 결정에 따라 Step 18을 최종 구현 단계로 하고 개발을 종료했다. 당초 계획했던 Step 19·20은 실행하지 않는다. 이 문서의 자동화 통과·최초 실패·재실행 결과는 그대로 유지하며, 개발 종료를 전체 사용자 인수 완료로 해석하지 않는다. 실제 마이크 입력 테스트에서 `running` 상태인데도 `RMS 0.000`이 유지됐다는 사용자 관찰은 원인 미확인이다. 물리 카메라, 실제 음성 송수신·청취, 실제 모바일 장치 검증과 Step 16의 간헐적 문제도 미완료 상태로 남는다.
