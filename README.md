# RH850 Pilot — MCU Control Suite

> RH850 MCU 보드를 시리얼(UART/SPI)로 제어하는 데스크탑 엔지니어링 도구

---

## Desktop App 개발 지침

### 에이전트 정보
- **에이전트 이름**: RH850 Pilot
- **역할**: RH850 MCU 보드의 시리얼 통신 기반 종합 제어 및 테스트 자동화 데스크탑 애플리케이션
- **목적**: 임베디드 개발자가 하나의 도구에서 시리얼 모니터링, 레지스터 R/W, 경고등 제어, 전압 모니터링, 디스플레이 영상 송출, 테스트 자동화까지 수행

---

## 핵심 기능

### 기능 1: 시리얼 터미널 (로그 모니터링)
- COM 포트 선택 / Baud Rate 설정
- Connect / Disconnect 제어
- RX / TX / System 로그 컬러 분류 표시
- 필터링 (ALL / RX / TX / SYS)
- Auto-scroll, Clear, 커맨드 직접 입력 & 전송

### 기능 2: 에러 모니터링
- `error read` 1회 조회 및 Continuous polling
- 모니터링 주기(ms) 설정
- `[error] flags=0x0` 형태 응답 파싱
- 32bit fault bitmap을 bit/mask/name/meaning 기준으로 decode
- 각 bit를 `1 = Error`, `0 = Normal`로 시각화

### 기능 3: 레지스터 읽기/쓰기
- 주소(Hex) 기반 Read / Write 커맨드 전송
- 읽어온 레지스터 테이블 표시 (Address, Name, Value, Description)
- Bit Field 분석 뷰 (Bits, Field Name, Value, Description)

### 기능 4: 경고등 제어 (1~31)
- 1번부터 31번까지 경고등 인디케이터 제어
- 개별 On/Off 토글 + 시리얼 커맨드 자동 전송
- All ON / All OFF 일괄 제어
- 활성화 상태 카운트 표시

### 기능 5: 실시간 전압 모니터링 (CH1~CH6)
- 6채널 실시간 전압 라인 차트 (Recharts)
- 채널별 활성화/비활성화 선택
- 전압 범위 설정 (기본 0~3.3V)
- 채널별 현재 값 실시간 표시
- 고유 색상 코딩

### 기능 6: 디스플레이 제어
- Device Init String RX 감지 시 자동 영상 송출 트리거
- Trigger String 커스터마이징
- Manual Start / Stop 제어
- 상태 표시 (WAITING → READY → STREAMING)
- 디스플레이 스펙 표시 (1920×720, GMSL, 24-bit, 60Hz)

### 기능 7: 테스트 자동화
- 테스트 시퀀스 생성/삭제
- 시퀀스별 Python 파일(`.py`) 등록 및 실행
- 파일이 없으면 `Python 파일을 등록해주세요.` 안내 표시
- 스텝 추가: Send / Expect / Delay / Wait
- Expect / Wait에서 문자열 포함 또는 Regex 매칭 지원
- 시퀀스 카드 및 step 카드 드래그앤드롭 순서 조정
- Quick Save / Restore와 JSON Import / Export 지원
- 기본 프리셋 `에러 모니터링` 제공 (`error read` -> `^\[error\] flags=0x([0-9A-F]+)$`)
- Python Console로 실행 상태와 stdout/stderr 피드백 제공

---

## 기술 스택

| 영역 | 기술 |
|------|------|
| Framework | React 18 + TypeScript |
| Desktop | Electron 28 |
| 상태 관리 | Recoil (전역 Atom/Selector) |
| 라우팅 | React Router v6 (HashRouter) |
| 차트 | Recharts |
| 시리얼 통신 | node-serialport (Electron Main Process) |
| IPC | contextBridge + ipcRenderer/ipcMain |
| 스타일 | Vanilla CSS (CSS Variables, 모듈화) |
| 빌드 | electron-builder |

---

## 프로젝트 구조

```
rh850-pilot/
├── electron/
│   ├── main.js              # Electron 메인 프로세스 (시리얼 IPC)
│   └── preload.js           # contextBridge (안전한 IPC 노출)
├── public/
│   └── index.html            # HTML 템플릿 (스플래시 포함)
├── src/
│   ├── components/
│   │   ├── Layout/           # Layout.tsx, Toast.tsx
│   │   ├── Sidebar/          # Sidebar.tsx (네비게이션)
│   │   ├── Header/           # Header.tsx (시리얼 제어 바)
│   │   ├── Terminal/         # TerminalPage.tsx (로그 모니터)
│   │   ├── ErrorMonitor/     # ErrorMonitorPage.tsx (error flags 모니터)
│   │   ├── Register/         # RegisterEditorPage.tsx (레지스터 R/W)
│   │   ├── WarningLights/    # WarningLightsPage.tsx (경고등 31개)
│   │   ├── VoltageMonitor/   # VoltageMonitorPage.tsx (전압 차트)
│   │   ├── DisplayControl/   # DisplayControlPage.tsx (영상 송출)
│   │   └── TestAutomation/   # TestAutomationPage.tsx (시퀀스)
│   ├── hooks/
│   │   └── useSerial.ts      # 시리얼 통신 커스텀 훅
│   ├── services/
│   │   └── serialService.ts  # 시리얼 API 추상화 (Mock 포함)
│   ├── state/
│   │   └── atoms.ts          # Recoil 전역 상태 정의
│   ├── styles/
│   │   └── global.css        # 전역 CSS 변수 & 기본 스타일
│   ├── types/
│   │   └── index.ts          # TypeScript 타입 정의
│   ├── App.tsx               # 라우터 + RecoilRoot
│   └── index.tsx             # React 엔트리 포인트
├── package.json
└── tsconfig.json
```

---

## 설치 & 실행

### 1. 의존성 설치
```bash
cd rh850-pilot
npm install
```

### 2. 개발 모드 (React + Electron 동시 실행)
```bash
npm run dev
```
- React Dev Server: `http://localhost:3000`
- Electron 윈도우가 자동으로 열립니다

### 3. React만 단독 실행 (브라우저 개발)
```bash
npm run start:react
```
- 브라우저에서 Mock 데이터로 UI 개발 가능

### 4. 프로덕션 빌드
```bash
npm run build
```
- `dist/` 디렉토리에 설치 파일 생성

---

## 아키텍처 설계

### 통신 흐름
```
[RH850 MCU] ←UART→ [COM Port]
                        ↕
              [Electron Main Process]
                  serialport (Node.js)
                        ↕ IPC
              [Electron Preload]
                  contextBridge
                        ↕
              [React Renderer]
                  useSerial Hook → Recoil Atoms
                        ↕
              [UI Components]
                  Pages (8개 라우트)
```

### 상태 관리 (Recoil)
- **Serial State**: 연결 상태, 포트 정보, Baud Rate
- **Terminal State**: 로그 라인, 필터, Auto-scroll
- **Error Monitor State**: 최신 flags snapshot, 수신 history
- **Register State**: 레지스터 목록, 로딩 상태
- **Warning Lights State**: 31개 경고등 On/Off
- **Voltage State**: 6채널 데이터, 범위 설정
- **Display State**: Init 감지, 스트리밍 상태
- **Test State**: 시퀀스 목록, 실행 상태
- **UI State**: 사이드바 축소, 활성 페이지, 토스트

### Mock 시스템
- `serialService.ts`에서 `window.electronAPI` 유무를 감지
- Electron 없이 브라우저에서 실행 시 Mock 데이터 자동 생성
- 개발 중 UI를 독립적으로 테스트 가능

---

## 디자인 가이드라인

### 컬러 팔레트
| 용도 | 색상 | HEX |
|------|------|-----|
| 배경 (Primary) | 다크 네이비 | `#060b18` |
| 카드 배경 | 딥 블루 | `#0f1730` |
| 액센트 (Primary) | 블루 | `#2563eb` |
| 액센트 (Light) | 스카이 블루 | `#60a5fa` |
| 성공 | 에메랄드 | `#10b981` |
| 경고 | 앰버 | `#f59e0b` |
| 에러 | 레드 | `#ef4444` |
| 텍스트 (Primary) | 라이트 그레이 | `#e2e8f0` |
| 텍스트 (Secondary) | 미디엄 그레이 | `#94a3b8` |

### 폰트
- **UI**: Noto Sans KR (300~700)
- **코드/데이터**: JetBrains Mono (400~600)

### 컴포넌트 톤
- 버튼: `btn--primary`, `btn--secondary`, `btn--danger`, `btn--ghost`
- 뱃지: `badge--success`, `badge--error`, `badge--warning`, `badge--info`
- 카드: 미묘한 보더 + 다크 배경, hover 시 하이라이트

---

## 전문 지식 영역
- Renesas RH850 MCU 아키텍처 및 레지스터 맵
- UART/SPI/I2C 시리얼 통신 프로토콜
- GMSL 디스플레이 시스템 (1920×720)
- 임베디드 펌웨어 테스트 자동화
- ASPICE 프로세스 기반 테스트 설계
- Electron + React 데스크탑 앱 아키텍처

---

## 제한사항
- 시리얼 통신은 Electron 환경에서만 실제 동작 (브라우저는 Mock)
- 동시에 1개의 COM 포트만 연결 가능
- 디스플레이 영상 송출은 외부 하드웨어 연동 필요
- 전압 모니터링은 MCU 측 ADC 데이터 프로토콜에 의존
- 현재 버전은 로컬 데이터만 지원 (DB/서버 미연동)

---

## 확장 계획
- [ ] SQLite 로컬 DB 연동 (테스트 결과 저장)
- [ ] 시리얼 커맨드 프로토콜 커스터마이징 UI
- [ ] 레지스터 맵 JSON/CSV 임포트
- [ ] 테스트 리포트 PDF 내보내기
- [ ] 다중 포트 동시 연결
- [ ] Jira API 연동 (테스트 결과 → 이슈 자동 생성)
