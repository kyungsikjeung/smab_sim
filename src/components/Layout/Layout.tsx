import React from 'react';
import { Outlet } from 'react-router-dom';
import { useRecoilValue } from 'recoil';
import { sidebarCollapsedState } from 'state/atoms';
import Sidebar from 'components/Sidebar/Sidebar';
import Header from 'components/Header/Header';
import Toast from 'components/Layout/Toast';
import './Layout.css';

const Layout: React.FC = () => {
  const collapsed = useRecoilValue(sidebarCollapsedState);

  return (
    <div className={`layout ${collapsed ? 'layout--collapsed' : ''}`}>
      <Sidebar />
      <Header />
      <main className="layout__content">
        <Outlet />
      </main>
      <Toast />
    </div>
  );
};

export default Layout;
