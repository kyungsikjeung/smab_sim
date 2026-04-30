# RH850 Pilot UI 문서 허브

이 문서는 페이지별 구현을 새로 만들 때 그대로 참조할 수 있도록 현재 프로젝트의
레이아웃 규칙, 시리얼 통신 패턴, CSS/상태 패턴을 정리한 문서 모음이다.

## 1. 문서 구조

- [DOC/index.md](index.md): 문서 전체 규칙 및 공통 패턴
- [DOC/pages/layout/README.md](pages/layout/README.md): 공통 레이아웃/프레임 규칙
- [DOC/pages/terminal/README.md](pages/terminal/README.md): Terminal 페이지
- [DOC/pages/command/README.md](pages/command/README.md): Command 페이지
- [DOC/pages/error-monitor/README.md](pages/error-monitor/README.md): Error Monitor 페이지
- [DOC/pages/fault-log-monitor/README.md](pages/fault-log-monitor/README.md): Fault Log Monitor 페이지
- [DOC/pages/gpio-monitor/README.md](pages/gpio-monitor/README.md): GPIO Monitor 페이지
- [DOC/pages/fault-injection/README.md](pages/fault-injection/README.md): Fault Injection 페이지
- [DOC/pages/register-editor/README.md](pages/register-editor/README.md): Register Editor 페이지
- [DOC/pages/voltage-monitor/README.md](pages/voltage-monitor/README.md): Voltage Monitor 페이지
- [DOC/pages/warning-lights/README.md](pages/warning-lights/README.md): Warning Lights 페이지
- [DOC/pages/display-control/README.md](pages/display-control/README.md): Display Control 페이지
- [DOC/pages/test-automation/README.md](pages/test-automation/README.md): Test Automation 페이지

## 2. 공통 라우팅

현재 라우팅은 `App.tsx`에서 다음과 같이 페이지를 매핑한다.

| 경로 | 컴포넌트 |
|---|---|
| `/terminal` | `TerminalPage` |
| `/commands` | `CommandPage` |
| `/fault-injection` | `FaultInjectionPage` |
| `/fault-log-monitor` | `FaultLogMonitorPage` |
| `/error-monitor` | `ErrorMonitorPage` |
| `/gpio-monitor` | `GpioMonitorPage` |
| `/register` | `RegisterEditorPage` |
| `/voltage-monitor` | `VoltageMonitorPage` |
| `/warning-lights` | `WarningLightsPage` |
| `/display-control` | `DisplayControlPage` |
| `/test-automation` | `TestAutomationPage` |

## 3. 공통 레이아웃 규칙

### 3.1 전역 프레임

- `src/components/Layout/Layout.tsx` 가 앱 셸을 구성한다.
- 전체는 `grid` 2x2 구조: 사이드바 + 헤더 + 콘텐츠.
- 콘텐츠 영역은 `overflow-y: auto`.
- 페이지는 `<Outlet />`로 교체되어 들어오며, 페이지 본문은 전부 자체 카드/섹션 구조를 가진다.

### 3.2 페이지 그리드 기본 규칙

- 페이지 상단 툴바/상태 표시 영역, 중단 데이터/콘텐츠 영역, 하단 입력 영역이 많은 패턴이다.
- 모바일 대응:
  - 데스크톱: `grid` 또는 `flex` 기반 다단 배열
  - 태블릿/모바일: 단일 컬럼으로 재배치
- 공통적으로 `padding`, `gap`, `card` 스타일을 먼저 확보하고 내부 구획을 flex/grid로 쪼갠다.

## 4. 시리얼 통신 공통 규칙

- 서비스 진입점: `src/services/serialService.ts`
  - Electron 환경: IPC 브릿지 (`window.electronAPI.serial`)
  - 브라우저(Mock) 환경: 내부 Mock 핸들러
- 훅: `src/hooks/useSerial.ts`
  - `connect`, `disconnect`, `refreshPorts`, `send`를 통해 동작
  - `send`는 연결 상태 검사 후 미연결면 실패 응답
- 이벤트 수신:
  - RX 이벤트가 들어오면 `terminalLines`에 `direction: 'rx'` 라인 추가
  - 파서는 `protocolParser`, `rohmProtocol`, feature별 parser로 분기
  - 상태 동기화: 각 feature atom 업데이트

### 4.1 로그/에러 공통 처리

- 접속 실패, 파싱 실패, 연결 끊김은 각각 Toast + 시스템 라인 로그로 상향 전달
- 오류 메시지는 사용자에게 알리고, 페이지는 자체 상태와 결합해 표시

## 5. CSS 공통 규칙

### 5.1 토큰

- 전역 토큰은 `src/styles/global.css`에서 관리한다.
- 색상/폰트/간격/반경은 토큰 기반 클래스를 우선 사용한다.
- 페이지별 CSS는 최소한의 예외처리만 직접 선언.

### 5.2 클래스 규약

- `block__element`, `block__element--modifier` 형태(BEM-like) 사용.
- 전역 공통 클래스(`.btn`, `.card`, `.badge`, `.input`)를 조합하고,
  페이지별로만 `.<page>-__*`를 추가한다.

## 6. 배열/상태 기반 렌더 패턴

이 프로젝트는 문자열 분기보다는 **구조 데이터 + map 렌더링**이 기본 패턴이다.

- 반복 UI: `map()` 가능한 배열로 라벨/항목/버튼 정의
- 동작 모드: `constant enum`/문자열 상수로 상태값 고정
- 상태 변경이 잦은 기능은:
  - `useState` + `useMemo` + `useCallback`
  - 렌더링 최소화를 위해 `set`/`Map`/`Record` 또는 `lookup` 사용

페이지 문서에선 아래 형식으로 같은 패턴을 따라 작성한다.

1. 레이아웃 블록
2. 핵심 배열/상수
3. 시리얼 입출력
4. 파싱/조건 분기
5. CSS/반응형 키포인트

## 7. 신규 페이지 추가 체크리스트

- [ ] 페이지 폴더 추가: `src/components/<PageName>/`
- [ ] 라우트 등록: `App.tsx`
- [ ] 상태/통신: `useSerial` 또는 IPC 이벤트를 통해 통신 일원화
- [ ] 배열 기반 UI 설계(반복 가능한 항목 구조화)
- [ ] 전역 토큰 사용 및 BEM-like 클래스 적용
- [ ] 반응형 브레이크포인트 적용(최소 width 768 기준)
- [ ] DOC 페이지 문서 추가: `DOC/pages/<page>/README.md`

---

본 문서는 페이지별 가이드(각 페이지 README)를 기준으로 작성 규칙과 재사용 방향을 통일합니다.

