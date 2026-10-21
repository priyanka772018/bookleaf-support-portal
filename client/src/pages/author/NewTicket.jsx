import { useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { api } from '../../api/client';
import { useAsync } from '../../hooks/useAsync';
import { Field, ErrorBanner } from '../../components/ui';

const MAX_BYTES = 5 * 1024 * 1024;

export default function NewTicket() {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const { data } = useAsync(() => api.get('/books'), []);
  const [form, setForm] = useState({ bookId: params.get('book') ?? 'general', subject: '', description: '' });
  const [file, setFile] = useState(null);
  const [errors, setErrors] = useState({});
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));

  function onFile(e) {
    const f = e.target.files?.[0] ?? null;
    setErrors((x) => ({ ...x, attachment: f && f.size > MAX_BYTES ? 'File must be 5 MB or smaller' : undefined }));
    setFile(f);
  }

  async function submit(e) {
    e.preventDefault();
    setError(null);
    const local = {};
    if (form.subject.trim().length < 5) local.subject = 'Please add a short subject (at least 5 characters)';
    if (form.description.trim().length < 20) local.description = 'Please describe the issue in a little more detail (at least 20 characters)';
    if (file && file.size > MAX_BYTES) local.attachment = 'File must be 5 MB or smaller';
    setErrors(local);
    if (Object.keys(local).length) return;

    setBusy(true);
    try {
      const fd = new FormData();
      fd.append('bookId', form.bookId);
      fd.append('subject', form.subject.trim());
      fd.append('description', form.description.trim());
      if (file) fd.append('attachment', file);
      const { ticket } = await api.postForm('/tickets', fd);
      navigate(`/tickets/${ticket.id}`, { state: { justCreated: true } });
    } catch (err) {
      if (err.details) setErrors(err.fieldErrors());
      else setError(err);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="narrow">
      <div className="page-head">
        <div>
          <h1>Get help</h1>
          <p className="muted">Tell us what's going on. Our team typically responds within one business day — urgent issues sooner.</p>
        </div>
      </div>
      <form className="card form" onSubmit={submit} noValidate>
        <Field label="Which book is this about?" htmlFor="book" error={errors.bookId}>
          <select id="book" value={form.bookId} onChange={set('bookId')}>
            <option value="general">General / Account level</option>
            {data?.books.map((b) => <option key={b.id} value={b.id}>{b.title}{b.isPublished ? '' : ` (${b.status})`}</option>)}
          </select>
        </Field>
        <Field label="Subject" htmlFor="subject" error={errors.subject}>
          <input id="subject" maxLength={150} value={form.subject} onChange={set('subject')} placeholder="e.g. Haven't received my Q2 royalty" />
        </Field>
        <Field label="Details" htmlFor="desc" error={errors.description}
          hint="Include anything that helps us act quickly: dates, amounts, platform links, order numbers.">
          <textarea id="desc" rows={7} maxLength={5000} value={form.description} onChange={set('description')} />
        </Field>
        <Field label="Attachment (optional)" htmlFor="file" error={errors.attachment} hint="Photos of print defects, screenshots, or statements. PNG, JPG, PDF, TXT or Word, up to 5 MB.">
          <input id="file" type="file" accept=".png,.jpg,.jpeg,.webp,.pdf,.txt,.doc,.docx" onChange={onFile} />
        </Field>
        <ErrorBanner error={error} />
        <div className="form-actions">
          <button type="button" className="btn btn-ghost" onClick={() => navigate(-1)}>Cancel</button>
          <button className="btn btn-primary" disabled={busy}>{busy ? 'Submitting…' : 'Submit ticket'}</button>
        </div>
      </form>
    </div>
  );
}
