import AsyncStorage from '@react-native-async-storage/async-storage';

export type RideXApiClientOptions = {
  tokenKey?: string;
  token?: string;
  apiUrl?: string;
  timeoutMs?: number;
};

export type RideXRequestOptions = RequestInit & {
  skipAuth?: boolean;
};

export function getRideXApiUrl(apiUrl?: string): string {
  return (
    apiUrl ||
    process.env.EXPO_PUBLIC_API_URL ||
    'https://ridex-backend-test.onrender.com'
  ).trim().replace(/\/+$/, '');
}

function joinUrl(baseUrl: string, input: RequestInfo | URL): string {
  if (input instanceof URL) return input.toString();
  if (typeof input !== 'string') return String(input);
  if (/^https?:\/\//i.test(input)) return input;
  return `${baseUrl}/${input.replace(/^\/+/, '')}`;
}

function mergeHeaders(init?: HeadersInit): Headers {
  return new Headers(init || {});
}

export function createRideXFetch(options: RideXApiClientOptions = {}) {
  const baseUrl = getRideXApiUrl(options.apiUrl);
  const timeoutMs = options.timeoutMs ?? 30000;

  return async function rideXFetch(
    input: RequestInfo | URL,
    init: RideXRequestOptions = {},
  ): Promise<Response> {
    const { skipAuth, ...requestInit } = init;
    const headers = mergeHeaders(requestInit.headers);
    const method = String(requestInit.method || 'GET').toUpperCase();

    if (requestInit.body && !headers.has('Content-Type') && method !== 'GET' && method !== 'HEAD') {
      headers.set('Content-Type', 'application/json');
    }

    if (!skipAuth) {
      const token = options.token ?? (options.tokenKey ? await AsyncStorage.getItem(options.tokenKey) : null);
      if (token) headers.set('Authorization', `Bearer ${token}`);
    }

    const controller = new AbortController();
    const callerSignal = requestInit.signal;
    const timeout = setTimeout(() => controller.abort(), timeoutMs);

    if (callerSignal) {
      if (callerSignal.aborted) controller.abort();
      else callerSignal.addEventListener('abort', () => controller.abort(), { once: true });
    }

    try {
      return await fetch(joinUrl(baseUrl, input), {
        ...requestInit,
        headers,
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timeout);
    }
  };
}

export function createRideXApiClient(options: RideXApiClientOptions = {}) {
  const baseUrl = getRideXApiUrl(options.apiUrl);
  const request = createRideXFetch(options);

  async function json<T = unknown>(path: string, init: RideXRequestOptions = {}): Promise<T> {
    const response = await request(path, init);
    const body = await response.json().catch(() => ({}));
    if (!response.ok || body?.success === false) {
      const message = body?.message || `RideX API request failed (${response.status})`;
      throw new Error(message);
    }
    return (body?.data ?? body) as T;
  }

  return {
    baseUrl,
    request,
    json,
    get: <T = unknown>(path: string, init: RideXRequestOptions = {}) =>
      json<T>(path, { ...init, method: 'GET' }),
    post: <T = unknown>(path: string, body?: unknown, init: RideXRequestOptions = {}) =>
      json<T>(path, {
        ...init,
        method: 'POST',
        body: body === undefined ? init.body : JSON.stringify(body),
      }),
    put: <T = unknown>(path: string, body?: unknown, init: RideXRequestOptions = {}) =>
      json<T>(path, {
        ...init,
        method: 'PUT',
        body: body === undefined ? init.body : JSON.stringify(body),
      }),
    patch: <T = unknown>(path: string, body?: unknown, init: RideXRequestOptions = {}) =>
      json<T>(path, {
        ...init,
        method: 'PATCH',
        body: body === undefined ? init.body : JSON.stringify(body),
      }),
    delete: <T = unknown>(path: string, init: RideXRequestOptions = {}) =>
      json<T>(path, { ...init, method: 'DELETE' }),
  };
}
