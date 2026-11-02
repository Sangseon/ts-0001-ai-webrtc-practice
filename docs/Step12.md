# Step 12 — 마이크 입력 레벨 측정 및 시각화

## 목적과 범위

선택한 마이크에 입력 신호가 들어오는지 로컬에서 확인하는 테스트 UI를 추가했다. 회의 연결·송신·음소거 상태와 별개로 사용자가 테스트를 명시적으로 시작·종료한다. 원격 참가자 레벨, 녹음, 스피커 모니터링, SFU Signaling은 추가하지 않았다. Windows, Node.js 24.22.1, npm 12.2.1, TypeScript 7.0.2 strict, React 19.3.1, Vite 8.3.5와 기존 mediasoup 3.32.0 / mediasoup-client 3.25.3을 사용하며 신규 패키지는 없다.

## 분석 방식과 수치의 의미

`useMicrophoneMeter`가 명시적 시작 동작에서 `AudioContext`, `MediaStreamAudioSourceNode`, `AnalyserNode`를 생성한다. Source는 Analyser에만 연결하고 `AudioContext.destination`에는 연결하지 않는다. Analyser의 `fftSize=2048`과 `getFloatTimeDomainData()`로 시간 영역 PCM을 읽고, `sqrt(sum(sample²) / sampleCount)`로 RMS를 계산한다. 비정상 값은 0으로 처리하고 샘플을 ±1 범위로 제한한다.

표시는 `min(100, round(RMS × 200))`인 **상대 입력 레벨**이다. RMS 0은 0, RMS 0.25는 50, RMS 0.5 이상은 100이다. 물리적으로 보정된 dB SPL이나 상대방에게 실제 송신되는 크기가 아니다. RAF는 실행 중에만 유지하고 UI 값은 약 100ms 간격으로 갱신한다. 무음에는 지속되는 애니메이션이나 값을 주지 않는다. 탭이 숨겨지거나 AudioContext가 suspended이면 표시값을 0으로 내리고, suspended 상태에서는 사용자가 `분석 재개`를 누를 수 있다.

## 트랙 선택과 소유권

- 로컬 오디오 트랙이 live·enabled이고 현재 명시 선택 ID와 같으면 그 트랙을 **공유**한다. 기본 장치 선택에서는 현재 소유한 live 트랙을 재사용하며 UI에 실제 deviceId를 별도로 표시한다. 분석용 MediaStream은 그 공유 트랙을 참조할 뿐 원본을 소유하지 않는다.
- 로컬 오디오 트랙이 없거나 비활성(회의 음소거), 선택 ID와 다르면 `{ audio: true | { deviceId: { exact } }, video: false }`로 **테스트 전용** 오디오만 획득한다. 잘못된 명시 ID를 기본 장치로 우회하지 않는다. 테스트 전용 트랙은 SFU Producer에 전달하지 않는다.
- 공유 트랙의 테스트 종료는 AudioNode·AudioContext·RAF·리스너만 해제한다. 테스트 전용 스트림은 종료 시 모든 트랙을 stop한다. 카메라와 원격 Consumer는 건드리지 않는다. `useLocalMedia`가 통화 트랙을 계속 소유하고 `useSfuSender`의 `stopTracks:false` 정책을 유지한다.
- 회의 음소거 중에는 공유 통화 트랙을 다시 활성화하지 않는다. 별도 테스트 트랙만 분석하며 서버 Audio Producer paused, 기존 Consumer와 통화 트랙 `enabled=false`를 유지한다. 테스트를 시작·종료해도 resume 요청은 전송하지 않는다. 사용자의 별도 `마이크 음소거 해제` 조작만 Step 10 경로를 따른다.

선택값 변경만으로 분석 대상을 자동 교체하지 않는다. UI는 분석 중 실제 장치·트랙과 선택값을 구분하고, 다른 선택을 적용하려면 테스트를 종료한 뒤 다시 시작하도록 안내한다. Step 11의 통화 마이크 `replaceTrack()`으로 공유 트랙이 바뀌면 기존 분석을 종료하고 재시작을 요구한다. 테스트 전용 트랙은 선택 변경 후에도 현재 실제 분석 대상을 표시한다. `devicechange`로 선택 장치가 목록에서 사라지면 기존 장치 경고가 표시되지만 live 트랙을 다른 장치로 자동 교체하지 않는다. 실제 분석 트랙 `ended`에서는 레벨을 0으로 내리고 분석을 정리한다.

## 생명주기와 실패 처리

중복 시작은 거절한다. 권한 요청 중 종료는 작업 세대를 무효화하고 결과가 늦게 와도 해당 스트림을 종료한다. 대기 요청이 해결되기 전에는 새 시작을 잠가 테스트 전용 트랙의 중복 획득을 막는다. 선택값이 대기 중 바뀌어도 옛 결과를 현재 미터에 연결하지 않는다. 컴포넌트 해제 시 RAF, ended·visibilitychange·statechange 리스너, AudioNode, AudioContext와 테스트 소유 트랙을 정리한다. 공유 통화 트랙은 stop하지 않는다.

권한 거부·장치 없음·장치 사용 실패는 기존 MediaDevices 오류 안내를 사용한다. AudioContext 생성·resume 실패는 분석 시작 실패로 표시하고 획득한 전용 트랙을 정리한다. suspended 상태에서는 수치를 0으로 유지한다. 브라우저가 탭 비활성 상태에서 RAF를 멈추거나 오디오 컨텍스트를 중단할 수 있으므로, 숨겨진 탭에서 계속 실시간 수치가 갱신된다고 보장하지 않는다.

## 실행과 검증

```powershell
npm run dev:server
# 다른 터미널
npm run dev:client

npm run test:meter
npm run test:meter:browser
```

화면의 `마이크 입력 테스트 시작`을 누르면 선택한 마이크를 분석한다. 테스트 중인 장치 ID·공유/전용 여부와 상대 레벨을 확인하고 `마이크 테스트 종료`로 자원을 해제한다. 테스트는 방 입장이나 SFU 연결 없이도 가능하다. 회의 중에는 기존 프로필·방·채팅·원격 재생을 유지한다.

| 검증 종류 | 실제 실행 결과 |
| --- | --- |
| RMS 단위 | `test:meter` 3/3: 무음 0, ±0.25 RMS 0.25, ±0.5 RMS 0.5, 증가·비정상 값·표시 범위 |
| Chrome·Edge 가상 마이크 | 네이티브 AudioContext/Source/Analyser에서 `getFloatTimeDomainData` 실제 샘플을 읽고 0보다 큰 상대 레벨을 관찰. 화면 출력은 `--mute-audio`로 억제했으며 캡처·Web Audio 분석과 SFU RTP는 유지 |
| 제어 신호 | 테스트 fixture가 Analyser 샘플을 무음 0과 ±0.25로 교체하자 표시 0과 50을 관찰. 이는 실제 발화나 별도 물리 장치 검증이 아님 |
| 회의 전·자원 | 시작·종료 5회, 실제 AudioContext closed, 미터 RAF 0, 테스트 전용 트랙 ended, 스피커 destination 연결 0. 중복 시작·늦은 응답·선택 변경·트랙 ended·AudioContext 오류·StrictMode 해제 정리 검증 |
| 회의 중 3인 | 공유 트랙 분석에서 추가 getUserMedia 0회, 기존 Producer·Consumer·Transport ID 유지, 원격 RTP 지속. 음소거 중 별도 트랙 분석 레벨은 있으나 서버 Producer paused·원격 Consumer 유지·오디오 패킷/바이트 정지, 명시적 해제 후 RTP 증가 |
| 장치 전환 | 선택만 변경하면 기존 분석 장치를 표시. 재시작 후 Mock ID 변경 반영. 통화 트랙의 Step 11 교체 시 공유 미터 종료·재시작, 이전 트랙 ended와 SFU 자원 ID 유지. `devicechange`에서 선택 장치 누락 안내 확인 |
| 기존 회귀 | `typecheck`, `build`, `test:media` 8/8, `test:ws` 19/19, `test:sfu:ws` 18/18, `test:sfu` 5/5, ChatHistory 26/26. 기존 Step 06~11 브라우저 명령을 순차 실행해 각각 종료 코드 0 확인 |

`/health`는 WebSocket 통합 및 브라우저 하네스의 실제 HTTP 요청으로 확인했다. 3인 테스트의 native 미디어 자원은 미디어 종료 후 슬롯·Transport·Producer·Consumer가 0이었고, 논리 방이 유지되는 동안 Router는 남을 수 있다. 서버 shutdown 후 worker도 종료됐다. 테스트 브라우저의 가상 오디오 신호와 Mock 장치 A/B는 서로 다른 실제 마이크 입력을 뜻하지 않는다.

### 테스트 중 발견한 문제

새 Step 12 브라우저 시나리오의 초기 실행은 테스트 계측이 앱 외부 RAF까지 세어 1회 실패했다. 이후 CDP 평가식의 닫는 따옴표 누락으로 2회 실패했고, 또 다른 실행은 논리 방이 남을 때 Router가 유지되는 기존 정책을 테스트가 잘못 가정해 실패했다. 각 조건을 바로잡은 뒤 전체 시나리오가 종료 코드 0으로 통과했다. 제품 오류를 숨기기 위해 성공 조건을 제거하지 않았고, 미터 전용 RAF·실제 미디어 자원만 검사했다.

Step 11 종합 검토에서 알려진 Step 07 `signaling timeout closes socket` 간헐적 실패는 **이번 실행에서 재현되지 않았다**. 이번 1회 통과만으로 원인이 해결됐다고 판단하지 않는다.

## Trade-off와 미검증 사항

공유 트랙 재사용은 중복 장치 점유를 줄이지만 음소거된 `enabled=false` 트랙으로 실제 입력을 볼 수 없다. 이때는 전용 트랙을 명시적으로 획득해 통화 음소거를 유지한다. 동일 물리 장치의 중복 획득이 제한되는 환경에서는 테스트가 실패할 수 있으며 통화 트랙을 강제로 활성화하지 않는다. 선택 후 재시작 정책은 자동 교체보다 조작이 한 번 늘지만 분석 장치와 실제 통화 장치를 명확히 구분한다.

이번에는 물리 장치 수동 검증을 하지 않았다. 실제 이어폰 마이크 발화에 따른 레벨 변화, 서로 다른 두 물리 마이크의 차이, 실제 장치 분리·권한·점유 문제, 사람의 청취, LAN/NAT와 장시간 안정성은 미검증이다. **PLAN의 Step 12 전체 완료 기준은 보류**한다. Step 06·08·09·10·11의 기존 검증 보류도 유지한다.

Step 13 통합 인수에서는 실제 마이크로 무음·발화·장치 변경을 확인하고, 음소거 상태에서 미터만 반응하며 상대에게 음성이 나가지 않는지 청취한다. 테스트 종료 후 AudioContext·트랙 점유 해제와 기존 SFU 연결·채팅 유지도 함께 확인한다.
