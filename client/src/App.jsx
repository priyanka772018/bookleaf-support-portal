import { Navigate, Route, Routes } from 'react-router-dom';
import { useAuth } from './auth/AuthContext';
import Layout from './components/Layout';
import { Spinner } from './components/ui';
import Login from './pages/Login';
import MyBooks from './pages/author/MyBooks';
import MyTickets from './pages/author/MyTickets';
import NewTicket from './pages/author/NewTicket';
import AuthorTicketDetail from './pages/author/AuthorTicketDetail';
import Queue from './pages/admin/Queue';
import AdminTicketDetail from './pages/admin/AdminTicketDetail';
import AiUsage from './pages/admin/AiUsage';

function RequireRole({ role, children }) {
  const { user } = useAuth();
  if (!user) return <Navigate to="/login" replace />;
  if (user.role !== role) return <Navigate to={user.role === 'admin' ? '/admin' : '/books'} replace />;
  return children;
}

export default function App() {
  const { user, loading } = useAuth();
  if (loading) return <div className="center-screen"><Spinner /></div>;

  return (
    <Routes>
      <Route path="/login" element={user ? <Navigate to={user.role === 'admin' ? '/admin' : '/books'} replace /> : <Login />} />
      <Route element={user ? <Layout /> : <Navigate to="/login" replace />}>
        <Route path="/books" element={<RequireRole role="author"><MyBooks /></RequireRole>} />
        <Route path="/tickets" element={<RequireRole role="author"><MyTickets /></RequireRole>} />
        <Route path="/tickets/new" element={<RequireRole role="author"><NewTicket /></RequireRole>} />
        <Route path="/tickets/:id" element={<RequireRole role="author"><AuthorTicketDetail /></RequireRole>} />
        <Route path="/admin" element={<RequireRole role="admin"><Queue /></RequireRole>} />
        <Route path="/admin/tickets/:id" element={<RequireRole role="admin"><AdminTicketDetail /></RequireRole>} />
        <Route path="/admin/ai-usage" element={<RequireRole role="admin"><AiUsage /></RequireRole>} />
      </Route>
      <Route path="*" element={<Navigate to={user ? (user.role === 'admin' ? '/admin' : '/books') : '/login'} replace />} />
    </Routes>
  );
}
