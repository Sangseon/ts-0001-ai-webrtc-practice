# Step 02 — SFU 실행 검증과 선택

2026-10-30 기준 **mediasoup v3.32.0을 선택**했다. 현재 Windows에서 사전 빌드 native worker와 Router의 생성·종료, 반복 실행 및 오류 정리를 확인했다. 이번 결과는 SFU 실행 환경 검증이며 WebRTC 송수신 검증은 아니다.

## 선택 결과와 Trade-off

| 후보 | 장점 | 비용·제약 | 결정 |
| --- | --- | --- | --- |
| mediasoup v3 | 기존 Node.js 서버의 TypeScript 코드에서 worker·Router와 미디어 자원을 직접 제어할 수 있어 학습 목적에 맞음 | 저수준 API이므로 Signaling과 자원 소유권·생명주기를 애플리케이션에서 구현해야 함. native worker 배포 조건도 관리해야 함 | 현재 환경에서 실제 실행되어 채택 |
| LiveKit | SDK 중심으로 방·트랙을 다루며 Windows 로컬 서버 배포 경로도 제공 | 별도 서버 실행과 SDK 규약·접속 토큰 및 애플리케이션 상태와의 연동이 필요함 | 비교 후보로 유지, 설치·실행하지 않음 |

mediasoup는 독립 서버 제품이 아닌 Node.js 라이브러리다. JavaScript 제어 계층과 미디어를 담당하는 C/C++ 자식 프로세스가 IPC로 통신한다. [공식 설계](https://mediasoup.org/documentation/v3/mediasoup/design/)

LiveKit의 Windows 배포 파일과 `livekit-server --dev` 실행 방식은 [공식 로컬 실행 문서](https://docs.livekit.io/transport/self-hosting/local/)에서 비교했다. 정상 실행된 mediasoup 외의 SFU는 추가 설치하지 않았다.

## 설치 환경과 의존성

| 항목 | 확인 결과 |
| --- | --- |
| 운영체제 | Microsoft Windows 11 Home, 10.0.22631, x64 |
| 런타임 | Node.js 24.22.1, npm 12.2.1, win32 x64 |
| 추가한 직접 의존성 | mediasoup 3.32.0, 자체 TypeScript 타입 포함 |
| 기존 주요 도구 | TypeScript 7.0.2, tsx 4.23.15, React 19.3.1, Vite 8.3.5 유지 |
| worker | 공식 Release의 mediasoup-worker-3.32.0-win32-x64.tgz 사용 |
| 실행 파일 | node_modules/mediasoup/worker/out/Release/mediasoup-worker.exe, 5,419,008 bytes |
| 별도 시스템 설치 | 없음: Node 변경, Python·MSVC 설치, Docker 도입 없음 |

설치한 패키지의 engines는 Node `>=22`이며 현재 런타임이 충족한다. [공식 설치 문서](https://mediasoup.org/documentation/v3/mediasoup/installation/)에 따르면 설치 스크립트가 플랫폼별 사전 빌드를 다운로드하고, 사용할 수 없으면 로컬 빌드로 전환한다. 로컬 빌드에는 Python 3.10 이상과 pip, Windows에서는 C++17 지원 MSVC 환경이 필요하다. 공식 문서는 OpenSSL 다운로드 인증서 및 Python 실행 별칭 관련 주의사항도 설명한다. 이번에는 사전 빌드가 정상 실행되어 이 도구들을 추가하지 않았다.

초기에는 `npm install --save-exact mediasoup@3.32.0 --ignore-scripts`로 패키지와 설치 스크립트를 확인했다. 공식 Windows x64 asset의 HTTP 200을 확인한 후 다음 명령으로 해당 버전에 한해서 설치 스크립트를 허용하고 실행했다.

```powershell
npm install-scripts approve mediasoup --allow-scripts-pin
npm rebuild mediasoup --foreground-scripts
```

이 허용 범위는 package.json의 `allowScripts`에 `mediasoup@3.32.0: true`로 저장했다. 전역 npm 설정은 변경하지 않았다. 이후 신규 설치는 루트에서 `npm ci`로 가능하며, 별도 임시 폴더에서도 실제 재현했다. worker 다운로드에는 npm 레지스트리 외에 GitHub Release 접근이 필요하다.

사전 빌드가 없거나 실행되지 않는 다른 환경에서 로컬 빌드 조건을 임의로 마련하지 않는다. 다운로드 실패 로그와 Python·MSVC 등 필요한 조건을 먼저 확인한다. 설치 스크립트의 기본 동작에는 로컬 빌드 fallback이 포함되므로, 다른 OS에서 동일하게 사전 빌드가 제공된다고 가정하지 않는다.

## 구현과 역할

- `server/src/sfu.ts`: worker 하나와 그 아래 Router 하나를 생성한다. Router 생성 실패 시 먼저 만든 worker도 종료한다. `close()`는 중복 호출에 같은 Promise를 반환하며 Router를 닫은 뒤 worker 자식 프로세스 종료까지 기다린다.
- `server/src/sfu-check.ts`: 기존 서버 TypeScript 설정을 사용하는 독립 검증 진입점이다. 단발 실행 또는 Ctrl+C까지 대기하는 실행을 제공한다. 정상 종료·SIGINT·SIGTERM 요청 및 worker 사망 시 정리하고, 실패는 종료 코드 1로 보고한다.
- `scripts/sfu.test.cjs`: Node 기본 테스트 러너와 실제 native worker로 생명주기를 검증한다. 별도 테스트 라이브러리는 추가하지 않았다.
- 기존 HTTP 서버의 진입점은 유지했다. `dev:server`와 `start:server`가 SFU를 자동 생성하지 않으며, 이후 미디어 Step에서 서버 상태·방과 연결한다.

worker는 실제 미디어 처리를 맡는 OS 자식 프로세스이며, Router는 그 worker 안의 논리적 미디어 전달 단위다. Router마다 별도 OS 프로세스가 생기는 것은 아니며, 애플리케이션 회의방의 참가자·권한 상태를 자동으로 제공하지 않는다. 생성·종료 API와 이벤트는 [공식 API](https://mediasoup.org/documentation/v3/mediasoup/api/), 애플리케이션의 객체 정리 책임은 [공식 자원 관리 문서](https://mediasoup.org/documentation/v3/mediasoup/garbage-collection/)를 기준으로 삼았다.

초기 코덱은 Opus(48,000 Hz, 2채널)와 VP8(90,000 Hz)다. 실제 생성된 Router capabilities에서 두 코덱을 확인했고, VP8의 보조 RTX 항목은 mediasoup가 추가했다. RTX를 입력 mediaCodecs에 직접 추가하지 않았다. Router capability와 브라우저 capability를 이용한 송수신 파라미터 협상은 이후 필요하다. [공식 RTP 문서](https://mediasoup.org/documentation/v3/mediasoup/rtp-parameters-and-capabilities/)

## 실행과 종료

저장소의 실제 긴 경로에서 다음을 실행한다.

```powershell
npm ci

# worker + Router 생성 후 자동으로 닫고 종료
npm run sfu:check

# 생성 상태 유지, 같은 터미널에서 Ctrl+C로 종료
npm run sfu:run

# 서버 컴파일 후 실제 worker 기반 테스트
npm run test:sfu

# 기존 양쪽 검사 및 빌드
npm run typecheck
npm run build

# 컴파일 결과로도 단발 실행 가능
node server/dist/sfu-check.js --once
```

단발 실행에서 확인한 출력 예시는 다음과 같다. PID와 Router ID는 실행마다 달라진다.

```text
SFU worker created pid=27472
SFU router created id=f7cf8936-df37-4fab-8769-3a7fc288bc17 codecs=audio/opus,video/VP8,video/rtx
SFU ready (worker + Router only; no media transports)
SFU router closed id=f7cf8936-df37-4fab-8769-3a7fc288bc17 closed=true
SFU worker closed pid=27472 subprocessClosed=true
```

`closed=true`만으로 자식 프로세스 종료를 추정하지 않고 `subprocessclose` 이벤트 또는 `subprocessClosed` 상태까지 확인한다. 5초 내 정상 종료가 되지 않으면 소유한 worker PID에 강제 종료를 요청하고 오류를 보고한다. worker가 예기치 않게 죽으면 상주 CLI는 오류 코드로 종료하며 자동 재생성하지 않는다.

## 검증 결과

| 검증 | 실제 결과 |
| --- | --- |
| 공식 사전 빌드 다운로드·실행 호환 검사 | 통과, 설치 로그에서 current host 유효 판정 |
| 깨끗한 임시 폴더 npm ci | 통과, 47개 패키지 설치·48개 감사·취약점 0건 보고, 이어서 worker·Router 실행·종료 통과 |
| worker·Router 코덱 및 Transport 부재 | 실제 Router dump의 transportIds가 빈 배열임을 확인, Opus·VP8 capability 확인 |
| 정상·중복 종료 | Router closed, worker closed·subprocessClosed 및 worker PID 소멸 확인 |
| 단발 CLI 반복 3회 | 매회 코드 0, 생성·종료 로그 및 PID 소멸 확인 |
| Router 생성 실패 | 지원하지 않는 코덱을 입력해 실제 실패 유도, 기존 worker 정리와 PID 소멸 확인 |
| worker 실행 중 강제 종료 | 준비된 자식 PID에 SIGKILL, died 로그·Router 정리·CLI 코드 1·worker PID 소멸 확인 |
| worker 바이너리 누락 | 별도 자식의 MEDIASOUP_WORKER_BIN을 없는 경로로 지정, ENOENT 보고·CLI 코드 1 확인 |
| 실제 터미널 Ctrl+C | SIGINT 정리 로그, Router·worker 종료 상태 및 잔류 worker 없음 확인 |
| npm run test:sfu | 5/5 통과 |
| npm run typecheck | 클라이언트·서버 모두 통과 |
| npm run build | 클라이언트·서버 모두 통과 |
| Step 01 회귀 | 기존 빌드 HTTP 서버 health 200 및 JSON, 잘못된 경로 404 확인. Vite 개발 화면을 headless Chrome·Edge에서 실제 렌더링하고 기존 문구·health 링크 확인 |
| 기존 자동 기록기 | 26/26 테스트 통과, 기존 기록 7개 검사에서 suspicious 0·failed false |
| 최종 잔류 확인 | mediasoup-worker 프로세스 없음, 검증 HTTP·Vite 포트 3000·5173 리스너 없음 |

Windows npm 터미널의 Ctrl+C는 셸 실행 결과 코드 1로 관찰됐지만, 애플리케이션의 SIGINT 정리 로그와 native worker 소멸은 확인했다. 자동 검증의 단발 성공 코드와 구분한다.

## 발견한 문제와 미검증 사항

- 설치 차단 문제는 mediasoup 정확한 버전의 프로젝트 내 allowScripts 설정으로 해결했다. npm 11 등 다른 버전의 설치 스크립트 정책은 직접 검증하지 않았다.
- 간접 의존성 node-domexception 1.0.0의 deprecated 경고가 있다. mediasoup → node-fetch → fetch-blob 경로의 의존성이며, 이 경고와 실행 실패를 동일시하지 않았다.
- 기존 esbuild 0.28.2 postinstall 차단 경고는 유지된다. 현재 tsx·검사·빌드와 신규 설치 후 worker 실행이 통과했으며 esbuild 허용 범위는 변경하지 않았다.
- 기존 브라우저 환경의 DevTools Hook shim/Fast Refresh 경고도 관찰됐다. 현재 기본 화면 렌더링은 통과했으며 상태 보존 Fast Refresh와 육안·클릭 검증은 이번에 수행하지 않았다.
- 로컬 C++ 컴파일, 사전 빌드 다운로드 차단 환경, worker 종료 5초 timeout fallback, 시작 도중 신호 경합, 부모 프로세스 강제 종료 및 다른 OS는 미검증이다. Windows에서 프로그램으로 보내는 SIGTERM은 Ctrl+C와 같다고 가정하지 않았다.
- 실제 Transport·Producer·Consumer, ICE/DTLS, RTP 송수신, 미디어 포트 도달성, 브라우저 코덱 협상 및 3인 통화는 미구현·미검증이다. 이 항목은 이후 Step의 범위다.
- AGENTS.md, 기존 ChatHistory, .codex Hook과 기록기는 변경하지 않았다. 같은 대화의 수동 중복 기록은 만들지 않았다. 이번 응답의 자동 기록 완료 여부는 Stop Hook 실행 후 확인해야 한다.
- Commit·Push는 실행하지 않았다.

## 이후 미디어 구현에서의 결정과 주의점

로컬 1대 실습의 미디어 bind 주소는 **127.0.0.1**, Transport에서 사용할 포트 범위의 초기안은 **40000~40100, UDP 우선·TCP 대안**으로 정한다. 이번 실행은 Transport를 만들지 않아 해당 포트를 바인딩하지 않으며 실제 가용성·방화벽·미디어 도달성은 미검증이다. Step 07에서 Transport listenInfos의 portRange 등에 반영하고 검증한다. 여러 PC로 확장할 때는 루프백 주소 대신 참가자에게 도달 가능한 IP와 announcedAddress를 별도로 검토해야 한다.

서버가 방 소속과 미디어 자원 소유권을 관리하고, WebSocket Signaling과 SFU 미디어 전송 역할을 구분해야 한다. 브라우저 RTP capability 교집합, ICE·DTLS 완료, 실제 수신 통계와 재생을 차례로 확인한다. 퇴장·실패 시 Transport·Producer·Consumer 참조까지 정리하고 worker 장애 정책을 명시한다. 이번 worker·Router 생성 성공만으로 이러한 연결이 성공했다고 판단하지 않는다.
