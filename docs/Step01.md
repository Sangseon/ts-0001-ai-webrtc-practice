# Step 01 — TypeScript 실행 기반

2026-10-30 Windows 환경에서 구현·검증했다. 기본 화면, HTTP 상태 경로, 실행·검사·빌드 명령이 이번 범위다.

## 환경과 선택 이유

| 항목 | 확인한 버전 |
| --- | --- |
| Node.js / npm | 24.22.1 / 12.2.1 |
| React / React DOM | 19.3.1 / 19.3.1 |
| Vite / React 플러그인 | 8.3.5 / 6.1.2 |
| TypeScript / tsx | 7.0.2 / 4.23.15 |
| @types/node | 24.19.2 |
| @types/react / @types/react-dom | 19.3.0 / 19.3.0 |
| Chrome / Edge | 156.0.8078.49 / 156.0.4314.50 |

설치 당시 npm 레지스트리의 버전·engines·peerDependencies를 확인했고, 직접 의존성은 정확한 버전과 `package-lock.json`으로 고정했다.
[Vite 공식 문서](https://vite.dev/guide/)의 Node 조건은 20.19 이상 또는 22.12 이상이며, 설치한 Vite의 engines는 `^20.19.0 || >=22.12.0`다. 현재 Node는 이를 충족하므로 시스템 버전을 변경하지 않았다. 프로젝트는 검증한 Node 24 계열과 npm 11 이상을 engines에 명시한다. SFU 런타임 호환성은 Step 02에서 별도 확인한다.

- React + Vite: 계획에서 권장한 SPA 구성을 사용한다. 기본 화면은 컴포넌트 하나와 일반 CSS로 구성했다.
- Node 기본 HTTP: 현재 필요한 단일 상태 경로에는 서버 프레임워크가 필요하지 않다.
- tsx: TypeScript 서버의 개발 실행과 변경 감지를 맡긴다. 실행 중 변환은 타입 검사가 아니므로 `tsc` 검사를 별도로 둔다.
- 단일 package.json: 클라이언트·서버 의존성과 명령을 루트에서 관리한다. workspace 관리 도구와 빈 공유 타입 패키지는 추가하지 않았다.
- TypeScript: 공통 설정에서 strict를 적용한다. 브라우저는 Bundler 해석, 서버는 NodeNext ESM 해석으로 실행 환경을 구분한다.
- Vite 루트는 설정 파일 위치에서 계산하고 Windows 실제 경로로 정규화한다. 개인 절대 경로를 소스에 저장하지 않는다.

## 파일과 디렉터리

```text
.
├── AGENTS.md                         기존 유지
├── README.md                         실행 안내 추가
├── package.json                      신규: 의존성·명령·지원 환경
├── package-lock.json                 신규: 설치 버전 고정
├── tsconfig.base.json                신규: 공통 strict 설정
├── .gitignore                        의존성·빌드 결과 제외 규칙 추가
├── client/
│   ├── index.html                    신규
│   ├── tsconfig.json                 신규
│   ├── vite.config.ts                신규
│   └── src/
│       ├── main.tsx                  신규: React 진입점
│       ├── App.tsx                   신규: 실행 확인 화면
│       └── style.css                 신규
├── server/
│   ├── tsconfig.json                 신규
│   └── src/index.ts                  신규: HTTP 서버
├── docs/
│   ├── Concept.md                    기존 유지
│   ├── PLAN.md                       Step 01 상태 갱신
│   ├── Step01.md                     신규: 이 문서
│   └── ChatHistory.md                기존 유지
├── scripts/                          기존 자동 기록기·테스트 유지
├── ChatHistory/                      기존 기록 유지, Git 관리 대상
├── .codex/                           기존 Hook 유지
└── .chat-history/                    기존 로컬 기록 상태, Git 제외
```

`node_modules/`, `client/dist/`, `server/dist/`, `*.tsbuildinfo`, npm 디버그 로그는 Git에서 제외한다.
애플리케이션은 기존 CommonJS 기록기 `.cjs`와 충돌하지 않도록 ESM으로 구성했다.

## 명령과 동작 확인

저장소 루트에서 `npm ci` 후 두 터미널을 연다.

| 목적 | 명령 | 결과 |
| --- | --- | --- |
| 클라이언트 개발 | `npm run dev:client` | http://127.0.0.1:5173 |
| 서버 개발 | `npm run dev:server` | http://127.0.0.1:3000 |
| 전체 타입 검사 | `npm run typecheck` | 양쪽 tsc 검사, 파일 생성 없음 |
| 개별 타입 검사 | `npm run typecheck:client`, `npm run typecheck:server` | 대상별 검사 |
| 전체 빌드 | `npm run build` | 양쪽 검사 후 빌드 |
| 개별 빌드 | `npm run build:client`, `npm run build:server` | client/dist, server/dist |
| 클라이언트 빌드 확인 | `npm run preview:client` | http://127.0.0.1:4173 |
| 서버 빌드 실행 | `npm run start:server` | server/dist/index.js 실행 |

각 개발 터미널은 `Ctrl+C`로 종료한다. 로컬 루프백 주소에만 바인딩하며, 클라이언트 포트가 사용 중이면 다른 번호로 자동 이동하지 않고 실패한다.

1. Chrome 또는 Edge에서 `http://127.0.0.1:5173`에 접속해 제목과 클라이언트 실행 안내를 확인한다.
2. 화면의 상태 확인 링크 또는 `http://127.0.0.1:3000/health`에 직접 접속해 HTTP 200과 `{"status":"ok"}`를 확인한다. 서버 자동 연결 상태를 표시하는 화면은 아니다.
3. PowerShell에서도 `Invoke-RestMethod http://127.0.0.1:3000/health`로 확인할 수 있다.
4. 서버가 실행된 상태에서 `/missing` 또는 `POST /health`는 HTTP 404 JSON을 반환한다.
5. 두 프로세스를 종료한 뒤 같은 명령으로 다시 실행한다.
6. `npm run build` 후 서버 실행 및 클라이언트 preview 명령으로 빌드 결과를 확인한다.

## 검증 결과

| 검증 | 결과 |
| --- | --- |
| npm install / 다른 경로 npm ci | 통과, 각 30개 패키지 감사에서 취약점 0건 보고 |
| 클라이언트·서버 타입 검사 | 모두 통과 |
| 클라이언트·서버 빌드 | 모두 통과 |
| 개발 HTTP 응답 | 클라이언트 200, health 200·JSON·Content-Type 확인 |
| 잘못된 경로·메서드 | 404 확인 |
| 실제 React 렌더링 | headless Chrome·Edge에서 DOM 내 실행 문구와 health 링크 확인 |
| 종료·재실행 | 개발 프로세스 기동·종료 2회, 실제 npm 개발 명령 Ctrl+C 종료 후 포트 해제 확인 |
| 빌드 결과 실행 | Node 빌드 서버 health 및 Chrome의 Vite preview 렌더링 통과 |
| 다른 위치 재현 | 한글·공백이 포함된 임시 소스 복사본의 실제 긴 경로에서 npm ci·검사·빌드·개발 실행·브라우저·preview 확인 통과 |
| 기존 기록기 | `node --test scripts/chat-history.test.cjs` 26/26 통과 |
| 기존 기록 검사 | `node scripts/chat-history.cjs --check`: checked 5, suspicious 0, failed false |
| Git 규칙 | 의존성·빌드·로컬 기록 상태 제외, ChatHistory Markdown은 제외되지 않음 |

현재 경로의 핵심 Step 01 완료 기준을 충족한다. Concept의 다자간 통신 등 프로젝트 전체 완료 기준은 이후 Step의 대상이다. 임시 검증 스크립트는 Git 대상에 추가하지 않았다.

## 남은 제약과 미검증 사항

- npm 12가 esbuild 0.28.2의 postinstall을 승인되지 않은 스크립트로 차단했다. 현재 Windows 설치에서는 tsx 실행과 모든 검사·빌드가 통과했다. 승인 설정은 변경하지 않았다. 다른 환경에서 실행 오류가 나면 `npm install-scripts ls`로 해당 패키지의 설치 상태를 먼저 확인한다.
- 브라우저 검증 중 React DevTools 전역 Hook shim 때문에 Fast Refresh가 비활성화된다는 경고가 있었다. 기본 화면 렌더링에는 영향이 없었고, 상태를 보존하는 Fast Refresh 동작은 검증하지 않았다.
- Windows 임시 경로를 `DESKTO~1` 같은 8.3 별칭으로 실행하면 Vite의 파일 허용 경로 불일치 또는 빈 React 화면이 발생했다. 실제 긴 경로에서 실행하면 통과했다. 터미널에서 `Set-Location`으로 실제 긴 저장소 경로로 이동한 뒤 명령을 실행한다. Vite의 파일 접근 제한을 해제하지 않았다.
- 화면 검증은 실제 브라우저의 headless DOM 검사다. 사람이 보는 창에서의 육안·클릭 검증, Firefox/Safari 및 다른 OS는 수행하지 않았다.
- 이번 최종 응답의 Stop Hook 기록은 응답 종료 이후 발생하므로 사전에 저장 완료를 확인할 수 없다. 자동 기록 설정과 기존 파일을 유지했고, 별도 수동 중복 기록은 만들지 않았다. 응답 후 새 ChatHistory 파일이 없다면 [ChatHistory.md](./ChatHistory.md)의 수동 복사 절차로 실제 프롬프트와 최종 응답을 한 번만 저장한다.
- Git Commit·Push는 실행하지 않았다.
