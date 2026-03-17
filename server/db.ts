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

// Export current DB type for other modules
export const DB_TYPE_ENV = DB_TYPE;

export const dbReady = Promise.resolve();

export default db;
