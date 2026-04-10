import React from 'react';
import { HashRouter, Routes, Route, Navigate } from 'react-router-dom';
import { RecoilRoot } from 'recoil';
import Layout from 'components/Layout/Layout';
import TerminalPage from 'components/Terminal/TerminalPage';
import CommandPage from 'components/Command/CommandPage';
import RegisterEditorPage from 'components/Register/RegisterEditorPage';
import RohmMonitorPage from 'components/Register/RegisterPage';
import VoltageMonitorPage from './components/VoltageMonitor/VoltageMonitorPage';
import WarningLightsPage from 'components/WarningLights/WarningLightsPage';
import DisplayControlPage from 'components/DisplayControl/DisplayControlPage';
import TestAutomationPage from 'components/TestAutomation/TestAutomationPage';
import 'styles/global.css';

const App: React.FC = () => {
  return (
    <RecoilRoot>
      <HashRouter>
        <Routes>
          <Route path="/" element={<Layout />}>
            <Route index element={<Navigate to="/terminal" replace />} />
            <Route path="terminal" element={<TerminalPage />} />
            <Route path="commands" element={<CommandPage />} />
            <Route path="register" element={<RegisterEditorPage />} />
            <Route path="rohm-monitor" element={<RohmMonitorPage />} />
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
