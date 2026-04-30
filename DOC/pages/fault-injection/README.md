# Fault Injection 페이지 가이드

## 기본 파일
- `src/components/FaultInjection/FaultInjectionPage.tsx`
- `src/components/FaultInjection/FaultInjection.css`

## 목적
- ADC Fault/Watchdog fault를 시나리오별로 주입
- 입력 검증, 배치 적용, 상태 피드백을 한 화면에서 수행

## 레이아웃 규칙
- 루트 클래스: `.fault-injection`
- 섹션 구조:
  - 상단 제어 카드(주입 모드 선택)
  - ADC Injection 카드 배열
  - Watchdog Injection 카드
  - 일괄 적용/초기화 액션

## 주요 배열/상태
- `adcChannels` 배열: 채널별 범위/명령어/상태 메타데이터
- `WATCHDOG_INJECT_COMMAND = 'wdt_fault inject'`
- `VOLT_MON_READ_COMMAND = 'voltmon read'`(사전 검증)
- `expandedSections`: accordion 상태
- `busyKey`: 현재 진행 중인 채널 동작 ID

## 시리얼 패턴
- 주입 전 사전 조회(`voltmon read`) 또는 값 정규화
- 주입 명령은 사용자가 실행 버튼 누를 때만 send
- 명령 응답을 즉시 UI 스낵/배지로 반환

## CSS 규칙
- `.fault-injection__group`, `.fault-injection__accordion`, `.fault-injection__cell`, `.fault-injection__danger`
- 폼 요소(`input`, `button`)를 동일한 row 높이로 정렬
- 유효하지 않은 입력은 빨간 경고/테두리 강조

## 구현 체크포인트
1. 값 범위 검증을 먼저 수행 후 send (최대치/최소치)
2. busy 상태에서 중복 클릭 잠금
3. 명령 전송 후 최소 1회 확인 수신/오류 반영

