import React from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useRecoilState } from 'recoil';
import { sidebarCollapsedState } from 'state/atoms';
import './Sidebar.css';

interface NavItem {
  path: string;
  label: string;
  icon: string;
  section?: string;
}

const NAV_ITEMS: NavItem[] = [
  { path: '/terminal',        label: '시리얼 터미널',    icon: '⌨',  section: 'MONITOR' },
  { path: '/commands',        label: 'CMD 명령어',      icon: '⌨' },
  { path: '/register',        label: '레지스터 R/W',     icon: '⎍' },
  { path: '/rohm-monitor',    label: 'ROHM 모니터',     icon: '◎' },
  { path: '/voltage-monitor', label: '전압 모니터링',    icon: '⚡' },
  { path: '/warning-lights',  label: '경고등 제어',      icon: '◉',  section: 'CONTROL' },
  { path: '/display-control', label: '디스플레이 제어',  icon: '▣' },
  { path: '/test-automation', label: '테스트 자동화',    icon: '⟳',  section: 'AUTOMATION' },
];

const Sidebar: React.FC = () => {
  const location = useLocation();
  const navigate = useNavigate();
  const [collapsed, setCollapsed] = useRecoilState(sidebarCollapsedState);

  let lastSection = '';

  return (
    <aside className={`sidebar ${collapsed ? 'sidebar--collapsed' : ''}`}>
      {/* ── Brand ── */}
      <div className="sidebar__brand">
        <div className="sidebar__logo">R8</div>
        <div className="sidebar__brand-text">
          <span className="sidebar__brand-name">RH850 Pilot</span>
          <span className="sidebar__brand-sub">MCU Control Suite</span>
        </div>
      </div>

      {/* ── Navigation ── */}
      <nav className="sidebar__nav">
        {NAV_ITEMS.map((item) => {
          const showSection = item.section && item.section !== lastSection;
          if (item.section) lastSection = item.section;
          const isActive = location.pathname === item.path;

          return (
            <React.Fragment key={item.path}>
              {showSection && (
                <div className="sidebar__section-label">{item.section}</div>
              )}
              <div
                className={`sidebar__link ${isActive ? 'sidebar__link--active' : ''}`}
                onClick={() => navigate(item.path)}
                role="button"
                tabIndex={0}
              >
                <span className="sidebar__link-icon">{item.icon}</span>
                <span className="sidebar__link-label">{item.label}</span>
              </div>
            </React.Fragment>
          );
        })}
      </nav>

      {/* ── Collapse Toggle ── */}
      <div className="sidebar__footer">
        <button
          className="sidebar__collapse-btn"
          onClick={() => setCollapsed(!collapsed)}
        >
          {collapsed ? '▸' : '◂'}
          {!collapsed && <span>접기</span>}
        </button>
      </div>
    </aside>
  );
};

export default Sidebar;
