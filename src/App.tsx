import React, { useCallback, useEffect } from 'react';
import { HashRouter, Routes, Route, Navigate } from 'react-router-dom';
import { RecoilRoot, useSetRecoilState } from 'recoil';
import Layout from 'components/Layout/Layout';
import TerminalPage from 'components/Terminal/TerminalPage';
import CommandPage from 'components/Command/CommandPage';
import FaultInjectionPage from 'components/FaultInjection/FaultInjectionPage';
import FaultLogMonitorPage from 'components/FaultLog/FaultLogMonitorPage';
import GpioMonitorPage from 'components/GpioMonitor/GpioMonitorPage';
import RegisterEditorPage from 'components/Register/RegisterEditorPage';
import ErrorMonitorPage from 'components/ErrorMonitor/ErrorMonitorPage';
import VoltageMonitorPage from './components/VoltageMonitor/VoltageMonitorPage';
import WarningLightsPage from 'components/WarningLights/WarningLightsPage';
import DisplayControlPage from 'components/DisplayControl/DisplayControlPage';
import TestAutomationPage from 'components/TestAutomation/TestAutomationPage';
import { displayWindowService } from 'services/displayWindowService';
import {
  displayHeartbeatEnabledState,
  displayOverlayRectState,
  displayOverlayRectsState,
  displayWindowOpenState,
  toastMessageState,
} from 'state/atoms';
import { DisplayWindowStatus } from 'types';
import 'styles/global.css';

const DisplayWindowLifecycle: React.FC = () => {
  const setDisplayWindowOpen = useSetRecoilState(displayWindowOpenState);
  const setDisplayHeartbeatEnabled = useSetRecoilState(displayHeartbeatEnabledState);
  const setDisplayOverlayRect = useSetRecoilState(displayOverlayRectState);
  const setDisplayOverlayRects = useSetRecoilState(displayOverlayRectsState);
  const setToast = useSetRecoilState(toastMessageState);

  const applyDisplayStatus = useCallback((status: DisplayWindowStatus) => {
    setDisplayWindowOpen(status.open);
    setDisplayHeartbeatEnabled(status.heartbeatEnabled);
    setDisplayOverlayRect(status.overlayRect ?? status.overlayRects[0] ?? null);
    setDisplayOverlayRects(status.overlayRects || []);
  }, [setDisplayHeartbeatEnabled, setDisplayOverlayRect, setDisplayOverlayRects, setDisplayWindowOpen]);

  useEffect(() => {
    let mounted = true;

    const bootstrapDisplayWindow = async () => {
      const status = await displayWindowService.getStatus();
      if (!mounted) return;

      applyDisplayStatus(status);
      if (status.open || !status.displayAvailable) {
        return;
      }

      const result = await displayWindowService.openHeartbeatWindow();
      if (!mounted) return;

      applyDisplayStatus(result.status || status);
      if (!result.success && result.error) {
        setToast({ type: 'error', message: result.error });
        return;
      }

      setToast({ type: 'info', message: 'Heartbeat 서브 창을 시작했습니다.' });
    };

    void bootstrapDisplayWindow();

    const unsubscribe = displayWindowService.onState((status) => {
      applyDisplayStatus(status);
      if (status.error) {
        setToast({ type: 'error', message: status.error });
      }
    });

    return () => {
      mounted = false;
      unsubscribe();
    };
  }, [applyDisplayStatus, setToast]);

  return null;
};

const App: React.FC = () => {
  return (
    <RecoilRoot>
      <DisplayWindowLifecycle />
      <HashRouter>
        <Routes>
          <Route path="/" element={<Layout />}>
            <Route index element={<Navigate to="/terminal" replace />} />
            <Route path="terminal" element={<TerminalPage />} />
            <Route path="commands" element={<CommandPage />} />
            <Route path="fault-injection" element={<FaultInjectionPage />} />
            <Route path="fault-log-monitor" element={<FaultLogMonitorPage />} />
            <Route path="error-monitor" element={<ErrorMonitorPage />} />
            <Route path="gpio-monitor" element={<GpioMonitorPage />} />
            <Route path="register" element={<RegisterEditorPage />} />
            <Route path="voltage-monitor" element={<VoltageMonitorPage />} />
            <Route path="warning-lights" element={<WarningLightsPage />} />
            <Route path="display-control" element={<DisplayControlPage />} />
            <Route path="test-automation" element={<TestAutomationPage />} />
          </Route>
        </Routes>
      </HashRouter>
    </RecoilRoot>
  );
};

export default App;
