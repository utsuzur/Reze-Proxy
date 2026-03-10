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
  apiKey?: string;
  type?: string;
  removeTopP?: boolean;
  lastUsedKeyIndex?: number;
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

export interface ErrorLog {
  id: number;
  tokenId: string;
  modelId: string;
  providerId: string;
  errorType: 'provider_error' | 'server_error';
  errorMessage: string;
  timestamp: string;
}
