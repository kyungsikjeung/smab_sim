export interface ShellCommandDefinition {
  command: string;
  handler: string;
  category:
    | 'Shell Core'
    | 'Memory / Register Utility'
    | 'System / Diagnostic'
    | 'SPI / Flash'
    | 'Error Flag / Fault Injection'
    | 'ROHM OSD / SPI'
    | 'Auto Command';
  module: string;
  description: string;
  syntax?: string;
  isAuto?: boolean;
  note?: string;
}

export const shellCommandCatalog: ShellCommandDefinition[] = [
  { command: 'help', handler: 'help', category: 'Shell Core', module: 'shell.c', description: '등록된 shell 명령 목록과 도움말 출력' },
  { command: 'status', handler: 'cmd_exec_status', category: 'Shell Core', module: 'shell.c', description: '이전 명령 실행 결과 코드 확인' },
  { command: 'clear', handler: 'cmd_clear_screen', category: 'Shell Core', module: 'shell.c', description: '터미널 화면 지움(ANSI clear 시퀀스)' },
  { command: 'cls', handler: 'cmd_cls_screen', category: 'Shell Core', module: 'shell.c', description: '`clear`와 동일 동작 별칭' },
  { command: 'history', handler: 'show_history', category: 'Shell Core', module: 'shell.c', description: '입력 히스토리 출력' },

  { command: 'wb', handler: 'w32_bit', category: 'Memory / Register Utility', module: 'utils.c', description: '주소의 특정 bit write', syntax: 'wb <addr> <bit> <0|1>' },
  { command: 'rb', handler: 'r32_bit', category: 'Memory / Register Utility', module: 'utils.c', description: '주소의 특정 bit read', syntax: 'rb <addr> <bit>' },
  { command: 'r32', handler: 'r32', category: 'Memory / Register Utility', module: 'utils.c', description: '32비트 읽기', syntax: 'r32 <addr>' },
  { command: 'w32', handler: 'w32', category: 'Memory / Register Utility', module: 'utils.c', description: '32비트 write', syntax: 'w32 <addr> <value>' },
  { command: 'read', handler: 'read_mem', category: 'Memory / Register Utility', module: 'utils.c', description: '메모리 연속 read', syntax: 'read <addr> <count>' },

  { command: 'led', handler: 'cmd_led', category: 'System / Diagnostic', module: 'test_commands.c', description: '보드 LED GPIO 제어', syntax: 'led <index> <on|off>' },
  { command: 'echo', handler: 'cmd_echo', category: 'System / Diagnostic', module: 'test_commands.c', description: '입력 문자열 echo 테스트', syntax: 'echo <text>' },
  { command: 'sched', handler: 'cmd_sched', category: 'System / Diagnostic', module: 'test_commands.c', description: '스케줄러 상태 조회' },
  { command: 'sysinfo', handler: 'cmd_sysinfo', category: 'System / Diagnostic', module: 'test_commands.c', description: '시스템/빌드/보드 정보 출력' },
  { command: 'delay', handler: 'cmd_delay', category: 'System / Diagnostic', module: 'test_commands.c', description: '지연 테스트', syntax: 'delay <ms>' },
  { command: 'uarttest', handler: 'cmd_uarttest', category: 'System / Diagnostic', module: 'test_commands.c', description: 'UART 송수신 경로 점검' },
  { command: 'voltmon', handler: 'cmd_voltmon', category: 'System / Diagnostic', module: 'test_commands.c', description: 'VoltMon 상태/에러 확인' },
  { command: 'vmlog', handler: 'cmd_vmlog', category: 'System / Diagnostic', module: 'test_commands.c', description: 'VoltMon 로그 on/off', syntax: 'vmlog <on|off>' },
  { command: 'faultout', handler: 'cmd_faultout', category: 'System / Diagnostic', module: 'test_commands.c', description: 'Fault output 상태 조회' },
  { command: 'gpio_status', handler: 'cmd_gpio_status', category: 'System / Diagnostic', module: 'test_commands.c', description: 'GPIO 입력/출력 전체 상태 조회' },
  { command: 'commdiag', handler: 'cmd_commdiag', category: 'System / Diagnostic', module: 'test_commands.c', description: 'I2C dispatch 진단 출력/초기화' },
  { command: 'simlightw', handler: 'cmd_simlightw', category: 'System / Diagnostic', module: 'test_commands.c', description: 'light write 경로 시뮬레이션 테스트' },
  { command: 'simlightr', handler: 'cmd_simlightr', category: 'System / Diagnostic', module: 'test_commands.c', description: 'light read 경로 시뮬레이션 테스트' },
  { command: 'wdt_fault', handler: 'cmd_wdt_fault', category: 'System / Diagnostic', module: 'test_commands.c', description: 'WDT/ECM reset 경로 테스트', syntax: 'wdt_fault' },
  { command: 'lram_ecc_inj', handler: 'cmd_lram_ecc_inj', category: 'System / Diagnostic', module: 'test_commands.c', description: 'LRAM ECC Safety Test', syntax: 'lram_ecc_inj der' },
  { command: 'rohm_fw', handler: 'cmd_rohm_fw', category: 'System / Diagnostic', module: 'test_rohm_commands.c', description: 'ROHM FW checksum mismatch safety test', syntax: 'rohm_fw fault' },

  { command: 'mcu_flash_id', handler: 'cmd_mcu_flash_id', category: 'SPI / Flash', module: 'test_commands.c', description: 'MCU Flash JEDEC ID 읽기' },
  { command: 'rohm_flash_id', handler: 'cmd_rohm_flash_id', category: 'SPI / Flash', module: 'test_commands.c', description: 'ROHM Flash JEDEC ID 읽기' },
  { command: 'rohm_flash_read', handler: 'cmd_rohm_flash_read', category: 'SPI / Flash', module: 'test_commands.c', description: 'ROHM Flash bypass read 테스트', syntax: 'rohm_flash_read <addr> <len>' },
  { command: 'spi_switch', handler: 'cmd_spi_switch', category: 'SPI / Flash', module: 'test_commands.c', description: 'SPI switch 제어', syntax: 'spi_switch <on|off>' },
  { command: 'flash_status', handler: 'cmd_flash_status', category: 'SPI / Flash', module: 'test_commands.c', description: 'Flash status register 조회' },
  { command: 'flash_read', handler: 'cmd_flash_read', category: 'SPI / Flash', module: 'test_commands.c', description: 'SPI NOR read', syntax: 'flash_read <addr> <len>' },
  { command: 'flash_write', handler: 'cmd_flash_write', category: 'SPI / Flash', module: 'test_commands.c', description: 'SPI NOR write', syntax: 'flash_write <addr> <hex>' },
  { command: 'flash_page_write', handler: 'cmd_flash_page_write', category: 'SPI / Flash', module: 'test_commands.c', description: 'SPI NOR page program', syntax: 'flash_page_write <addr> <hex>' },
  { command: 'flash_erase', handler: 'cmd_flash_erase', category: 'SPI / Flash', module: 'test_commands.c', description: 'Flash 4KB erase', syntax: 'flash_erase <addr>' },
  { command: 'flash_test', handler: 'cmd_flash_test', category: 'SPI / Flash', module: 'test_commands.c', description: 'Flash self-test 실행' },
  { command: 'flash_wp', handler: 'cmd_flash_wp', category: 'SPI / Flash', module: 'test_commands.c', description: 'Flash write protect 상태 조회' },
  { command: 'fhdr', handler: 'cmd_fhdr', category: 'SPI / Flash', module: 'test_commands.c', description: 'Flash header read/write 테스트' },
  { command: 'fmap', handler: 'cmd_fmap', category: 'SPI / Flash', module: 'test_commands.c', description: 'Flash 메모리 맵 출력' },
  { command: 'flog', handler: 'cmd_flog', category: 'SPI / Flash', module: 'test_commands.c', description: 'fault log read/write/clear', syntax: 'flog <read|write|clear> [args]' },
  { command: 'fault_set', handler: 'cmd_fault_set', category: 'SPI / Flash', module: 'test_commands.c', description: 'fault injection 실행' },
  { command: 'fault_rolltest', handler: 'cmd_fault_rolltest', category: 'SPI / Flash', module: 'test_commands.c', description: 'rolling fault log 반복 주입 테스트', syntax: 'fault_rolltest <count>' },
  { command: 'flash', handler: 'cmd_flash', category: 'SPI / Flash', module: 'test_commands.c', description: 'Flash ownership/meta dump/verify 등 서브 커맨드 dispatcher', syntax: 'flash <subcmd> ...' },
  { command: 'flogtest', handler: 'cmd_flogtest', category: 'SPI / Flash', module: 'test_commands.c', description: 'fault log TC01~TC05 자동 검증' },

  { command: 'faultinj', handler: 'cmd_faultinj', category: 'Error Flag / Fault Injection', module: 'test_commands.c', description: 'fault flag 제어 공용 핸들러', syntax: 'faultinj <status|set|clear|assign|setmask|clrmask|write>' },
  { command: 'error', handler: 'cmd_error', category: 'Error Flag / Fault Injection', module: 'test_commands.c', description: 'faultinj alias', syntax: 'error <same as faultinj>' },
  { command: 'err', handler: 'cmd_err', category: 'Error Flag / Fault Injection', module: 'test_commands.c', description: 'error alias', syntax: 'err <same as faultinj>' },
  {
    command: 'gmsl_sim',
    handler: 'cmd_gmsl_sim',
    category: 'Error Flag / Fault Injection',
    module: 'test_commands.c',
    description: 'GMSL line simulation dispatcher',
    syntax: 'gmsl_sim <status|low|high|auto> [nowait]',
    note: 'low/high는 기본 대기 후 상태 출력, nowait 옵션으로 즉시 리턴 가능',
  },
  {
    command: 'gmsl_sim status',
    handler: 'cmd_gmsl_sim',
    category: 'Error Flag / Fault Injection',
    module: 'test_commands.c',
    description: '실제 GMSL 핀, override 상태, 디바운스 결과, XRST, ERROR_FLAG_GMSL_LINE 확인',
  },
  {
    command: 'gmsl_sim low',
    handler: 'cmd_gmsl_sim',
    category: 'Error Flag / Fault Injection',
    module: 'test_commands.c',
    description: 'GMSL을 LOW로 강제해 fault 경로 재현, 기본적으로 약 20ms 후 상태 출력',
  },
  {
    command: 'gmsl_sim high',
    handler: 'cmd_gmsl_sim',
    category: 'Error Flag / Fault Injection',
    module: 'test_commands.c',
    description: 'GMSL을 HIGH로 강제해 clear 경로 재현, 기본적으로 약 520ms 후 상태 출력',
  },
  {
    command: 'gmsl_sim auto',
    handler: 'cmd_gmsl_sim',
    category: 'Error Flag / Fault Injection',
    module: 'test_commands.c',
    description: 'override를 해제하고 다시 실제 GPIO 입력으로 복귀',
  },

  { command: 'fail_det', handler: 'cmd_fail_det', category: 'ROHM OSD / SPI', module: 'test_rohm_commands.c', description: 'FAIL_DET 입력 레벨 확인' },
  { command: 'lights', handler: 'cmd_lights', category: 'ROHM OSD / SPI', module: 'test_rohm_commands.c', description: '다중 경고등 제어(32bit 마스크)', syntax: 'lights <4Bytes>' },
  { command: 'light', handler: 'cmd_light', category: 'ROHM OSD / SPI', module: 'test_rohm_commands.c', description: '단일 경고등 제어', syntax: 'light <on|off> <idx>' },
  { command: 'warn_osd', handler: 'cmd_warn_osd', category: 'ROHM OSD / SPI', module: 'test_rohm_commands.c', description: '특정 index의 OSD 경고 payload 송신', syntax: 'warn_osd <idx>' },
  { command: 'rohm_sr', handler: 'cmd_rohm_sr', category: 'ROHM OSD / SPI', module: 'test_rohm_commands.c', description: 'ROHM status register decode 출력' },
  { command: 'rohm_sr_raw', handler: 'cmd_rohm_sr_raw', category: 'ROHM OSD / SPI', module: 'test_rohm_commands.c', description: 'ROHM status register raw dump' },
  { command: 'rohm_mspi_dbg', handler: 'cmd_rohm_mspi_dbg', category: 'ROHM OSD / SPI', module: 'test_rohm_commands.c', description: 'MSPI0/GPIO/마지막 SPI 진단 상태 dump' },
  { command: 'rohm_bypass', handler: 'cmd_rohm_bypass', category: 'ROHM OSD / SPI', module: 'test_rohm_commands.c', description: 'ROHM flash bypass on/off', syntax: 'rohm_bypass <on|off>' },
  { command: 'rohm_rd_prm', handler: 'cmd_rohm_rd_prm', category: 'ROHM OSD / SPI', module: 'test_rohm_commands.c', description: 'ROHM Param 다중 byte read', syntax: 'rohm_rd_prm <addr> <len>' },
  { command: 'rohm_wr_prm', handler: 'cmd_rohm_wr_prm', category: 'ROHM OSD / SPI', module: 'test_rohm_commands.c', description: 'ROHM Param 다중 byte write', syntax: 'rohm_wr_prm <addr> <data>' },
  { command: 'rohm_rd_prm1b', handler: 'cmd_rohm_rd_prm1b', category: 'ROHM OSD / SPI', module: 'test_rohm_commands.c', description: 'ROHM Param 1byte read', syntax: 'rohm_rd_prm1b <addr>' },
  { command: 'rohm_wr_prm1b', handler: 'cmd_rohm_wr_prm1b', category: 'ROHM OSD / SPI', module: 'test_rohm_commands.c', description: 'ROHM Param 1byte write + verify', syntax: 'rohm_wr_prm1b <addr> <value>' },
  { command: 'rohm_rd_osd', handler: 'cmd_rohm_rd_osd', category: 'ROHM OSD / SPI', module: 'test_rohm_commands.c', description: 'OSD 영역 read' },
  { command: 'rohm_cmd', handler: 'cmd_rohm_cmd', category: 'ROHM OSD / SPI', module: 'test_rohm_commands.c', description: '단일 ROHM opcode 송신', syntax: 'rohm_cmd <opcode>' },
  { command: 'rohm_xrst', handler: 'cmd_rohm_xrst', category: 'ROHM OSD / SPI', module: 'test_rohm_commands.c', description: 'XRST 핀 제어', syntax: 'rohm_xrst <read|high|low|pulse>' },

  {
    command: 'version',
    handler: 'build_info',
    category: 'Auto Command',
    module: 'shell.c',
    description: 'boot 시 build info 출력',
    isAuto: true,
  },
  {
    command: 'flashmgr_boot',
    handler: 'app_flash_manager_auto_bootstrap',
    category: 'Auto Command',
    module: 'app_flash_manager_bootstrap.c',
    description: 'boot 시 flash manager bootstrap 실행',
    isAuto: true,
  },
];

export const shellCommandCategories = shellCommandCatalog
  .map((entry) => entry.category)
  .filter((category, idx, arr) => arr.indexOf(category) === idx);
