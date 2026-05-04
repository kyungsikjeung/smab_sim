import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useRecoilState, useRecoilValue, useResetRecoilState, useSetRecoilState } from 'recoil';
import { BU92_REGISTER_MAP } from 'data/rohm/bu92RegisterMap';
import { useSerial } from 'hooks/useSerial';
import {
  buildRohmFieldWriteBytes,
  buildRohmRegisterRows,
  formatRohmByte,
  formatRohmFieldValue,
  formatRohmHex,
  getRohmFieldKey,
  parseFlexibleNumber,
} from 'services/rohmRegisterMap';
import { subscribeRohmProtocolEvents } from 'services/rohmProtocol';
import { registerLoadingState, rohmRegisterBytesState, toastMessageState } from 'state/atoms';
import { RegisterValueFormat, RohmBitfieldDefinition, RohmRegisterFieldRow } from 'types';
import './RegisterEditorPage.css';

const READ_ALL_BATCHES = [
  { address: 0x00, length: 0xff },
  { address: 0xff, length: 0x01 },
  { address: 0x100, length: 0xff },
  { address: 0x1ff, length: 0x01 },
];

const DEFAULT_POLL_INTERVAL_SECONDS = '2';
const READ_BATCH_GAP_MS = 30;
const WRITE_READBACK_DELAY_MS = 180;
const ROHM_READ_TIMEOUT_MS = 4000;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const hasDraftValue = (drafts: Record<string, string>, key: string) =>
  Object.prototype.hasOwnProperty.call(drafts, key);

const toWriteToken = (values: number[]) => `0x${values.map((value) => formatRohmByte(value).replace(/^0x/i, '')).join('')}`;

const splitWriteBatches = (bytes: Array<{ address: number; value: number }>) => {
  if (bytes.length === 0) {
    return [];
  }

  const sortedBytes = [...bytes].sort((left, right) => left.address - right.address);
  const batches: Array<{ address: number; values: number[] }> = [];
  let currentBatch = { address: sortedBytes[0].address, values: [sortedBytes[0].value] };

  for (let index = 1; index < sortedBytes.length; index += 1) {
    const current = sortedBytes[index];
    const previous = sortedBytes[index - 1];

    if (current.address === previous.address + 1) {
      currentBatch.values.push(current.value);
      continue;
    }

    batches.push(currentBatch);
    currentBatch = { address: current.address, values: [current.value] };
  }

  batches.push(currentBatch);
  return batches;
};

const formatEditableValue = (row: RohmRegisterFieldRow, format: RegisterValueFormat) => {
  if (row.numericValue === null) {
    return '';
  }

  return formatRohmFieldValue(row.numericValue, row.bitLength, format);
};

const getFieldMaxValue = (row: RohmRegisterFieldRow) => (2 ** row.bitLength) - 1;

const RegisterEditorPage: React.FC = () => {
  const { send, connected } = useSerial();
  const rawBytes = useRecoilValue(rohmRegisterBytesState);
  const [loading, setLoading] = useRecoilState(registerLoadingState);
  const resetRawBytes = useResetRecoilState(rohmRegisterBytesState);
  const setToast = useSetRecoilState(toastMessageState);

  const bootstrapRef = useRef(false);
  const pollTimerRef = useRef<number | null>(null);
  const pollInFlightRef = useRef(false);
  const previousRowValuesRef = useRef<Record<string, number | null>>({});

  const [valueFormat, setValueFormat] = useState<RegisterValueFormat>('hex');
  const [searchQuery, setSearchQuery] = useState('');
  const [pollIntervalSeconds, setPollIntervalSeconds] = useState(DEFAULT_POLL_INTERVAL_SECONDS);
  const [continuousPolling, setContinuousPolling] = useState(false);
  const [latchedChangedRowKeys, setLatchedChangedRowKeys] = useState<string[]>([]);
  const [editedValues, setEditedValues] = useState<Record<string, string>>({});
  const [selectedRowKey, setSelectedRowKey] = useState<string | null>(null);
  const [writeBusyRowKey, setWriteBusyRowKey] = useState<string | null>(null);

  const rows = useMemo(
    () => buildRohmRegisterRows(BU92_REGISTER_MAP, rawBytes, valueFormat),
    [rawBytes, valueFormat]
  );

  const fieldLookup = useMemo(
    () =>
      new Map<string, RohmBitfieldDefinition>(
        BU92_REGISTER_MAP.bitfields.map((field) => [getRohmFieldKey(field), field])
      ),
    []
  );

  const normalizedQuery = searchQuery.trim().toLowerCase();
  const filteredRows = useMemo(() => {
    if (!normalizedQuery) {
      return rows;
    }

    const addressQuery = parseFlexibleNumber(normalizedQuery);

    return rows.filter((row) =>
      (addressQuery !== null && row.addressSpan.includes(addressQuery))
      || [row.name, row.primaryAddressDec, row.primaryAddressHex]
          .join(' ')
          .toLowerCase()
          .includes(normalizedQuery)
    );
  }, [normalizedQuery, rows]);

  const cacheByteCount = Object.keys(rawBytes).length;
  const resolvedCount = rows.filter((row) => row.resolved).length;
  const changedCount = latchedChangedRowKeys.length;
  const pollIntervalMs = useMemo(() => {
    const parsed = Number(pollIntervalSeconds);
    if (!Number.isFinite(parsed) || parsed <= 0) {
      return null;
    }

    return Math.round(parsed * 1000);
  }, [pollIntervalSeconds]);

  const clearPollTimer = useCallback(() => {
    if (pollTimerRef.current !== null) {
      window.clearTimeout(pollTimerRef.current);
      pollTimerRef.current = null;
    }
  }, []);

  const scheduleNextPoll = useCallback(
    (delayMs: number, callback: () => void) => {
      clearPollTimer();
      pollTimerRef.current = window.setTimeout(() => {
        callback();
      }, delayMs);
    },
    [clearPollTimer]
  );

  const showWarning = useCallback(
    (message: string) => {
      setToast({ type: 'warning', message });
    },
    [setToast]
  );

  const createReadWaiter = useCallback((address: number, length: number) => {
    let settled = false;
    let timeoutId = 0;
    let unsubscribe = () => {};

    const promise = new Promise<boolean>((resolve) => {
      const finish = (result: boolean) => {
        if (settled) {
          return;
        }

        settled = true;
        window.clearTimeout(timeoutId);
        unsubscribe();
        resolve(result);
      };

      unsubscribe = subscribeRohmProtocolEvents((event) => {
        if (event.type !== 'read-complete') {
          return;
        }

        if (event.response.addr !== address || event.response.len !== length) {
          return;
        }

        finish(true);
      });

      timeoutId = window.setTimeout(() => {
        finish(false);
      }, ROHM_READ_TIMEOUT_MS);
    });

    return {
      cancel: () => {
        if (settled) {
          return;
        }

        settled = true;
        window.clearTimeout(timeoutId);
        unsubscribe();
      },
      promise,
    };
  }, []);

  const executeRead = useCallback(
    async (address: number, length: number, options?: { silent?: boolean }) => {
      const waiter = createReadWaiter(address, length);
      const sendResult = await send(`rohm_rd_prm ${formatRohmHex(address, 2)} ${formatRohmHex(length, 2)}`);

      if (!sendResult.success) {
        waiter.cancel();
        return false;
      }

      const completed = await waiter.promise;
      if (!completed && !options?.silent) {
        showWarning(`${formatRohmHex(address, 2)} read 응답이 없습니다.`);
      }

      return completed;
    },
    [createReadWaiter, send, showWarning]
  );

  const executeBatchRead = useCallback(
    async (batches: Array<{ address: number; length: number }>, options?: { silent?: boolean }) => {
      for (const batch of batches) {
        const completed = await executeRead(batch.address, batch.length, options);
        if (!completed) {
          return false;
        }

        await sleep(READ_BATCH_GAP_MS);
      }

      return true;
    },
    [executeRead]
  );

  const handleReadAll = useCallback(
    async (options?: { silent?: boolean }) => {
      if (!connected) {
        return false;
      }

      bootstrapRef.current = true;
      setLoading(true);

      try {
        return await executeBatchRead(READ_ALL_BATCHES, options);
      } finally {
        setLoading(false);
      }
    },
    [connected, executeBatchRead, setLoading]
  );

  const runContinuousPolling = useCallback(async () => {
    if (!continuousPolling || !connected || pollIntervalMs === null) {
      return;
    }

    if (pollInFlightRef.current || loading || writeBusyRowKey !== null) {
      scheduleNextPoll(250, () => {
        void runContinuousPolling();
      });
      return;
    }

    pollInFlightRef.current = true;
    const startedAt = Date.now();

    try {
      await handleReadAll({ silent: true });
    } finally {
      pollInFlightRef.current = false;
    }

    if (!continuousPolling || !connected || pollIntervalMs === null) {
      return;
    }

    const elapsed = Date.now() - startedAt;
    scheduleNextPoll(Math.max(0, pollIntervalMs - elapsed), () => {
      void runContinuousPolling();
    });
  }, [connected, continuousPolling, handleReadAll, loading, pollIntervalMs, scheduleNextPoll, writeBusyRowKey]);

  const getDisplayValue = useCallback(
    (row: RohmRegisterFieldRow) =>
      hasDraftValue(editedValues, row.key)
        ? editedValues[row.key]
        : formatEditableValue(row, valueFormat),
    [editedValues, valueFormat]
  );

  const isDraftDirty = useCallback(
    (row: RohmRegisterFieldRow) => {
      if (!hasDraftValue(editedValues, row.key)) {
        return false;
      }

      const draft = editedValues[row.key].trim();
      if (!draft) {
        return false;
      }

      const parsed = parseFlexibleNumber(draft);
      if (parsed === null) {
        return true;
      }

      return row.numericValue !== parsed;
    },
    [editedValues]
  );

  const isDraftValid = useCallback(
    (row: RohmRegisterFieldRow) => {
      const draft = getDisplayValue(row).trim();
      if (!draft) {
        return false;
      }

      const parsed = parseFlexibleNumber(draft);
      if (parsed === null) {
        return false;
      }

      return parsed >= 0 && parsed <= getFieldMaxValue(row);
    },
    [getDisplayValue]
  );

  const canWriteRow = useCallback(
    (row: RohmRegisterFieldRow) =>
      connected
      && row.resolved
      && row.access.includes('W')
      && isDraftDirty(row)
      && isDraftValid(row)
      && !loading
      && writeBusyRowKey === null,
    [connected, isDraftDirty, isDraftValid, loading, writeBusyRowKey]
  );

  const handleWriteField = useCallback(
    async (row: RohmRegisterFieldRow) => {
      const field = fieldLookup.get(row.key);
      if (!field) {
        showWarning('레지스터 정의를 찾을 수 없습니다.');
        return;
      }

      const draft = getDisplayValue(row).trim();
      const nextValue = parseFlexibleNumber(draft);

      if (nextValue === null) {
        showWarning('값은 HEX 또는 DEC 정수만 입력할 수 있습니다.');
        return;
      }

      if (nextValue < 0 || nextValue > getFieldMaxValue(row)) {
        showWarning(`${row.name} 범위를 벗어난 값입니다.`);
        return;
      }

      const writeBytes = buildRohmFieldWriteBytes(field, rawBytes, nextValue);
      if (!writeBytes || writeBytes.length === 0) {
        showWarning('먼저 Read All로 현재 값을 읽어주세요.');
        return;
      }

      const writeBatches = splitWriteBatches(writeBytes);

      setWriteBusyRowKey(row.key);
      setSelectedRowKey(row.key);
      setLoading(true);

      try {
        for (const batch of writeBatches) {
          const writeResult = await send(`rohm_wr_prm ${formatRohmHex(batch.address, 2)} ${toWriteToken(batch.values)}`);
          if (!writeResult.success) {
            return;
          }

          await sleep(READ_BATCH_GAP_MS);
        }

        await sleep(WRITE_READBACK_DELAY_MS);

        for (const batch of writeBatches) {
          const completed = await executeRead(batch.address, batch.values.length);
          if (!completed) {
            return;
          }

          await sleep(READ_BATCH_GAP_MS);
        }

        setToast({ type: 'success', message: `${row.name} write 완료` });
      } finally {
        setLoading(false);
        setWriteBusyRowKey(null);
      }
    },
    [executeRead, fieldLookup, getDisplayValue, rawBytes, send, setLoading, setToast, showWarning]
  );

  const handleFieldInputChange = useCallback((rowKey: string, value: string) => {
    setEditedValues((prev) => ({
      ...prev,
      [rowKey]: value,
    }));
  }, []);

  const handleFieldInputKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLInputElement>, row: RohmRegisterFieldRow) => {
      if (event.key !== 'Enter') {
        return;
      }

      event.preventDefault();
      void handleWriteField(row);
    },
    [handleWriteField]
  );

  const handleClearCache = useCallback(() => {
    resetRawBytes();
    setLatchedChangedRowKeys([]);
    setEditedValues({});
    setSelectedRowKey(null);
  }, [resetRawBytes]);

  useEffect(() => {
    if (cacheByteCount === 0) {
      previousRowValuesRef.current = {};
      setLatchedChangedRowKeys([]);
      return;
    }

    const nextSnapshot: Record<string, number | null> = {};
    const nextChangedKeys: string[] = [];

    rows.forEach((row) => {
      nextSnapshot[row.key] = row.numericValue;
      const previousValue = previousRowValuesRef.current[row.key];

      if (previousValue === undefined || previousValue === null || row.numericValue === null) {
        return;
      }

      if (previousValue !== row.numericValue) {
        nextChangedKeys.push(row.key);
      }
    });

    previousRowValuesRef.current = nextSnapshot;
    if (nextChangedKeys.length > 0) {
      setLatchedChangedRowKeys((prev) => Array.from(new Set([...prev, ...nextChangedKeys])));
    }
  }, [cacheByteCount, rows]);

  useEffect(() => {
    const rowLookup = new Map(rows.map((row) => [row.key, row]));

    setEditedValues((prev) => {
      let hasChange = false;
      const next = { ...prev };

      Object.entries(prev).forEach(([key, draft]) => {
        const row = rowLookup.get(key);

        if (!row) {
          delete next[key];
          hasChange = true;
          return;
        }

        const parsed = parseFlexibleNumber(draft);
        if (parsed !== null && row.numericValue !== null && parsed === row.numericValue) {
          delete next[key];
          hasChange = true;
        }
      });

      return hasChange ? next : prev;
    });
  }, [rows]);

  useEffect(() => {
    if (!connected) {
      bootstrapRef.current = false;
      clearPollTimer();
      setContinuousPolling(false);
      return;
    }

    if (bootstrapRef.current || cacheByteCount > 0) {
      return;
    }

    bootstrapRef.current = true;
    void handleReadAll({ silent: true });
  }, [cacheByteCount, clearPollTimer, connected, handleReadAll]);

  useEffect(() => {
    clearPollTimer();

    if (!continuousPolling) {
      return undefined;
    }

    if (!connected) {
      setContinuousPolling(false);
      return undefined;
    }

    if (pollIntervalMs === null) {
      showWarning('폴링 간격을 초 단위로 입력해주세요.');
      setContinuousPolling(false);
      return undefined;
    }

    if (!pollInFlightRef.current) {
      void runContinuousPolling();
    }

    return () => {
      clearPollTimer();
    };
  }, [clearPollTimer, connected, continuousPolling, pollIntervalMs, runContinuousPolling, showWarning]);

  useEffect(
    () => () => {
      clearPollTimer();
    },
    [clearPollTimer]
  );

  return (
    <div className="register-editor">
      <section className="register-editor__toolbar">
        <div className="register-editor__toolbar-main">
          <div className="register-editor__field">
            <span className="register-editor__label">Format</span>
            <div className="register-editor__toggle" role="tablist" aria-label="Value format">
              <button
                className={`register-editor__toggle-btn ${valueFormat === 'hex' ? 'register-editor__toggle-btn--active' : ''}`}
                onClick={() => setValueFormat('hex')}
                type="button"
              >
                HEX
              </button>
              <button
                className={`register-editor__toggle-btn ${valueFormat === 'dec' ? 'register-editor__toggle-btn--active' : ''}`}
                onClick={() => setValueFormat('dec')}
                type="button"
              >
                DEC
              </button>
            </div>
          </div>

          <div className="register-editor__field">
            <span className="register-editor__label">Polling</span>
            <div className="register-editor__poll-box">
              <label className="register-editor__checkbox">
                <input
                  checked={continuousPolling}
                  disabled={!connected}
                  onChange={(event) => setContinuousPolling(event.target.checked)}
                  type="checkbox"
                />
                <span>Continuous</span>
              </label>

              <input
                className="input register-editor__poll-input"
                value={pollIntervalSeconds}
                onChange={(event) => setPollIntervalSeconds(event.target.value)}
                placeholder="2"
              />
              <span className="register-editor__poll-unit">sec</span>
            </div>
          </div>
          <label className="register-editor__field register-editor__field--search">
            <span className="register-editor__label">Search</span>
            <input
              className="input register-editor__search-input"
              value={searchQuery}
              onChange={(event) => setSearchQuery(event.target.value)}
              placeholder="레지스터명 또는 0x0123"
            />
          </label>
        </div>

        <div className="register-editor__actions">
          <button
            className="btn btn--primary"
            disabled={!connected || loading}
            onClick={() => void handleReadAll()}
            type="button"
          >
            Read All
          </button>
          <button
            className="btn btn--ghost"
            disabled={loading}
            onClick={handleClearCache}
            type="button"
          >
            Clear
          </button>
        </div>
      </section>

      <div className="register-editor__status-row">
        <span className={`register-editor__status-pill ${connected ? 'register-editor__status-pill--connected' : ''}`}>
          {connected ? 'Connected' : 'Disconnected'}
        </span>
        <span className="register-editor__status-pill">0x000 - 0x1FF</span>
        <span className="register-editor__status-pill">{resolvedCount} / {rows.length} resolved</span>
        <span className={`register-editor__status-pill ${changedCount > 0 ? 'register-editor__status-pill--changed' : ''}`}>
          {changedCount} changed
        </span>
        <span className="register-editor__status-pill">{cacheByteCount} bytes</span>
        {continuousPolling && pollIntervalMs !== null && (
          <span className="register-editor__status-pill register-editor__status-pill--polling">
            {pollIntervalSeconds}s polling
          </span>
        )}
      </div>

      <div className="register-editor__table-wrap">
        {filteredRows.length === 0 ? (
          <div className="register-editor__empty">검색 결과가 없습니다.</div>
        ) : (
          <table className="register-editor__table">
            <colgroup>
              <col className="register-editor__col register-editor__col--addr" />
              <col className="register-editor__col register-editor__col--register" />
              <col className="register-editor__col register-editor__col--access" />
              <col className="register-editor__col register-editor__col--value" />
              <col className="register-editor__col register-editor__col--raw" />
              <col className="register-editor__col register-editor__col--description" />
              <col className="register-editor__col register-editor__col--write" />
            </colgroup>
            <thead>
              <tr>
                <th>Addr</th>
                <th>Register</th>
                <th>R/W</th>
                <th>Field Value</th>
                <th>Raw</th>
                <th>설명</th>
                <th>Write</th>
              </tr>
            </thead>
            <tbody>
              {filteredRows.map((row) => {
                const displayValue = getDisplayValue(row);
                const draftDirty = isDraftDirty(row);
                const draftValid = !displayValue.trim() || isDraftValid(row);
                const valueChanged = latchedChangedRowKeys.includes(row.key);
                const writePending = writeBusyRowKey === row.key;

                return (
                  <tr
                    key={row.key}
                    className={[
                      'register-editor__row',
                      selectedRowKey === row.key ? 'register-editor__row--selected' : '',
                      valueChanged ? 'register-editor__row--changed' : '',
                      !row.resolved ? 'register-editor__row--unresolved' : '',
                    ].filter(Boolean).join(' ')}
                    onClick={() => setSelectedRowKey(row.key)}
                  >
                    <td>
                      <span className="register-editor__addr-hex">{row.primaryAddressHex}</span>
                    </td>
                    <td>
                      <div className="register-editor__name">{row.name}</div>
                    </td>
                    <td>
                      <span className="register-editor__access">{row.access}</span>
                    </td>
                    <td>
                      <div className="register-editor__value-cell">
                        <input
                          className={[
                            'input',
                            'register-editor__value-input',
                            valueChanged ? 'register-editor__value-input--changed' : '',
                            draftDirty ? 'register-editor__value-input--dirty' : '',
                            !draftValid ? 'register-editor__value-input--invalid' : '',
                          ].filter(Boolean).join(' ')}
                          disabled={!row.access.includes('W') || writePending}
                          onChange={(event) => handleFieldInputChange(row.key, event.target.value)}
                          onFocus={() => setSelectedRowKey(row.key)}
                          onKeyDown={(event) => handleFieldInputKeyDown(event, row)}
                          placeholder={row.resolved ? '' : '--'}
                          value={displayValue}
                        />
                        <span className={`register-editor__delta ${valueChanged ? 'register-editor__delta--latched' : ''}`}>
                          {valueChanged ? 'LATCHED' : ''}
                        </span>
                      </div>
                    </td>
                    <td>
                      <span className={`register-editor__raw ${!row.resolved ? 'register-editor__raw--unresolved' : ''}`}>
                        {row.rawValueText}
                      </span>
                    </td>
                    <td>
                      <div className="register-editor__description">{row.description}</div>
                    </td>
                    <td>
                      <button
                        className="btn btn--secondary btn--sm"
                        disabled={!canWriteRow(row)}
                        onClick={(event) => {
                          event.stopPropagation();
                          void handleWriteField(row);
                        }}
                        type="button"
                      >
                        {writePending ? '...' : 'Write'}
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
};

export default RegisterEditorPage;
