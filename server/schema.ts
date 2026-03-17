import { pgTable, text, integer, real, timestamp, serial, uniqueIndex, index, primaryKey as pgPrimaryKey } from 'drizzle-orm/pg-core';
import { sqliteTable, text as sqliteText, integer as sqliteInteger, real as sqliteReal, uniqueIndex as sqliteUniqueIndex, primaryKey as sqlitePrimaryKey } from 'drizzle-orm/sqlite-core';

// --- Postgres Schema ---

export const pgProviders = pgTable('providers', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  baseUrl: text('baseUrl').notNull(),
  apiKey: text('apiKey'),
  type: text('type').default('openai_compatible'),
  removeTopP: integer('removeTopP').default(0),
  lastUsedKeyIndex: integer('lastUsedKeyIndex').default(0),
  createdAt: timestamp('createdAt').defaultNow(),
  updatedAt: timestamp('updatedAt').defaultNow(),
});

export const pgModels = pgTable('models', {
  id: text('id').notNull(),
  providerId: text('providerId').notNull(),
  name: text('name').notNull(),
  maxInputTokens: integer('maxInputTokens'),
  maxOutputTokens: integer('maxOutputTokens'),
  pricingModelId: text('pricingModelId'),
  inputPricePer1k: real('inputPricePer1k').default(0),
  outputPricePer1k: real('outputPricePer1k').default(0),
  isActive: integer('isActive').default(1),
  createdAt: timestamp('createdAt').defaultNow(),
  updatedAt: timestamp('updatedAt').defaultNow(),
}, (table) => ({
  pk: pgPrimaryKey({ columns: [table.id, table.providerId] }),
}));

export const pgTokens = pgTable('tokens', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  token: text('token').notNull(),
  createdAt: timestamp('createdAt').defaultNow(),
  expiresAt: timestamp('expiresAt'),
  accessibleModelIds: text('accessibleModelIds'),
  usageCount: integer('usageCount').default(0),
  inputTokens: integer('inputTokens').default(0),
  outputTokens: integer('outputTokens').default(0),
  totalCost: real('totalCost').default(0),
  maxTokenUsage: integer('maxTokenUsage'),
  maxCostUsage: real('maxCostUsage'),
  isActive: integer('isActive').default(1),
  maxRequestsPerDay: integer('maxRequestsPerDay'),
  maxRequestsPerMinute: integer('maxRequestsPerMinute'),
  requestsToday: integer('requestsToday').default(0),
  lastRequestDate: text('lastRequestDate'),
  requestsThisMinute: integer('requestsThisMinute').default(0),
  lastRequestMinute: text('lastRequestMinute'),
  updatedAt: timestamp('updatedAt').defaultNow(),
}, (table) => ({
  tokenIdx: uniqueIndex('idx_tokens_token').on(table.token),
}));

export const pgRequestLogs = pgTable('request_logs', {
  id: serial('id').primaryKey(),
  tokenId: text('tokenId').notNull(),
  modelId: text('modelId').notNull(),
  inputTokens: integer('inputTokens').default(0),
  outputTokens: integer('outputTokens').default(0),
  cost: real('cost').default(0),
  timestamp: timestamp('timestamp').defaultNow(),
}, (table) => ({
  tokenIdx: index('idx_request_logs_tokenId').on(table.tokenId),
  timestampIdx: index('idx_request_logs_timestamp').on(table.timestamp),
}));

export const pgAdminSessions = pgTable('admin_sessions', {
  id: serial('id').primaryKey(),
  selector: text('selector').notNull(),
  validatorHash: text('validatorHash').notNull(),
  createdAt: timestamp('createdAt').defaultNow(),
  lastSeenAt: timestamp('lastSeenAt'),
  expiresAt: timestamp('expiresAt').notNull(),
  revokedAt: timestamp('revokedAt'),
  ip: text('ip'),
  userAgent: text('userAgent'),
  updatedAt: timestamp('updatedAt').defaultNow(),
}, (table) => ({
  selectorIdx: uniqueIndex('idx_admin_sessions_selector').on(table.selector),
  expiresIdx: index('idx_admin_sessions_expiresAt').on(table.expiresAt),
  revokedIdx: index('idx_admin_sessions_revokedAt').on(table.revokedAt),
}));

export const pgAdminAuditLog = pgTable('admin_audit_log', {
  id: serial('id').primaryKey(),
  timestamp: timestamp('timestamp').defaultNow(),
  event: text('event').notNull(),
  ip: text('ip'),
  userAgent: text('userAgent'),
  details: text('details'),
}, (table) => ({
  timestampIdx: index('idx_admin_audit_log_timestamp').on(table.timestamp),
}));

export const pgErrorLogs = pgTable('error_logs', {
  id: serial('id').primaryKey(),
  tokenId: text('tokenId'),
  modelId: text('modelId'),
  providerId: text('providerId'),
  errorType: text('errorType'),
  errorMessage: text('errorMessage'),
  timestamp: timestamp('timestamp').defaultNow(),
}, (table) => ({
  timestampIdx: index('idx_error_logs_timestamp').on(table.timestamp),
}));

// --- SQLite Schema ---

export const sqliteProviders = sqliteTable('providers', {
  id: sqliteText('id').primaryKey(),
  name: sqliteText('name').notNull(),
  baseUrl: sqliteText('baseUrl').notNull(),
  apiKey: sqliteText('apiKey'),
  type: sqliteText('type').default('openai_compatible'),
  removeTopP: sqliteInteger('removeTopP').default(0),
  lastUsedKeyIndex: sqliteInteger('lastUsedKeyIndex').default(0),
  createdAt: sqliteText('createdAt'),
  updatedAt: sqliteText('updatedAt'),
});

export const sqliteModels = sqliteTable('models', {
  id: sqliteText('id').notNull(),
  providerId: sqliteText('providerId').notNull(),
  name: sqliteText('name').notNull(),
  maxInputTokens: sqliteInteger('maxInputTokens'),
  maxOutputTokens: sqliteInteger('maxOutputTokens'),
  pricingModelId: sqliteText('pricingModelId'),
  inputPricePer1k: sqliteReal('inputPricePer1k').default(0),
  outputPricePer1k: sqliteReal('outputPricePer1k').default(0),
  isActive: sqliteInteger('isActive').default(1),
  createdAt: sqliteText('createdAt'),
  updatedAt: sqliteText('updatedAt'),
}, (table) => ({
  pk: sqlitePrimaryKey({ columns: [table.id, table.providerId] }),
}));

export const sqliteTokens = sqliteTable('tokens', {
  id: sqliteText('id').primaryKey(),
  name: sqliteText('name').notNull(),
  token: sqliteText('token').notNull(),
  createdAt: sqliteText('createdAt'),
  expiresAt: sqliteText('expiresAt'),
  accessibleModelIds: sqliteText('accessibleModelIds'),
  usageCount: sqliteInteger('usageCount').default(0),
  inputTokens: sqliteInteger('inputTokens').default(0),
  outputTokens: sqliteInteger('outputTokens').default(0),
  totalCost: sqliteReal('totalCost').default(0),
  maxTokenUsage: sqliteInteger('maxTokenUsage'),
  maxCostUsage: sqliteReal('maxCostUsage'),
  isActive: sqliteInteger('isActive').default(1),
  maxRequestsPerDay: sqliteInteger('maxRequestsPerDay'),
  maxRequestsPerMinute: sqliteInteger('maxRequestsPerMinute'),
  requestsToday: sqliteInteger('requestsToday').default(0),
  lastRequestDate: sqliteText('lastRequestDate'),
  requestsThisMinute: sqliteInteger('requestsThisMinute').default(0),
  lastRequestMinute: sqliteText('lastRequestMinute'),
  updatedAt: sqliteText('updatedAt'),
});

export const sqliteRequestLogs = sqliteTable('request_logs', {
  id: sqliteInteger('id').primaryKey({ autoIncrement: true }),
  tokenId: sqliteText('tokenId').notNull(),
  modelId: sqliteText('modelId').notNull(),
  inputTokens: sqliteInteger('inputTokens').default(0),
  outputTokens: sqliteInteger('outputTokens').default(0),
  cost: sqliteReal('cost').default(0),
  timestamp: sqliteText('timestamp'),
});

export const sqliteAdminSessions = sqliteTable('admin_sessions', {
  id: sqliteInteger('id').primaryKey({ autoIncrement: true }),
  selector: sqliteText('selector').notNull(),
  validatorHash: sqliteText('validatorHash').notNull(),
  createdAt: sqliteText('createdAt'),
  lastSeenAt: sqliteText('lastSeenAt'),
  expiresAt: sqliteText('expiresAt').notNull(),
  revokedAt: sqliteText('revokedAt'),
  ip: sqliteText('ip'),
  userAgent: sqliteText('userAgent'),
  updatedAt: sqliteText('updatedAt'),
});

export const sqliteAdminAuditLog = sqliteTable('admin_audit_log', {
  id: sqliteInteger('id').primaryKey({ autoIncrement: true }),
  timestamp: sqliteText('timestamp'),
  event: sqliteText('event').notNull(),
  ip: sqliteText('ip'),
  userAgent: sqliteText('userAgent'),
  details: sqliteText('details'),
});

export const sqliteErrorLogs = sqliteTable('error_logs', {
  id: sqliteInteger('id').primaryKey({ autoIncrement: true }),
  tokenId: sqliteText('tokenId'),
  modelId: sqliteText('modelId'),
  providerId: sqliteText('providerId'),
  errorType: sqliteText('errorType'),
  errorMessage: sqliteText('errorMessage'),
  timestamp: sqliteText('timestamp'),
});
