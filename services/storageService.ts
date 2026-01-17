import { ModelConfig, Provider, UserToken, ErrorLog } from '../types';

const API_URL = '/api';

const getCookie = (name: string): string | null => {
  if (typeof document === 'undefined') return null;

  const parts = document.cookie.split(';');
  for (const part of parts) {
    const idx = part.indexOf('=');
    if (idx === -1) continue;
    const k = part.slice(0, idx).trim();
    const v = part.slice(idx + 1).trim();
    if (k === name) return decodeURIComponent(v);
  }
  return null;
};

const csrfHeaders = (): Record<string, string> => {
  const csrf = getCookie('reze_csrf');
  return csrf ? { 'X-CSRF-Token': csrf } : {};
};

class StorageService {
  // --- Error Logs ---
  async getErrorLogs(): Promise<ErrorLog[]> {
    try {
      const res = await fetch(`${API_URL}/errors`, { credentials: 'same-origin' });
      if (!res.ok) {
        console.error('getErrorLogs failed:', res.status, res.statusText);
        throw new Error('Failed to fetch error logs');
      }
      return await res.json();
    } catch (e) {
      console.error(e);
      return [];
    }
  }

  async pruneErrorLogs(): Promise<void> {
    await fetch(`${API_URL}/errors/prune`, {
        method: 'DELETE',
        credentials: 'same-origin',
        headers: { ...csrfHeaders() }
    });
  }

  // --- Providers ---
  async getProviders(): Promise<Provider[]> {
    try {
      const res = await fetch(`${API_URL}/providers`, { credentials: 'same-origin' });
      if (!res.ok) {
        console.error('getProviders failed:', res.status, res.statusText);
        throw new Error('Failed to fetch providers');
      }
      return await res.json();
    } catch (e) {
      console.error(e);
      return [];
    }
  }

  async saveProvider(provider: Provider): Promise<void> {
    await fetch(`${API_URL}/providers`, {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json', ...csrfHeaders() },
      body: JSON.stringify(provider)
    });
  }

  async updateProvider(provider: Provider): Promise<void> {
    await fetch(`${API_URL}/providers`, {
      method: 'PUT',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json', ...csrfHeaders() },
      body: JSON.stringify(provider)
    });
  }

  async deleteProvider(id: string): Promise<void> {
    await fetch(`${API_URL}/providers/${id}`, {
      method: 'DELETE',
      credentials: 'same-origin',
      headers: { ...csrfHeaders() }
    });
  }

  // --- Models ---
  async getModels(): Promise<ModelConfig[]> {
    try {
      const res = await fetch(`${API_URL}/models`, { credentials: 'same-origin' });
      if (!res.ok) {
        console.error('getModels failed:', res.status, res.statusText);
        throw new Error('Failed to fetch models');
      }
      return await res.json();
    } catch (e) {
      console.error(e);
      return [];
    }
  }

  async saveModels(newModels: ModelConfig[]): Promise<void> {
    await fetch(`${API_URL}/models`, {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json', ...csrfHeaders() },
      body: JSON.stringify(newModels)
    });
  }

  async updateModel(model: ModelConfig): Promise<void> {
    await fetch(`${API_URL}/models`, {
      method: 'PUT',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json', ...csrfHeaders() },
      body: JSON.stringify(model)
    });
  }

  // --- Tokens ---
  async getTokens(): Promise<UserToken[]> {
    try {
      const res = await fetch(`${API_URL}/tokens`, { credentials: 'same-origin' });
      if (!res.ok) {
        console.error('getTokens failed:', res.status, res.statusText);
        throw new Error('Failed to fetch tokens');
      }
      return await res.json();
    } catch (e) {
      console.error(e);
      return [];
    }
  }

  async saveToken(token: UserToken): Promise<void> {
    await fetch(`${API_URL}/tokens`, {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json', ...csrfHeaders() },
      body: JSON.stringify(token)
    });
  }

  async updateToken(token: Partial<UserToken> & { id: string }): Promise<void> {
    await fetch(`${API_URL}/tokens`, {
      method: 'PUT',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json', ...csrfHeaders() },
      body: JSON.stringify(token)
    });
  }

  async deleteToken(id: string): Promise<void> {
    await fetch(`${API_URL}/tokens/${id}`, {
      method: 'DELETE',
      credentials: 'same-origin',
      headers: { ...csrfHeaders() }
    });
  }
}

export const storageService = new StorageService();