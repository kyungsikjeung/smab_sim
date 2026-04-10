const { spawn } = require('child_process');
const path = require('path');
const electron = require('electron');

// ELECTRON_RUN_AS_NODE 가 설정된 환경에서는 Electron 앱이 아닌 Node로 실행됩니다.
delete process.env.ELECTRON_RUN_AS_NODE;
process.env.ELECTRON_START_URL ||= 'http://localhost:3000';

const electronPath = path.normalize(electron);
const child = spawn(electronPath, [process.cwd()], {
  stdio: 'inherit',
});

child.on('exit', (code) => process.exit(code ?? 0));
child.on('error', (error) => {
  console.error('[start-electron] Electron 실행 실패:', error.message);
  process.exit(1);
});
