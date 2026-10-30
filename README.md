# WebRTC Conference Practice

## Overview

TypeScript와 Codex를 활용해 SFU 기반 다자간 화상회의를 단계별로 구현하는 실습 프로젝트다.

WebSocket 제어 메시지와 WebRTC 미디어 전송의 역할, 참가자 상태와 미디어 자원의 관리 방식을 학습한다.
현재는 TypeScript 실행 기반, SFU worker·Router 실행 검증, WebSocket 세션·프로필 동기화, 논리적 다중 회의방과 전체·회의방 채팅까지 구현했다.
로컬 카메라·마이크 획득과 미리보기도 구현해 Chrome·Edge 가상 장치로 검증했다. 물리 장치 인수 검증은 남아 있다.
SFU 단일 활성 회의방 송신도 구현했으며, Chrome·Edge 가상 장치에서 실제 ICE/DTLS 연결과 RTP 통계 증가를 확인했다.
2인 양방향 수신과 수신 전용 연결을 추가해 원격 영상 프레임·오디오 RTP·재생 상태를 검증했다. 실제 음성 청취는 미검증이다.
3인 동적 송수신·반복 재연결과 4개 브라우저 세션의 방 격리도 가상 장치로 검증했다. Map과 native SFU 자원 수를 비교해 정리를 확인했다.
회의 중 카메라 종료·재획득과 마이크 음소거·해제를 구현했다. 3인 가상 장치로 원격 상태와 실제 RTP 차단·재개를 검증했으며 물리 장치 제어·청취는 미검증이다.

Learning Repository의 `practice` 유형이며, Repository 이름은 `ts-0001-ai-webrtc-practice`다.

### Topics

- typescript
- webrtc
- sfu
- mediasoup
- real-time-communication

## Focus

- TypeScript strict 모드의 클라이언트·서버 실행 구조 이해
- SFU worker와 Router의 역할 및 자원 정리 과정 확인
- Signaling과 영상·음성 전송의 역할 구분
- 참가자 입장·퇴장과 미디어 연결 상태 관리

학습 목표 중 현재 구현한 범위는 아래 Scope에 구분한다.

## Tech Stack

| 영역 | 현재 사용 기술 |
| --- | --- |
| 언어 | TypeScript 7.0.2, strict 모드 |
| 클라이언트 | React 19.3.1, Vite 8.3.5 |
| 서버 | Node.js 24.22.1, 기본 HTTP 모듈, ws 8.22.0 |
| SFU 실행 검증 | mediasoup 3.32.0 |
| 브라우저 SFU 송수신 | mediasoup-client 3.25.3 |

## Scope

| 구분 | 내용 | 상태 |
| --- | --- | --- |
| 실행 기반 | React 기본 화면, HTTP 상태 확인, 개발 실행·타입 검사·빌드 | 완료 (Step 01) |
| SFU 실행 검증 | worker·Router 생성·종료, Opus·VP8 설정, 반복 실행·오류 정리 | 완료 (Step 02) |
| 세션·프로필 | WebSocket 접속자 목록, 닉네임·고정 아바타 변경·동기화 | 완료 (Step 03) |
| 회의방 | 생성·자동 입장·다중 참여·방별 퇴장·참가자 목록·빈 방 삭제 | 완료 (Step 04) |
| SFU 송신 | 단일 활성 방, 오디오·비디오 송신·전환·자원 정리 | 완료 (Step 07, 가상 장치 검증) |
| 미디어 수신 | 단일 활성 방의 2인 양방향·수신 전용, 원격 재생·정리 | 구현·가상 장치 검증, 실제 청취 대기 (Step 08) |
| 동적 다자간 미디어 | 3인 상호 수신·입퇴장·재연결, 개별 원본 종료·방 격리·자원 수 검증 | 구현·가상 장치 검증, 실제 청취 대기 (Step 09) |
| 채팅 | 전체·방별 전달, 프로필 연동, 브라우저 메모리 내역 | 완료 (Step 05) |
| 로컬 미디어 | 카메라만·마이크만·두 종류 선택 획득, 음소거 미리보기, 트랙 종료 | 구현·가상 검증, 물리 검증 대기 (Step 06) |
| Signaling | capabilities·Send/Recv Transport·Producer/Consumer·통계·종료 | 송수신 구현 (Step 07~08) |
| 미디어 제어 | 카메라 OFF/ON, 기존 Audio Producer pause/resume, 원격 상태 표시 | 구현·가상 장치 검증, 물리 인수 대기 (Step 10) |
| 장치 설정 | 장치 목록·선택·전환, 마이크 테스트 | 구현 예정 (Step 11~12) |

실제 SFU RTP 송수신은 3인 루프백·가상 장치까지 검증했으며 물리 장치의 실제 청취는 남아 있다.
다중 회의방 소속·채팅은 유지하고 실제 송수신은 참가자당 한 방으로 제한한다. 회의방 목록·채팅 화면 선택만으로 미디어 대상이 바뀌지 않는다.
인증·DB·녹화·화면 공유는 초기 필수 범위에서 제외한다.

## Implementation

단일 npm 패키지에서 클라이언트와 서버를 구분하고, 공통 TypeScript strict 설정을 적용한다.

- `client/`: 연결 상태·프로필·전체 접속자·다중 회의방·채팅 UI를 표시한다. 화면 선택과 실제 소속을 구분한다. `Chat.tsx`는 채팅 화면, `useSession.ts`는 단일 연결과 제한된 내역·공통 작성자 표시 정보를 관리한다.
- `client/src/LocalMedia.tsx`, `useLocalMedia.ts`: WebSocket 상태와 독립적으로 사용자 클릭에 따른 로컬 미디어 획득·재생·종료를 관리한다.
- `client/src/MediaPanel.tsx`, `useSfuSender.ts`: 기존 송신과 같은 활성 시도에 수신을 연결하고 명시적으로 전환·종료한다. `RemoteMedia.tsx`는 공통 프로필과 원격 영상·음성 재생을 표시한다.
- `server/src/media.ts`: 지연 생성 단일 worker·방별 Router·참가자별 활성 송수신 자원과 소유권을 관리한다.
- `server/src/index.ts`: HTTP·WebSocket 서버 실행 진입점이다. 세션·프로필의 기준 상태는 서버 메모리에 둔다.
- `server/src/shared/protocol.ts`: 양쪽의 메시지 타입·아바타 목록·런타임 검증을 공유한다.
- `server/src/rooms.ts`: 방별 참가자 ID 집합을 소속의 기준 상태로 관리하고 프로필은 세션에서 참조한다.
- `server/src/sfu-check.ts`: worker 하나와 Router 하나를 생성하고 종료하는 독립 검증 진입점이다.

Step 02 독립 SFU 검증은 별도 실행한다. 실제 송신용 worker는 첫 Signaling 요청 때 기존 서버 안에서 지연 생성한다. Router 생성 실패나 worker 사망 시에도 자원을 정리한다.

### Documents

- [Concept](./docs/Concept.md) — 프로젝트 개요 및 구현 방향
- [PLAN](./docs/PLAN.md) — Step별 구현 범위와 완료 기준
- [Step 01](./docs/Step01.md) — 실행 방법, 기술 선택 및 검증 결과
- [Step 02](./docs/Step02.md) — mediasoup 선택과 worker·Router 실행 검증
- [Step 03](./docs/Step03.md) — WebSocket 세션·프로필 구현과 검증
- [Step 04](./docs/Step04.md) — 다중 회의방·참가자 동기화와 검증, 기존 회귀 이슈
- [Step 05](./docs/Step05.md) — 전체·회의방 채팅, 메모리 내역과 실제 브라우저 검증
- [Step 06](./docs/Step06.md) — 로컬 미디어 생명주기, 가상 장치 결과와 물리 장치 수동 확인 절차
- [Step 07](./docs/Step07.md) — 단일 활성 SFU 송신·방 전환·실제 RTP 통계와 검증 한계
- [Step 08](./docs/Step08.md) — 2인 양방향 수신·수신 전용·원격 재생, 가상 검증과 실제 청취 대기
- [Step 09](./docs/Step09.md) — 동적 다자간 송수신·종료·재연결·방 격리와 native 자원 개수 검증
- [Step 10](./docs/Step10.md) — 카메라 재획득·마이크 pause/resume·음소거 유지와 실제 RTP 검증
- [ChatHistory](./docs/ChatHistory.md) — 기존 대화 자동 기록 사용 방법

## What I Learned

- Vite의 TypeScript 변환과 타입 검사를 구분하고, `tsc`로 클라이언트·서버를 별도 검사했다.
- Windows x64 사전 빌드 worker를 실행해, Router가 worker 자식 프로세스 안에서 생성되는 구조를 확인했다.
- 객체의 종료 상태와 자식 프로세스의 실제 종료를 각각 확인하고, 반복 실행·실패 상황에서 worker가 남지 않는지 검증했다.
- 서버가 연결의 ID를 기준으로 프로필을 변경하고, 잘못된 요청과 연결 종료 후에도 다른 사용자의 상태를 유지하는지 확인했다.
- 방별 ID 집합으로 다중 소속을 표현하고, 한 방 퇴장과 연결 전체 종료의 정리 범위를 구분해 검증했다.
- 같은 WebSocket에서 전체·방별 메시지의 수신 범위를 검증하고, 공통 프로필 변경이 기존 채팅 작성자 표시에도 반영되는지 확인했다.
- 브라우저 가상 장치로 미리보기 종료·컴포넌트 해제·늦은 획득 응답의 트랙 정리와 video 참조 제거를 확인했다.
- Producer 생성과 실제 RTP 송신을 구분해 브라우저 송신·SFU 수신 카운터 증가를 확인하고, stopTracks:false로 방 전환 시 로컬 트랙을 재사용했다.
- Consumer 생성 후 브라우저 준비·서버 재개 순서를 연결하고, 수신 RTP 증가·디코딩·영상 프레임을 함께 확인했다. 수신 전용의 자동 재생 차단과 사용자 클릭에 의한 재개도 검증했다.
- 3인 입퇴장과 개별 원본 종료가 다른 미디어·논리 소속에 영향을 주지 않는지, 반복 실행 후 Map·worker/Router 덤프의 자원 수가 기준으로 돌아오는지 검증했다.
- 카메라는 트랙과 Producer를 다시 만들고 마이크는 기존 Producer를 유지하는 차이를 확인했다. 서버 pause·원격 Consumer 상태와 RTP 통계를 함께 측정하고 방 전환 중 음소거를 유지했다.

상세 검증 결과와 미검증 항목은 Step 문서에서 확인할 수 있다.

## AI Usage

Mode: ai

Codex를 개발 계획, 코드 생성, 테스트 작성·실행 및 문서 정리에 활용한다.
사용자는 Step별 범위와 제약을 정하고, 변경 내역과 타입 검사·빌드·로컬 실행 결과를 기준으로 검토·검증을 진행한다.
개발 대화의 자동 기록 방식은 [ChatHistory 문서](./docs/ChatHistory.md)에 정리했다.

## How to Run

### 준비 및 의존성 설치

Node.js 24.x와 npm 11 이상을 사용한다. 검증 환경은 Node.js 24.22.1, npm 12.2.1이다.
저장소의 실제 긴 경로에서 의존성을 설치한다. mediasoup worker 다운로드에는 GitHub Release 접근이 필요하다.

```powershell
npm ci
```

### 클라이언트·서버 실행

저장소 루트의 두 터미널에서 각각 실행한다.

```powershell
# 터미널 1: 클라이언트 http://127.0.0.1:5173
npm run dev:client
```

```powershell
# 터미널 2: 서버 http://127.0.0.1:3000/health
npm run dev:server
```

각 터미널에서 `Ctrl+C`로 종료한다. 서버 상태 확인 응답은 `{"status":"ok"}`다.
서버 없이도 화면은 열리며 연결 오류가 표시된다.

Chrome과 Edge에서 화면을 각각 열어 서로 다른 ID와 접속자 목록을 확인한다.
닉네임·아바타를 변경하면 다른 화면에도 반영되며, 연결 종료 후 `다시 연결`하면 새 ID가 발급된다.
클라이언트는 같은 호스트의 포트 3000 `/ws`에 연결한다.

회의방을 생성하면 자동 입장하며, 여러 방에 동시에 참여할 수 있다. 방 선택은 화면만 바꾸고 `선택한 방 퇴장`은 그 방 소속만 제거한다.
Chrome·Edge의 세 독립 세션에서 A는 방 1·2, B는 방 1, C는 방 2로 참가자 목록을 비교할 수 있다.

채팅 화면에서 전체 또는 참여 중인 방을 선택해 전송한다. 메시지는 앞뒤 공백을 제거한 1~500자이며, 채널별 최근 100개·전체 500개를 브라우저 메모리에 보관한다. 방 퇴장 시 그 방 내역, 연결 종료 시 전체 내역을 지운다. 선택만으로 방 소속이 바뀌지 않는다.

획득할 카메라·마이크 종류를 체크한 뒤 `로컬 미디어 시작`을 누른다. 카메라만·마이크만·두 종류 모두를 지원하며 선택하지 않은 장치는 요청하지 않는다. 모두 미선택이면 요청하지 않으며 미디어 없이도 방·채팅을 이용할 수 있다. 영상 미리보기는 음소거되고, 마이크만 획득하면 로컬 재생은 하지 않는다. `로컬 미디어 종료`는 획득한 모든 트랙을 중지한다. 종류 변경은 종료 후 다시 시작하며, 송신 중 ON/OFF나 특정 장치 선택 기능은 아니다. WebSocket 종료와 미디어 종료는 독립적이다. localhost·127.0.0.1을 사용하며 물리 장치 확인 절차는 Step 06 문서를 따른다.

### 타입 검사 및 빌드

```powershell
npm run typecheck
npm run build
```

빌드 결과는 별도 터미널에서 각각 실행한다.

```powershell
npm run preview:client
npm run start:server
```

빌드 화면은 `http://127.0.0.1:4173`에서 확인한다.
개별 검사·빌드 명령과 문제 해결 방법은 [Step 01 문서](./docs/Step01.md)를 참고한다.

WebSocket 통합 테스트:

```powershell
npm run test:ws
```

로컬 미디어 검증:

```powershell
npm run test:media          # Mock 단위 테스트
npm run test:media:browser  # Windows Chrome·Edge 가상 장치, 개발 서버를 먼저 종료
```

가상 장치 테스트는 별도 임시 브라우저 프로필을 만들고 종료 후 제거한다. 실제 카메라·마이크 하드웨어나 권한 대화상자 검증을 대신하지 않는다.

SFU 송수신은 로컬 미디어 획득·방 입장 후 별도 `미디어 대상 회의방`을 선택하고 `SFU 송신 시작`을 누른다. 같은 활성 방의 원격 미디어를 함께 수신한다. 장치 없이 받으려면 `선택한 방 수신만 연결`을 누른다. `선택한 방으로 미디어 전환`은 이전 송수신을 종료한 뒤 새 방으로 연결한다. `SFU 송수신 종료`는 로컬 트랙을 유지하며 `로컬 미디어 종료`는 송신 중인 연결도 정리한다. WebSocket 유실은 송수신을 정리하지만 로컬 트랙은 별도 종료해야 한다. 원격 재생이 차단되면 타일의 재생 버튼을 누른다. 실제 이어폰 마이크·청취 확인 절차는 [Step 08 문서](./docs/Step08.md)를 따른다.

```powershell
npm run test:sfu:ws       # 실제 native worker 기반 Signaling·소유권·경합 테스트
npm run test:sfu:browser  # 개발 서버 종료 후 Chrome·Edge 가상 장치의 실제 RTP 검증
npm run test:sfu:receive:browser # 2인 수신·재생·방 격리·SFU 중단 검증
npm run test:sfu:multi:browser   # 4개 독립 세션: 3인 상호 RTP·동적 종료·방 격리·native 자원 검증
npm run test:sfu:controls:browser # 3인 카메라·마이크 제어 5회 반복·RTP 차단/재개·경합 검증
```

SFU 송신 중 `카메라 OFF / 켜기 취소`, `카메라 ON`, `마이크 음소거/해제`를 사용한다. 카메라는 종료 후 다시 획득하고, 음소거는 기존 마이크 트랙과 Producer를 유지한다. 방 전환으로 음소거가 자동 해제되지 않는다. 수신 전용에서는 제어 버튼이 비활성이다. 실제 장치 수동 절차와 제한은 [Step 10 문서](./docs/Step10.md)를 따른다.

현재 미디어 주소는 127.0.0.1, UDP/TCP 포트 범위는 40000~40100이다. 다른 PC·LAN 배포는 검증하지 않았다. 물리 이어폰 마이크 송신 확인 절차는 Step 07 문서를 따른다.

세션·프로필 규칙은 [Step 03 문서](./docs/Step03.md), 회의방 규칙과 브라우저 절차는 [Step 04 문서](./docs/Step04.md)를 참고한다.
채팅 정책과 검증은 [Step 05 문서](./docs/Step05.md)를 따른다. 기존 초과 payload의 불필요한 강제 종료 경로는 별도 수정됐으며, 극단적 반복에서의 1006 관찰과 검증 한계는 [Step 03 후속 기록](./docs/Step03.md#2026-10-30-초과-payload-종료-경합-수정)에 남아 있다.

### SFU 실행 검증

worker·Router를 생성하고 종료 상태를 확인한다.

```powershell
npm run sfu:check  # 생성 후 자동 종료
npm run sfu:run    # 생성 상태 유지, Ctrl+C로 종료
npm run test:sfu   # 실제 worker 기반 테스트
```

설치 조건과 검증 범위는 [Step 02 문서](./docs/Step02.md)를 참고한다.

## References

- [Repository README Convention](https://github.com/Sangseon/00-conventions/blob/master/docs/repository-readme.md) — Learning Repository README 작성 기준
- [mediasoup v3 공식 문서](https://mediasoup.org/documentation/v3/) — SFU 설계·설치·API
