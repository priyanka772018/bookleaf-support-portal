import { NavLink, Outlet } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext';
import { useLiveStatus } from '../hooks/LiveEvents';

const NAV = {
  author: [
    { to: '/books', label: 'My Books' },
    { to: '/tickets', label: 'My Tickets' },
    { to: '/tickets/new', label: 'Get Help' },
  ],
  admin: [
    { to: '/admin', label: 'Ticket Queue', end: true },
    { to: '/admin/ai-usage', label: 'AI Usage' },
  ],
};

function LiveIndicator() {
  const status = useLiveStatus();
  const label = { live: 'Live', connecting: 'Connecting', reconnecting: 'Reconnecting', offline: 'Offline' }[status];
  return <span className={`live live-${status}`} title="Real-time updates"><span className="live-dot" />{label}</span>;
}

export default function Layout() {
  const { user, logout } = useAuth();
  return (
    <div className="app">
      <header className="topbar">
        <div className="topbar-inner">
          <div className="brand">
            <span className="brand-mark" aria-hidden>❦</span>
            <span>BookLeaf <em>{user.role === 'admin' ? 'Support Desk' : 'Author Portal'}</em></span>
          </div>
          <nav className="nav">
            {NAV[user.role].map((n) => (
              <NavLink key={n.to} to={n.to} end={n.end ?? n.to === '/tickets'}>{n.label}</NavLink>
            ))}
          </nav>
          <div className="topbar-right">
            <LiveIndicator />
            <span className="who">{user.name}</span>
            <button className="btn btn-ghost btn-sm" onClick={logout}>Log out</button>
          </div>
        </div>
      </header>
      <main className="container"><Outlet /></main>
    </div>
  );
}
