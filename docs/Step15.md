# Step 15 — 언어 혼용·구조 QC와 최소 개선

## 목적과 판단 범위

[PLAN](./PLAN.md)의 Step 15에 따라 TypeScript 중심 구조, CommonJS 테스트·도구의 역할, 타입 검사 범위, 제품 코드의 소유권과 중복을 현재 저장소에서 점검했다. 확장자 비율만으로 결함을 판단하지 않았다. 이번 결론은 **코드 변경 불필요**다. [QC](./QC.md)의 A~G 관련 기준을 참고한 구조 점검 결과이며, QC 표의 사용자 `확인` 상태나 전체 [QA](./QA.md) 인수 결과를 갱신한 것은 아니다.

시작 시 `git status --short`와 `git diff --stat`는 모두 출력이 없어 작업 트리가 깨끗했다. 현재 설치된 Node.js는 24.22.1, npm은 12.2.1, TypeScript는 7.0.2, `tsx`는 4.23.15다. `package.json`의 실행 스크립트와 `npm ls --depth=0`의 실제 설치 버전을 대조했다. 의존성 추가·설정 변경은 하지 않았다.

## 추적 파일과 검사 범위

`git ls-files -- client server scripts`로 추적 중인 `.ts/.tsx/.js/.cjs/.mjs`만 집계했다. 빈 줄을 제외한 줄 수는 `Get-Content -Encoding utf8`로 계산했으며, 주석은 코드 줄에서 제외하지 않았다.

| 확장자 | 파일 수 | 전체 줄 | 비어 있지 않은 줄 | 소속 |
| --- | ---: | ---: | ---: | --- |
| `.ts` | 15 | 1,925 | 1,846 | client/server 제품·개발 진입점 |
| `.tsx` | 7 | 363 | 351 | React 제품 UI |
| `.cjs` | 23 | 2,711 | 2,614 | `scripts/` 테스트·fixture·Hook |
| 추적 `.js`·`.mjs` | 0 | 0 | 0 | 없음 |
| 합계 | 45 | 4,999 | 4,811 |  |

추적 코드의 전체 줄 기준 TypeScript/TSX는 2,288줄(45.8%), CommonJS는 2,711줄(54.2%)이다. 이는 테스트 시나리오와 브라우저 하네스의 크기를 반영한다. 제품 소스는 TypeScript/TSX다. `server/dist`에서 현재 `.js` 산출물 8개를 확인했으며, `dist/`, `node_modules/`, `*.tsbuildinfo`는 `.gitignore` 대상이므로 위 집계에 포함하지 않았다. 이 산출물과 외부 라이브러리를 JavaScript 제품 원본으로 세지 않았다.

`tsconfig.base.json`은 `strict: true`, `isolatedModules`, `verbatimModuleSyntax`, `noEmitOnError`를 설정한다. `client/tsconfig.json`은 `client/src`와 `vite.config.ts`, `server/tsconfig.json`은 `server/src`를 포함한다. `npm run typecheck`는 두 프로젝트를 검사한다. **`scripts/*.cjs` 23개와 Hook 실행 명령은 TypeScript strict 검사 대상 밖**이다. 이는 테스트·도구 코드의 타입 사각지대이며, 제품 코드가 검사에서 빠졌다는 증거는 찾지 못했다. Node 내장 테스트 러너는 JavaScript를 직접 실행하고, TypeScript 소스를 읽는 단위 테스트는 `--import tsx`, 빌드 서버를 쓰는 테스트는 `server/dist`의 ESM을 `import()`로 연결한다.

## CommonJS 파일별 역할과 전환 판단

아래 표의 모든 `.cjs`는 strict 검사 **미적용**이다. `직접`은 `package.json`의 해당 npm script가 실행함을, `하네스`는 `media.browser.cjs`가 `require()`함을 뜻한다. CommonJS의 공통 근거는 `package.json`의 `type: module` 아래에서도 `.cjs`로 Node의 `require`, `module.exports`, `__dirname`, `fork`와 현재 Hook 명령을 별도 변환 없이 실행할 수 있다는 점이다. TypeScript 전환의 공통 이점은 테스트·fixture의 정적 검사이며, 공통 위험은 ESM/CJS 로딩·`tsx` 또는 빌드 경로·Hook 실행 방식 변경이다. 아래의 이점과 위험은 각 파일의 추가 사유다.

| 파일 | 역할·실행 지점·주요 의존성 | 전환 이점 / 추가 위험 | 판단 |
| --- | --- | --- | --- |
| `scripts/chat-history.cjs` | Hook 본체; `.codex/hooks.json`의 UserPromptSubmit/Stop에서 `node` 직접 실행, Node fs·crypto·child_process 사용 | 입력·출력 타입 명시 / Hook의 무변환·실패 개방 실행 경로가 바뀜 | 유지 |
| `scripts/chat-history.test.cjs` | Hook 단위·CLI 테스트; `node --test` 직접, 기록기·임시 Git 저장소 의존 | fixture 타입 / 격리 실행과 CJS 호출 변경 | 유지 |
| `scripts/devices.fixture.cjs` | 브라우저 장치 A/B Mock 주입 문자열; `media.browser.cjs`가 CDP로 주입 | Mock 계약 명시 / 직렬화·주입 경로 변경 | 유지 |
| `scripts/media.browser.cjs` | Chrome·Edge CDP 공통 하네스; `test:media:browser` 직접 및 다른 브라우저 진입점에서 호출, ws·Vite·서버·fixture·scenario 의존 | 페이지/IPC 계약 타입화 가치 있음 / 프로세스·CDP·정리 경로 전면 영향 | 유지, 향후 선택적 타입화 후보 |
| `scripts/media.test.cjs` | `test:media`; Node test와 `--import tsx`로 로컬 미디어·장치 TS 모듈 import | Mock 트랙 타입 / TS 로더 경로 중복 | 유지 |
| `scripts/microphone-level.test.cjs` | `test:meter`; Node test와 `--import tsx`로 RMS TS 모듈 import | PCM fixture 타입 / 작은 테스트에 로딩 비용 추가 | 유지 |
| `scripts/microphone-meter.browser.cjs` | `test:meter:browser`; 환경 플래그 설정 후 공통 하네스 실행 | 플래그 타입 / 단순 진입점에 변환 단계 추가 | 유지 |
| `scripts/microphone-meter.fixture.cjs` | Web Audio 제어 신호·무음 주입 문자열; 하네스가 CDP로 주입 | fixture 계약 / 브라우저 주입 문자열 빌드 필요 | 유지 |
| `scripts/microphone-meter.scenarios.cjs` | 입력 미터 브라우저 검증; 하네스가 호출, CDP page helpers·React 모듈 의존 | helper 타입 / 가상 신호·페이지 평가 경로 변경 | 유지 |
| `scripts/sfu-browser.scenarios.cjs` | Step 07 송신 RTP 브라우저 시나리오; 하네스 호출 | helper 타입 / CDP 공통 계약 동시 변경 | 유지 |
| `scripts/sfu-controls.browser.cjs` | `test:sfu:controls:browser`; 플래그 후 하네스 실행 | 플래그 타입 / 진입점 복잡화 | 유지 |
| `scripts/sfu-controls.scenarios.cjs` | 카메라·마이크 제어 브라우저 검증; 하네스 helpers 의존 | 상태 fixture 타입 / CDP 계약 변경 | 유지 |
| `scripts/sfu-devices.browser.cjs` | `test:sfu:devices:browser`; 제어·장치 플래그 후 하네스 실행 | 플래그 타입 / 진입점 복잡화 | 유지 |
| `scripts/sfu-devices.scenarios.cjs` | 장치 선택·교체 브라우저 검증; 하네스 helpers·React 모듈 의존 | Mock 장치 타입 / 주입·페이지 평가 경로 변경 | 유지 |
| `scripts/sfu-multi-server.cjs` | 다자간 테스트 전용 서버 자식 프로세스; 하네스의 `fork()`, `server/dist/application.js` 동적 import·IPC 의존 | IPC 타입 / 자식 프로세스 진입·빌드 타이밍 변경 | 유지 |
| `scripts/sfu-multi.browser.cjs` | `test:sfu:multi:browser`; 플래그 후 하네스 실행 | 플래그 타입 / 진입점 복잡화 | 유지 |
| `scripts/sfu-multi.scenarios.cjs` | 3인 이상·다중 방 브라우저 시나리오; 하네스 helpers 의존 | 참가자/자원 snapshot 타입 / 대형 시나리오 로딩 변경 | 유지, 향후 선택적 타입화 후보 |
| `scripts/sfu-receive.browser.cjs` | `test:sfu:receive:browser`; 플래그 후 하네스 실행 | 플래그 타입 / 진입점 복잡화 | 유지 |
| `scripts/sfu-receive.scenarios.cjs` | 2인 수신·SFU 중단 브라우저 시나리오; 하네스 helpers 의존 | Consumer 증거 타입 / CDP 계약 변경 | 유지 |
| `scripts/sfu-ws.test.cjs` | `test:sfu:ws`; Node test·ws·빌드된 서버·mediasoup worker 의존 | 요청/응답 fixture 타입 / ESM 빌드와 Node test 로딩 영향 | 유지, 향후 선택적 타입화 후보 |
| `scripts/sfu.browser.cjs` | `test:sfu:browser`; 플래그 후 하네스 실행 | 플래그 타입 / 진입점 복잡화 | 유지 |
| `scripts/sfu.test.cjs` | `test:sfu`; Node test·빌드된 SFU CLI·native worker 의존 | subprocess 결과 타입 / worker 실행 경로 변경 | 유지 |
| `scripts/ws.test.cjs` | `test:ws`; Node test·ws·빌드된 application 의존 | 프로토콜 fixture 타입 / 알려진 러너 비종료와 함께 로더 변경 시 원인 분리 어려움 | 유지, 안정성은 Step 16 |

진입점 6개와 fixture 2개를 포함한 위 23개는 모두 테스트·자동화·기록 도구다. `scripts/sfu-multi-server.cjs`는 테스트 시에만 뜨는 서버로, 제품 서버의 복제 구현이 아니다. CommonJS는 Node 내장 `node:test`의 필수 조건은 아니지만, **현행 직접 실행과 하네스의 `require()` 계약을 유지하기에 적합**하다. 테스트 일부만 TypeScript로 옮기면 혼용 로더가 늘고 검증 경로가 갈라진다. 선택적 타입화를 한다면 먼저 하네스 helper·IPC 계약의 실질적 결함을 찾아 범위를 정해야 한다.

## 구조 점검과 품질 판단

| 관련 QC | 현재 코드에서 확인한 근거 | 판단·심각도 |
| --- | --- | --- |
| QC-001~003 | `package.json` 스크립트, 추적 파일과 `.gitignore`를 대조했다. client/server의 제품 TS, scripts의 테스트·Hook, `dist` 산출물이 분리된다. | 명확한 중복 제품 코드나 추적 산출물 없음. 낮음 |
| QC-004~005 | 두 tsconfig가 strict를 상속하며 이번 `typecheck`가 통과했다. `rg`로 `client/src`, `server/src`의 명시적 `any`, `@ts-ignore`/`@ts-expect-error`/`@ts-nocheck`를 찾지 못했다. | 제품 코드 검사 범위 적절. `as` 단언은 별도 검토. 낮음 |
| QC-006~008 | `server/src/shared/{protocol,mediaProtocol}.ts`가 메시지 계약·런타임 필드 검증을 공유하고, `application.ts`가 `maxPayload: 4096`과 세션 participantId를 권한 기준으로 사용한다. `useSession.ts`와 `useSfuSender.ts`는 응답·이벤트의 세대/ID를 확인한다. | 정적 계약만으로 네트워크 입력을 신뢰하지 않는 구조. 특정 경합의 전체 인수는 Step 19 범위 |
| QC-009~010 | `.cjs`는 `scripts/`에 한정되며 위 표의 진입·fixture·시나리오 의존성이 확인된다. | 타입 사각지대는 사실이나 즉시 전환 근거 없음. 낮음 |
| QC-011~017 | `application.ts`는 세션·룸·미디어 서비스를 연결하고, `rooms.ts`가 논리 소속을, `media.ts`가 단일 worker·방별 Router와 활성 mediaId·Transport·Producer·Consumer 소유권을 관리한다. | 책임 분리가 확인됨. 종료 순서의 간헐 문제는 Step 16. 보통 |
| QC-018~020 | `useLocalMedia.ts`가 Track/MediaStream 소유와 이전 트랙 stop을 담당하며, `useSfuSender.ts`는 `stopTracks:false`인 Producer와 원격 Consumer를 관리한다. `useMediaDevices.ts`는 `devicechange` 리스너를 제거하고, `useMicrophoneMeter.ts`는 RAF·ended·AudioContext 관련 자원을 정리한다. | 소유권 경계 확인. 전체 사용자 동작 재검증은 수행하지 않음 |
| QC-021~023 | Node 단위·WebSocket/SFU 통합·CDP 브라우저 시나리오가 분리되고, fixture는 Mock과 가상 장치 차이를 표시한다. 하네스는 종료 정리 경로를 갖는다. | 브라우저/프로세스 정리의 간헐 이슈를 해결했다고 판단하지 않음. 보통, Step 16 |

타입 단언 두 곳을 따로 확인했다. `server/src/media.ts`의 `Promise.resolve(null as unknown as Router)`는 Router 생성 중 참조할 `RoomRouter` 객체를 먼저 만들기 위한 자리표시자다. 같은 동기 호출에서 실제 생성 Promise로 교체한 뒤 Map에 넣으므로 이번 점검에서 잘못된 Router 사용은 관찰되지 않았다. 하지만 **실제 Router가 아닌 값을 Router로 단언하는 타입 우회**인 것은 사실이다. `client/src/useSfuSender.ts`의 `data as unknown as ConsumerOptions`도 `validMediaResponse`의 Boolean 런타임 확인을 mediasoup-client의 구조 타입으로 연결하는 단언이다. 검사기는 기본 필드를 검사하고 라이브러리 `consume()`이 세부 RTP 값을 처리하지만 정적 보장 범위가 넓지는 않다. 둘 다 낮은 수준의 유지보수 위험으로 기록하고, 재현 결함 없이 공통 SFU 생성·수신 경로를 바꾸지 않았다. 추후 실제 오류나 계약 확장 필요가 생기면 해당 경로만 좁혀 개선한다.

## 변경과 검증

제품 코드·테스트 코드·패키지·설정 **변경 없음**. 이번 변경은 이 문서, [README](../README.md)의 Step 15 링크, [PLAN](./PLAN.md)의 Step 15 상태 표시뿐이다. 따라서 변경 후 제품 회귀 테스트는 필요하지 않다. 변경 전 기준 상태 확인 및 CommonJS 실행 경로 점검으로 다음 명령을 **순차 실행**했다.

| 명령 | 현재 실행 결과 | 종료 코드 |
| --- | --- | ---: |
| `npm run typecheck` | client/server strict 검사 통과 | 0 |
| `npm run build` | client Vite·server tsc 빌드 통과; Vite의 506.02 kB JS 청크 경고는 기존 크기 경고 | 0 |
| `npm run test:media` | Node/tsx 로컬 미디어 8/8 | 0 |
| `npm run test:meter` | Node/tsx RMS 3/3 | 0 |
| `node --test scripts/chat-history.test.cjs` | 기록기 격리 테스트 26/26 | 0 |
| `npm run test:sfu` | native worker/Router 5/5, 러너 정상 종료 | 0 |

이번 실행에서 최초 실패·재실행은 없었다. `test:ws`, `test:sfu:ws`, Chrome·Edge 브라우저 테스트, 물리 장치 QA는 **이번에 실행하지 않았다**. 코드·테스트를 수정하지 않았고, 이전 PC 과부하와 알려진 종료 문제를 Step 16에서 분리해 다루기 위해 브라우저를 불필요하게 기동하지 않았다. [Step 13](./Step13.md)에는 `npm run test:ws` 첫 실행에서 본문 19/19 뒤 러너 비종료·수동 종료, 재실행 19/19·종료 코드 0이 남아 있다. 과거 `signaling timeout closes socket` 간헐 실패도 원인 미확정이다. 이번 단위·SFU 테스트의 정상 종료는 이 두 문제의 해결 증거가 아니다. 기록기 26/26은 현재 턴의 Stop Hook 기록 생성 증거도 아니다.

빌드 후 `git status --short`와 `git diff`로 산출물이 추적 변경에 섞이지 않았음을 확인했다. 브라우저·개발 서버를 이번 Step에서 기동하지 않았다. `npm run test:sfu`의 worker 종료와 러너 종료는 출력으로 확인했다. 마지막 점검에서 현재 작업 공간 경로를 명령줄에 포함한 Node·mediasoup-worker·Chrome·Edge 프로세스는 없었고, 일반 개발 포트 3000/3001/5173/5174의 리스너도 없었다. 시스템의 다른 작업까지 종료됐다는 뜻은 아니다.

## 결론과 다음 단계

현재 제품 코드는 TypeScript/TSX 중심이며 strict 검사에 포함된다. CommonJS는 테스트·브라우저 자동화·기록 도구에 한정되고 현행 Node 실행 계약에 맞으므로 유지한다. **실제 코드 수정은 필요하지 않다고 판단한다.** strict 밖의 테스트 코드와 두 타입 단언은 한계로 남긴다. 본 Step의 구조 분석·근거 기록·문서 검증 범위는 완료했으며, 전체 QC와 사용자 수동 QA는 수행하지 않았다.

[Step 16](./PLAN.md)은 `test:ws` 러너 비종료 및 Signaling timeout의 재현·원인·정리 개선을 맡는다. 대규모 `.cjs` 전환이나 테스트 하네스 재설계는 현재 근거로 제안하지 않는다. [Step 19](./PLAN.md)에서 전체 QC·QA를 실제 증거로 판정해야 한다.
