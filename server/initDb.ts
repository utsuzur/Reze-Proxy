import { db, conn, DbType } from './db.ts';
import * as schema from './schema.ts';
import { sql } from 'drizzle-orm';

const DB_TYPE = process.env.DB_TYPE || 'sqlite';

export async function initializeSchemas() {
    console.log(`Checking schema initialization for ${DB_TYPE}...`);

    if (DB_TYPE === 'sqlite') {
        const sqlite = conn as any; // better-sqlite3 instance
        sqlite.exec(`
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
        console.log('SQLite schema checked/initialized.');
    }

    if (DB_TYPE === 'postgres') {
        try {
            // Check if a known table exists
            const tableExists = await (db as any).execute(sql`
                SELECT EXISTS (
                    SELECT FROM information_schema.tables 
                    WHERE table_name = 'providers'
                );
            `);

            if (!tableExists.rows[0].exists) {
                console.log('PostgreSQL tables missing. Initializing schema...');
                
                // providers
                await (db as any).execute(sql`
                    CREATE TABLE IF NOT EXISTS providers (
                        id TEXT PRIMARY KEY,
                        name TEXT NOT NULL,
                        baseUrl TEXT NOT NULL,
                        apiKey TEXT,
                        type TEXT DEFAULT 'openai_compatible',
                        removeTopP INTEGER DEFAULT 0,
                        lastUsedKeyIndex INTEGER DEFAULT 0,
                        "createdAt" TIMESTAMP DEFAULT NOW(),
                        "updatedAt" TIMESTAMP DEFAULT NOW()
                    )
                `);

                // models
                await (db as any).execute(sql`
                    CREATE TABLE IF NOT EXISTS models (
                        id TEXT NOT NULL,
                        providerId TEXT NOT NULL,
                        name TEXT NOT NULL,
                        maxInputTokens INTEGER,
                        maxOutputTokens INTEGER,
                        pricingModelId TEXT,
                        inputPricePer1k REAL DEFAULT 0,
                        outputPricePer1k REAL DEFAULT 0,
                        isActive INTEGER DEFAULT 1,
                        "createdAt" TIMESTAMP DEFAULT NOW(),
                        "updatedAt" TIMESTAMP DEFAULT NOW(),
                        PRIMARY KEY (id, providerId),
                        FOREIGN KEY(providerId) REFERENCES providers(id) ON DELETE CASCADE
                    )
                `);

                // tokens
                await (db as any).execute(sql`
                    CREATE TABLE IF NOT EXISTS tokens (
                        id TEXT PRIMARY KEY,
                        name TEXT NOT NULL,
                        token TEXT NOT NULL,
                        "createdAt" TIMESTAMP DEFAULT NOW(),
                        "expiresAt" TIMESTAMP,
                        accessibleModelIds TEXT,
                        usageCount INTEGER DEFAULT 0,
                        inputTokens INTEGER DEFAULT 0,
                        outputTokens INTEGER DEFAULT 0,
                        totalCost REAL DEFAULT 0,
                        maxTokenUsage INTEGER,
                        maxCostUsage REAL,
                        isActive INTEGER DEFAULT 1,
                        maxRequestsPerDay INTEGER,
                        maxRequestsPerMinute INTEGER,
                        requestsToday INTEGER DEFAULT 0,
                        lastRequestDate TEXT,
                        requestsThisMinute INTEGER DEFAULT 0,
                        lastRequestMinute TEXT,
                        "updatedAt" TIMESTAMP DEFAULT NOW()
                    )
                `);

                // request_logs
                await (db as any).execute(sql`
                    CREATE TABLE IF NOT EXISTS request_logs (
                        id SERIAL PRIMARY KEY,
                        tokenId TEXT NOT NULL,
                        modelId TEXT NOT NULL,
                        inputTokens INTEGER DEFAULT 0,
                        outputTokens INTEGER DEFAULT 0,
                        cost REAL DEFAULT 0,
                        timestamp TIMESTAMP DEFAULT NOW()
                    )
                `);

                // admin_sessions
                await (db as any).execute(sql`
                    CREATE TABLE IF NOT EXISTS admin_sessions (
                        id SERIAL PRIMARY KEY,
                        selector TEXT NOT NULL UNIQUE,
                        validatorHash TEXT NOT NULL,
                        "createdAt" TIMESTAMP DEFAULT NOW(),
                        "lastSeenAt" TIMESTAMP,
                        "expiresAt" TIMESTAMP NOT NULL,
                        "revokedAt" TIMESTAMP,
                        ip TEXT,
                        userAgent TEXT,
                        "updatedAt" TIMESTAMP DEFAULT NOW()
                    )
                `);

                // admin_audit_log
                await (db as any).execute(sql`
                    CREATE TABLE IF NOT EXISTS admin_audit_log (
                        id SERIAL PRIMARY KEY,
                        timestamp TIMESTAMP DEFAULT NOW(),
                        event TEXT NOT NULL,
                        ip TEXT,
                        userAgent TEXT,
                        details TEXT
                    )
                `);

                // error_logs
                await (db as any).execute(sql`
                    CREATE TABLE IF NOT EXISTS error_logs (
                        id SERIAL PRIMARY KEY,
                        tokenId TEXT,
                        modelId TEXT,
                        providerId TEXT,
                        errorType TEXT,
                        errorMessage TEXT,
                        timestamp TIMESTAMP DEFAULT NOW()
                    )
                `);

                console.log('PostgreSQL schema initialized successfully.');
            } else {
                console.log('PostgreSQL schema already exists.');
            }
        } catch (err) {
            console.error('Failed to initialize PostgreSQL schema:', err);
            throw err;
        }
    }
}
