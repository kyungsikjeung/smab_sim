# Warning Lights 페이지 가이드

## 기본 파일
- `src/components/WarningLights/WarningLightsPage.tsx`
- `src/components/WarningLights/WarningLights.css`

## 목적
- 경고등 On/Off 개별 제어 및 전체 ON/OFF
- MCU 상태 동기화 후 비트맵 기반 조명 제어

## 레이아웃 규칙
- 루트 클래스: `.warning-lights`
- 2단 구성:
  - 상단 헤더/버튼 영역
  - 4 x 6 또는 6개 버튼 grid
- 각 light 항목은 동일 크기 카드 + 라벨 + 상태 표시
- 화면 하단에 sync/summary 영역 배치

## 주요 배열/상태
- `lights` 배열: 최소 6개 항목 (id, label, value, name)
- `toLightsMask`: `1 << (id - 1)` 형태 비트맵 산출
- 로컬 상태:
  - `lightsState`: 배열 기반 전체 토글 값
  - `connected` 체크
- 마운트 동기화:
  - `simlightr` 응답 기반 초기 동기화

## 시리얼 패턴
- 토글 시 `lights <8자리 hex>` 명령으로 일괄 송신
- 연결 상태 변화 감지 시 버튼 비활성화
- 초기/재동기화:
  - 화면 진입 시 현재 상태를 요청
  - ACK 또는 응답 파싱으로 반영

## CSS 규칙
- `.warning-lights__grid`, `.warning-lights__cell`, `.warning-lights__cell--on`
- 켜짐 상태는 글로우/강조색 적용
- 모바일에서는 1열 또는 2열으로 변경 가능성 최소 2단계 fallback

## 구현 체크포인트
1. 상태 변경은 배열 copy 기반 불변 업데이트
2. HEX 문자열 포맷 고정(예: 8자리 0-padding)
3. 수신 반영이 늦더라도 로컬 상태와 동기 루프 보장

