# Register Editor 페이지 가이드

## 기본 파일
- `src/components/Register/RegisterEditorPage.tsx`
- `src/components/Register/RegisterEditor.css`

## 목적
- ROHM 레지스터 읽기/쓰기/검증 워크플로우 제공
- 대량 주소 조회 최적화와 write-readback 검증

## 레이아웃 규칙
- 루트 클래스: `.register-editor`
- 구성:
  - 입력 패널(Address/Mask/Count + Go)
  - 레지스터 테이블 헤더/본문
  - 변경 내역/검증 결과 섹션
- 다중 컬럼 테이블일 때 `overflow-x: auto`로 가독성 확보

## 주요 배열/상태
- `READ_ALL_BATCHES`: 배치 조회 구조
- `READ_BATCH_GAP_MS`, `WRITE_READBACK_DELAY_MS`
- `REGISTER_ROWS`(map/list) 기반 렌더
- `editedValues`: 사용자가 임시 편집한 값 map
- `latchedChangedRowKeys`: 마지막 write-readback으로 확정된 변경 키
- `splitWriteBatches(...)`를 통해 연속 주소 묶음 전송

## 시리얼 패턴
- 기본 커맨드:
  - `rohm_rd_prm`(read)
  - `rohm_wr_prm`(write)
- 대량 조회:
  - 배치 단위로 전송
  - 읽기-반환 간 지연 적용(`READ_BATCH_GAP_MS`)
- Write 검증:
  - write 완료 후 readback 대기 (`WRITE_READBACK_DELAY_MS`)
  - 응답 파싱으로 성공/실패 결정

## CSS 규칙
- `.register-editor__table`, `.register-editor__row`, `.register-editor__cell`, `.register-editor__editor`
- 행 강조: `changed` / `error` modifier 사용
- 주소/값 입력은 고정 폭 + 대문자 Hex 안내

## 구현 체크포인트
1. 주소/값 변경은 문자열 정규화(hex 대문자) 후 전송
2. 파싱 실패시 해당 row에 에러 표시
3. 테이블이 클 수 있으므로 메모리 최적화(고정 key/가상화 고려)

