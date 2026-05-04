import { TestSequence } from 'types';

export const DEFAULT_TEST_SEQUENCE_ID = 'preset-error-monitoring';

const TEST_SEQUENCE_PRESETS: TestSequence[] = [
  {
    id: DEFAULT_TEST_SEQUENCE_ID,
    name: '에러 모니터링',
    description: 'Python 파일을 연결해 에러 모니터링 자동화를 실행합니다.',
    createdAt: '2026-04-13T00:00:00.000+09:00',
    pythonScript: null,
    steps: [],
  },
];

export const createDefaultTestSequences = (): TestSequence[] => (
  TEST_SEQUENCE_PRESETS.map((sequence) => ({
    ...sequence,
    steps: [],
  }))
);
