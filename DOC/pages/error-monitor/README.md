# Error Monitor 페이지 가이드

## 기본 파일
- `src/components/ErrorMonitor/ErrorMonitorPage.tsx`
- `src/components/ErrorMonitor/ErrorMonitor.css`

## 목적
- `error read` 응답을 주기/수동 조회하며 비트 플래그 상태 추적
- 변동 상태 감시 및 변경 이력 표시

## 레이아웃 규칙
- 루트 클래스: `.error-monitor`
- 구조:
  1) 페이지 헤더(설명 + 제어)
  2) 통제 패널(Refresh/Reset 등)
  3) Bit Grid 영역(4x8)
  4) 변경 로그/변경 카운트
- Bit 표시 그리드는 단색 카드 반복 렌더

## 주요 배열/상태
- `bitGridGroups = Array.from({ length: 4 })`
- 비트 맵:
  - 현재 상태 map (`errorFlags`)
  - 이전 상태 map (`previousFlags`)로 변경 감지
  - `changedFlags` set/array로 최근 변화 표시
- 주기 조회 제어:
  - polling interval 설정 상태, `isPolling`, `isRunning`

## 시리얼 패턴
- 기본 커맨드: `error read`
- 실행 방식:
  - 수동 버튼 또는 반복 Polling
  - 응답은 공통 parse 후 `protocolParser` 계열 상태 반영
- 변경점:
  - 현재 값과 이전 값 비교 → UI highlight (`changed` class)

## CSS 규칙
- `.error-monitor__grid`, `.error-monitor__bit`, `.error-monitor__bit--changed`
- 비트 버튼은 동일 크기 유지 + 상태별 색상 토큰
- 모바일에서는 4열→2열/1열로 축소

## 구현 체크포인트
1. Polling cleanup 꼭 `clearInterval`로 처리
2. 변경값은 최소 단위(`bit index`)로 추적해 렌더 비용 최소화
3. 미연결/타임아웃시 에러 배지와 사용자 안내 유지

