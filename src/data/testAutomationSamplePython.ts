export const TEST_AUTOMATION_SAMPLE_PYTHON_FILE_NAME = 'rh850_test_automation_sample.py';

export const TEST_AUTOMATION_SAMPLE_PYTHON = `#!/usr/bin/env python3
"""
RH850 Pilot test automation sample.

Current app integration:
- Electron starts this Python file as a child process.
- stdout/stderr are streamed back to the Test Automation console.
- exit code 0 is treated as success, non-zero as failure.

Optional direct serial mode:
- Set SMAB_SERIAL_PORT and SMAB_BAUD_RATE before running if this script should
  talk to the board directly through pyserial.
- Example on Windows:
  set SMAB_SERIAL_PORT=COM7
  set SMAB_BAUD_RATE=115200
"""

import os
import sys
import time


COMMANDS = [
    "status",
    "error status",
    "gpio_status",
]


def log(message):
    print(message, flush=True)


def run_console_only():
    log("[sample] Console-only smoke test")
    for index, command in enumerate(COMMANDS, start=1):
        log(f"[sample] step {index}: would send '{command}'")
        time.sleep(0.2)
    log("[sample] done")


def run_direct_serial(port, baud_rate):
    try:
        import serial
    except ImportError:
        log("[sample] pyserial is not installed. Install with: pip install pyserial")
        return 2

    log(f"[sample] opening serial port {port} @ {baud_rate}")
    with serial.Serial(port=port, baudrate=baud_rate, timeout=1.0) as ser:
        for command in COMMANDS:
            payload = (command + "\\r\\n").encode("utf-8")
            log(f"[tx] {command}")
            ser.write(payload)
            ser.flush()
            deadline = time.time() + 1.0
            while time.time() < deadline:
                line = ser.readline()
                if line:
                    log("[rx] " + line.decode("utf-8", errors="replace").rstrip())

    log("[sample] serial run complete")
    return 0


def main():
    port = os.environ.get("SMAB_SERIAL_PORT", "").strip()
    baud_rate_text = os.environ.get("SMAB_BAUD_RATE", "115200").strip()

    if not port:
        run_console_only()
        return 0

    try:
        baud_rate = int(baud_rate_text)
    except ValueError:
        log(f"[sample] invalid SMAB_BAUD_RATE: {baud_rate_text}")
        return 2

    return run_direct_serial(port, baud_rate)


if __name__ == "__main__":
    sys.exit(main())
`;
