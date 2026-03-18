import 'dotenv/config';
import { drizzle as drizzleSqlite } from 'drizzle-orm/better-sqlite3';
import { drizzle as drizzlePg } from 'drizzle-orm/node-postgres';
import Database from 'better-sqlite3';
import pg from 'pg';
import * as schema from './schema.ts';
import { eq, sql } from 'drizzle-orm';

const DB_TYPE = process.env.DB_TYPE || 'sqlite';
const DB_PATH = process.env.DB_PATH || './reze.db';
const POSTGRES_URL = process.env.POSTGRES_URL;

export type DbType = 'sqlite' | 'postgres';

function createSqliteDb(path: string) {
    const sqlite = new Database(path);
    return {
        db: drizzleSqlite(sqlite, { schema: {
            syncState: schema.sqliteSyncState,
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
            syncState: schema.pgSyncState,
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

/**
 * Updates the global sync_state timestamp to current time.
 * Should be called after any modification (CUD) operation.
 */
export async function updateSyncState(targetDb: any = db) {
    const now = new Date().toISOString();
    const syncStateTable = DB_TYPE === 'postgres' && targetDb === db ? schema.pgSyncState : schema.sqliteSyncState;
    // Note: This helper might need more complex logic if we want to support both types of DBs flexibly
    // but for now we assume targetDb uses the schema corresponding to its type.
    
    // Determine which schema to use based on targetDb's internal structure or just use a generic approach
    const isPg = targetDb.session && (targetDb.session.constructor.name.includes('Pg') || targetDb.session.constructor.name.includes('NodePostgres'));
    const table = isPg ? schema.pgSyncState : schema.sqliteSyncState;

    try {
        await targetDb.insert(table)
            .values({ id: 'global', lastUpdatedAt: now })
            .onConflictDoUpdate({
                target: table.id,
                set: { lastUpdatedAt: now }
            });
    } catch (e) {
        // Fallback for SQLite which might not support onConflictDoUpdate via drizzle in all versions/configs
        try {
            const result = await targetDb.update(table).set({ lastUpdatedAt: now }).where(eq(table.id, 'global'));
            if (result.changes === 0) {
                 await targetDb.insert(table).values({ id: 'global', lastUpdatedAt: now });
            }
        } catch (e2) {}
    }
}

// Export current DB type for other modules
export const DB_TYPE_ENV = DB_TYPE;

export const dbReady = Promise.resolve();

export default db;
