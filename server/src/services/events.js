import { EventEmitter } from 'node:events';

/**
 * In-process pub/sub for real-time ticket updates, consumed by the SSE stream.
 * Each event is targeted at the ticket's author and/or all admins.
 *
 * For multi-instance deployment this would be swapped for Postgres
 * LISTEN/NOTIFY or Redis pub/sub behind the same publish() interface.
 */
const bus = new EventEmitter();
bus.setMaxListeners(0);

/**
 * @param {string} type  e.g. 'ticket.created', 'ticket.updated', 'ticket.message'
 * @param {object} payload must include ticketId and authorId
 * @param {{ toAuthor?: boolean, toAdmins?: boolean }} audience
 */
export function publish(type, payload, { toAuthor = true, toAdmins = true } = {}) {
  bus.emit('event', { type, payload, toAuthor, toAdmins, at: new Date().toISOString() });
}

export function subscribe(listener) {
  bus.on('event', listener);
  return () => bus.off('event', listener);
}
