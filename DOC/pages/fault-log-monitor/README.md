# Fault Log Monitor 페이지 가이드

## 기본 파일
- `src/components/FaultLog/FaultLogMonitor.tsx`
- `src/components/FaultLog/FaultLogMonitor.css`

## 목적
- Fault 로그 최신 항목 조회
- 응답 라인을 파싱해 표 형태 요약 + 비트 반복 빈도 표시

## 레이아웃 규칙
- 루트 클래스: `.fault-log-monitor`
- 구조:
  - 상단 제어 패널 (`fault` 버튼, 새로고침, 상세 토글)
  - 테이블 영역 (`fault-log-monitor__table`)
  - 요약/통계 영역 (`fault-log-monitor__summary`)
- 로그를 클릭했을 때 상세 패널 확장 가능

## 주요 배열/상태
- `FAULT_LOG_COMMAND = "flog latest"`
- `RECENT_LOG_LIMIT`/timeout 상수로 조회 제한
- `parsedEntries` 배열: 응답 파싱 결과
- `recurringBits` Map/배열: 재발현 비트 통계
- 라인 중복 방지를 위한 `seenRxLineIdsRef` 패턴

## 시리얼 패턴
- `send_and_collect` 성격 동작 모델:
  - 요청 전 현재 RX 라인 ID 캡처
  - 요청 송신 후 새로 유입된 라인만 파싱
- 수신 파싱:
  - 공통 RX 텍스트 라인을 응답 패턴으로 필터링
  - 표준 포맷이 맞지 않으면 에러/빈 결과 처리
- 실패 시 fallback message와 요약에 반영

## CSS 규칙
- `.fault-log-monitor__table`, `.fault-log-monitor__summary`, `.fault-log-monitor__row`
- 스크롤 가능한 표를 두고, 열 고정은 최소 5개 열까지만 허용
- 긴 텍스트는 wrap/truncate 조합으로 가독성 유지

## 구현 체크포인트
1. 요청 직전 RX offset 캡처는 동일 방식으로 재사용
2. 새 로그만 필터링해 파싱 대상을 좁혀야 성능 저하 예방
3. 반복 조회일 경우 마지막 갱신 시각 표시

