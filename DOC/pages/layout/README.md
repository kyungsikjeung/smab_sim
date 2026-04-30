# Layout/Global 문서

## 적용 대상
- `src/components/Layout/Layout.tsx`
- `src/components/Header/Header.tsx`
- `src/components/Sidebar/Sidebar.tsx`
- `src/components/Layout/Layout.css`

## 구조

```txt
Layout
├── Header (상단 고정 바)
├── Sidebar (좌측 네비게이션)
└── Content (각 라우트 페이지)
```

### Layout.css 핵심 개념

- `display: grid` with:
  - `grid-template-columns: var(--sidebar-width) 1fr`
  - `grid-template-rows: var(--header-height) 1fr`
  - `grid-template-areas: "sidebar header" "sidebar content"`
- `layout__content`는 패딩 + `overflow-y: auto`를 반드시 유지
- 반응형에서 sidebar/컨텐츠 간격이 줄어들지 않도록 `min-height` 확보

## 페이지 공통 제약

- 페이지는 본문 최상위 루트 클래스를 하나의 block로 둔다.
- 루트 block은 `padding`, `display`, `gap`만 담당하고
  내부에서 section/card/button/input를 BEM 패턴으로 분해한다.
- 네비게이션 상태(활성/비활성), 연결 상태(connected), 에러는 헤더에서 공통 관리.

## 공통 컴포넌트 사용

- Shell command를 수동 입력하려면 `ShellCommandPanel` 재사용을 권장.
- 로그 표시가 필요한 경우 `terminalLines` 상태를 이용해 RX/TX/SYS를 같은 채널로 처리.
- 기능별 테이블/패널은 section card 단위로 분리하고 각 card는 고유 modifier 클래스를 둔다.

## 추천 레이아웃 패턴 (페이지별 템플릿)

1. `.xxx-page`
2. `.xxx-page__header`
3. `.xxx-page__body`
4. `.xxx-page__toolbar`
5. `.xxx-page__card` 반복
6. `.xxx-page__table-wrap`, `.xxx-page__chart`, `.xxx-page__actions`
7. 반응형: `@media (max-width: 1100px)`에서 2열→1열

## 시리얼 통신 결합 규칙

- 페이지는 가능한 한 `serialService` 직접 호출보다 `useSerial` 또는 상위 커스텀 훅을 우선 사용.
- 송신은 `send(command)` 혹은 명시적 라우팅 함수를 통해 단일 진입.
- 수신 데이터 해석은 공통 parser 또는 페이지 parser에서 수행.
- 페이지별 추가 파서가 필요하면 기존 parser 흐름과 충돌하지 않게 `useEffect`에서 구독/필터링.

