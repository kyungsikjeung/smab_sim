# Test Automation 페이지 가이드

## 기본 파일
- `src/components/TestAutomation/TestAutomationPage.tsx`
- `src/components/TestAutomation/TestAutomation.css`

## 목적
- Python 기반 테스트 실행 엔진 호출 인터페이스 제공
- 시퀀스 저장/편집/재생 구조
- 실행 로그 및 결과 요약 표시

## 레이아웃 규칙
- 루트 클래스: `.test-automation`
- 좌측 시퀀스 목록 패널
- 우측 에디터/콘솔 패널
- 하단/우측 상단 액션:
  - Run / Stop / Import / Export
  - 상태 배지(Pending/Running/Done/Error)

## 주요 배열/상태
- `sequences`: 시퀀스 배열(각 항목이 steps/metadata 포함)
- `scriptConsole`: 로그 라인 배열 (최대 300)
- `expandedSections`: 에디터 아코디언 상태
- `runSummary`: 최종 결과 집계
- 시퀀스 step 타입:
  - Send / Delay / Expect / Parse / Wait (현재 구현 상태 기준 확장 여지 포함)

## 시리얼 패턴
- Electron 스크립트 실행 API 연동:
  - `window.electronAPI.automation.startScript(...)`
  - `window.electronAPI.automation.stopScript()`
  - `window.electronAPI.automation.onOutput((chunk)=>...)`
- Python 쪽 브릿지가 별도면:
 - 출력 라인을 그대로 로그에 적재
 - 결과는 result 이벤트 수신 시 UI 요약 갱신

## CSS 규칙
- `.test-automation__layout`, `.test-automation__sequence-list`, `.test-automation__editor`
- `.test-automation__console`, `.test-automation__status`, `.test-automation__run-btn`
- Drag/drop/accordion 인터랙션에서 transition 최소화(너무 잦은 상태 계산 방지)

## 구현 체크포인트
1. run 상태에서 중복 실행 방지
2. stop 요청 후 타임아웃 처리 고려
3. 로그 라인 누적은 최대치 제한(예: 300)으로 메모리 가드
4. 신규 시퀀스 타입 추가 시 parser/render split 분리 권장

