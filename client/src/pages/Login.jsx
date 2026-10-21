import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext';
import { Field } from '../components/ui';

const DEMO = [
  { label: 'Author · Ananya Reddy', email: 'ananya.reddy@email.com', password: 'Author@123' },
  { label: 'Author · Sneha Kulkarni', email: 'sneha.kulkarni@email.com', password: 'Author@123' },
  { label: 'Admin · Support Lead', email: 'admin@bookleaf.com', password: 'Admin@123' },
];

export default function Login() {
  const { login } = useAuth();
  const navigate = useNavigate();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

  async function submit(e) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const user = await login(email, password);
      navigate(user.role === 'admin' ? '/admin' : '/books', { replace: true });
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  }

  const fe = error?.fieldErrors?.() ?? {};
  return (
    <div className="login-page">
      <div className="login-card">
        <div className="brand brand-lg"><span className="brand-mark">❦</span><span>BookLeaf</span></div>
        <h1>Author Support</h1>
        <p className="muted">Sign in to see your books, royalties and support tickets.</p>
        <form onSubmit={submit} noValidate>
          <Field label="Email" htmlFor="email" error={fe.email}>
            <input id="email" type="email" autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} required />
          </Field>
          <Field label="Password" htmlFor="password" error={fe.password}>
            <input id="password" type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} required />
          </Field>
          {error && !error.details && <div className="alert alert-error">{error.message}</div>}
          <button className="btn btn-primary btn-block" disabled={busy}>{busy ? 'Signing in…' : 'Sign in'}</button>
        </form>
        <div className="demo-logins">
          <div className="muted small">Demo accounts (all authors use <code>Author@123</code>)</div>
          {DEMO.map((d) => (
            <button key={d.email} type="button" className="chip" onClick={() => { setEmail(d.email); setPassword(d.password); }}>{d.label}</button>
          ))}
        </div>
      </div>
    </div>
  );
}
