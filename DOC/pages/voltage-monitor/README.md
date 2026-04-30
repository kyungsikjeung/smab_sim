# Voltage Monitor 페이지 가이드

## 기본 파일
- `src/components/VoltageMonitor/VoltageMonitorPage.tsx`
- `src/components/VoltageMonitor/VoltageMonitor.css`
- `src/components/VoltageMonitor/VoltageStreamingChart.tsx`
- `src/components/VoltageMonitor/voltageFrameStore.ts`

## 목적
- CH 단위 ADC 전압/유효상태 표시
- 채널별 활성화/비활성화 토글과 실시간 차트 렌더

## 레이아웃 규칙
- 루트 클래스: `.voltage-monitor`
- 패널 구성:
  - 채널 카드 그룹
  - 활성 채널 요약 (`showWindowStats`)
  - 차트 영역 (`chart-wrap`)
  - 제어 패널(연결/로그/범위 설정)
- 채널 카드를 `map`으로 생성해 확장성 유지

## 주요 배열/상태
- `channels` 배열: CH1~CH6 메타데이터 (label, unit, max, color)
- `enabledChannels`: `Set<number>` 또는 배열 기반 활성 채널 상태
- `voltageFrameStore`: 최근 프레임 ring buffer
- `CHART_MAX_POINTS`(예: 100) 기반 데이터 슬라이딩

## 시리얼 패턴
- 연결 후 모니터링 진입에서 자동 streaming on/off 제어:
  - `vmlog on`
  - `vmlog off`
- 실제 값은 parsing 결과를 `voltageDataState`로 업데이트
- 차트는 상태 store polling을 통해 프레임 렌더링

## CSS 규칙
- `.voltage-monitor__layout`, `.voltage-monitor__cards`, `.voltage-monitor__channel-card`
- 상태 텍스트는 강조 대비 높은 색 사용
- 차트 컨테이너는 높이 고정 + 반응형 너비

## 구현 체크포인트
1. 채널 색상은 고정 배열로 관리(인덱스 충돌 방지)
2. streaming 전환은 idempotent하게 처리(연속 클릭 시 중복 명령 방지)
3. 차트 렌더링이 프레임 단위로 과도하게 재생성되지 않도록 store 분리

