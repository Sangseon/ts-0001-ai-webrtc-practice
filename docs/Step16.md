# Step 16 — WebSocket 테스트 안정성·종료 정리

## 목적과 범위

[PLAN](./PLAN.md)의 Step 16은 [Step13](./Step13.md)에서 관찰한 `npm run test:ws`의 **본문 19/19 뒤 러너 비종료**와 과거 `signaling timeout closes socket` 간헐 실패를 조사하는 단계다. [Step15](./Step15.md)에서는 두 문제를 해결된 것으로 판단하지 않았다. 이번에는 테스트 연결의 소유·정리와 Signaling timeout의 실제 종료 이벤트를 확인했다. 세션·SFU 제품 코드, 테스트 프레임워크와 기존 기능 계약은 변경하지 않았다.

시작 시 `git status --short`와 `git diff --stat`는 출력이 없었다. Node.js 24.22.1, npm 12.2.1과 저장소의 `ws` 8.22.0을 사용했다. [QC](./QC.md)의 QC-013·022·023·024를 참고하되 QC 확인 상태와 [QA](./QA.md)의 수동 인수 결과는 변경하지 않았다.

## 변경 전 분석과 재현

### A. WebSocket 러너 비종료

`scripts/ws.test.cjs`의 `setup(t)`는 HTTP/WebSocket 서버를 만들고 `t.after(() => app.close())`만 등록했다. `connect()`가 만든 **테스트 클라이언트 WebSocket은 테스트별 정리 대상에 등록되지 않았다**. 많은 테스트는 클라이언트가 열린 채 본문을 마치므로, 클라이언트 종료를 서버 측 `app.close()`에서 상대편 연결을 끊는 효과에 의존했다. 이는 테스트 자원 소유권의 확인된 빈틈이다. 다만 Step 13의 비종료 실행에서 어떤 소켓·타이머·테스트 러너 핸들이 실제로 남았는지 계측 기록은 없다. 따라서 이 빈틈을 **과거 비종료의 단독 원인으로 단정하지 않는다**.

`server/src/application.ts`를 확인하면 `close()`는 heartbeat interval을 `clearInterval`하고 서버 WebSocket을 `terminate()`한 뒤 `wss.close()`, HTTP `server.close()`, SFU 서비스 종료를 기다린다. 중복 `close()`는 동일 Promise를 반환한다. 이번 조사에서 이 제품 종료 경로의 재현 가능한 결함은 확인되지 않았다. `scripts/ws.test.cjs`는 별도 앱·임시 포트로 테스트를 구성하며 `roomRequest`의 순번 변수만 공유한다. 이를 비종료 원인으로 볼 증거는 없다.

변경 전 제한 실행에서 **원래의 비종료는 재현되지 않았다**. 대신 첫 전체 실행의 초과 payload 반복 테스트에서 10번째 연결이 1009 대신 1006으로 닫혀 18/19·종료 코드 1이 되었다. 러너는 정상 종료했다. 같은 전체 명령의 다음 실행은 19/19·코드 0, 해당 테스트만 집중 실행한 결과는 1/1·코드 0이었다. 이 첫 실패를 재실행 성공으로 지우지 않는다. 4,097-byte를 보내는 `ws` Close 핸드셰이크의 전송·상대 수신 타이밍이 관여할 수 있지만, 이번 실행에는 해당 연결의 내부 프레임·TCP 상태 계측이 없어 1006의 원인은 **미확인**이다. [Step03](./Step03.md)에도 별도 stress에서 간헐 1006이 기록되어 있다. 1009 assertion은 유지했다.

### B. Signaling timeout 간헐 실패

`client/src/useSession.ts`는 media 요청별 8,000ms 타이머를 만들고, 응답이 없으면 요청을 reject한 뒤 `socket.close()`를 호출한다. `onclose`는 대기 요청을 정리하고 화면을 연결 종료 상태로 만든다. `scripts/sfu-browser.scenarios.cjs`의 시나리오는 capabilities 요청을 **고의로 전송하지 않은 뒤** 종료 상태를 기다린다. 공통 `until()`은 100ms 간격 최대 150회, 약 15초다. 타이머의 시작 시점, WebSocket Close 이벤트, React 화면 갱신, CDP 평가 사이에 시간이 들 수 있다. 과거 실패에서 이 가운데 어느 단계가 늦었는지 기록되지 않아 PC 부하·Close 핸드셰이크·화면 반영 중 하나를 원인으로 특정할 수 없다.

변경 전 Chrome·Edge 가상 장치 브라우저 시나리오 1회는 성공했다. 8초 타이머가 실제로 발화했는지와 소켓 Close 이벤트가 있었는지는 기존 테스트 출력만으로는 직접 구분되지 않았다.

## 최소 수정

| 파일 | 수정 | 기존 검증 조건 |
| --- | --- | --- |
| `scripts/ws.test.cjs` | `setup(t)`의 URL별 Set에 `connect()`가 만든 클라이언트 소켓을 등록한다. 테스트 종료 Hook에서 열린 클라이언트의 Close 이벤트를 등록하고 `terminate()`한 뒤 서버 `app.close()`와 클라이언트 종료를 모두 기다린다. | 19개 테스트, 4,096/4,097-byte 경계, 1009 assertion, 프로필·방·채팅·종료 기대값 유지 |
| `scripts/sfu-browser.scenarios.cjs` | capabilities 요청의 실제 누락 횟수, WebSocket Close 이벤트와 시작 후 경과 시간을 기록한다. Close와 기존 화면 종료 상태를 **같은 기존 약 15초 대기 안에서** 확인하고 8초 타이머보다 이른 종료를 거절한다. | 실제 SFU RTP·DTLS·오류 복구, 로컬 트랙 유지, timeout 시 소켓·화면 종료 조건 유지 |
| `docs/Step16.md`, `README.md`, `docs/PLAN.md` | 조사 결과, 문서 링크와 Step 상태 기록 | 기존 Step 01~15 기록 유지 |

클라이언트 소켓을 테스트가 직접 소유하는 변경은 서버 정리에만 기대던 상태를 줄이고, 종료 Hook 자체가 두 종류의 연결 완료를 기다리게 한다. 브라우저 검증은 누락 요청 1건과 Close 이벤트·경과 시간을 추가로 검사한다. timeout 값을 늘리거나 sleep·skip·무조건 PASS·`process.exit(0)`을 추가하지 않았다. 제품 코드와 공통 테스트 하네스는 변경하지 않았다.

## 실행 결과

실행은 순차로 진행했다. 아래의 시간은 도구가 보고한 명령 실행 경과 시간이며 브라우저 명령에는 서버·브라우저 기동과 정리까지 포함된다. 각 회차의 본문 결과와 프로세스 종료를 분리했다.

| 단계·명령 | 본문 결과 | 러너 종료·코드 | 약 소요 시간 |
| --- | --- | --- | ---: |
| 변경 전 1회 `npm run test:ws` | **18/19**; 초과 payload 10번째 연결 1006≠1009 | 정상 종료, **1** | 5.3초 |
| 변경 전 2회 `npm run test:ws` | 19/19 | 정상 종료, 0 | 3.6초 |
| 변경 전 집중 `node --test --test-name-pattern="oversized payload repeatedly completes the 1009 close handshake" scripts/ws.test.cjs` | 1/1 | 정상 종료, 0 | 0.5초 |
| 변경 전 `npm run test:sfu:browser` | Chrome·Edge 가상 장치 RTP와 Signaling timeout 시나리오 통과 | 정상 종료, 0 | 약 45초 |
| 수정 후 1회 `npm run test:ws` | 19/19 | 정상 종료, 0 | 3.7초 |
| 수정 후 2회 `npm run test:ws` | 19/19 | 정상 종료, 0 | 3.6초 |
| 수정 후 3회 `npm run test:ws` | 19/19 | 정상 종료, 0 | 3.7초 |
| 수정 후 중간 `npm run test:sfu:browser` | 진단 추가 버전 통과 | 정상 종료, 0 | 약 47초 |
| 수정 후 최종 `npm run test:sfu:browser` | 최종 동일 대기 한도에서 통과 | 정상 종료, 0 | 약 36초 |

최종 브라우저 로그는 `SIGNALING_TIMEOUT {"dropped":1,"closed":true,"elapsed":8008}`을 남겼다. 이는 테스트가 capabilities 요청을 한 번 누락했고, 약 8.008초 뒤 소켓 Close 이벤트를 관찰했다는 뜻이다. 이어 화면의 연결 종료, SFU 송신 정리, 로컬 트랙 유지가 확인됐다. Chrome·Edge의 실제 가상 장치 RTP·ICE/DTLS 검증과 브라우저 런타임 예외 0건도 같은 실행에서 확인했다. 사람이 듣는 음성이나 물리 장치 검증은 아니다.

`node --check`로 변경한 두 `.cjs`의 문법을 확인했고 `git diff --check`는 공백 오류를 보고하지 않았다. 테스트 assertion을 삭제하거나 실패 조건을 완화하지 않았다. 이번 변경은 테스트 코드뿐이므로 제품 코드의 별도 `typecheck`·전체 빌드·다자간 브라우저 회귀는 실행하지 않았다. `test:ws` 명령 자체가 각 회차 서버 빌드를 수행하며, SFU 브라우저 명령으로 관련 Signaling·실제 RTP 경로를 재확인했다. `test:sfu:ws`는 이 두 테스트 파일을 공유하지 않으므로 이번에 재실행하지 않았다.

## 자원과 남은 문제

수정 후 `test:ws`의 종료 Hook은 각 테스트의 클라이언트 Close와 HTTP/WebSocket 서버 종료를 기다린다. 세 전체 회차는 별도 강제 종료 없이 코드 0으로 끝났다. 브라우저 하네스는 자신이 시작한 Node·Chrome·Edge 프로세스와 임시 프로필을 정리했다. 최종 프로세스·포트·프로필 잔류 결과는 작업 종료 시 별도로 확인해 보고한다.

| 문제 | 판정 | 근거와 한계 |
| --- | --- | --- |
| Step 13의 `test:ws` 19/19 뒤 비종료 | **부분 해결** | 테스트 소켓 소유권 빈틈을 수정하고 수정 후 3/3 정상 종료. 원래 비종료는 이번에 재현되지 않아 당시 남은 핸들의 정체와 단독 원인은 미확인 |
| `signaling timeout closes socket` 간헐 실패 | **재현 불가·원인 미해결** | 변경 전 1회·수정 후 2회 통과. 최종 8.008초 Close 증거를 추가했으나 과거 실패 단계는 확인 불가 |
| 초과 payload 반복 테스트의 1006 | **미해결** | 변경 전 1/2 전체 실행에서 10번째 연결이 1006; 집중 실행과 수정 후 3회는 1009. Close/TCP 계층 원인은 미확인, 1009 assertion 유지 |

따라서 Step 16은 **부분 완료**다. 제한된 반복에서 WebSocket 테스트의 본문과 러너 종료가 안정적이었으나, 원래 비종료와 timeout 간헐 실패의 근본 원인을 확인했다고 주장하지 않는다. 추가 재현 시 실패 시점의 소켓 Close 코드·Close 프레임·열린 핸들·CDP/화면 상태를 함께 수집해야 한다. 전체 QC와 사용자 수동 QA는 [Step 19](./PLAN.md)의 별도 작업이다.
