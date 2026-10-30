# ts-0001-ai-webrtc-practice

Codex AI를 활용한 TypeScript 기반 WebRTC 바이브 코딩 실습 프로젝트.

## Documents

- [Concept](./docs/Concept.md) — 프로젝트 개요 및 구현 방향
- [PLAN](./docs/PLAN.md) — Step별 구현 범위와 완료 기준
- [Step 01](./docs/Step01.md) — 실행 방법, 기술 선택 및 검증 결과
- [ChatHistory](./docs/ChatHistory.md) — 기존 대화 자동 기록 사용 방법

## 로컬 실행 (Step 01)

Node.js 24.x와 npm 11 이상을 사용한다. 검증 환경은 Node.js 24.22.1, npm 12.2.1이다.
저장소 루트에서 의존성을 설치한다. 최초 설치에도 커밋된 lockfile을 사용하는 `npm ci`를 사용할 수 있다.

```powershell
npm ci
```

두 터미널에서 각각 실행한다.

```powershell
# 터미널 1: 클라이언트 http://127.0.0.1:5173
npm run dev:client
```

```powershell
# 터미널 2: 서버 http://127.0.0.1:3000/health
npm run dev:server
```

각 터미널에서 `Ctrl+C`로 종료한다. 서버 상태 확인 응답은 `{"status":"ok"}`다.
클라이언트는 서버 없이도 기본 화면이 열린다.

```powershell
npm run typecheck
npm run build

# 빌드 후 별도 터미널에서 각각 실행
npm run preview:client
npm run start:server
```

빌드 화면은 `http://127.0.0.1:4173`에서 확인한다.
개별 검사·빌드 명령과 문제 해결 방법은 [Step 01 문서](./docs/Step01.md)를 참고한다.

현재 구현 범위는 기본 화면과 HTTP 상태 확인 경로까지다. 아래 기능은 이후 Step의 구현 대상이다.

아래 기능을 구현할 거고 프롬프트로 작업순서 정의 밑 기능구현을 step별로 작성하여 구현하도록 할 계획이다.

```
1. 다자간 화상회의
2. 채팅
	- 전체 채팅
	- 회의방 채팅
3. 캐릭터, 닉네임 변경
4. 장치설정
	- 카메라, 마이크 제어
	- 장치 선택
	- 마이크 테스트
```
