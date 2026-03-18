import { pgTable, text, integer, real, timestamp, serial, uniqueIndex, index, primaryKey as pgPrimaryKey } from 'drizzle-orm/pg-core';
import { sqliteTable, text as sqliteText, integer as sqliteInteger, real as sqliteReal, uniqueIndex as sqliteUniqueIndex, primaryKey as sqlitePrimaryKey } from 'drizzle-orm/sqlite-core';

// --- Postgres Schema ---

export const pgProviders = pgTable('providers', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  baseUrl: text('baseurl').notNull(),
  apiKey: text('apikey'),
  type: text('type').default('openai_compatible'),
  removeTopP: integer('removetopp').default(0),
  lastUsedKeyIndex: integer('lastusedkeyindex').default(0),
  createdAt: timestamp('createdAt', { mode: 'string' }).defaultNow(),
  updatedAt: timestamp('updatedAt', { mode: 'string' }).defaultNow(),
});

export const pgModels = pgTable('models', {
  id: text('id').notNull(),
  providerId: text('providerid').notNull(),
  name: text('name').notNull(),
  maxInputTokens: integer('maxinputtokens'),
  maxOutputTokens: integer('maxoutputtokens'),
  pricingModelId: text('pricingmodelid'),
  inputPricePer1k: real('inputpriceper1k').default(0),
  outputPricePer1k: real('outputpriceper1k').default(0),
  isActive: integer('isactive').default(1),
  createdAt: timestamp('createdAt', { mode: 'string' }).defaultNow(),
  updatedAt: timestamp('updatedAt', { mode: 'string' }).defaultNow(),
}, (table) => ({
  pk: pgPrimaryKey({ columns: [table.id, table.providerId] }),
}));

export const pgTokens = pgTable('tokens', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  token: text('token').notNull(),
  createdAt: timestamp('createdAt', { mode: 'string' }).defaultNow(),
  expiresAt: timestamp('expiresAt', { mode: 'string' }),
  accessibleModelIds: text('accessiblemodelids'),
  usageCount: integer('usagecount').default(0),
  inputTokens: integer('inputtokens').default(0),
  outputTokens: integer('outputtokens').default(0),
  totalCost: real('totalcost').default(0),
  maxTokenUsage: integer('maxtokenusage'),
  maxCostUsage: real('maxcostusage'),
  isActive: integer('isactive').default(1),
  maxRequestsPerDay: integer('maxrequestsperday'),
  maxRequestsPerMinute: integer('maxrequestsperminute'),
  requestsToday: integer('requeststoday').default(0),
  lastRequestDate: text('lastrequestdate'),
  requestsThisMinute: integer('requeststhisminute').default(0),
  lastRequestMinute: text('lastrequestminute'),
  tokenType: text('tokentype').default('rpd'),
  creditBalance: real('creditbalance').default(0),
  updatedAt: timestamp('updatedAt', { mode: 'string' }).defaultNow(),
}, (table) => ({
  tokenIdx: uniqueIndex('idx_tokens_token').on(table.token),
}));

export const pgRequestLogs = pgTable('request_logs', {
  id: serial('id').primaryKey(),
  tokenId: text('tokenid').notNull(),
  modelId: text('modelid').notNull(),
  inputTokens: integer('inputtokens').default(0),
  outputTokens: integer('outputtokens').default(0),
  cost: real('cost').default(0),
  timestamp: timestamp('timestamp', { mode: 'string' }).defaultNow(),
}, (table) => ({
  tokenIdx: index('idx_request_logs_tokenId').on(table.tokenId),
  timestampIdx: index('idx_request_logs_timestamp').on(table.timestamp),
}));

export const pgAdminSessions = pgTable('admin_sessions', {
  id: serial('id').primaryKey(),
  selector: text('selector').notNull(),
  validatorHash: text('validatorhash').notNull(),
  createdAt: timestamp('createdAt', { mode: 'string' }).defaultNow(),
  lastSeenAt: timestamp('lastSeenAt', { mode: 'string' }),
  expiresAt: timestamp('expiresAt', { mode: 'string' }).notNull(),
  revokedAt: timestamp('revokedAt', { mode: 'string' }),
  ip: text('ip'),
  userAgent: text('useragent'),
  updatedAt: timestamp('updatedAt', { mode: 'string' }).defaultNow(),
}, (table) => ({
  selectorIdx: uniqueIndex('idx_admin_sessions_selector').on(table.selector),
  expiresIdx: index('idx_admin_sessions_expiresAt').on(table.expiresAt),
  revokedIdx: index('idx_admin_sessions_revokedAt').on(table.revokedAt),
}));

export const pgAdminAuditLog = pgTable('admin_audit_log', {
  id: serial('id').primaryKey(),
  timestamp: timestamp('timestamp', { mode: 'string' }).defaultNow(),
  event: text('event').notNull(),
  ip: text('ip'),
  userAgent: text('useragent'),
  details: text('details'),
}, (table) => ({
  timestampIdx: index('idx_admin_audit_log_timestamp').on(table.timestamp),
}));

export const pgErrorLogs = pgTable('error_logs', {
  id: serial('id').primaryKey(),
  tokenId: text('tokenid'),
  modelId: text('modelid'),
  providerId: text('providerid'),
  errorType: text('errortype'),
  errorMessage: text('errormessage'),
  timestamp: timestamp('timestamp', { mode: 'string' }).defaultNow(),
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
  tokenType: sqliteText('tokenType').default('rpd'),
  creditBalance: sqliteReal('creditBalance').default(0),
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
