# Display Control 페이지 가이드

## 기본 파일
- `src/components/DisplayControl/DisplayControlPage.tsx`
- `src/components/DisplayControl/DisplayControl.css`

## 목적
- 디스플레이 시작/중지 상태 조작
- OSD/오버레이 설정, 프리뷰 제공
- VSB/Slot/Color 선택을 배열 기반으로 관리

## 레이아웃 규칙
- 루트 클래스: `.display-control`
- 블록 구조:
  - 상태 카드(WAITING/READY/STREAMING)
  - OSD 제어 패널
  - VSB/Slot 토글 패널
  - Preview/Action 영역
- 복잡 상태는 섹션별 카드로 분리하고 공통 spacing 유지

## 주요 배열/상태
- `activeOverlayRects`: 활성 사각형 오버레이 배열
- `selectableVsbPresets`, `vsbColor` palette, `warningLightSelection`
- `vsbSlotSelection`: 슬롯 선택 배열
- 상태 관리:
  - `displayState`, `triggerString`, `isPreviewOpen`
  - `isStreaming`, `isBusy`

## 시리얼 패턴
- 제어 커맨드:
  - `DISPLAY_START`
  - `DISPLAY_STOP`
- 조명 연동 커맨드:
  - `lights ...`
- trigger string/overlay 변화는 문자열 생성기에서 command payload 조합 후 send
- 수신으로 커맨드 ACK 및 상태 리셋 신호 처리

## CSS 규칙
- `.display-control__status`, `.display-control__controls`, `.display-control__preview`, `.display-control__actions`
- 버튼/토글은 동일한 높이와 아이콘 가독성 유지
- 반응형에서 preview 축소 또는 하단 고정 모드로 이동

## 구현 체크포인트
1. 오버레이/색상 선택은 map 렌더로 처리해 새 항목 추가를 안전하게
2. start/stop 중복 클릭 방지를 위해 debounce/disabled 처리
3. preview 데이터 파싱은 별도 유틸에서 문자열 조합

