const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000/api';

// Uploaded files (product images, etc) are served outside the /api prefix,
// so their URL is the API origin without that prefix.
const API_ORIGIN = API_BASE_URL.replace(/\/api\/?$/, '');

export function assetUrl(path?: string | null) {
  if (!path) return null;
  if (/^https?:\/\//.test(path)) return path;
  return `${API_ORIGIN}${path.startsWith('/') ? '' : '/'}${path}`;
}

export const PRODUCT_IMAGE_MAX_BYTES = 1024 * 1024;
export const PRODUCT_IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp'];

export function validateProductImageFile(file: File): string | null {
  if (file.size > PRODUCT_IMAGE_MAX_BYTES) return 'Image size must be 1 MB or less.';
  if (!PRODUCT_IMAGE_TYPES.includes(file.type)) return 'Only JPG, PNG, or WebP images are allowed.';
  return null;
}

export async function uploadProductImage(productId: string, file: File): Promise<void> {
  const formData = new FormData();
  formData.append('file', file);
  const res = await fetch(`${API_BASE_URL}/products/${productId}/images`, {
    method: 'POST',
    headers: accessToken ? { Authorization: `Bearer ${accessToken}` } : {},
    credentials: 'include',
    body: formData,
  });
  if (!res.ok) {
    const data = await res.json().catch(() => null);
    throw new ApiError(res.status, data?.message || 'Failed to upload image', data);
  }
}

export const WHATSAPP_MEDIA_MAX_BYTES = 64 * 1024 * 1024;

export interface WhatsappSendResult {
  sent: boolean;
  reason?: string;
  error?: string;
  chatId?: string;
}

// Multipart, not JSON, so this bypasses apiFetch's Content-Type: application/json
// - the browser sets the multipart boundary header itself. The file goes
// straight from the <input> into this FormData and out over the wire; it's
// never written anywhere on this frontend either.
export async function sendWhatsappMedia(chatId: string, file: File, caption?: string): Promise<WhatsappSendResult> {
  const formData = new FormData();
  formData.append('file', file);
  if (caption) formData.append('caption', caption);
  const res = await fetch(`${API_BASE_URL}/whatsapp/send-media/${encodeURIComponent(chatId)}`, {
    method: 'POST',
    headers: accessToken ? { Authorization: `Bearer ${accessToken}` } : {},
    credentials: 'include',
    body: formData,
  });
  const data = await res.json().catch(() => null);
  if (!res.ok) {
    throw new ApiError(res.status, data?.message || 'Failed to send media', data);
  }
  return data as WhatsappSendResult;
}

let accessToken: string | null = null;
let refreshPromise: Promise<string | null> | null = null;

export function setAccessToken(token: string | null) {
  accessToken = token;
}

export function getAccessToken() {
  return accessToken;
}

export class ApiError extends Error {
  status: number;
  body: unknown;
  constructor(status: number, message: string, body: unknown) {
    super(message);
    this.status = status;
    this.body = body;
  }
}

async function refreshAccessToken(): Promise<string | null> {
  if (!refreshPromise) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15000);
    refreshPromise = fetch(`${API_BASE_URL}/auth/refresh`, {
      method: 'POST',
      credentials: 'include',
      signal: controller.signal,
    })
      .then(async (res) => {
        if (!res.ok) return null;
        const data = await res.json();
        setAccessToken(data.accessToken);
        return data.accessToken as string;
      })
      .catch(() => null)
      .finally(() => {
        clearTimeout(timeout);
        refreshPromise = null;
      });
  }
  return refreshPromise;
}

interface RequestOptions {
  method?: string;
  body?: unknown;
  skipAuth?: boolean;
  isRetry?: boolean;
}

const REQUEST_TIMEOUT_MS = 45000;

export async function apiFetch<T = unknown>(path: string, options: RequestOptions = {}): Promise<T> {
  const { method = 'GET', body, skipAuth, isRetry } = options;

  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (!skipAuth && accessToken) {
    headers.Authorization = `Bearer ${accessToken}`;
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  let res: Response;
  try {
    res = await fetch(`${API_BASE_URL}${path}`, {
      method,
      headers,
      credentials: 'include',
      body: body !== undefined ? JSON.stringify(body) : undefined,
      signal: controller.signal,
    });
  } catch (err) {
    const timedOut = err instanceof DOMException && err.name === 'AbortError';
    throw new ApiError(
      0,
      timedOut ? 'The server took too long to respond. Check that the API server is running.' : 'Could not reach the server. Check your connection.',
      null,
    );
  } finally {
    clearTimeout(timeout);
  }

  if (res.status === 401 && !skipAuth && !isRetry) {
    const newToken = await refreshAccessToken();
    if (newToken) {
      return apiFetch<T>(path, { ...options, isRetry: true });
    }
  }

  const text = await res.text();
  const data = text ? JSON.parse(text) : null;

  if (!res.ok) {
    const message = (data && (data.message || data.error)) || res.statusText;
    throw new ApiError(res.status, Array.isArray(message) ? message.join(', ') : message, data);
  }

  return data as T;
}

export const api = {
  get: <T = unknown>(path: string) => apiFetch<T>(path),
  post: <T = unknown>(path: string, body?: unknown) => apiFetch<T>(path, { method: 'POST', body }),
  patch: <T = unknown>(path: string, body?: unknown) => apiFetch<T>(path, { method: 'PATCH', body }),
  put: <T = unknown>(path: string, body?: unknown) => apiFetch<T>(path, { method: 'PUT', body }),
  delete: <T = unknown>(path: string) => apiFetch<T>(path, { method: 'DELETE' }),
};
