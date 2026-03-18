import { db, conn, getSecondaryDb } from './db.ts';
import type { DbType } from './db.ts';
import * as schema from './schema.ts';
import { sql } from 'drizzle-orm';

const DB_TYPE = process.env.DB_TYPE || 'sqlite';

async function initializeTableSchema(database: any, connection: any, type: string) {
    console.log(`Checking schema initialization for ${type}...`);

    if (type === 'sqlite') {
        const sqlite = connection as any; // better-sqlite3 instance
        sqlite.exec(`
            CREATE TABLE IF NOT EXISTS sync_state (
                id TEXT PRIMARY KEY,
                lastUpdatedAt TEXT
            );

            CREATE TABLE IF NOT EXISTS providers (
                id TEXT PRIMARY KEY,
                name TEXT NOT NULL,
                baseUrl TEXT NOT NULL,
                apiKey TEXT,
                type TEXT DEFAULT 'openai_compatible',
                removeTopP INTEGER DEFAULT 0,
                lastUsedKeyIndex INTEGER DEFAULT 0,
                createdAt TEXT,
                updatedAt TEXT
            );

            CREATE TABLE IF NOT EXISTS models (
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
            );

            CREATE TABLE IF NOT EXISTS tokens (
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
                tokenType TEXT DEFAULT 'rpd',
                creditBalance REAL DEFAULT 0,
                updatedAt TEXT
            );

            CREATE TABLE IF NOT EXISTS request_logs (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                tokenId TEXT NOT NULL,
                modelId TEXT NOT NULL,
                inputTokens INTEGER DEFAULT 0,
                outputTokens INTEGER DEFAULT 0,
                cost REAL DEFAULT 0,
                timestamp TEXT NOT NULL,
                FOREIGN KEY(tokenId) REFERENCES tokens(id) ON DELETE CASCADE
            );

            CREATE TABLE IF NOT EXISTS admin_sessions (
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
            );

            CREATE TABLE IF NOT EXISTS admin_audit_log (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                timestamp TEXT NOT NULL,
                event TEXT NOT NULL,
                ip TEXT,
                userAgent TEXT,
                details TEXT
            );

            CREATE TABLE IF NOT EXISTS error_logs (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                tokenId TEXT,
                modelId TEXT,
                providerId TEXT,
                errorType TEXT,
                errorMessage TEXT,
                timestamp TEXT NOT NULL,
                FOREIGN KEY(tokenId) REFERENCES tokens(id) ON DELETE SET NULL
            );
        `);

        // Migration: Add columns if they don't exist
        try { sqlite.exec("ALTER TABLE tokens ADD COLUMN tokenType TEXT DEFAULT 'rpd'"); } catch(e) {}
        try { sqlite.exec("ALTER TABLE tokens ADD COLUMN creditBalance REAL DEFAULT 0"); } catch(e) {}

        console.log('SQLite schema checked/initialized.');
    }

    if (type === 'postgres') {
        try {
            // Check if a known table exists
            const tableExists = await (database as any).execute(sql`
                SELECT EXISTS (
                    SELECT FROM information_schema.tables 
                    WHERE table_name = 'providers'
                );
            `);

            if (!tableExists.rows[0].exists) {
                console.log('PostgreSQL tables missing. Initializing schema...');
                
                // sync_state
                await (database as any).execute(sql`
                    CREATE TABLE IF NOT EXISTS sync_state (
                        id TEXT PRIMARY KEY,
                        "lastUpdatedAt" TIMESTAMP DEFAULT NOW()
                    )
                `);

                // providers
                await (database as any).execute(sql`
                    CREATE TABLE IF NOT EXISTS providers (
                        id TEXT PRIMARY KEY,
                        name TEXT NOT NULL,
                        baseurl TEXT NOT NULL,
                        apikey TEXT,
                        type TEXT DEFAULT 'openai_compatible',
                        removetopp INTEGER DEFAULT 0,
                        lastusedkeyindex INTEGER DEFAULT 0,
                        "createdAt" TIMESTAMP DEFAULT NOW(),
                        "updatedAt" TIMESTAMP DEFAULT NOW()
                    )
                `);

                // models
                await (database as any).execute(sql`
                    CREATE TABLE IF NOT EXISTS models (
                        id TEXT NOT NULL,
                        providerid TEXT NOT NULL,
                        name TEXT NOT NULL,
                        maxinputtokens INTEGER,
                        maxoutputtokens INTEGER,
                        pricingmodelid TEXT,
                        inputpriceper1k REAL DEFAULT 0,
                        outputpriceper1k REAL DEFAULT 0,
                        isactive INTEGER DEFAULT 1,
                        "createdAt" TIMESTAMP DEFAULT NOW(),
                        "updatedAt" TIMESTAMP DEFAULT NOW(),
                        PRIMARY KEY (id, providerid),
                        FOREIGN KEY(providerid) REFERENCES providers(id) ON DELETE CASCADE
                    )
                `);

                // tokens
                await (database as any).execute(sql`
                    CREATE TABLE IF NOT EXISTS tokens (
                        id TEXT PRIMARY KEY,
                        name TEXT NOT NULL,
                        token TEXT NOT NULL,
                        "createdAt" TIMESTAMP DEFAULT NOW(),
                        "expiresAt" TIMESTAMP,
                        accessiblemodelids TEXT,
                        usagecount INTEGER DEFAULT 0,
                        inputtokens INTEGER DEFAULT 0,
                        outputtokens INTEGER DEFAULT 0,
                        totalcost REAL DEFAULT 0,
                        maxtokenusage INTEGER,
                        maxcostusage REAL,
                        isactive INTEGER DEFAULT 1,
                        maxrequestsperday INTEGER,
                        maxrequestsperminute INTEGER,
                        requeststoday INTEGER DEFAULT 0,
                        lastrequestdate TEXT,
                        requeststhisminute INTEGER DEFAULT 0,
                        lastrequestminute TEXT,
                        tokentype TEXT DEFAULT 'rpd',
                        creditbalance REAL DEFAULT 0,
                        "updatedAt" TIMESTAMP DEFAULT NOW()
                    )
                `);

                // request_logs
                await (database as any).execute(sql`
                    CREATE TABLE IF NOT EXISTS request_logs (
                        id SERIAL PRIMARY KEY,
                        tokenid TEXT NOT NULL,
                        modelid TEXT NOT NULL,
                        inputtokens INTEGER DEFAULT 0,
                        outputtokens INTEGER DEFAULT 0,
                        cost REAL DEFAULT 0,
                        timestamp TIMESTAMP DEFAULT NOW()
                    )
                `);

                // admin_sessions
                await (database as any).execute(sql`
                    CREATE TABLE IF NOT EXISTS admin_sessions (
                        id SERIAL PRIMARY KEY,
                        selector TEXT NOT NULL UNIQUE,
                        validatorhash TEXT NOT NULL,
                        "createdAt" TIMESTAMP DEFAULT NOW(),
                        "lastSeenAt" TIMESTAMP,
                        "expiresAt" TIMESTAMP NOT NULL,
                        "revokedAt" TIMESTAMP,
                        ip TEXT,
                        useragent TEXT,
                        "updatedAt" TIMESTAMP DEFAULT NOW()
                    )
                `);

                // admin_audit_log
                await (database as any).execute(sql`
                    CREATE TABLE IF NOT EXISTS admin_audit_log (
                        id SERIAL PRIMARY KEY,
                        timestamp TIMESTAMP DEFAULT NOW(),
                        event TEXT NOT NULL,
                        ip TEXT,
                        useragent TEXT,
                        details TEXT
                    )
                `);

                // error_logs
                await (database as any).execute(sql`
                    CREATE TABLE IF NOT EXISTS error_logs (
                        id SERIAL PRIMARY KEY,
                        tokenid TEXT,
                        modelid TEXT,
                        providerid TEXT,
                        errortype TEXT,
                        errormessage TEXT,
                        timestamp TIMESTAMP DEFAULT NOW()
                    )
                `);

                console.log('PostgreSQL schema initialized successfully.');
            } else {
                console.log('PostgreSQL schema already exists. Checking for missing columns...');
                
                // Migration for existing Postgres tables
                try { await (database as any).execute(sql`ALTER TABLE tokens ADD COLUMN IF NOT EXISTS tokentype TEXT DEFAULT 'rpd'`); } catch(e) {}
                try { await (database as any).execute(sql`ALTER TABLE tokens ADD COLUMN IF NOT EXISTS creditbalance REAL DEFAULT 0`); } catch(e) {}
                try { await (database as any).execute(sql`CREATE TABLE IF NOT EXISTS sync_state (id TEXT PRIMARY KEY, "lastUpdatedAt" TIMESTAMP DEFAULT NOW())`); } catch(e) {}
            }
        } catch (err) {
            console.error('Failed to initialize PostgreSQL schema:', err);
            throw err;
        }
    }
}

export async function initializeSchemas() {
    // Initialize primary DB
    await initializeTableSchema(db, conn, DB_TYPE);

    // If sync is enabled, also initialize secondary DB
    if (process.env.DB_SYNC_ON_STARTUP === 'true') {
        const secondary = getSecondaryDb();
        if (secondary) {
            console.log("Initializing secondary database schema...");
            const secondaryType = DB_TYPE === 'postgres' ? 'sqlite' : 'postgres';
            await initializeTableSchema(secondary.db, secondary.conn, secondaryType);
            
            // If secondary was Postgres, we should close the pool we just created to avoid leaks
            // but sync.ts will create its own. For simplicity, we can let it be or close it.
            if (secondaryType === 'postgres') {
                (secondary.conn as any).end();
            } else {
                (secondary.conn as any).close();
            }
        }
    }
}
