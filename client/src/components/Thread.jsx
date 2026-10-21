import { dateTime } from './format';

/** Conversation thread shared by author and admin views. */
export default function Thread({ messages, viewer }) {
  return (
    <ol className="thread">
      {messages.map((m) => {
        const mine = m.senderRole === viewer;
        const who = m.senderRole === 'admin'
          ? (viewer === 'author' ? `BookLeaf Support · ${m.senderName?.split(' ')[0] ?? ''}` : m.senderName)
          : (viewer === 'author' ? 'You' : m.senderName);
        return (
          <li key={m.id} className={`msg ${m.senderRole} ${mine ? 'mine' : ''}`}>
            <div className="msg-meta">
              <strong>{who}</strong>
              <span>{dateTime(m.createdAt)}</span>
              {viewer === 'admin' && m.aiAssisted && <span className="badge badge-ai">AI-assisted</span>}
            </div>
            <div className="msg-body">{m.body}</div>
          </li>
        );
      })}
    </ol>
  );
}
