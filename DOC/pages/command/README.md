# Command 페이지 가이드

## 기본 파일
- `src/components/Command/CommandPage.tsx`
- `src/components/Command/CommandPage.css`
- `src/components/Terminal/ShellCommandPanel.tsx`

## 목적
- 미리 정의된 카테고리/명령 집합으로 빠른 송신 편의성 제공
- 명령 검색/추가/실행 흐름을 수동 터미널과 분리해 조합

## 레이아웃 규칙
- 루트 클래스: `.command-page`
- 상단 타이틀 + 설명 영역
- 본문 2단 구조:
  - 좌/우 섹션: 명령 카테고리/퀵 명령 + 입력 패널
- Embedded terminal 상태가 있으면 페이지가 `terminal`과 `command` 패널을 동시 표시
  - `isEmbeddedTerminalVisible`로 토글

## 주요 배열/상태
- `shellCommandCategories`: 카테고리 정의 배열
- `shellCommandCatalog`: 명령 목록(`name`, `command`, `category`, `auto` 등)
- 기본 quick 배열:
  - `vmlog on`, `vmlog off` 등 자주 쓰는 명령
- 상태:
  - `commandInput`, `selectedCategory`, `isAuto`, `isEmbeddedTerminalVisible`

## 시리얼 패턴
- `useSerial` 기반으로 전달된 `onSend` 콜백만 사용해 단방향 송신
- 내부 `sendCommand(command, withHistory)` 패턴:
  - 입력값 검증 → `send(trimmed)` → 히스토리 저장
- Shell 패널에서 `AUTO_CMD` 선택 시 배열 순회 실행 가능
- 성공/실패 표시는 터미널 라인/컴포넌트 내 상태 배지로 분리

## CSS 규칙
- `.command-page__grid`, `.command-page__panel`, `.command-page__terminal`
- 카테고리 버튼/명령 카드가 많을 수 있어 `overflow` + 카드 높이 제한 처리
- 작은 화면에서는 패널 수직 배치로 변경

## 구현 체크포인트
1. 카탈로그는 하드코딩 상수로 관리, 렌더는 `map`
2. 공용 파싱 로직 금지(통신 프로토콜 해석은 공통 parser 계열에서 처리)
3. `ShellCommandPanel` props 기본값(`selectedCategory`, `onSend`)을 일관되게 처리
4. 입력 자동완성/기본값은 `getDefaultPayload`로 중앙화

