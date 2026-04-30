# GPIO Monitor 페이지 가이드

## 기본 파일
- `src/components/GpioMonitor/GpioMonitorPage.tsx`
- `src/components/GpioMonitor/GpioMonitor.css`

## 목적
- GPIO 입력/출력 상태를 주기 조회해 표시
- 핀 단위 토글/표시로 빠르게 헷갈리지 않게 모니터링

## 레이아웃 규칙
- 루트 클래스: `.gpio-monitor`
- 섹션:
  - 출력 상태 카드(Write/Status)
  - 입력 상태 카드(Read/Status)
  - 통신 제어(폴링 시작/정지)
- `grid-template`을 사용해 채널별 컬럼 정렬

## 주요 배열/상태
- `GPIO_STATUS_COMMAND = 'gpio_status'`
- `outputPins`: `[sysFault, extFault]`와 라벨/색상 메타데이터
- `inputPins`: `[gmslTpDesLock, lcdFail, ledFail]` 및 라벨
- 폴링 상태:
  - `isPolling`, `pollingIntervalMs`, `isBusy`

## 시리얼 패턴
- 시작 동작 시 `gpio_status` 반복 송신
- 수신 파싱은 GPIO 관련 token만 추출해 개별 pin 상태 갱신
- 연결 해제/응답 없음 시 폴링 안전 종료 처리

## CSS 규칙
- `.gpio-monitor__grid`, `.gpio-monitor__pin-card`, `.gpio-monitor__pin-badge`
- 상태 색상:
  - On/Off를 명확히 구분되는 `--color-success`/`--color-danger` 조합
- 모바일에서는 카드 폭을 1열로 변경해 터치 가독성 확보

## 구현 체크포인트
1. Polling 주기는 과도하게 작게 두지 말 것(기본 안정값 유지)
2. 응답 파싱 실패 시 해당 핀은 `N/A` 유지
3. 입력/출력 분리를 위해 map 키를 고정한다

