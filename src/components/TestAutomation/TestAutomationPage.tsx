import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useRecoilState, useSetRecoilState } from 'recoil';
import {
  activeTestIdState,
  testRunningState,
  testSequencesState,
  toastMessageState,
} from 'state/atoms';
import {
  AutomationOutputEvent,
  SequencePythonScript,
  TestSequence,
} from 'types';
import {
  TEST_AUTOMATION_SAMPLE_PYTHON,
  TEST_AUTOMATION_SAMPLE_PYTHON_FILE_NAME,
} from 'data/testAutomationSamplePython';
import { formatDateTime, formatTimeWithMilliseconds } from 'utils/dateTime';
import './TestAutomation.css';

let sequenceCounter = 0;

const SCRIPT_REQUIRED_MESSAGE = '이 시퀀스에 등록된 Python 파일이 없습니다. Python 파일을 등록해주세요.';
const SEQUENCE_LIBRARY_SCHEMA = 'rh850-pilot.test-sequences';
const SEQUENCE_LIBRARY_VERSION = 2;

const genSeqId = () => `seq-${Date.now()}-${++sequenceCounter}`;
const getConsoleTimestamp = () => formatTimeWithMilliseconds();
const formatTimestamp = (value: string) => formatDateTime(value);
const buildExportFileName = () => `rh850-pilot-sequences-${new Date().toISOString().replace(/[:.]/g, '-')}.json`;

type IconProps = {
  className?: string;
};

type ExpandableSection = 'setup' | 'console' | 'scriptPreview';
type DisclosureIconProps = IconProps & {
  open?: boolean;
};

type SequenceLibraryPayload = {
  schema: string;
  version: number;
  mode: 'python-only';
  exportedAt: string;
  sequenceCount: number;
  sequences: TestSequence[];
};

const FileCodeIcon: React.FC<IconProps> = ({ className }) => (
  <svg className={className} viewBox="0 0 24 24" fill="none" aria-hidden="true">
    <path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8l-5-5Z" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
    <path d="M14 3v5h5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
    <path d="m10 13-2 2 2 2" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
    <path d="m14 13 2 2-2 2" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);

const SaveIcon: React.FC<IconProps> = ({ className }) => (
  <svg className={className} viewBox="0 0 24 24" fill="none" aria-hidden="true">
    <path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2Z" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
    <path d="M17 21v-8H7v8" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
    <path d="M7 3v5h8" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);

const UploadIcon: React.FC<IconProps> = ({ className }) => (
  <svg className={className} viewBox="0 0 24 24" fill="none" aria-hidden="true">
    <path d="M12 16V4" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
    <path d="m7 9 5-5 5 5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
    <path d="M20 16.5V19a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2v-2.5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);

const DownloadIcon: React.FC<IconProps> = ({ className }) => (
  <svg className={className} viewBox="0 0 24 24" fill="none" aria-hidden="true">
    <path d="M12 4v12" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
    <path d="m7 11 5 5 5-5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
    <path d="M20 20H4" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);

const FolderIcon: React.FC<IconProps> = ({ className }) => (
  <svg className={className} viewBox="0 0 24 24" fill="none" aria-hidden="true">
    <path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7Z" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);

const PlayIcon: React.FC<IconProps> = ({ className }) => (
  <svg className={className} viewBox="0 0 24 24" fill="none" aria-hidden="true">
    <path d="m8 5 11 7-11 7V5Z" fill="currentColor" />
  </svg>
);

const TerminalIcon: React.FC<IconProps> = ({ className }) => (
  <svg className={className} viewBox="0 0 24 24" fill="none" aria-hidden="true">
    <path d="M4 5h16a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2Z" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
    <path d="m7 9 3 3-3 3" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
    <path d="M13 15h4" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);

const TrashIcon: React.FC<IconProps> = ({ className }) => (
  <svg className={className} viewBox="0 0 24 24" fill="none" aria-hidden="true">
    <path d="M3 6h18" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
    <path d="M8 6V4a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v2" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
    <path d="m19 6-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
    <path d="M10 11v6" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
    <path d="M14 11v6" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);

const EditIcon: React.FC<IconProps> = ({ className }) => (
  <svg className={className} viewBox="0 0 24 24" fill="none" aria-hidden="true">
    <path d="m12 20 8-8-4-4-8 8-1 5 5-1Z" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
    <path d="m14.5 7.5 4 4" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);

const DisclosureIcon: React.FC<DisclosureIconProps> = ({ className, open = false }) => (
  <svg className={className} viewBox="0 0 24 24" fill="none" aria-hidden="true">
    <path d="M6 12h12" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
    {!open && (
      <path d="M12 6v12" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
    )}
  </svg>
);

const DisclosureControl: React.FC<{ compact?: boolean; open: boolean }> = ({ compact = false, open }) => (
  <span className={[
    'test__collapse-control',
    compact ? 'test__collapse-control--compact' : '',
    open ? 'test__collapse-control--open' : '',
  ].filter(Boolean).join(' ')}>
    {!compact && <span className="test__collapse-control-label">{open ? '접기' : '열기'}</span>}
    <span className="test__collapse-control-icon">
      <DisclosureIcon className="test__collapse-chevron" open={open} />
    </span>
  </span>
);

const isRecord = (value: unknown): value is Record<string, unknown> => (
  typeof value === 'object' && value !== null && !Array.isArray(value)
);

const sanitizeString = (value: unknown, fallback = '') => (
  typeof value === 'string' ? value : fallback
);

const normalizePythonScript = (candidate: unknown): SequencePythonScript | null => {
  if (!isRecord(candidate)) return null;

  const fileName = sanitizeString(candidate.fileName);
  const content = sanitizeString(candidate.content);
  if (!fileName && !content) return null;

  return {
    fileName: fileName || 'sequence_script.py',
    content,
    uploadedAt: sanitizeString(candidate.uploadedAt, new Date().toISOString()),
  };
};

const normalizeSequence = (candidate: unknown, index: number): TestSequence | null => {
  if (!isRecord(candidate)) return null;

  return {
    id: sanitizeString(candidate.id, `imported-${index + 1}-${genSeqId()}`),
    name: sanitizeString(candidate.name, `Imported Sequence ${index + 1}`),
    description: sanitizeString(candidate.description),
    pythonScript: normalizePythonScript(candidate.pythonScript),
    steps: [],
    createdAt: sanitizeString(candidate.createdAt, new Date().toISOString()),
  };
};

const buildSequenceExport = (sequence: TestSequence): TestSequence => ({
  ...sequence,
  steps: [],
});

const parseSequenceLibrary = (rawText: string) => {
  const parsed = JSON.parse(rawText) as unknown;
  const payload = isRecord(parsed) ? parsed : null;
  const schema = payload ? sanitizeString(payload.schema) : '';
  const mode = payload ? sanitizeString(payload.mode) : '';

  if (schema && schema !== SEQUENCE_LIBRARY_SCHEMA) {
    throw new Error('지원되지 않는 시퀀스 JSON schema입니다.');
  }

  if (mode && mode !== 'python-only') {
    throw new Error('Python 전용 시퀀스 JSON만 불러올 수 있습니다.');
  }

  const rawSequences = Array.isArray(parsed)
    ? parsed
    : payload && Array.isArray(payload.sequences)
      ? payload.sequences
      : null;

  if (!rawSequences) {
    throw new Error('유효한 테스트 시퀀스 JSON 형식이 아닙니다.');
  }

  const sequences = rawSequences
    .map((sequence, index) => normalizeSequence(sequence, index))
    .filter((sequence): sequence is TestSequence => sequence !== null);

  if (sequences.length === 0) {
    throw new Error('가져올 수 있는 테스트 시퀀스가 없습니다.');
  }

  return {
    exportedAt: payload ? sanitizeString(payload.exportedAt) || null : null,
    schema: schema || null,
    version: payload && typeof payload.version === 'number' ? payload.version : null,
    sequences,
  };
};

const buildSequenceLibraryPayload = (sequences: TestSequence[]) => {
  const payload = {
    schema: SEQUENCE_LIBRARY_SCHEMA,
    version: SEQUENCE_LIBRARY_VERSION,
    mode: 'python-only',
    exportedAt: new Date().toISOString(),
    sequenceCount: sequences.length,
    sequences: sequences.map(buildSequenceExport),
  } satisfies SequenceLibraryPayload;

  return JSON.stringify(payload, null, 2);
};

const downloadTextFile = (fileName: string, content: string, type = 'text/plain;charset=utf-8') => {
  const blob = new Blob([content], { type });
  const objectUrl = window.URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = objectUrl;
  anchor.download = fileName;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => {
    window.URL.revokeObjectURL(objectUrl);
  }, 0);
};

const moveArrayItem = <T,>(items: T[], fromIndex: number, toIndex: number) => {
  const next = [...items];
  const [moved] = next.splice(fromIndex, 1);
  next.splice(toIndex, 0, moved);
  return next;
};

const getRunSummaryTone = (summary: string) => (
  summary.includes('실패')
  || summary.includes('없습니다')
  || summary.includes('실행할 수 없습니다')
    ? 'test__run-summary--error'
    : 'test__run-summary--success'
);

const TestAutomationPage: React.FC = () => {
  const [sequences, setSequences] = useRecoilState(testSequencesState);
  const [activeId, setActiveId] = useRecoilState(activeTestIdState);
  const setRunning = useSetRecoilState(testRunningState);
  const setToast = useSetRecoilState(toastMessageState);

  const [scriptRunning, setScriptRunning] = useState(false);
  const [scriptConsole, setScriptConsole] = useState<AutomationOutputEvent[]>([]);
  const [runSummary, setRunSummary] = useState('');
  const [draggedSequenceId, setDraggedSequenceId] = useState<string | null>(null);
  const [dragOverSequenceId, setDragOverSequenceId] = useState<string | null>(null);
  const [runningSequenceId, setRunningSequenceId] = useState<string | null>(null);
  const importInputRef = useRef<HTMLInputElement | null>(null);
  const nameInputRef = useRef<HTMLInputElement | null>(null);
  const [isEditingName, setIsEditingName] = useState(false);
  const [nameDraft, setNameDraft] = useState('');
  const [expandedSections, setExpandedSections] = useState<Record<ExpandableSection, boolean>>({
    setup: false,
    console: false,
    scriptPreview: false,
  });

  const activeSequence = useMemo(
    () => sequences.find((sequence) => sequence.id === activeId) || null,
    [activeId, sequences]
  );

  const activeScript = activeSequence?.pythonScript || null;
  const hasRegisteredScript = Boolean(activeScript?.content.trim());
  const scriptPreview = useMemo(() => {
    if (!activeScript?.content) return '';

    const lines = activeScript.content.split(/\r?\n/);
    const preview = lines.slice(0, 14).join('\n');
    return lines.length > 14 ? `${preview}\n...` : preview;
  }, [activeScript]);

  useEffect(() => {
    setRunSummary('');
    setDraggedSequenceId(null);
    setDragOverSequenceId(null);
    setIsEditingName(false);
    setExpandedSections((prev) => ({
      ...prev,
      scriptPreview: false,
    }));
  }, [activeId]);

  useEffect(() => {
    if (!isEditingName) {
      setNameDraft(activeSequence?.name || '');
    }
  }, [activeSequence?.name, isEditingName]);

  useEffect(() => {
    if (scriptRunning) {
      setExpandedSections((prev) => (
        prev.console
          ? prev
          : {
            ...prev,
            console: true,
          }
      ));
    }
  }, [scriptRunning]);

  useEffect(() => {
    if (isEditingName) {
      nameInputRef.current?.focus();
      nameInputRef.current?.select();
    }
  }, [isEditingName]);

  const pushConsoleLine = useCallback((entry: AutomationOutputEvent) => {
    setScriptConsole((prev) => [...prev.slice(-299), entry]);
  }, []);

  useEffect(() => {
    if (!window.electronAPI?.automation) return undefined;

    return window.electronAPI.automation.onOutput((entry) => {
      pushConsoleLine(entry);

      if (entry.exitCode !== undefined) {
        const sequenceName = sequences.find((sequence) => sequence.id === runningSequenceId)?.name
          || activeSequence?.name
          || '선택한 시퀀스';

        setScriptRunning(false);
        setRunning(false);
        setRunningSequenceId(null);
        setRunSummary(
          entry.exitCode === 0
            ? `${sequenceName} Python 실행 완료`
            : `${sequenceName} Python 실행 실패 (exit code: ${entry.exitCode})`
        );
      }
    });
  }, [activeSequence, pushConsoleLine, runningSequenceId, sequences, setRunning]);

  const updateActiveSequence = useCallback((updater: (sequence: TestSequence) => TestSequence) => {
    if (!activeId) return;

    setSequences((prev) => prev.map((sequence) => (
      sequence.id === activeId ? updater(sequence) : sequence
    )));
  }, [activeId, setSequences]);

  const createSequence = useCallback(() => {
    const sequence: TestSequence = {
      id: genSeqId(),
      name: `Python Sequence ${sequences.length + 1}`,
      description: '',
      pythonScript: null,
      steps: [],
      createdAt: new Date().toISOString(),
    };

    setSequences((prev) => [...prev, sequence]);
    setActiveId(sequence.id);
    setRunSummary('새 시퀀스 생성 완료. Python 파일을 연결하세요.');
  }, [sequences.length, setActiveId, setSequences]);

  const deleteSequence = useCallback(() => {
    if (!activeId) return;

    const nextSequences = sequences.filter((sequence) => sequence.id !== activeId);
    setSequences(nextSequences);
    setActiveId(nextSequences[0]?.id || null);
    setRunSummary('선택한 시퀀스 삭제');
    setToast({ type: 'info', message: '시퀀스 삭제' });
  }, [activeId, sequences, setActiveId, setSequences, setToast]);

  const moveSequence = useCallback((sourceSequenceId: string, targetSequenceId: string) => {
    if (sourceSequenceId === targetSequenceId) return;

    setSequences((prev) => {
      const fromIndex = prev.findIndex((sequence) => sequence.id === sourceSequenceId);
      const toIndex = prev.findIndex((sequence) => sequence.id === targetSequenceId);
      if (fromIndex < 0 || toIndex < 0 || fromIndex === toIndex) return prev;
      return moveArrayItem(prev, fromIndex, toIndex);
    });
  }, [setSequences]);

  const handleSequenceDragStart = useCallback((sequenceId: string) => {
    setDraggedSequenceId(sequenceId);
    setDragOverSequenceId(null);
  }, []);

  const handleSequenceDrop = useCallback((targetSequenceId: string) => {
    if (!draggedSequenceId) return;
    moveSequence(draggedSequenceId, targetSequenceId);
    setDraggedSequenceId(null);
    setDragOverSequenceId(null);
  }, [draggedSequenceId, moveSequence]);

  const updateSequencePythonScript = useCallback((script: SequencePythonScript | null) => {
    updateActiveSequence((sequence) => ({
      ...sequence,
      pythonScript: script,
    }));
  }, [updateActiveSequence]);

  const updateSequenceName = useCallback((name: string) => {
    updateActiveSequence((sequence) => ({
      ...sequence,
      name,
    }));
  }, [updateActiveSequence]);

  const updateSequenceDescription = useCallback((description: string) => {
    updateActiveSequence((sequence) => ({
      ...sequence,
      description,
    }));
  }, [updateActiveSequence]);

  const startSequenceNameEdit = useCallback(() => {
    if (!activeSequence) return;
    setNameDraft(activeSequence.name);
    setIsEditingName(true);
  }, [activeSequence]);

  const cancelSequenceNameEdit = useCallback(() => {
    setNameDraft(activeSequence?.name || '');
    setIsEditingName(false);
  }, [activeSequence]);

  const commitSequenceName = useCallback(() => {
    if (!activeSequence) return;

    const trimmedName = nameDraft.trim();
    if (!trimmedName) {
      setNameDraft(activeSequence.name);
      setIsEditingName(false);
      return;
    }

    if (trimmedName !== activeSequence.name) {
      updateSequenceName(trimmedName);
      setRunSummary(`시퀀스 이름 변경 · ${trimmedName}`);
    }

    setIsEditingName(false);
  }, [activeSequence, nameDraft, updateSequenceName]);

  const handleScriptUpload = useCallback(async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file || !activeSequence) return;

    try {
      const content = await file.text();
      updateSequencePythonScript({
        content,
        fileName: file.name,
        uploadedAt: new Date().toISOString(),
      });

      const message = `${activeSequence.name} Python 파일 연결 완료`;
      setRunSummary(message);
      setToast({ type: 'success', message });
      pushConsoleLine({
        stream: 'status',
        message: `시퀀스 Python 등록 완료: ${activeSequence.name} <- ${file.name}`,
        timestamp: getConsoleTimestamp(),
      });
    } catch (error) {
      const message = `Python 파일 등록 실패: ${error instanceof Error ? error.message : 'unknown error'}`;
      setToast({ type: 'error', message });
      pushConsoleLine({
        stream: 'stderr',
        message,
        timestamp: getConsoleTimestamp(),
      });
    } finally {
      event.target.value = '';
    }
  }, [activeSequence, pushConsoleLine, setToast, updateSequencePythonScript]);

  const clearSequencePythonScript = useCallback(() => {
    if (!activeSequence) return;

    updateSequencePythonScript(null);
    setRunSummary(`${activeSequence.name} Python 파일 연결 해제`);
    setToast({ type: 'info', message: 'Python 파일 연결 해제' });
    pushConsoleLine({
      stream: 'status',
      message: `시퀀스 Python 연결 해제: ${activeSequence.name}`,
      timestamp: getConsoleTimestamp(),
    });
  }, [activeSequence, pushConsoleLine, setToast, updateSequencePythonScript]);

  const runPythonScript = useCallback(async () => {
    if (!activeSequence) return;

    if (!hasRegisteredScript || !activeScript) {
      setRunSummary(SCRIPT_REQUIRED_MESSAGE);
      setToast({ type: 'warning', message: SCRIPT_REQUIRED_MESSAGE });
      pushConsoleLine({
        stream: 'stderr',
        message: SCRIPT_REQUIRED_MESSAGE,
        timestamp: getConsoleTimestamp(),
      });
      return;
    }

    if (!window.electronAPI?.automation) {
      const message = 'Electron 환경에서만 Python 자동화를 실행할 수 있습니다.';
      setRunSummary(message);
      setToast({ type: 'error', message });
      pushConsoleLine({
        stream: 'stderr',
        message,
        timestamp: getConsoleTimestamp(),
      });
      return;
    }

    setRunning(true);
    setScriptRunning(true);
    setRunningSequenceId(activeSequence.id);
    setRunSummary(`${activeSequence.name} Python 실행 중`);

    const result = await window.electronAPI.automation.startScript({
      fileName: activeScript.fileName,
      content: activeScript.content,
    });

    if (!result.success) {
      const message = result.error || 'Python 스크립트 실행 실패';
      setRunning(false);
      setScriptRunning(false);
      setRunningSequenceId(null);
      setRunSummary(message);
      setToast({ type: 'error', message });
      pushConsoleLine({
        stream: 'stderr',
        message,
        timestamp: getConsoleTimestamp(),
      });
    }
  }, [activeScript, activeSequence, hasRegisteredScript, pushConsoleLine, setRunning, setToast]);

  const stopPythonScript = useCallback(async () => {
    if (!window.electronAPI?.automation) return;

    const result = await window.electronAPI.automation.stopScript();
    if (!result.success) {
      const message = result.error || 'Python 스크립트 중지 실패';
      setToast({ type: 'error', message });
      pushConsoleLine({
        stream: 'stderr',
        message,
        timestamp: getConsoleTimestamp(),
      });
      return;
    }

    setRunSummary('Python 스크립트 중지 요청 전송');
  }, [pushConsoleLine, setToast]);

  const clearPythonConsole = useCallback(() => {
    setScriptConsole([]);
  }, []);

  const downloadSamplePythonScript = useCallback(() => {
    downloadTextFile(
      TEST_AUTOMATION_SAMPLE_PYTHON_FILE_NAME,
      TEST_AUTOMATION_SAMPLE_PYTHON,
      'text/x-python;charset=utf-8'
    );
    const message = `${TEST_AUTOMATION_SAMPLE_PYTHON_FILE_NAME} 다운로드 완료`;
    setRunSummary(message);
    setToast({ type: 'info', message });
  }, [setToast]);

  const exportSequenceLibrary = useCallback(() => {
    if (sequences.length === 0) {
      const message = '저장할 시퀀스가 없습니다.';
      setRunSummary(message);
      setToast({ type: 'warning', message });
      return;
    }

    try {
      downloadTextFile(
        buildExportFileName(),
        buildSequenceLibraryPayload(sequences),
        'application/json;charset=utf-8'
      );
      const message = `시퀀스 JSON 저장 완료 · ${sequences.length}개`;
      setRunSummary(message);
      setToast({ type: 'success', message });
    } catch (error) {
      const message = `시퀀스 내보내기 실패: ${error instanceof Error ? error.message : 'unknown error'}`;
      setRunSummary(message);
      setToast({ type: 'error', message });
    }
  }, [sequences, setToast]);

  const openImportPicker = useCallback(() => {
    importInputRef.current?.click();
  }, []);

  const handleImportSequences = useCallback(async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    try {
      const rawText = await file.text();
      const imported = parseSequenceLibrary(rawText);
      setSequences(imported.sequences);
      setActiveId(imported.sequences[0]?.id || null);

      const message = `시퀀스 가져오기 완료 · ${imported.sequences.length}개`;
      setRunSummary(message);
      setToast({ type: 'success', message });
    } catch (error) {
      const message = `시퀀스 가져오기 실패: ${error instanceof Error ? error.message : 'unknown error'}`;
      setRunSummary(message);
      setToast({ type: 'error', message });
    } finally {
      event.target.value = '';
    }
  }, [setActiveId, setSequences, setToast]);

  const toggleExpandedSection = useCallback((section: ExpandableSection) => {
    setExpandedSections((prev) => ({
      ...prev,
      [section]: !prev[section],
    }));
  }, []);

  const activeSummaryItems = useMemo(() => {
    if (!activeSequence) return [];

    return [
      {
        label: 'Mode',
        value: 'Python Only',
        tone: 'neutral',
      },
      {
        label: 'Python',
        value: hasRegisteredScript ? 'Ready' : 'Required',
        tone: hasRegisteredScript ? 'ready' : 'warning',
      },
      {
        label: 'Console',
        value: scriptRunning ? 'Running' : scriptConsole.length > 0 ? `${scriptConsole.length} logs` : 'Idle',
        tone: scriptRunning ? 'ready' : 'neutral',
      },
      {
        label: 'Sequences',
        value: `${sequences.length} items`,
        tone: sequences.length > 0 ? 'neutral' : 'warning',
      },
    ];
  }, [activeSequence, hasRegisteredScript, scriptConsole.length, scriptRunning, sequences.length]);

  return (
    <div className="test-page">
      <aside className="test__list">
        <div className="test__list-panel">
          <div className="test__list-header">
            <div>
              <div className="test__list-title-row">
                <div className="test__list-title">Sequences</div>
                <div className="test__list-count">{sequences.length}</div>
              </div>
              <div className="test__list-subtitle">시퀀스를 선택해 Python 자동화를 관리합니다.</div>
            </div>
            <div className="test__list-actions">
              <button className="btn btn--primary btn--sm" onClick={createSequence} type="button">
                + New
              </button>
            </div>
          </div>

          <div className="test__list-divider" aria-hidden="true" />

          <input
            ref={importInputRef}
            type="file"
            accept="application/json,.json"
            onChange={handleImportSequences}
            hidden
          />

          <div className="test__list-scroll">
            {sequences.map((sequence) => {
              const hasSequenceScript = Boolean(sequence.pythonScript?.content.trim());

              return (
                <div
                  key={sequence.id}
                  className={[
                    'test__sequence-card',
                    sequence.id === activeId ? 'test__sequence-card--active' : '',
                    draggedSequenceId === sequence.id ? 'test__sequence-card--dragging' : '',
                    dragOverSequenceId === sequence.id ? 'test__sequence-card--drop-target' : '',
                  ].filter(Boolean).join(' ')}
                  onClick={() => setActiveId(sequence.id)}
                  draggable
                  onDragStart={() => handleSequenceDragStart(sequence.id)}
                  onDragOver={(event) => {
                    event.preventDefault();
                    if (draggedSequenceId && draggedSequenceId !== sequence.id) {
                      setDragOverSequenceId(sequence.id);
                    }
                  }}
                  onDragLeave={() => {
                    if (dragOverSequenceId === sequence.id) {
                      setDragOverSequenceId(null);
                    }
                  }}
                  onDragEnd={() => {
                    setDraggedSequenceId(null);
                    setDragOverSequenceId(null);
                  }}
                  onDrop={(event) => {
                    event.preventDefault();
                    handleSequenceDrop(sequence.id);
                  }}
                >
                  <div className="test__sequence-head">
                    <span className="test__sequence-grip" title="드래그해서 시퀀스 순서 변경">⋮⋮</span>
                    <div className="test__sequence-name">{sequence.name}</div>
                  </div>

                  <div className="test__sequence-meta-row">
                    <div className="test__sequence-meta">Python Only</div>
                    <span className={`test__sequence-badge ${hasSequenceScript ? 'test__sequence-badge--ready' : 'test__sequence-badge--missing'}`}>
                      {hasSequenceScript ? 'Python Ready' : 'Python Required'}
                    </span>
                  </div>

                  {sequence.description && <div className="test__sequence-desc">{sequence.description}</div>}
                  <div className={`test__sequence-script ${hasSequenceScript ? '' : 'test__sequence-script--missing'}`}>
                    {sequence.pythonScript?.fileName || 'Python 파일 등록 필요'}
                  </div>
                </div>
              );
            })}

            {sequences.length === 0 && (
              <div className="test__empty-inline">
                New로 시퀀스를 만들거나 아래 Load로 저장된 JSON을 불러오세요.
              </div>
            )}
          </div>

          <div className="test__list-storage" aria-label="Sequence file actions">
            <div className="test__list-storage-head">
              <div>
                <div className="test__list-storage-title">Sequence File</div>
                <div className="test__list-storage-text">
                  시퀀스를 JSON으로 저장하고 다시 불러옵니다.
                </div>
              </div>
              <span className="test__list-storage-badge">JSON</span>
            </div>
            <div className="test__list-storage-actions">
              <button className="btn btn--secondary btn--sm test__list-storage-btn" onClick={openImportPicker} disabled={scriptRunning} type="button">
                <FolderIcon className="test__button-icon" />
                Load
              </button>
              <button className="btn btn--secondary btn--sm test__list-storage-btn" onClick={exportSequenceLibrary} disabled={scriptRunning || sequences.length === 0} type="button">
                <SaveIcon className="test__button-icon" />
                Save
              </button>
            </div>
          </div>
        </div>
      </aside>

      <div className="test__editor">
        <div className="test__editor-main">
          {activeSequence ? (
            <>
              <section className="test__hero">
                <div className="test__hero-top">
                  <div className="test__hero-copy">
                    <div className="test__hero-kicker">Python Automation</div>
                    {isEditingName ? (
                      <div className="test__name-editor">
                        <input
                          ref={nameInputRef}
                          className="input test__name-edit-input"
                          value={nameDraft}
                          onBlur={commitSequenceName}
                          onChange={(event) => setNameDraft(event.target.value)}
                          onKeyDown={(event) => {
                            if (event.key === 'Enter') {
                              event.preventDefault();
                              commitSequenceName();
                            }
                            if (event.key === 'Escape') {
                              event.preventDefault();
                              cancelSequenceNameEdit();
                            }
                          }}
                          placeholder="시퀀스 이름"
                        />
                      </div>
                    ) : (
                      <div className="test__editor-title-row">
                        <div className="test__editor-name">{activeSequence.name}</div>
                        <button
                          className="test__name-edit-button"
                          onClick={startSequenceNameEdit}
                          title="시퀀스 이름 편집"
                          type="button"
                        >
                          <EditIcon className="test__button-icon" />
                        </button>
                      </div>
                    )}
                    <div className="test__editor-meta">
                      Python 파일 업로드, 미리보기, 실행 로그를 한 화면에서 관리합니다.
                    </div>
                  </div>

                  <div className="test__hero-actions">
                    <button
                      className="btn btn--primary btn--sm"
                      onClick={runPythonScript}
                      disabled={scriptRunning || !hasRegisteredScript}
                      title={hasRegisteredScript ? '이 시퀀스에 연결된 Python 파일 실행' : SCRIPT_REQUIRED_MESSAGE}
                      type="button"
                    >
                      <PlayIcon className="test__button-icon" />
                      {scriptRunning ? 'Running' : 'Run Python'}
                    </button>
                    <button className="btn btn--danger btn--sm" onClick={stopPythonScript} disabled={!scriptRunning} type="button">
                      Stop
                    </button>
                    <button className="btn btn--ghost btn--sm" onClick={deleteSequence} type="button">
                      <TrashIcon className="test__button-icon" />
                      Delete
                    </button>
                  </div>
                </div>

                <div className="test__summary-row">
                  {activeSummaryItems.map((item) => (
                    <div key={item.label} className={`test__summary-pill test__summary-pill--${item.tone}`}>
                      <span className="test__summary-label">{item.label}</span>
                      <span className="test__summary-value">{item.value}</span>
                    </div>
                  ))}
                </div>

                {runSummary && (
                  <div className={`test__run-summary ${getRunSummaryTone(runSummary)}`}>
                    {runSummary}
                  </div>
                )}
              </section>

              <section className="test__section test__workspace">
                <div className="test__section-header">
                  <div>
                    <div className="test__section-title">Python Workspace</div>
                    <div className="test__section-subtitle">
                      이 시퀀스는 Python 파일만 실행합니다.
                    </div>
                  </div>
                  <div className="test__section-chip">
                    <FileCodeIcon className="test__chip-icon" />
                    {hasRegisteredScript ? 'Python Ready' : 'Python Required'}
                  </div>
                </div>

                {hasRegisteredScript && activeScript ? (
                  <div className="test__script-stack">
                    <div className="test__script-brief">
                      <div className="test__script-brief-main">
                        <div className="test__script-file">{activeScript.fileName}</div>
                        <div className="test__script-meta">
                          등록 시각: {formatTimestamp(activeScript.uploadedAt)}
                        </div>
                      </div>
                      <div className="test__script-actions">
                        <button className="btn btn--ghost btn--sm" onClick={downloadSamplePythonScript} type="button">
                          <DownloadIcon className="test__button-icon" />
                          Sample .py
                        </button>
                        <label className="btn btn--secondary btn--sm test__script-upload">
                          <UploadIcon className="test__button-icon" />
                          Replace .py
                          <input type="file" accept=".py" onChange={handleScriptUpload} hidden />
                        </label>
                        <button className="btn btn--ghost btn--sm" onClick={clearSequencePythonScript} type="button">
                          Clear File
                        </button>
                      </div>
                    </div>

                    <button
                      className="test__preview-toggle"
                      onClick={() => toggleExpandedSection('scriptPreview')}
                      type="button"
                    >
                      <span>{expandedSections.scriptPreview ? 'Preview 숨기기' : 'Preview 보기'}</span>
                      <DisclosureControl compact open={expandedSections.scriptPreview} />
                    </button>

                    {expandedSections.scriptPreview && (
                      <pre className="test__script-preview">{scriptPreview}</pre>
                    )}
                  </div>
                ) : (
                  <div className="test__script-callout">
                    <div className="test__script-callout-icon">
                      <FileCodeIcon className="test__callout-svg" />
                    </div>
                    <div className="test__script-callout-body">
                      <div className="test__script-callout-title">Python 파일을 등록해주세요.</div>
                      <div className="test__script-callout-text">
                        이 시퀀스는 `.py` 파일만 실행합니다.
                      </div>
                      <div className="test__script-callout-actions">
                        <label className="btn btn--primary btn--sm test__script-upload">
                          <UploadIcon className="test__button-icon" />
                          Upload .py
                          <input type="file" accept=".py" onChange={handleScriptUpload} hidden />
                        </label>
                        <button className="btn btn--ghost btn--sm test__sample-download" onClick={downloadSamplePythonScript} type="button">
                          <DownloadIcon className="test__button-icon" />
                          Sample .py
                        </button>
                      </div>
                    </div>
                  </div>
                )}
              </section>

              <div className="test__accordion-group">
                <section className="test__section test__collapsible">
                  <button
                    className="test__collapse-trigger"
                    onClick={() => toggleExpandedSection('setup')}
                    type="button"
                  >
                    <div className="test__collapse-trigger-main">
                      <div className="test__section-title">Sequence Details</div>
                      <div className="test__section-subtitle">
                        시퀀스 설명을 입력합니다.
                      </div>
                    </div>
                    <div className="test__collapse-trigger-side">
                      <span className="test__collapse-meta">
                        {activeSequence.description.trim() ? '설명 입력됨' : '설명 없음'}
                      </span>
                      <DisclosureControl open={expandedSections.setup} />
                    </div>
                  </button>

                  {expandedSections.setup && (
                    <div className="test__collapse-body">
                      <div className="test__sequence-form">
                        <label className="test__field-group">
                          <span className="test__field-label">Description</span>
                          <textarea
                            className="input test__sequence-textarea"
                            value={activeSequence.description}
                            onChange={(event) => updateSequenceDescription(event.target.value)}
                            placeholder="시퀀스 설명 또는 실행 목적을 적어주세요."
                            rows={4}
                          />
                        </label>
                      </div>
                    </div>
                  )}
                </section>

                <section className="test__section test__collapsible">
                  <button
                    className="test__collapse-trigger"
                    onClick={() => toggleExpandedSection('console')}
                    type="button"
                  >
                    <div className="test__collapse-trigger-main">
                      <div className="test__section-title">Python Console</div>
                      <div className="test__section-subtitle">
                        Python 실행 로그를 확인합니다.
                      </div>
                    </div>
                    <div className="test__collapse-trigger-side">
                      <span className={`test__script-status ${scriptRunning ? 'test__script-status--running' : ''}`}>
                        <TerminalIcon className="test__script-status-icon" />
                        {scriptRunning ? 'Running' : scriptConsole.length > 0 ? `${scriptConsole.length} logs` : 'Idle'}
                      </span>
                      <DisclosureControl open={expandedSections.console} />
                    </div>
                  </button>

                  {expandedSections.console && (
                    <div className="test__collapse-body">
                      <div className="test__console-toolbar">
                        <div className={`test__script-status ${scriptRunning ? 'test__script-status--running' : ''}`}>
                          <TerminalIcon className="test__script-status-icon" />
                          {scriptRunning ? 'Running' : 'Idle'}
                        </div>
                        <button className="btn btn--ghost btn--sm" onClick={clearPythonConsole} type="button">
                          Clear Log
                        </button>
                      </div>

                      <div className="test__script-console">
                        {scriptConsole.length === 0 ? (
                          <div className="test__script-empty">
                            선택한 시퀀스의 Python 실행 로그가 여기에 표시됩니다.
                          </div>
                        ) : (
                          scriptConsole.map((entry, index) => (
                            <div
                              key={`${entry.timestamp}-${index}`}
                              className={`test__script-line test__script-line--${entry.stream}`}
                            >
                              <span className="test__script-time">{entry.timestamp}</span>
                              <span className="test__script-stream">{entry.stream}</span>
                              <span className="test__script-message">{entry.message}</span>
                            </div>
                          ))
                        )}
                      </div>
                    </div>
                  )}
                </section>
              </div>
            </>
          ) : (
            <div className="test__empty">
              좌측에서 시퀀스를 선택하거나 새로 생성하세요.
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default TestAutomationPage;
