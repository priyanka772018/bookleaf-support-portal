/**
 * Server-Sent Events over fetch(), so the JWT goes in a header (EventSource
 * can't send headers and would leak the token into URLs/logs).
 * Reconnects with backoff; `onStatus` reports 'live' | 'reconnecting'.
 */
import { tokenStore } from './client';

export function connectLiveEvents({ onEvent, onStatus }) {
  let stopped = false;
  let controller;
  let attempt = 0;

  async function run() {
    while (!stopped) {
      controller = new AbortController();
      try {
        const res = await fetch('/api/events', {
          headers: { Authorization: `Bearer ${tokenStore.get()}`, Accept: 'text/event-stream' },
          signal: controller.signal,
        });
        if (res.status === 401) { onStatus?.('offline'); return; }
        if (!res.ok || !res.body) throw new Error(`SSE ${res.status}`);
        attempt = 0;
        onStatus?.('live');
        const reader = res.body.pipeThrough(new TextDecoderStream()).getReader();
        let buffer = '';
        for (;;) {
          const { value, done } = await reader.read();
          if (done) break;
          buffer += value;
          let idx;
          while ((idx = buffer.indexOf('\n\n')) !== -1) {
            const chunk = buffer.slice(0, idx);
            buffer = buffer.slice(idx + 2);
            let type = 'message';
            let data = '';
            for (const line of chunk.split('\n')) {
              if (line.startsWith('event:')) type = line.slice(6).trim();
              else if (line.startsWith('data:')) data += line.slice(5).trim();
            }
            if (data && type !== 'ready') {
              try { onEvent(type, JSON.parse(data)); } catch { /* ignore malformed */ }
            }
          }
        }
      } catch (err) {
        if (stopped || err.name === 'AbortError') return;
      }
      if (stopped) return;
      onStatus?.('reconnecting');
      attempt += 1;
      await new Promise((r) => setTimeout(r, Math.min(1000 * 2 ** attempt, 15000)));
    }
  }
  run();
  return () => { stopped = true; controller?.abort(); };
}
