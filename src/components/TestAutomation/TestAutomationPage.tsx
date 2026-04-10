import React, { useState, useCallback, useEffect } from 'react';
import { useRecoilState } from 'recoil';
import {
  testSequencesState,
  activeTestIdState,
  testRunningState,
} from 'state/atoms';
import { useSerial } from 'hooks/useSerial';
import { AutomationOutputEvent, TestSequence, TestStep } from 'types';
import './TestAutomation.css';

let stepCounter = 0;
const genStepId = () => `step-${Date.now()}-${++stepCounter}`;
const genSeqId = () => `seq-${Date.now()}`;
const getConsoleTimestamp = () => new Date().toLocaleTimeString('ko-KR', { hour12: false, fractionalSecondDigits: 3 });

const TestAutomationPage: React.FC = () => {
  const { send, connected } = useSerial();
  const [sequences, setSequences] = useRecoilState(testSequencesState);
  const [activeId, setActiveId] = useRecoilState(activeTestIdState);
  const [running, setRunning] = useRecoilState(testRunningState);

  const [newStepType, setNewStepType] = useState<TestStep['type']>('send');
  const [newStepValue, setNewStepValue] = useState('');
  const [scriptFileName, setScriptFileName] = useState('');
  const [scriptContent, setScriptContent] = useState('');
  const [scriptRunning, setScriptRunning] = useState(false);
  const [scriptConsole, setScriptConsole] = useState<AutomationOutputEvent[]>([]);

  const activeSequence = sequences.find((s) => s.id === activeId) || null;

  const pushConsoleLine = useCallback((entry: AutomationOutputEvent) => {
    setScriptConsole((prev) => [...prev.slice(-299), entry]);
  }, []);

  useEffect(() => {
    if (!window.electronAPI?.automation) return undefined;

    return window.electronAPI.automation.onOutput((entry) => {
      pushConsoleLine(entry);
      if (entry.exitCode !== undefined) {
        setScriptRunning(false);
      }
    });
  }, [pushConsoleLine]);

  // 시퀀스 생성
  const createSequence = useCallback(() => {
    const seq: TestSequence = {
      id: genSeqId(),
      name: `Test Sequence ${sequences.length + 1}`,
      description: '',
      steps: [],
      createdAt: new Date().toISOString(),
    };
    setSequences((prev) => [...prev, seq]);
    setActiveId(seq.id);
  }, [sequences.length, setSequences, setActiveId]);

  // 스텝 추가
  const addStep = useCallback(() => {
    if (!activeId || !newStepValue.trim()) return;
    const step: TestStep = {
      id: genStepId(),
      type: newStepType,
      description: newStepValue.trim(),
      ...(newStepType === 'send' && { command: newStepValue.trim() }),
      ...(newStepType === 'expect' && { expectedResponse: newStepValue.trim() }),
      ...(newStepType === 'delay' && { delayMs: parseInt(newStepValue) || 1000 }),
    };
    setSequences((prev) =>
      prev.map((s) => (s.id === activeId ? { ...s, steps: [...s.steps, step] } : s))
    );
    setNewStepValue('');
  }, [activeId, newStepType, newStepValue, setSequences]);

  // 스텝 삭제
  const removeStep = useCallback(
    (stepId: string) => {
      if (!activeId) return;
      setSequences((prev) =>
        prev.map((s) =>
          s.id === activeId ? { ...s, steps: s.steps.filter((st) => st.id !== stepId) } : s
        )
      );
    },
    [activeId, setSequences]
  );

  // 시퀀스 실행
  const runSequence = useCallback(async () => {
    if (!activeSequence || !connected || running) return;
    setRunning(true);

    for (const step of activeSequence.steps) {
      if (step.type === 'send' && step.command) {
        await send(step.command);
      } else if (step.type === 'delay' && step.delayMs) {
        await new Promise((r) => setTimeout(r, step.delayMs));
      }
      // expect / wait 로직은 실제 환경에서 확장
    }

    setRunning(false);
  }, [activeSequence, connected, running, send, setRunning]);

  // 시퀀스 삭제
  const deleteSequence = useCallback(() => {
    if (!activeId) return;
    setSequences((prev) => prev.filter((s) => s.id !== activeId));
    setActiveId(null);
  }, [activeId, setSequences, setActiveId]);

  const handleScriptUpload = useCallback(
    async (event: React.ChangeEvent<HTMLInputElement>) => {
      const file = event.target.files?.[0];
      if (!file) return;

      try {
        const content = await file.text();
        setScriptFileName(file.name);
        setScriptContent(content);
        pushConsoleLine({
          stream: 'status',
          message: `스크립트 업로드 완료: ${file.name}`,
          timestamp: getConsoleTimestamp(),
        });
      } catch (error) {
        pushConsoleLine({
          stream: 'stderr',
          message: `스크립트 업로드 실패: ${error instanceof Error ? error.message : 'unknown error'}`,
          timestamp: getConsoleTimestamp(),
        });
      } finally {
        event.target.value = '';
      }
    },
    [pushConsoleLine]
  );

  const runPythonScript = useCallback(async () => {
    if (!scriptContent.trim()) {
      pushConsoleLine({
        stream: 'stderr',
        message: '먼저 실행할 Python 파일을 업로드해주세요.',
        timestamp: getConsoleTimestamp(),
      });
      return;
    }

    if (!window.electronAPI?.automation) {
      pushConsoleLine({
        stream: 'stderr',
        message: 'Electron 환경에서만 Python 자동화를 실행할 수 있습니다.',
        timestamp: getConsoleTimestamp(),
      });
      return;
    }

    setScriptRunning(true);
    const result = await window.electronAPI.automation.startScript({
      fileName: scriptFileName || 'uploaded_script.py',
      content: scriptContent,
    });

    if (!result.success) {
      setScriptRunning(false);
      pushConsoleLine({
        stream: 'stderr',
        message: result.error || 'Python 스크립트 실행에 실패했습니다.',
        timestamp: getConsoleTimestamp(),
      });
    }
  }, [pushConsoleLine, scriptContent, scriptFileName]);

  const stopPythonScript = useCallback(async () => {
    if (!window.electronAPI?.automation) return;

    const result = await window.electronAPI.automation.stopScript();
    if (!result.success) {
      pushConsoleLine({
        stream: 'stderr',
        message: result.error || 'Python 스크립트 중지에 실패했습니다.',
        timestamp: getConsoleTimestamp(),
      });
    }
  }, [pushConsoleLine]);

  const clearPythonConsole = useCallback(() => {
    setScriptConsole([]);
  }, []);

  return (
    <div className="test-page">
      {/* ── Left: Sequence List ── */}
      <div className="test__list">
        <div className="test__list-header">
          <span className="test__list-title">Sequences</span>
          <button className="btn btn--primary btn--sm" onClick={createSequence}>+ New</button>
        </div>

        {sequences.map((seq) => (
          <div
            key={seq.id}
            className={`test__sequence-card ${seq.id === activeId ? 'test__sequence-card--active' : ''}`}
            onClick={() => setActiveId(seq.id)}
          >
            <div className="test__sequence-name">{seq.name}</div>
            <div className="test__sequence-meta">{seq.steps.length} steps</div>
          </div>
        ))}

        {sequences.length === 0 && (
          <div style={{ color: 'var(--text-tertiary)', fontSize: 12, padding: 20, textAlign: 'center' }}>
            + New 버튼으로 시퀀스를 추가하세요
          </div>
        )}
      </div>

      {/* ── Right: Editor ── */}
      <div className="test__editor">
        <div className="test__editor-main">
          {activeSequence ? (
            <>
              <div className="test__editor-header">
                <span className="test__editor-name">{activeSequence.name}</span>
                <div style={{ display: 'flex', gap: 8 }}>
                  <button
                    className="btn btn--primary btn--sm"
                    onClick={runSequence}
                    disabled={!connected || running || activeSequence.steps.length === 0}
                  >
                    {running ? '⟳ Running...' : '▶ Run'}
                  </button>
                  <button className="btn btn--danger btn--sm" onClick={deleteSequence}>Delete</button>
                </div>
              </div>

              <div className="test__steps">
                {activeSequence.steps.map((step, idx) => (
                  <div key={step.id} className="test__step">
                    <span className="test__step-index">{idx + 1}</span>
                    <span className={`test__step-type test__step-type--${step.type}`}>
                      {step.type}
                    </span>
                    <span className="test__step-content">{step.description}</span>
                    <button className="test__step-remove" onClick={() => removeStep(step.id)}>×</button>
                  </div>
                ))}
              </div>

              <div className="test__add-step">
                <select
                  className="select test__add-select"
                  value={newStepType}
                  onChange={(e) => setNewStepType(e.target.value as TestStep['type'])}
                >
                  <option value="send">Send</option>
                  <option value="expect">Expect</option>
                  <option value="delay">Delay (ms)</option>
                  <option value="wait">Wait</option>
                </select>
                <input
                  className="input test__add-input"
                  value={newStepValue}
                  onChange={(e) => setNewStepValue(e.target.value)}
                  placeholder={
                    newStepType === 'send' ? '전송할 커맨드...' :
                    newStepType === 'expect' ? '기대 응답 문자열...' :
                    newStepType === 'delay' ? '대기 시간 (ms)...' :
                    '대기 조건...'
                  }
                  onKeyDown={(e) => e.key === 'Enter' && addStep()}
                />
                <button className="btn btn--secondary btn--sm" onClick={addStep} disabled={!newStepValue.trim()}>
                  Add
                </button>
              </div>
            </>
          ) : (
            <div className="test__empty">
              좌측에서 시퀀스를 선택하거나 새로 생성하세요
            </div>
          )}
        </div>

        <div className="test__script-panel">
          <div className="test__script-header">
            <div>
              <div className="test__editor-name">Python Automation</div>
              <div className="test__script-meta">
                업로드한 `.py`는 Electron 메인 프로세스가 임시 파일로 저장한 뒤 실행합니다.
              </div>
            </div>
            <div className={`test__script-status ${scriptRunning ? 'test__script-status--running' : ''}`}>
              {scriptRunning ? 'Running' : 'Idle'}
            </div>
          </div>

          <div className="test__script-toolbar">
            <label className="btn btn--secondary btn--sm test__script-upload">
              Upload .py
              <input type="file" accept=".py" onChange={handleScriptUpload} hidden />
            </label>
            <div className="test__script-file">
              {scriptFileName || '업로드된 Python 파일 없음'}
            </div>
            <button
              className="btn btn--primary btn--sm"
              onClick={runPythonScript}
              disabled={scriptRunning || !scriptContent.trim()}
            >
              Run Python
            </button>
            <button
              className="btn btn--danger btn--sm"
              onClick={stopPythonScript}
              disabled={!scriptRunning}
            >
              Stop
            </button>
            <button className="btn btn--ghost btn--sm" onClick={clearPythonConsole}>
              Clear Log
            </button>
          </div>

          <div className="test__script-console">
            {scriptConsole.length === 0 ? (
              <div className="test__script-empty">
                Python 실행 상태와 stdout/stderr 로그가 여기에 표시됩니다.
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
      </div>
    </div>
  );
};

export default TestAutomationPage;
