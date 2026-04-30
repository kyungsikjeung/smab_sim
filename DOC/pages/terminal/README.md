# Terminal 페이지 가이드

## 기본 파일
- `src/components/Terminal/TerminalPage.tsx`
- `src/components/Terminal/Terminal.css`
- `src/components/Terminal/ShellCommandPanel.tsx` (공유 입력 패널)

## 목적
- 실시간 RX/TX/System 라인 표시
- 수동 명령 입력/Quick command 실행
- 디버깅 목적의 필터/다운로드/클리어

## 레이아웃 규칙
- 루트 클래스: `.terminal-page`
- 상단: `.terminal-page__toolbar`
  - 연결 상태 태그, 자동 스크롤 토글, 필터 버튼, Clear
- 중앙: `.terminal-page__log` (로그 컨테이너)
  - 라인 렌더링 블록: `.terminal__line`, `.terminal__line--rx`, `.terminal__line--tx`, `.terminal__line--system`
- 하단: 입력창과 전송 버튼

## 주요 배열/상태
- `FILTERS` 배열: all / rx / tx / system 필터 버튼 구성
- `displayedLines`: 현재 필터 적용된 라인 목록 (`useMemo`)
- `terminalLines` 전역 목록: `id`, `timestamp`, `direction`, `content` 구조
- 입력 상태:
  - `commandInput`, `autoScroll`, `searchTerm`
  - `showCommandLine`, `isAutoScroll`, `isConnected`

## 시리얼 패턴
- `useSerial({ manageSideEffects: true })` 사용(연결/수신 이벤트 자동 반영)
- 연결된 상태에서만 `sendCommand` 실행
- 수동 전송:
  - 엔터/Send 버튼 이벤트 → `send(command)`
  - `trim` 후 빈 문자열 무시
- 실수 방지:
  - 미연결 시 action block + 안내 토스트

## CSS 규칙
- 기본 스크롤 영역:
  - 고정 높이 + `overflow-y: auto`
  - 시스템 메시지/오류는 색상 토큰 기반 하이라이트
- 반응형:
  - 모바일에서 toolbar를 세로 정렬
- 라인 로그:
  - monospace 계열 폰트 + 긴 라인 래핑 정책 설정
  - 최근 라인 우선 표시

## 구현 체크포인트
1. 페이지 루트는 `grid`/`flex` 중 한 가지, 반드시 `gap`으로 구획 분리
2. 필터 로직은 `direction` 분기 중심 (`all` 포함)
3. 검색어 하이라이트는 렌더 단계에서만 수행
4. 최대 라인 수 제한은 성능 병목 방지 용도

## 재사용 포인트
- 공통 Shell 입력 UI가 필요하면 `ShellCommandPanel`을 임베드해서 카테고리별 명령 셋 제공
- 로그 패널이 필요한 모든 페이지의 포맷 기준과 맞춰야 테스트/디버깅 일관성 유지

