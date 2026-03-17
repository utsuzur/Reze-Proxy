import 'dotenv/config';
import { drizzle as drizzleSqlite } from 'drizzle-orm/better-sqlite3';
import { drizzle as drizzlePg } from 'drizzle-orm/node-postgres';
import Database from 'better-sqlite3';
import pg from 'pg';
import * as schema from './schema.ts';

const DB_TYPE = process.env.DB_TYPE || 'sqlite';
const DB_PATH = process.env.DB_PATH || './reze.db';
const POSTGRES_URL = process.env.POSTGRES_URL;

export type DbType = 'sqlite' | 'postgres';

function createSqliteDb(path: string) {
    const sqlite = new Database(path);
    return {
        db: drizzleSqlite(sqlite, { schema: {
            providers: schema.sqliteProviders,
            models: schema.sqliteModels,
            tokens: schema.sqliteTokens,
            requestLogs: schema.sqliteRequestLogs,
            adminSessions: schema.sqliteAdminSessions,
            adminAuditLog: schema.sqliteAdminAuditLog,
            errorLogs: schema.sqliteErrorLogs,
        }}),
        conn: sqlite
    };
}

function createPgDb(url: string) {
    const pool = new pg.Pool({ connectionString: url });
    return {
        db: drizzlePg(pool, { schema: {
            providers: schema.pgProviders,
            models: schema.pgModels,
            tokens: schema.pgTokens,
            requestLogs: schema.pgRequestLogs,
            adminSessions: schema.pgAdminSessions,
            adminAuditLog: schema.pgAdminAuditLog,
            errorLogs: schema.pgErrorLogs,
        }}),
        conn: pool
    };
}

let primary;
if (DB_TYPE === 'postgres' && POSTGRES_URL) {
    primary = createPgDb(POSTGRES_URL);
    console.log('Using PostgreSQL database.');
} else {
    primary = createSqliteDb(DB_PATH);
    console.log('Using SQLite database.');
}

export const db = primary.db;
export const conn = primary.conn;

export function getSecondaryDb() {
    if (DB_TYPE === 'postgres') {
        // Primary is PG, secondary is SQLite
        return createSqliteDb(DB_PATH);
    } else if (POSTGRES_URL) {
        // Primary is SQLite, secondary is PG
        return createPgDb(POSTGRES_URL);
    }
    return null;
}

// Initialize SQLite tables if they don't exist (Legacy compatibility)
if (DB_TYPE === 'sqlite') {
    const sqlite = primary.conn as Database.Database;
    sqlite.exec(`CREATE TABLE IF NOT EXISTS providers (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        baseUrl TEXT NOT NULL,
        apiKey TEXT,
        type TEXT DEFAULT 'openai_compatible',
        removeTopP INTEGER DEFAULT 0,
        lastUsedKeyIndex INTEGER DEFAULT 0,
        createdAt TEXT,
        updatedAt TEXT
    )`);

    sqlite.exec(`CREATE TABLE IF NOT EXISTS models (
        id TEXT,
        providerId TEXT,
        name TEXT NOT NULL,
        maxInputTokens INTEGER,
        maxOutputTokens INTEGER,
        pricingModelId TEXT,
        inputPricePer1k REAL DEFAULT 0,
        outputPricePer1k REAL DEFAULT 0,
        isActive INTEGER DEFAULT 1,
        createdAt TEXT,
        updatedAt TEXT,
        PRIMARY KEY (id, providerId),
        FOREIGN KEY(providerId) REFERENCES providers(id) ON DELETE CASCADE
    )`);

    sqlite.exec(`CREATE TABLE IF NOT EXISTS tokens (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        token TEXT NOT NULL,
        createdAt TEXT,
        expiresAt TEXT,
        accessibleModelIds TEXT,
        usageCount INTEGER DEFAULT 0,
        inputTokens INTEGER DEFAULT 0,
        outputTokens INTEGER DEFAULT 0,
        totalCost REAL DEFAULT 0,
        maxTokenUsage INTEGER DEFAULT NULL,
        maxCostUsage REAL DEFAULT NULL,
        isActive INTEGER DEFAULT 1,
        maxRequestsPerDay INTEGER,
        maxRequestsPerMinute INTEGER,
        requestsToday INTEGER DEFAULT 0,
        lastRequestDate TEXT,
        requestsThisMinute INTEGER DEFAULT 0,
        lastRequestMinute TEXT,
        updatedAt TEXT
    )`);

    sqlite.exec(`CREATE TABLE IF NOT EXISTS request_logs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        tokenId TEXT NOT NULL,
        modelId TEXT NOT NULL,
        inputTokens INTEGER DEFAULT 0,
        outputTokens INTEGER DEFAULT 0,
        cost REAL DEFAULT 0,
        timestamp TEXT NOT NULL,
        FOREIGN KEY(tokenId) REFERENCES tokens(id) ON DELETE CASCADE
    )`);

    sqlite.exec(`CREATE TABLE IF NOT EXISTS admin_sessions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        selector TEXT NOT NULL UNIQUE,
        validatorHash TEXT NOT NULL,
        createdAt TEXT NOT NULL,
        lastSeenAt TEXT,
        expiresAt TEXT NOT NULL,
        revokedAt TEXT,
        ip TEXT,
        userAgent TEXT,
        updatedAt TEXT
    )`);

    sqlite.exec(`CREATE TABLE IF NOT EXISTS admin_audit_log (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        timestamp TEXT NOT NULL,
        event TEXT NOT NULL,
        ip TEXT,
        userAgent TEXT,
        details TEXT
    )`);

    sqlite.exec(`CREATE TABLE IF NOT EXISTS error_logs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        tokenId TEXT,
        modelId TEXT,
        providerId TEXT,
        errorType TEXT,
        errorMessage TEXT,
        timestamp TEXT NOT NULL,
        FOREIGN KEY(tokenId) REFERENCES tokens(id) ON DELETE SET NULL
    )`);
}

export const dbReady = Promise.resolve();

export default db;
