import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useRecoilState, useRecoilValue, useResetRecoilState, useSetRecoilState } from 'recoil';
import { BU92_REGISTER_MAP } from 'data/rohm/bu92RegisterMap';
import { useSerial } from 'hooks/useSerial';
import {
  buildRohmRegisterRows,
  formatRohmByte,
  formatRohmHex,
  getUniqueRegisterAddresses,
  parseFlexibleNumber,
} from 'services/rohmRegisterMap';
import { subscribeRohmProtocolEvents } from 'services/rohmProtocol';
import { registerLoadingState, rohmRegisterBytesState, toastMessageState } from 'state/atoms';
import { RegisterValueFormat, RohmRegisterFieldRow } from 'types';
import './Register.css';

const DEFAULT_READ_ADDRESS = '0x53';
const DEFAULT_READ_LENGTH = '0x01';
const DEFAULT_WRITE_ADDRESS = '0x83';
const DEFAULT_WRITE_VALUE = '0xAA';
const DEFAULT_MONITOR_INTERVAL = '1000';
const READ_BATCH_GAP_MS = 30;
const WRITE_READBACK_DELAY_MS = 180;
const ROHM_READ_TIMEOUT_MS = 4000;
const MAPPED_ADDRESSES = getUniqueRegisterAddresses(BU92_REGISTER_MAP);
const SHELL_COMMAND_GAP_MS = 220;
const READ_ALL_BATCHES = [
  { address: 0x00, length: 0xff },
  { address: 0xff, length: 0x01 },
  { address: 0x100, length: 0xff },
  { address: 0x1ff, length: 0x01 },
];
const KEY_STATUS_BATCHES = [
  { address: 0x101, length: 0x01 },
  { address: 0x104, length: 0x01 },
  { address: 0x112, length: 0x05 },
  { address: 0x126, length: 0x04 },
];
const FOCUS_BATCHES = [
  { address: 0x7f, length: 0x0b },
  { address: 0x93, length: 0x03 },
  { address: 0x112, length: 0x1c },
  { address: 0x136, length: 0x02 },
  { address: 0x13e, length: 0x0d },
  { address: 0x1ac, length: 0x0e },
];

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

type DiagnosticTone = 'healthy' | 'warning' | 'critical' | 'idle';

type DisplayDiagnosis = {
  tone: DiagnosticTone;
  label: string;
  summary: string;
  nextStep: string;
  observations: string[];
};

type FocusGroupKind = 'setting' | 'fail' | 'irq' | 'counter' | 'calc';

type FocusGroupDefinition = {
  title: string;
  subtitle: string;
  kind: FocusGroupKind;
  fields: string[];
};

const FOCUS_GROUPS: FocusGroupDefinition[] = [
  {
    title: 'Test Settings',
    subtitle: 'Freeze / RGB Sigma / VSB 관련 현재 설정',
    kind: 'setting',
    fields: [
      'FMSTOP_DET_EN',
      'FMSTOP_ERRLV',
      'IMGCHK_ERRLV',
      'OSD2_ERRLV',
      'IMG_CALC_EN',
      'IMG_CALC_SINGLE',
      'IMG_CALC_SEL',
      'IMG_INSEL',
      'IMG_MODE',
      'IMG0_X_COORD',
      'IMG0_Y_COORD',
    ],
  },
  {
    title: 'FAIL / No Signal',
    subtitle: '영상 정지, 신호 없음, fail-det 관련 현재 상태',
    kind: 'fail',
    fields: [
      'FAIL_DET_PIN_R',
      'FRAME_STOP_R',
      'SYSTEM_FAIL_R',
      'FAIL_DET_R',
      'CLK_FAIL_R',
      'CHKSUM_FAIL_R',
      'OEC_FAIL_R',
      'VS_WD_FAIL_R',
      'FRAME_STOP_H',
      'SYSTEM_FAIL_H',
      'FAIL_DET_H',
      'CLK_FAIL_H',
    ],
  },
  {
    title: 'IRQ / VSB',
    subtitle: 'IMG / OSD / VSB 관련 IRQ와 latched detail',
    kind: 'irq',
    fields: [
      'IMG_IRQ_H',
      'OSD2_IRQ_H',
      'IMG_IRQ_TGL_R',
      'OSD2_IRQ_TGL_R',
      'IMG_STATUS_H',
      'OSD2_STATUS_H',
      'OSD2_ERRSYS_H',
      'OSD2_ERRCHR_H',
      'VSBIMC_ERRCHR_H',
      'IMG_ERR_REGION_H',
    ],
  },
  {
    title: 'Counters',
    subtitle: '실제로 누적되는 모니터링용 카운터',
    kind: 'counter',
    fields: [
      'OSD1_UPCNT_R',
      'OSD2_CRCCNT_R',
      'OSD2_CH_USAGE_R',
      'IMG0_CALC_CNT',
      'IMG_FRAME_CALC_CNT',
      'IMG0_ERR_FRAMCNT',
      'IMG_FSTOP_CNT',
    ],
  },
  {
    title: 'IMG0 RGB',
    subtitle: 'IMG0 region에서 계산된 RGB 결과',
    kind: 'calc',
    fields: ['IMG0_CALCDATA_R', 'IMG0_CALCDATA_G', 'IMG0_CALCDATA_B'],
  },
];

const getByteValue = (bytes: Record<number, number>, address: number) => {
  const value = bytes[address];
  return typeof value === 'number' ? value : null;
};

const getBitValue = (bytes: Record<number, number>, address: number, bit: number) => {
  const value = getByteValue(bytes, address);
  if (value === null) {
    return null;
  }
  return ((value >> bit) & 0x1) === 1;
};

const formatDiagnosticByte = (bytes: Record<number, number>, address: number) => {
  const value = getByteValue(bytes, address);
  return value === null ? '--' : formatRohmByte(value);
};

const buildDisplayDiagnosis = (bytes: Record<number, number>): DisplayDiagnosis => {
  const commandDispOn = getBitValue(bytes, 0x101, 0);
  const forcePgen = getByteValue(bytes, 0x104);
  const statusByte = getByteValue(bytes, 0x126);
  const failDetPinNormal = getBitValue(bytes, 0x127, 6);
  const failDetActive = getBitValue(bytes, 0x128, 0);
  const frameStopActive = getBitValue(bytes, 0x128, 7);
  const systemFailActive = getBitValue(bytes, 0x128, 4);
  const checksumFailActive = getBitValue(bytes, 0x128, 1);
  const frameStopLatched = getBitValue(bytes, 0x112, 7);
  const failDetLatched = getBitValue(bytes, 0x112, 0);
  const imgIrqLatched = getBitValue(bytes, 0x113, 4);
  const osdIrqLatched = getBitValue(bytes, 0x113, 3);
  const imgStatus = getByteValue(bytes, 0x115);
  const osdStatus = getByteValue(bytes, 0x116);

  const observations: string[] = [];
  const initDone = statusByte === null ? null : ((statusByte >> 1) & 0x1) === 1;
  const setDone = statusByte === null ? null : (statusByte & 0x1) === 1;
  const displayOnState = statusByte === null ? null : ((statusByte >> 5) & 0x1) === 1;
  const dmapOk = statusByte === null ? null : ((statusByte >> 3) & 0x1) === 1;

  if (statusByte !== null) {
    observations.push(
      `0x126=${formatRohmByte(statusByte)}: DISP_ON=${displayOnState ? 'ON' : 'OFF'}, INIT_DONE=${initDone ? '1' : '0'}, SET_DONE=${setDone ? '1' : '0'}, DMAP_OK=${dmapOk ? '1' : '0'}`
    );
  }

  if (commandDispOn !== null) {
    observations.push(`0x101 bit0=${commandDispOn ? '1' : '0'}: display command is ${commandDispOn ? 'ON' : 'OFF'}.`);
  }

  if (forcePgen !== null && forcePgen !== 0) {
    observations.push(`0x104=${formatRohmByte(forcePgen)}: FORCE_PGEN is not zero, so forced pattern/free-run path should be checked.`);
  }

  if (failDetPinNormal === false) {
    observations.push(`0x127=${formatDiagnosticByte(bytes, 0x127)}: FAIL_DET pin is reporting error now.`);
  }

  if (failDetActive) {
    observations.push(`0x128=${formatDiagnosticByte(bytes, 0x128)}: FAIL_DET_R is active now.`);
  }

  if (frameStopActive) {
    observations.push(`0x128=${formatDiagnosticByte(bytes, 0x128)}: FRAME_STOP_R is active now.`);
  }

  if (systemFailActive) {
    observations.push(`0x128=${formatDiagnosticByte(bytes, 0x128)}: SYSTEM_FAIL_R is active now.`);
  }

  if (checksumFailActive) {
    observations.push(`0x128=${formatDiagnosticByte(bytes, 0x128)}: checksum fail is active now.`);
  }

  if (frameStopLatched || failDetLatched) {
    observations.push(`0x112=${formatDiagnosticByte(bytes, 0x112)}: sticky history says FRAME_STOP/FAIL_DET happened before.`);
  }

  if (imgIrqLatched || osdIrqLatched) {
    observations.push(`0x113=${formatDiagnosticByte(bytes, 0x113)}: IMG/OSD IRQ history is latched.`);
  }

  if (imgStatus !== null && imgStatus !== 0) {
    observations.push(`0x115=${formatRohmByte(imgStatus)}: IMG detail status bits are non-zero.`);
  }

  if (osdStatus !== null && osdStatus !== 0) {
    observations.push(`0x116=${formatRohmByte(osdStatus)}: OSD detail status bits are non-zero.`);
  }

  if (getByteValue(bytes, 0x137) !== null) {
    observations.push('0x137 counters are expected to move. OSD1_UPCNT_R / OSD2_CRCCNT_R are counters, not direct fault bits.');
  }

  if (statusByte === null && getByteValue(bytes, 0x112) === null && getByteValue(bytes, 0x128) === null) {
    return {
      tone: 'idle',
      label: 'Waiting',
      summary: '핵심 상태 레지스터가 아직 안 읽혀서 진단을 만들 수 없습니다.',
      nextStep: 'Read All 또는 Monitor를 한 번 실행해서 0x112~0x129, 0x126 구간을 채워주세요.',
      observations: ['0x112, 0x126, 0x128 주변 상태 레지스터가 들어오면 원인 후보를 바로 묶어 보여줍니다.'],
    };
  }

  if (commandDispOn === false || displayOnState === false) {
    return {
      tone: 'critical',
      label: 'Display Off',
      summary: '현재는 fail 이전에 display on 경로 자체가 꺼져 있는 쪽이 더 의심됩니다.',
      nextStep: '0x101 DISP_ON command와 0x126 ST_DISP_ON_R를 먼저 맞춰보세요. 둘 중 하나라도 OFF면 화면은 정상 영상이어도 안 나옵니다.',
      observations,
    };
  }

  if (initDone === false || setDone === false) {
    return {
      tone: 'warning',
      label: 'Setup Incomplete',
      summary: '초기 parameter load가 덜 끝난 상태로 보입니다.',
      nextStep: 'INIT_DONE / SET_DONE가 모두 1인지 먼저 확인하고, 초기 다운로드 순서를 다시 봐야 합니다.',
      observations,
    };
  }

  if (failDetActive || failDetPinNormal === false || failDetLatched) {
    return {
      tone: 'critical',
      label: 'Fail Detect',
      summary: '이건 통신 포맷 문제가 아니라 BU92가 실제로 FAIL_DET를 내고 있는 상태로 보입니다.',
      nextStep: 'FAIL_DET 핀, 외부 safety 회로, 그리고 왜 FAIL_DET가 서는지 0x112/0x128/0x127을 중심으로 원인을 좁히는 게 맞습니다.',
      observations,
    };
  }

  if (frameStopActive || frameStopLatched || (imgStatus !== null && imgStatus !== 0)) {
    return {
      tone: 'critical',
      label: 'Frame Stop',
      summary: '화면이 꺼진 핵심 원인은 영상이 멈췄다고 판단한 frame-stop / IMG 쪽일 가능성이 큽니다.',
      nextStep: '입력 영상이 실제로 살아있는지, LVDS/DE/clock 경로가 안정적인지, IMG 관련 판정 조건을 먼저 확인해보세요.',
      observations,
    };
  }

  if (imgIrqLatched || osdIrqLatched || (osdStatus !== null && osdStatus !== 0)) {
    return {
      tone: 'warning',
      label: 'IMG / OSD Event',
      summary: 'Display ON 자체는 살아 있지만 IMG/OSD 쪽 이벤트가 반복 발생하고 있습니다.',
      nextStep: 'OSD/IMG block 설정, hidden area / checksum / character state처럼 IRQ를 만들 수 있는 블록을 따로 봐야 합니다.',
      observations,
    };
  }

  if (dmapOk === false) {
    return {
      tone: 'warning',
      label: 'DMAP NG',
      summary: '출력 FIFO/PLL 검증이 좋지 않아 downstream 출력 경로를 의심해야 합니다.',
      nextStep: 'DMAP 관련 상태와 출력 쪽 클럭/PLL 조건을 우선 점검해보세요.',
      observations,
    };
  }

  return {
    tone: 'healthy',
    label: 'Looks Stable',
    summary: '핵심 status 비트만 보면 display enable 경로는 대체로 정상입니다.',
    nextStep: '이 경우엔 패널 전원/백라이트/외부 safety 신호처럼 BU92 바깥 경로를 의심하는 편이 빠릅니다.',
    observations,
  };
};

const getFocusItemTone = (
  row: RohmRegisterFieldRow,
  groupKind: FocusGroupKind,
  changedRowKeys: string[]
) => {
  if (!row.resolved) {
    return 'missing';
  }

  const isNonZero = row.numericValue !== null && row.numericValue !== 0;
  const isChanged = changedRowKeys.includes(row.key);

  if ((groupKind === 'fail' || groupKind === 'irq') && isNonZero) {
    return 'alert';
  }

  if ((groupKind === 'counter' || groupKind === 'calc') && isChanged) {
    return 'active';
  }

  if (groupKind === 'setting' && isNonZero) {
    return 'active';
  }

  return 'normal';
};

const RegisterPage: React.FC = () => {
  const { send, connected } = useSerial();
  const rawBytes = useRecoilValue(rohmRegisterBytesState);
  const [loading, setLoading] = useRecoilState(registerLoadingState);
  const resetRawBytes = useResetRecoilState(rohmRegisterBytesState);
  const setToast = useSetRecoilState(toastMessageState);

  const autoBootstrappedRef = useRef(false);
  const monitorTimeoutRef = useRef<number | null>(null);
  const monitorInFlightRef = useRef(false);
  const previousRowValuesRef = useRef<Record<string, number | null>>({});

  const [valueFormat, setValueFormat] = useState<RegisterValueFormat>('hex');
  const [searchQuery, setSearchQuery] = useState('');
  const [readAddress, setReadAddress] = useState(DEFAULT_READ_ADDRESS);
  const [readLength, setReadLength] = useState(DEFAULT_READ_LENGTH);
  const [writeAddress, setWriteAddress] = useState(DEFAULT_WRITE_ADDRESS);
  const [writeValue, setWriteValue] = useState(DEFAULT_WRITE_VALUE);
  const [monitorInterval, setMonitorInterval] = useState(DEFAULT_MONITOR_INTERVAL);
  const [monitorScope, setMonitorScope] = useState<'full' | 'focus'>('focus');
  const [continuousMonitoring, setContinuousMonitoring] = useState(false);
  const [changedRowKeys, setChangedRowKeys] = useState<string[]>([]);
  const [selectedRowKey, setSelectedRowKey] = useState<string | null>(null);
  const [serialActionBusy, setSerialActionBusy] = useState(false);
  const [serialActionLabel, setSerialActionLabel] = useState('Idle');

  const rows = buildRohmRegisterRows(BU92_REGISTER_MAP, rawBytes, valueFormat);
  const rowLookup = useMemo(() => new Map(rows.map((row) => [row.name, row])), [rows]);
  const normalizedQuery = searchQuery.trim().toLowerCase();
  const filteredRows = normalizedQuery
    ? rows.filter((row) =>
        [
          row.name,
          row.description,
          row.primaryAddressDec,
          row.primaryAddressHex,
          row.rawValueText,
        ]
          .join(' ')
          .toLowerCase()
          .includes(normalizedQuery)
      )
    : rows;

  const cacheByteCount = Object.keys(rawBytes).length;
  const monitorIntervalMs = parseFlexibleNumber(monitorInterval);
  const unresolvedCount = rows.filter((row) => !row.resolved).length;
  const resolvedCount = rows.length - unresolvedCount;
  const diagnosis = buildDisplayDiagnosis(rawBytes);
  const focusGroups = useMemo(
    () =>
      FOCUS_GROUPS.map((group) => ({
        ...group,
        rows: group.fields
          .map((field) => rowLookup.get(field))
          .filter((row): row is RohmRegisterFieldRow => Boolean(row)),
      })),
    [rowLookup]
  );

  const clearMonitorTimeout = useCallback(() => {
    if (monitorTimeoutRef.current !== null) {
      window.clearTimeout(monitorTimeoutRef.current);
      monitorTimeoutRef.current = null;
    }
  }, []);

  const showInputError = useCallback(
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
        if (settled) return;
        settled = true;
        window.clearTimeout(timeoutId);
        unsubscribe();
        resolve(result);
      };

      unsubscribe = subscribeRohmProtocolEvents((event) => {
        if (event.type !== 'read-complete') return;
        if (event.response.addr !== address || event.response.len !== length) return;
        finish(true);
      });

      timeoutId = window.setTimeout(() => {
        finish(false);
      }, ROHM_READ_TIMEOUT_MS);
    });

    return {
      promise,
      cancel: () => {
        if (settled) return;
        settled = true;
        window.clearTimeout(timeoutId);
        unsubscribe();
      },
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
        showInputError(`${formatRohmHex(address, 2)} read 응답이 시간 내에 완료되지 않았습니다.`);
      }
      return completed;
    },
    [createReadWaiter, send, showInputError]
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

  const readBatches = useCallback(
    async (batches: Array<{ address: number; length: number }>, options?: { silent?: boolean }) => {
      if (!connected) return false;

      setLoading(true);
      try {
        return await executeBatchRead(batches, options);
      } finally {
        setLoading(false);
      }
    },
    [connected, executeBatchRead, setLoading]
  );

  const handleRead = useCallback(async () => {
    const address = parseFlexibleNumber(readAddress);
    const length = parseFlexibleNumber(readLength);

    if (address === null) {
      showInputError('읽을 주소를 HEX 또는 DEC로 입력해주세요.');
      return;
    }

    if (length === null || length <= 0 || length > 0xff) {
      showInputError('읽기 길이는 1~255 범위로 입력해주세요.');
      return;
    }

    setLoading(true);
    try {
      await executeRead(address, length);
    } finally {
      setLoading(false);
    }
  }, [executeRead, readAddress, readLength, setLoading, showInputError]);

  const handleReadAll = useCallback(async () => {
    autoBootstrappedRef.current = true;
    await readBatches(READ_ALL_BATCHES);
  }, [readBatches]);

  const handleReadFocus = useCallback(async () => {
    autoBootstrappedRef.current = true;
    await readBatches(FOCUS_BATCHES);
  }, [readBatches]);

  const handleWrite = useCallback(async () => {
    const address = parseFlexibleNumber(writeAddress);
    const value = parseFlexibleNumber(writeValue);

    if (address === null) {
      showInputError('쓸 주소를 HEX 또는 DEC로 입력해주세요.');
      return;
    }

    if (value === null || value < 0 || value > 0xff) {
      showInputError('현재 1byte write만 지원합니다. 0x00~0xFF 범위로 입력해주세요.');
      return;
    }

    setLoading(true);
    try {
      const writeResult = await send(`rohm_wr_prm ${formatRohmHex(address, 2)} ${formatRohmByte(value)}`);
      if (!writeResult.success) {
        return;
      }
      await sleep(WRITE_READBACK_DELAY_MS);
      await executeRead(address, 1);
    } finally {
      setLoading(false);
    }
  }, [executeRead, send, setLoading, showInputError, writeAddress, writeValue]);

  const handleSelectRow = useCallback(
    (row: RohmRegisterFieldRow) => {
      setSelectedRowKey(row.key);
      setReadAddress(formatRohmHex(row.primaryAddress, 2));
      setReadLength(formatRohmHex(row.addressSpan.length, 2));
      setWriteAddress(formatRohmHex(row.primaryAddress, 2));

      const currentByte = rawBytes[row.primaryAddress];
      if (typeof currentByte === 'number') {
        setWriteValue(formatRohmByte(currentByte));
      }
    },
    [rawBytes]
  );

  const handleClearCache = useCallback(() => {
    resetRawBytes();
    setSelectedRowKey(null);
    setChangedRowKeys([]);
    autoBootstrappedRef.current = false;
    previousRowValuesRef.current = {};
  }, [resetRawBytes]);

  const handleStartMonitoring = useCallback(() => {
    if (!connected) {
      showInputError('먼저 시리얼 포트를 연결해주세요.');
      return;
    }

    if (monitorIntervalMs === null || monitorIntervalMs <= 0) {
      showInputError('모니터링 주기는 1ms 이상의 숫자로 입력해주세요.');
      return;
    }

    autoBootstrappedRef.current = true;
    setContinuousMonitoring(true);
  }, [connected, monitorIntervalMs, showInputError]);

  const handleStopMonitoring = useCallback(() => {
    setContinuousMonitoring(false);
    clearMonitorTimeout();
  }, [clearMonitorTimeout]);

  const executeShellCommand = useCallback(
    async (command: string, settleMs = SHELL_COMMAND_GAP_MS) => {
      const result = await send(command);
      if (!result.success) {
        return false;
      }

      if (settleMs > 0) {
        await sleep(settleMs);
      }

      return true;
    },
    [send]
  );

  const executeShellSequence = useCallback(
    async (commands: string[], settleMs = SHELL_COMMAND_GAP_MS) => {
      for (const command of commands) {
        const success = await executeShellCommand(command, settleMs);
        if (!success) {
          return false;
        }
      }
      return true;
    },
    [executeShellCommand]
  );

  const runSerialAction = useCallback(
    async (label: string, runner: () => Promise<boolean>) => {
      if (!connected) {
        showInputError('먼저 시리얼 포트를 연결해주세요.');
        return;
      }

      setSerialActionBusy(true);
      setSerialActionLabel(label);

      const wasMonitoring = continuousMonitoring;
      if (wasMonitoring) {
        handleStopMonitoring();
      }

      try {
        const success = await runner();
        setSerialActionLabel(success ? `${label} done` : `${label} failed`);
      } finally {
        setSerialActionBusy(false);
      }
    },
    [connected, continuousMonitoring, handleStopMonitoring, showInputError]
  );

  const handleSerialSnapshot = useCallback(async () => {
    await runSerialAction('Snapshot', async () => {
      const shellOk = await executeShellSequence(['fail_det', 'rohm_sr', 'rohm_mspi_dbg']);
      if (!shellOk) {
        return false;
      }

      return readBatches(KEY_STATUS_BATCHES, { silent: true });
    });
  }, [executeShellSequence, readBatches, runSerialAction]);

  const handleClearStickyFaults = useCallback(async () => {
    await runSerialAction('Clear Sticky', async () => {
      const writeOk = await executeShellSequence([
        'rohm_wr_prm1b 0x112 0xFF',
        'rohm_wr_prm1b 0x113 0xFF',
      ]);

      if (!writeOk) {
        return false;
      }

      return readBatches(KEY_STATUS_BATCHES, { silent: true });
    });
  }, [executeShellSequence, readBatches, runSerialAction]);

  const handleForceDisplayOn = useCallback(async () => {
    await runSerialAction('Force Display On', async () => {
      const writeOk = await executeShellSequence([
        'rohm_wr_prm1b 0x101 0x01',
        'rohm_rd_prm1b 0x101',
      ]);

      if (!writeOk) {
        return false;
      }

      return readBatches(KEY_STATUS_BATCHES, { silent: true });
    });
  }, [executeShellSequence, readBatches, runSerialAction]);

  const handlePulseXrst = useCallback(async () => {
    await runSerialAction('XRST Pulse', async () => {
      const shellOk = await executeShellSequence(
        ['rohm_xrst pulse', 'fail_det', 'rohm_sr'],
        450
      );

      if (!shellOk) {
        return false;
      }

      return readBatches(READ_ALL_BATCHES, { silent: true });
    });
  }, [executeShellSequence, readBatches, runSerialAction]);

  const runContinuousMonitor = useCallback(async () => {
    if (!connected || !continuousMonitoring || monitorIntervalMs === null || monitorIntervalMs <= 0) {
      monitorInFlightRef.current = false;
      return;
    }

    const startedAt = Date.now();
    const monitorBatches = monitorScope === 'focus' ? FOCUS_BATCHES : READ_ALL_BATCHES;
    monitorInFlightRef.current = true;

    try {
      const completed = await executeBatchRead(monitorBatches, { silent: true });
      if (!completed) {
        setContinuousMonitoring(false);
        showInputError('모니터링 중 ROHM dump 응답이 끊겨 자동 모니터링을 중지했습니다.');
        return;
      }
    } finally {
      monitorInFlightRef.current = false;
    }

    if (!connected || !continuousMonitoring) {
      return;
    }

    const elapsed = Date.now() - startedAt;
    const nextDelay = Math.max(0, monitorIntervalMs - elapsed);
    clearMonitorTimeout();
    monitorTimeoutRef.current = window.setTimeout(() => {
      void runContinuousMonitor();
    }, nextDelay);
  }, [clearMonitorTimeout, connected, continuousMonitoring, executeBatchRead, monitorIntervalMs, monitorScope, showInputError]);

  useEffect(() => {
    if (cacheByteCount === 0) {
      previousRowValuesRef.current = {};
      setChangedRowKeys([]);
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
    setChangedRowKeys(nextChangedKeys);
  }, [cacheByteCount, rows]);

  useEffect(() => {
    if (!connected) {
      autoBootstrappedRef.current = false;
      clearMonitorTimeout();
      setContinuousMonitoring(false);
      setChangedRowKeys([]);
      previousRowValuesRef.current = {};
      return;
    }

    if (autoBootstrappedRef.current || continuousMonitoring) {
      return;
    }

    autoBootstrappedRef.current = true;
    if (cacheByteCount > 0) {
      return;
    }

    void readBatches(READ_ALL_BATCHES);
  }, [cacheByteCount, clearMonitorTimeout, connected, continuousMonitoring, readBatches]);

  useEffect(() => {
    clearMonitorTimeout();

    if (!continuousMonitoring) {
      return undefined;
    }

    if (!connected || monitorIntervalMs === null || monitorIntervalMs <= 0) {
      setContinuousMonitoring(false);
      return undefined;
    }

    if (!monitorInFlightRef.current) {
      void runContinuousMonitor();
    }

    return () => {
      clearMonitorTimeout();
    };
  }, [clearMonitorTimeout, connected, continuousMonitoring, monitorIntervalMs, runContinuousMonitor]);

  return (
    <div className="register-page">
      <div className="register__hero">
        <div className="register__hero-copy">
          <span className="register__eyebrow">ROHM PARAMETER EDITOR</span>
          <h2 className="register__title">BU92 bitfield monitor</h2>
          <p className="register__subtitle">
            `rohm_rd_prm` / `rohm_wr_prm` 응답을 바로 파싱해서 주소, bitfield, 현재 값을 표로 보여줍니다.
          </p>
        </div>

        <div className="register__stats">
          <div className="register__stat-card">
            <span className="register__stat-label">Chip</span>
            <strong className="register__stat-value">{BU92_REGISTER_MAP.chip.toUpperCase()}</strong>
          </div>
          <div className="register__stat-card">
            <span className="register__stat-label">Mapped Fields</span>
            <strong className="register__stat-value">{rows.length}</strong>
          </div>
          <div className="register__stat-card">
            <span className="register__stat-label">Resolved Fields</span>
            <strong className="register__stat-value">{resolvedCount}</strong>
          </div>
          <div className={`register__stat-card ${unresolvedCount > 0 ? 'register__stat-card--warning' : 'register__stat-card--success'}`}>
            <span className="register__stat-label">Missing Fields</span>
            <strong className="register__stat-value">{unresolvedCount}</strong>
          </div>
          <div className="register__stat-card">
            <span className="register__stat-label">Cached Bytes</span>
            <strong className="register__stat-value">{cacheByteCount} / {MAPPED_ADDRESSES.length}</strong>
          </div>
        </div>
      </div>

      <section className={`register__diagnosis register__diagnosis--${diagnosis.tone}`}>
        <div className="register__diagnosis-header">
          <div>
            <span className="register__eyebrow">Display Health</span>
            <h3 className="register__panel-title">{diagnosis.label}</h3>
          </div>
          <span className={`register__diagnosis-badge register__diagnosis-badge--${diagnosis.tone}`}>
            {diagnosis.label}
          </span>
        </div>

        <p className="register__diagnosis-summary">{diagnosis.summary}</p>
        <p className="register__diagnosis-next">{diagnosis.nextStep}</p>

        <div className="register__diagnosis-list">
          {diagnosis.observations.map((item) => (
            <div key={item} className="register__diagnosis-item">
              {item}
            </div>
          ))}
        </div>
      </section>

      <section className="register__focus">
        <div className="register__panel-header">
          <div>
            <h3 className="register__panel-title">Focus Monitor</h3>
            <p className="register__panel-text">영상 Freeze, 신호 없음, RGB Sigma, VSB, FAIL_R, IRQ, IMG0 RGB 계산값만 따로 묶어서 봅니다.</p>
          </div>

          <div className="register__action-row">
            <button
              className="btn btn--secondary"
              onClick={() => void handleReadFocus()}
              disabled={!connected || loading || continuousMonitoring || serialActionBusy}
              type="button"
            >
              Read Focus
            </button>
          </div>
        </div>

        <div className="register__focus-grid">
          {focusGroups.map((group) => (
            <section key={group.title} className="register__focus-panel">
              <div className="register__focus-header">
                <div className="register__focus-title">{group.title}</div>
                <div className="register__focus-subtitle">{group.subtitle}</div>
              </div>

              <div className="register__watch-list">
                {group.rows.map((row) => {
                  const tone = getFocusItemTone(row, group.kind, changedRowKeys);

                  return (
                    <button
                      key={row.key}
                      className={[
                        'register__watch-card',
                        `register__watch-card--${tone}`,
                        changedRowKeys.includes(row.key) ? 'register__watch-card--changed' : '',
                      ].filter(Boolean).join(' ')}
                      onClick={() => handleSelectRow(row)}
                      type="button"
                    >
                      <div className="register__watch-topline">
                        <span className="register__watch-name">{row.name}</span>
                        <span className="register__watch-address">{row.primaryAddressHex}</span>
                      </div>
                      <div className="register__watch-value">{row.valueText}</div>
                      <div className="register__watch-raw">{row.rawValueText}</div>
                      <div className="register__watch-desc">{row.description}</div>
                    </button>
                  );
                })}
              </div>
            </section>
          ))}
        </div>
      </section>

      <div className="register__control-grid">
        <section className="register__panel">
          <div className="register__panel-header">
            <div>
              <h3 className="register__panel-title">Serial Recovery</h3>
              <p className="register__panel-text">시리얼 명령으로 snapshot, sticky clear, display-on, XRST pulse를 순서대로 실행합니다.</p>
            </div>
          </div>

          <div className="register__serial-status">
            <span className="register__label">Last Serial Action</span>
            <strong className={`register__serial-action ${serialActionBusy ? 'register__serial-action--busy' : ''}`}>
              {serialActionLabel}
            </strong>
          </div>

          <div className="register__action-row">
            <button
              className="btn btn--secondary"
              onClick={() => void handleSerialSnapshot()}
              disabled={!connected || loading || serialActionBusy}
              type="button"
            >
              Snapshot
            </button>
            <button
              className="btn btn--secondary"
              onClick={() => void handleClearStickyFaults()}
              disabled={!connected || loading || serialActionBusy}
              type="button"
            >
              Clear Sticky
            </button>
            <button
              className="btn btn--primary"
              onClick={() => void handleForceDisplayOn()}
              disabled={!connected || loading || serialActionBusy}
              type="button"
            >
              Force DISP_ON
            </button>
            <button
              className="btn btn--danger"
              onClick={() => void handlePulseXrst()}
              disabled={!connected || loading || serialActionBusy}
              type="button"
            >
              XRST Pulse
            </button>
          </div>

          <div className="register__serial-notes">
            <div className="register__serial-note">`Snapshot`: `fail_det`, `rohm_sr`, `rohm_mspi_dbg` 후 핵심 상태 레지스터를 다시 읽습니다.</div>
            <div className="register__serial-note">`Clear Sticky`: 0x112 / 0x113 sticky history를 W1C 방식으로 지웁니다.</div>
            <div className="register__serial-note">`Force DISP_ON`: 0x101 bit0를 1로 써서 display-on 경로를 다시 확인합니다.</div>
            <div className="register__serial-note">`XRST Pulse`: ROHM XRST를 pulse한 뒤 전체 상태를 다시 읽습니다.</div>
          </div>
        </section>

        <section className="register__panel">
          <div className="register__panel-header">
            <div>
              <h3 className="register__panel-title">Display</h3>
              <p className="register__panel-text">값 표시 형식과 검색 필터를 조정합니다.</p>
            </div>
          </div>

          <div className="register__format-toggle" role="tablist" aria-label="Value format">
            <button
              className={`register__format-btn ${valueFormat === 'hex' ? 'register__format-btn--active' : ''}`}
              onClick={() => setValueFormat('hex')}
              type="button"
            >
              HEX
            </button>
            <button
              className={`register__format-btn ${valueFormat === 'dec' ? 'register__format-btn--active' : ''}`}
              onClick={() => setValueFormat('dec')}
              type="button"
            >
              DEC
            </button>
          </div>

          <label className="register__field">
            <span className="register__label">Search Filter</span>
            <input
              className="input register__search-input"
              value={searchQuery}
              onChange={(event) => setSearchQuery(event.target.value)}
              placeholder="fail_r, checksum, 0x0128..."
            />
          </label>
        </section>

        <section className="register__panel">
          <div className="register__panel-header">
            <div>
              <h3 className="register__panel-title">Read</h3>
              <p className="register__panel-text">선택 주소를 읽거나, 내장된 BU92 필드 주소 전체를 순차 조회합니다.</p>
            </div>
          </div>

          <div className="register__inline-fields">
            <label className="register__field">
              <span className="register__label">Address</span>
              <input
                className="input register__mono-input"
                value={readAddress}
                onChange={(event) => setReadAddress(event.target.value)}
                placeholder="0x53"
              />
            </label>

            <label className="register__field">
              <span className="register__label">Length</span>
              <input
                className="input register__mono-input"
                value={readLength}
                onChange={(event) => setReadLength(event.target.value)}
                placeholder="0x01"
              />
            </label>
          </div>

          <div className="register__monitor-row">
            <label className="register__field register__field--compact">
              <span className="register__label">Interval (ms)</span>
              <input
                className="input register__mono-input"
                value={monitorInterval}
                onChange={(event) => setMonitorInterval(event.target.value)}
                placeholder="1000"
              />
            </label>

            <span className={`register__status-badge ${continuousMonitoring ? 'register__status-badge--active' : ''}`}>
              {continuousMonitoring ? `Monitoring ${monitorScope === 'focus' ? 'Focus' : 'Full'}` : 'Idle'}
            </span>
          </div>

          <div className="register__format-toggle" role="tablist" aria-label="Monitor scope">
            <button
              className={`register__format-btn ${monitorScope === 'focus' ? 'register__format-btn--active' : ''}`}
              onClick={() => setMonitorScope('focus')}
              type="button"
              disabled={continuousMonitoring || serialActionBusy}
            >
              Focus
            </button>
            <button
              className={`register__format-btn ${monitorScope === 'full' ? 'register__format-btn--active' : ''}`}
              onClick={() => setMonitorScope('full')}
              type="button"
              disabled={continuousMonitoring || serialActionBusy}
            >
              Full
            </button>
          </div>

          <div className="register__action-row">
            <button className="btn btn--primary" onClick={() => void handleRead()} disabled={!connected || loading || continuousMonitoring || serialActionBusy}>
              Read
            </button>
            <button className="btn btn--secondary" onClick={() => void handleReadAll()} disabled={!connected || loading || continuousMonitoring || serialActionBusy}>
              Read All
            </button>
            <button className="btn btn--secondary" onClick={() => void handleReadFocus()} disabled={!connected || loading || continuousMonitoring || serialActionBusy}>
              Read Focus
            </button>
            {continuousMonitoring ? (
              <button className="btn btn--danger" onClick={handleStopMonitoring} type="button" disabled={serialActionBusy}>
                Stop Monitor
              </button>
            ) : (
              <button className="btn btn--secondary" onClick={handleStartMonitoring} disabled={!connected || serialActionBusy} type="button">
                Start Monitor
              </button>
            )}
          </div>
        </section>

        <section className="register__panel">
          <div className="register__panel-header">
            <div>
              <h3 className="register__panel-title">Write</h3>
              <p className="register__panel-text">현재는 1byte write 후 자동 read-back으로 동기화합니다.</p>
            </div>
          </div>

          <div className="register__inline-fields">
            <label className="register__field">
              <span className="register__label">Write Address</span>
              <input
                className="input register__mono-input"
                value={writeAddress}
                onChange={(event) => setWriteAddress(event.target.value)}
                placeholder="0x83"
              />
            </label>

            <label className="register__field">
              <span className="register__label">Write Value</span>
              <input
                className="input register__mono-input"
                value={writeValue}
                onChange={(event) => setWriteValue(event.target.value)}
                placeholder="0xAA"
              />
            </label>
          </div>

          <div className="register__action-row">
            <button className="btn btn--primary" onClick={() => void handleWrite()} disabled={!connected || loading || continuousMonitoring || serialActionBusy}>
              Write Byte
            </button>
            <button className="btn btn--ghost" onClick={handleClearCache} type="button" disabled={serialActionBusy}>
              Clear Cache
            </button>
          </div>
        </section>
      </div>

      <div className="register__table-wrap">
        {filteredRows.length === 0 ? (
          <div className="register__empty">
            검색 결과가 없습니다. 다른 필드명이나 주소로 다시 필터링해보세요.
          </div>
        ) : (
          <table className="register__table">
            <thead>
              <tr>
                <th style={{ width: 90 }}>addr (DEC)</th>
                <th style={{ width: 110 }}>addr (HEX)</th>
                <th style={{ width: 80 }}>Len (bits)</th>
                <th style={{ width: 70 }}>R/W</th>
                <th style={{ width: 220 }}>Field name</th>
                <th style={{ width: 160 }}>Field value</th>
                <th style={{ width: 180 }}>Raw bytes</th>
                <th>Description</th>
              </tr>
            </thead>
            <tbody>
              {filteredRows.map((row) => (
                <tr
                  key={row.key}
                  className={[
                    'register__row',
                    selectedRowKey === row.key ? 'register__row--selected' : '',
                    !row.resolved ? 'register__row--missing' : '',
                  ].filter(Boolean).join(' ')}
                  onClick={() => handleSelectRow(row)}
                >
                  <td>{row.primaryAddressDec}</td>
                  <td><span className="register__mono-text register__mono-text--accent">{row.primaryAddressHex}</span></td>
                  <td>{row.bitLength}</td>
                  <td>{row.access}</td>
                  <td>
                    <div className="register__field-name">{row.name}</div>
                  </td>
                  <td>
                    <span
                      className={[
                        'register__value-pill',
                        row.resolved ? 'register__value-pill--ready' : '',
                        changedRowKeys.includes(row.key) ? 'register__value-pill--changed' : '',
                      ].filter(Boolean).join(' ')}
                    >
                      {row.valueText}
                    </span>
                  </td>
                  <td>
                    <span className={[
                      'register__mono-text',
                      !row.resolved ? 'register__mono-text--missing' : '',
                    ].filter(Boolean).join(' ')}>
                      {row.rawValueText}
                    </span>
                  </td>
                  <td>
                    <div className="register__description">{row.description}</div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
};

export default RegisterPage;
