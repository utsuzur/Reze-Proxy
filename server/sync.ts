import { db, getSecondaryDb } from './db.ts';
import * as schema from './schema.ts';
import { eq, and, sql } from 'drizzle-orm';

const DB_TYPE = process.env.DB_TYPE || 'sqlite';

async function syncTable(tableName: string, primaryDb: any, secondaryDb: any, primaryTable: any, secondaryTable: any, idField: string = 'id', hasUpdatedAt: boolean = true) {
    console.log(`Syncing table: ${tableName}...`);
    
    const primaryData = await primaryDb.select().from(primaryTable);
    const secondaryData = await secondaryDb.select().from(secondaryTable);

    const primaryMap = new Map(primaryData.map((item: any) => [item[idField], item]));
    const secondaryMap = new Map(secondaryData.map((item: any) => [item[idField], item]));

    const allIds = new Set([...primaryMap.keys(), ...secondaryMap.keys()]);
    let syncCount = 0;

    for (const id of allIds) {
        const pItem = primaryMap.get(id) as any;
        const sItem = secondaryMap.get(id) as any;

        if (!pItem && sItem) {
            // Missing in primary, add it
            await primaryDb.insert(primaryTable).values(sItem);
            syncCount++;
        } else if (pItem && !sItem) {
            // Missing in secondary, add it
            await secondaryDb.insert(secondaryTable).values(pItem);
            syncCount++;
        } else if (pItem && sItem && hasUpdatedAt) {
            // Both exist, check updatedAt
            const pUpdate = new Date(pItem.updatedAt || 0).getTime();
            const sUpdate = new Date(sItem.updatedAt || 0).getTime();

            if (pUpdate > sUpdate) {
                // Primary is newer, update secondary
                await secondaryDb.update(secondaryTable).set(pItem).where(eq(secondaryTable[idField], id));
                syncCount++;
            } else if (sUpdate > pUpdate) {
                // Secondary is newer, update primary
                await primaryDb.update(primaryTable).set(sItem).where(eq(primaryTable[idField], id));
                syncCount++;
            }
        }
    }
    
    if (syncCount > 0) {
        console.log(`Synced ${syncCount} records for ${tableName}.`);
    }
}

// Special sync for models (composite primary key)
async function syncModels(primaryDb: any, secondaryDb: any, primaryTable: any, secondaryTable: any) {
    console.log(`Syncing table: models...`);
    const primaryData = await primaryDb.select().from(primaryTable);
    const secondaryData = await secondaryDb.select().from(secondaryTable);

    const getKey = (item: any) => `${item.id}:${item.providerId}`;
    const primaryMap = new Map(primaryData.map((item: any) => [getKey(item), item]));
    const secondaryMap = new Map(secondaryData.map((item: any) => [getKey(item), item]));

    const allKeys = new Set([...primaryMap.keys(), ...secondaryMap.keys()]);
    let syncCount = 0;

    for (const key of allKeys) {
        const pItem = primaryMap.get(key) as any;
        const sItem = secondaryMap.get(key) as any;

        if (!pItem && sItem) {
            await primaryDb.insert(primaryTable).values(sItem);
            syncCount++;
        } else if (pItem && !sItem) {
            await secondaryDb.insert(secondaryTable).values(pItem);
            syncCount++;
        } else if (pItem && sItem) {
            const pUpdate = new Date(pItem.updatedAt || 0).getTime();
            const sUpdate = new Date(sItem.updatedAt || 0).getTime();

            if (pUpdate > sUpdate) {
                await secondaryDb.update(secondaryTable).set(pItem).where(and(eq(secondaryTable.id, pItem.id), eq(secondaryTable.providerId, pItem.providerId)));
                syncCount++;
            } else if (sUpdate > pUpdate) {
                await primaryDb.update(primaryTable).set(sItem).where(and(eq(primaryTable.id, sItem.id), eq(primaryTable.providerId, sItem.providerId)));
                syncCount++;
            }
        }
    }
    if (syncCount > 0) console.log(`Synced ${syncCount} models.`);
}

export async function syncDatabases() {
    const secondary = getSecondaryDb();
    if (!secondary) {
        console.log("Secondary database not configured, skipping sync.");
        return;
    }

    try {
        const sDb = secondary.db;
        
        // Map tables for Drizzle (based on DB_TYPE)
        const isPrimaryPg = DB_TYPE === 'postgres';
        
        const pProviders = isPrimaryPg ? schema.pgProviders : schema.sqliteProviders;
        const sProviders = isPrimaryPg ? schema.sqliteProviders : schema.pgProviders;
        
        const pModels = isPrimaryPg ? schema.pgModels : schema.sqliteModels;
        const sModels = isPrimaryPg ? schema.sqliteModels : schema.pgModels;
        
        const pTokens = isPrimaryPg ? schema.pgTokens : schema.sqliteTokens;
        const sTokens = isPrimaryPg ? schema.sqliteTokens : schema.pgTokens;
        
        const pAdminSessions = isPrimaryPg ? schema.pgAdminSessions : schema.sqliteAdminSessions;
        const sAdminSessions = isPrimaryPg ? schema.sqliteAdminSessions : schema.pgAdminSessions;

        const pRequestLogs = isPrimaryPg ? schema.pgRequestLogs : schema.sqliteRequestLogs;
        const sRequestLogs = isPrimaryPg ? schema.sqliteRequestLogs : schema.pgRequestLogs;

        const pAdminAuditLog = isPrimaryPg ? schema.pgAdminAuditLog : schema.sqliteAdminAuditLog;
        const sAdminAuditLog = isPrimaryPg ? schema.sqliteAdminAuditLog : schema.pgAdminAuditLog;

        const pErrorLogs = isPrimaryPg ? schema.pgErrorLogs : schema.sqliteErrorLogs;
        const sErrorLogs = isPrimaryPg ? schema.sqliteErrorLogs : schema.pgErrorLogs;

        await syncTable('providers', db, sDb, pProviders, sProviders, 'id', true);
        await syncModels(db, sDb, pModels, sModels);
        await syncTable('tokens', db, sDb, pTokens, sTokens, 'id', true);
        await syncTable('admin_sessions', db, sDb, pAdminSessions, sAdminSessions, 'id', true);
        
        // Logs (only sync missing ones based on ID for simplicity, or skip if too large)
        // Note: serial IDs might not align perfectly between DBs if they started at different times
        // but for now, we'll try to sync them.
        await syncTable('request_logs', db, sDb, pRequestLogs, sRequestLogs, 'id', false);
        await syncTable('admin_audit_log', db, sDb, pAdminAuditLog, sAdminAuditLog, 'id', false);
        await syncTable('error_logs', db, sDb, pErrorLogs, sErrorLogs, 'id', false);

        console.log("Database synchronization complete.");
    } catch (err) {
        console.error("Database synchronization failed:", err);
    } finally {
        // If secondary was SQLite, we should probably close the connection
        if (DB_TYPE === 'postgres' && (secondary as any).conn) {
            (secondary as any).conn.close();
        }
    }
}
