export interface ModelConfig {
  id: string;
  name: string; // The model ID from the provider (e.g., gpt-4)
  providerId: string;
  maxInputTokens: number;
  maxOutputTokens: number;
  isActive: boolean;
}

export interface Provider {
  id: string;
  name: string;
  baseUrl: string;
  apiKey: string; // Stored securely in backend in real app
  type: 'openai' | 'azure' | 'anthropic' | 'other';
}

export interface UserToken {
  id: string;
  name: string;
  token: string;
  createdAt: string;
  expiresAt: string | null;
  accessibleModelIds: string[]; // List of model IDs this token can access
  usageCount: number;
  maxRequestsPerDay?: number;
  maxRequestsPerMinute?: number;
  isActive: boolean;
}

export interface AdminConfig {
  themeColor: string;
}
