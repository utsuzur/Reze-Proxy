import { ModelConfig, Provider, UserToken } from '../types';

const API_URL = '/api';

class StorageService {
  // --- Providers ---
  async getProviders(): Promise<Provider[]> {
    try {
      const res = await fetch(`${API_URL}/providers`);
      if (!res.ok) throw new Error('Failed to fetch providers');
      return await res.json();
    } catch (e) {
      console.error(e);
      return [];
    }
  }

  async saveProvider(provider: Provider): Promise<void> {
    await fetch(`${API_URL}/providers`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(provider)
    });
  }

  async updateProvider(provider: Provider): Promise<void> {
    await fetch(`${API_URL}/providers`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(provider)
    });
  }

  async deleteProvider(id: string): Promise<void> {
    await fetch(`${API_URL}/providers/${id}`, { method: 'DELETE' });
  }

  // --- Models ---
  async getModels(): Promise<ModelConfig[]> {
    try {
      const res = await fetch(`${API_URL}/models`);
      if (!res.ok) throw new Error('Failed to fetch models');
      return await res.json();
    } catch (e) {
      console.error(e);
      return [];
    }
  }

  async saveModels(newModels: ModelConfig[]): Promise<void> {
    await fetch(`${API_URL}/models`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(newModels)
    });
  }

  async updateModel(model: ModelConfig): Promise<void> {
    await fetch(`${API_URL}/models`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(model)
    });
  }

  // --- Tokens ---
  async getTokens(): Promise<UserToken[]> {
    try {
      const res = await fetch(`${API_URL}/tokens`);
      if (!res.ok) throw new Error('Failed to fetch tokens');
      return await res.json();
    } catch (e) {
      console.error(e);
      return [];
    }
  }

  async saveToken(token: UserToken): Promise<void> {
    await fetch(`${API_URL}/tokens`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(token)
    });
  }

  async updateToken(token: Partial<UserToken> & { id: string }): Promise<void> {
    await fetch(`${API_URL}/tokens`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(token)
    });
  }

  async deleteToken(id: string): Promise<void> {
    await fetch(`${API_URL}/tokens/${id}`, { method: 'DELETE' });
  }
}

export const storageService = new StorageService();