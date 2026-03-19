import { db, getSecondaryDb, conn, updateSyncState } from './db.ts';
import * as schema from './schema.ts';
import { eq, and, sql, inArray } from 'drizzle-orm';

const DB_TYPE = process.env.DB_TYPE || 'sqlite';

/**
 * Gets the maximum timestamp value from a set of tables to determine "freshness"
 * Now also checks the dedicated sync_state table.
 */
async function getMaxTimestamp(dbInstance: any, tableConfigs: { table: any, field: string }[], syncStateTable: any) {
    let maxTs = 0;
    
    // 1. Check dedicated sync_state table (Most reliable for deletions)
    try {
        const state = await dbInstance.select().from(syncStateTable).where(eq(syncStateTable.id, 'global'));
        if (state[0]?.lastUpdatedAt) {
            maxTs = new Date(state[0].lastUpdatedAt).getTime();
        }
    } catch (e) {}

    // 2. Check all other tables as fallback/safety
    for (const config of tableConfigs) {
        try {
            const result = await dbInstance.select({ 
                maxVal: sql`max(${sql.raw(config.field)})` 
            }).from(config.table);
            
            const val = result[0]?.maxVal;
            if (val) {
                const ts = new Date(val).getTime();
                if (ts > maxTs) maxTs = ts;
            }
        } catch (e) {
            // Silently ignore if table/field missing (schema divergence)
        }
    }
    return maxTs;
}

/**
 * Mirror sourceTable to targetTable - Phase 1: Upsert (Insert or Update)
 */
async function mirrorUpsert(
    tableName: string, 
    sourceDb: any, 
    targetDb: any, 
    sourceTable: any, 
    targetTable: any, 
    idFields: string[] = ['id']
) {
    const sourceData = await sourceDb.select().from(sourceTable);
    const targetData = await targetDb.select().from(targetTable);

    const getKeys = (item: any) => idFields.map(f => item[f]).join(':');
    const targetMap = new Map(targetData.map((item: any) => [getKeys(item), item]));

    let insertCount = 0;
    let updateCount = 0;

    const itemsToInsert: any[] = [];

    for (const sItem of sourceData) {
        // Sanitize item: replace null/undefined numeric fields with 0
        const sanitizedItem = { ...sItem };
        if (tableName === 'request_logs' || tableName === 'tokens' || tableName === 'models' || tableName === 'providers') {
            const numericFields = ['cost', 'inputTokens', 'outputTokens', 'usageCount', 'inputPricePer1k', 'outputPricePer1k', 'creditBalance', 'removeTopP', 'lastUsedKeyIndex'];
            for (const field of numericFields) {
                if (Object.prototype.hasOwnProperty.call(sanitizedItem, field) && (sanitizedItem[field] === null || sanitizedItem[field] === undefined)) {
                    sanitizedItem[field] = 0;
                }
            }
        }

        const key = getKeys(sItem);
        const tItem = targetMap.get(key);
        
        if (!tItem) {
            itemsToInsert.push(sanitizedItem);
        } else {
            let changed = true;
            if (sItem.updatedAt && tItem.updatedAt) {
                changed = new Date(sItem.updatedAt).getTime() !== new Date(tItem.updatedAt).getTime();
            } else if (sItem.timestamp && tItem.timestamp) {
                changed = new Date(sItem.timestamp).getTime() !== new Date(tItem.timestamp).getTime();
            } else if (sItem.lastUpdatedAt && tItem.lastUpdatedAt) {
                changed = new Date(sItem.lastUpdatedAt).getTime() !== new Date(tItem.lastUpdatedAt).getTime();
            }

            if (changed) {
                let whereClause;
                if (idFields.length === 1) {
                    whereClause = eq(targetTable[idFields[0]], sItem[idFields[0]]);
                } else {
                    whereClause = and(...idFields.map(f => eq(targetTable[f], sItem[f])));
                }
                await targetDb.update(targetTable).set(sanitizedItem).where(whereClause);
                updateCount++;
            }
        }
    }

    // Batch Insert (much faster)
    if (itemsToInsert.length > 0) {
        // SQLite has a limit on the number of variables in a single query (default 999 or 32766 depending on version)
        // We chunk the inserts to be safe.
        const CHUNK_SIZE = 50; 
        for (let i = 0; i < itemsToInsert.length; i += CHUNK_SIZE) {
            const chunk = itemsToInsert.slice(i, i + CHUNK_SIZE);
            try {
                await targetDb.insert(targetTable).values(chunk);
                insertCount += chunk.length;
            } catch (err: any) {
                // Fallback to individual inserts if batch fails (e.g. unique constraint in one item)
                for (const item of chunk) {
                    try {
                        await targetDb.insert(targetTable).values(item);
                        insertCount++;
                    } catch (singleErr: any) {
                        if (singleErr.message?.includes('UNIQUE') && tableName === 'providers') {
                            const whereClause = eq(targetTable.name, item.name);
                            await targetDb.update(targetTable).set(item).where(whereClause);
                            updateCount++;
                        } else if (singleErr.message?.includes('UNIQUE') && idFields.length === 1) {
                            const whereClause = eq(targetTable[idFields[0]], item[idFields[0]]);
                            await targetDb.update(targetTable).set(item).where(whereClause);
                            updateCount++;
                        }
                    }
                }
            }
        }
    }

    return { insertCount, updateCount };
}

/**
 * Mirror sourceTable to targetTable - Phase 2: Delete
 */
async function mirrorDelete(
    tableName: string, 
    sourceDb: any, 
    targetDb: any, 
    sourceTable: any, 
    targetTable: any, 
    idFields: string[] = ['id']
) {
    const sourceData = await sourceDb.select().from(sourceTable);
    const targetData = await targetDb.select().from(targetTable);

    const getKeys = (item: any) => idFields.map(f => item[f]).join(':');
    const sourceMap = new Map(sourceData.map((item: any) => [getKeys(item), item]));

    let deleteCount = 0;
    const idsToDelete: any[] = [];

    for (const tItem of targetData) {
        const key = getKeys(tItem);
        if (!sourceMap.has(key)) {
            if (idFields.length === 1) {
                idsToDelete.push(tItem[idFields[0]]);
            } else {
                // Complex PK - unfortunately we still have to delete one by one or use a complex WHERE
                let whereClause = and(...idFields.map(f => eq(targetTable[f], tItem[f])));
                await targetDb.delete(targetTable).where(whereClause);
                deleteCount++;
            }
        }
    }

    // Batch delete for simple PKs
    if (idsToDelete.length > 0) {
        const CHUNK_SIZE = 100;
        for (let i = 0; i < idsToDelete.length; i += CHUNK_SIZE) {
            const chunk = idsToDelete.slice(i, i + CHUNK_SIZE);
            await targetDb.delete(targetTable).where(inArray(targetTable[idFields[0]], chunk));
            deleteCount += chunk.length;
        }
    }

    return { deleteCount };
}

export async function syncDatabases() {
    const secondary = getSecondaryDb();
    if (!secondary) {
        console.log("Secondary database not configured, skipping sync.");
        return;
    }

    try {
        const sDb = secondary.db;
        const isPrimaryPg = DB_TYPE === 'postgres';
        
        // Define table mappings in dependency order
        const tablePairs = [
            { 
                name: 'sync_state', 
                pTable: isPrimaryPg ? schema.pgSyncState : schema.sqliteSyncState,
                sTable: isPrimaryPg ? schema.sqliteSyncState : schema.pgSyncState,
                ids: ['id'],
                updateField: 'lastUpdatedAt'
            },
            { 
                name: 'providers', 
                pTable: isPrimaryPg ? schema.pgProviders : schema.sqliteProviders,
                sTable: isPrimaryPg ? schema.sqliteProviders : schema.pgProviders,
                ids: ['id'],
                updateField: 'updatedAt'
            },
            { 
                name: 'tokens', 
                pTable: isPrimaryPg ? schema.pgTokens : schema.sqliteTokens,
                sTable: isPrimaryPg ? schema.sqliteTokens : schema.pgTokens,
                ids: ['id'],
                updateField: 'updatedAt'
            },
            { 
                name: 'models', 
                pTable: isPrimaryPg ? schema.pgModels : schema.sqliteModels,
                sTable: isPrimaryPg ? schema.sqliteModels : schema.pgModels,
                ids: ['id', 'providerId'],
                updateField: 'updatedAt'
            },
            { 
                name: 'admin_sessions', 
                pTable: isPrimaryPg ? schema.pgAdminSessions : schema.sqliteAdminSessions,
                sTable: isPrimaryPg ? schema.sqliteAdminSessions : schema.pgAdminSessions,
                ids: ['id'],
                updateField: 'updatedAt'
            },
            { 
                name: 'request_logs', 
                pTable: isPrimaryPg ? schema.pgRequestLogs : schema.sqliteRequestLogs,
                sTable: isPrimaryPg ? schema.sqliteRequestLogs : schema.pgRequestLogs,
                ids: ['id'],
                updateField: 'timestamp'
            },
            { 
                name: 'admin_audit_log', 
                pTable: isPrimaryPg ? schema.pgAdminAuditLog : schema.sqliteAdminAuditLog,
                sTable: isPrimaryPg ? schema.sqliteAdminAuditLog : schema.pgAdminAuditLog,
                ids: ['id'],
                updateField: 'timestamp'
            },
            { 
                name: 'error_logs', 
                pTable: isPrimaryPg ? schema.pgErrorLogs : schema.sqliteErrorLogs,
                sTable: isPrimaryPg ? schema.sqliteErrorLogs : schema.pgErrorLogs,
                ids: ['id'],
                updateField: 'timestamp'
            }
        ];

        const pSyncTable = isPrimaryPg ? schema.pgSyncState : schema.sqliteSyncState;
        const sSyncTable = isPrimaryPg ? schema.sqliteSyncState : schema.pgSyncState;

        // 1. Determine Freshness
        const localMax = await getMaxTimestamp(db, tablePairs.map(tp => ({ table: tp.pTable, field: tp.updateField })), pSyncTable);
        console.log(`Checking remote database freshness...`);
        const remoteMax = await getMaxTimestamp(sDb, tablePairs.map(tp => ({ table: tp.sTable, field: tp.updateField })), sSyncTable);

        console.log(`Freshness check: Local=${new Date(localMax).toISOString()}, Remote=${new Date(remoteMax).toISOString()}`);

        if (localMax === 0 && remoteMax === 0) {
            console.log("Both databases are empty, nothing to sync.");
            return;
        }

        if (localMax === remoteMax && localMax !== 0) {
            console.log("Databases are already in sync (timestamps match exactly). Skipping...");
            return;
        }

        // 2. Set Direction (Latest Wins)
        let sourceDb, targetDb;
        let pToS = true;

        if (localMax >= remoteMax) {
            console.log("Local database is newer. Syncing Local -> Remote...");
            sourceDb = db;
            targetDb = sDb;
            pToS = true;
        } else {
            console.log("Remote database is newer. Syncing Remote -> Local...");
            sourceDb = sDb;
            targetDb = db;
            pToS = false;
        }

        // 3. Temporarily disable foreign keys for SQLite if it's the target
        const isTargetSqlite = pToS ? !isPrimaryPg : isPrimaryPg;
        const targetConn = pToS ? secondary.conn : conn;
        
        if (isTargetSqlite) {
            try { (targetConn as any).exec('PRAGMA foreign_keys = OFF'); } catch(e) {}
        }

        try {
            // Phase 1: Upserts (Forward order)
            for (const tp of tablePairs) {
                const sourceTable = pToS ? tp.pTable : tp.sTable;
                const targetTable = pToS ? tp.sTable : tp.pTable;
                const { insertCount, updateCount } = await mirrorUpsert(tp.name, sourceDb, targetDb, sourceTable, targetTable, tp.ids);
                if (insertCount > 0 || updateCount > 0) {
                    console.log(`Synced ${tp.name} (Upsert): ${insertCount} ins, ${updateCount} upd.`);
                }
            }

            // Phase 2: Deletes (Reverse order)
            for (const tp of [...tablePairs].reverse()) {
                const sourceTable = pToS ? tp.pTable : tp.sTable;
                const targetTable = pToS ? tp.sTable : tp.pTable;
                const { deleteCount } = await mirrorDelete(tp.name, sourceDb, targetDb, sourceTable, targetTable, tp.ids);
                if (deleteCount > 0) {
                    console.log(`Synced ${tp.name} (Delete): ${deleteCount} del.`);
                }
            }
            
            // 4. Ensure sync_state is updated on BOTH databases to match the latest record
            const finalMax = Math.max(localMax, remoteMax);
            const now = new Date(finalMax).toISOString();
            
            const updateState = async (dbInstance: any, table: any) => {
                try {
                    await dbInstance.insert(table)
                        .values({ id: 'global', lastUpdatedAt: now })
                        .onConflictDoUpdate({
                            target: table.id,
                            set: { lastUpdatedAt: now }
                        });
                } catch (e) {
                    try {
                        const result = await dbInstance.update(table).set({ lastUpdatedAt: now }).where(eq(table.id, 'global'));
                        if (result.changes === 0) {
                             await dbInstance.insert(table).values({ id: 'global', lastUpdatedAt: now });
                        }
                    } catch (e2) {}
                }
            };

            await updateState(sourceDb, pToS ? pSyncTable : sSyncTable);
            await updateState(targetDb, pToS ? sSyncTable : pSyncTable);
            
        } finally {
            if (isTargetSqlite) {
                try { (targetConn as any).exec('PRAGMA foreign_keys = ON'); } catch(e) {}
            }
        }

        console.log("Database synchronization complete.");
    } catch (err) {
        console.error("Database synchronization failed:", err);
    } finally {
        if (DB_TYPE === 'postgres' && (secondary as any).conn && (secondary as any).conn.close) {
            (secondary as any).conn.close();
        } else if (DB_TYPE === 'sqlite' && (secondary as any).conn && (secondary as any).conn.end) {
            (secondary as any).conn.end();
        }
    }
}
