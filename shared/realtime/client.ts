export type RideXStreamEvent = {
  id?: string;
  type?: string;
  actorType?: string;
  actorId?: string;
  bookingId?: string | null;
  driverId?: string | null;
  customerId?: string | null;
  payload?: Record<string, unknown>;
  createdAt?: string;
};

type Options = {
  url: string;
  headers?: Record<string, string>;
  onEvent: (event: RideXStreamEvent) => void;
  onError?: (error: unknown) => void;
  onOpen?: () => void;
  onClose?: () => void;
  heartbeatTimeoutMs?: number;
};

/**
 * Small React-Native-compatible SSE client.
 * We intentionally keep the transport dependency-free and use XHR so the
 * existing RideX Expo app does not need another native networking package.
 */
export function openRideXEventStream(options: Options) {
  const xhr = new XMLHttpRequest();
  let cursor = 0;
  let buffer = '';
  let closed = false;
  let opened = false;
  let heartbeatTimer: ReturnType<typeof setTimeout> | null = null;
  const heartbeatTimeoutMs = Math.max(10_000, options.heartbeatTimeoutMs ?? 60_000);

  const clearHeartbeat = () => {
    if (heartbeatTimer) {
      clearTimeout(heartbeatTimer);
      heartbeatTimer = null;
    }
  };

  const touchHeartbeat = () => {
    clearHeartbeat();
    if (closed) return;
    heartbeatTimer = setTimeout(() => {
      if (closed) return;
      try { xhr.abort(); } catch {}
      options.onError?.(new Error('Realtime heartbeat timed out'));
    }, heartbeatTimeoutMs);
  };

  const notifyOpen = () => {
    if (opened || closed) return;
    opened = true;
    touchHeartbeat();
    options.onOpen?.();
  };

  const notifyClose = () => {
    clearHeartbeat();
    if (!opened) return;
    options.onClose?.();
  };

  const flushBuffer = (chunk: string) => {
    buffer += chunk;
    touchHeartbeat();

    const parts = buffer.split(/\r?\n\r?\n/);
    buffer = parts.pop() ?? '';

    for (const block of parts) {
      let dataLines: string[] = [];
      let eventType = 'message';
      for (const line of block.split(/\r?\n/)) {
        if (!line || line.startsWith(':')) continue;
        const separator = line.indexOf(':');
        const field = separator >= 0 ? line.slice(0, separator) : line;
        const value = separator >= 0 ? line.slice(separator + 1).replace(/^ /, '') : '';
        if (field === 'event') eventType = value || 'message';
        if (field === 'data') dataLines.push(value);
      }

      const data = dataLines.join('\n');
      if (!data) continue;
      try {
        const parsed = JSON.parse(data) as RideXStreamEvent;
        parsed.type = parsed.type || eventType;
        options.onEvent(parsed);
      } catch {
        options.onEvent({ type: eventType, payload: { raw: data } });
      }
    }
  };

  xhr.onreadystatechange = () => {
    if (closed) return;
    if (xhr.readyState === 2) notifyOpen();

    if (xhr.readyState === 3 || xhr.readyState === 4) {
      if (xhr.status >= 200 && xhr.status < 400) notifyOpen();
      const text = xhr.responseText || '';
      const next = text.slice(cursor);
      cursor = text.length;
      if (next) flushBuffer(next);

      if (xhr.readyState === 4) {
        if (xhr.status >= 400) {
          options.onError?.(new Error(`Realtime stream failed (${xhr.status})`));
        }
        notifyClose();
      }
    }
  };

  xhr.onerror = () => {
    if (closed) return;
    options.onError?.(new Error('Realtime connection failed'));
    notifyClose();
  };
  xhr.ontimeout = () => {
    if (closed) return;
    options.onError?.(new Error('Realtime connection timed out'));
    notifyClose();
  };

  xhr.open('GET', options.url, true);
  xhr.setRequestHeader('Accept', 'text/event-stream');
  for (const [key, value] of Object.entries(options.headers ?? {})) {
    xhr.setRequestHeader(key, value);
  }
  xhr.send();

  return () => {
    if (closed) return;
    closed = true;
    clearHeartbeat();
    try { xhr.abort(); } catch {}
    if (opened) options.onClose?.();
  };
}
