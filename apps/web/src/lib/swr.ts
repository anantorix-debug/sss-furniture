import { api } from './api';

export function fetcher<T = unknown>(path: string): Promise<T> {
  const cachebustedPath = path.includes('?') ? `${path}&t=${Date.now()}` : `${path}?t=${Date.now()}`;
  return api.get<T>(cachebustedPath);
}
