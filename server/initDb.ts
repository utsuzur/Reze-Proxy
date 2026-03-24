import { db, conn, getSecondaryDb } from './db.ts';
import type { DbType } from './db.ts';
import * as schema from './schema.ts';
import { sql, eq } from 'drizzle-orm';

const DB_TYPE = process.env.DB_TYPE || 'sqlite';

// Helper to get the correct table based on DB_TYPE
const getTable = (tableName: string, type: string) => {
  const prefix = type === 'postgres' ? 'pg' : 'sqlite';
  const key = `${prefix}${tableName.charAt(0).toUpperCase()}${tableName.slice(1)}` as keyof typeof schema;
  return schema[key] as any;
};

async function seedData(database: any, type: string) {
    console.log(`Seeding initial data for ${type}...`);
    
    const providersTable = getTable('providers', type);
    const modelsTable = getTable('models', type);
    const tokensTable = getTable('tokens', type);

    // 1. Seed Providers
    const skipSeeding = process.env.SKIP_SEEDING !== 'false';
    const existingProviders = await database.select().from(providersTable).limit(1);
    
    if (!skipSeeding && existingProviders.length === 0) {
        console.log("  No providers found, seeding defaults...");
        const defaultProviders = [
            {
                id: 'openai',
                name: 'OpenAI',
                baseUrl: 'https://api.openai.com/v1',
                type: 'openai_compatible',
                apiKey: '', // User needs to fill this
                createdAt: new Date().toISOString(),
                updatedAt: new Date().toISOString(),
            },
            {
                id: 'anthropic',
                name: 'Anthropic',
                baseUrl: 'https://api.anthropic.com/v1',
                type: 'anthropic',
                apiKey: '', // User needs to fill this
                createdAt: new Date().toISOString(),
                updatedAt: new Date().toISOString(),
            },
            {
                id: 'groq',
                name: 'Groq',
                baseUrl: 'https://api.groq.com/openai/v1',
                type: 'openai_compatible',
                apiKey: '', // User needs to fill this
                createdAt: new Date().toISOString(),
                updatedAt: new Date().toISOString(),
            }
        ];

        for (const provider of defaultProviders) {
            try {
                await database.insert(providersTable).values(provider);
                console.log(`    Added provider: ${provider.name}`);
            } catch (e) {
                console.error(`    Failed to seed provider ${provider.name}:`, e);
            }
        }

        // 2. Seed Models (only if we seeded providers)
        const defaultModels = [
            // OpenAI
            { id: 'gpt-4o', providerId: 'openai', name: 'GPT-4o', maxInputTokens: 128000, maxOutputTokens: 4096, inputPricePer1k: 0.005, outputPricePer1k: 0.015, isActive: 1 },
            { id: 'gpt-4o-mini', providerId: 'openai', name: 'GPT-4o Mini', maxInputTokens: 128000, maxOutputTokens: 16384, inputPricePer1k: 0.00015, outputPricePer1k: 0.0006, isActive: 1 },
            { id: 'gpt-4-turbo', providerId: 'openai', name: 'GPT-4 Turbo', maxInputTokens: 128000, maxOutputTokens: 4096, inputPricePer1k: 0.01, outputPricePer1k: 0.03, isActive: 1 },
            
            // Anthropic
            { id: 'claude-3-5-sonnet-20240620', providerId: 'anthropic', name: 'Claude 3.5 Sonnet', maxInputTokens: 200000, maxOutputTokens: 8192, inputPricePer1k: 0.003, outputPricePer1k: 0.015, isActive: 1 },
            { id: 'claude-3-opus-20240229', providerId: 'anthropic', name: 'Claude 3 Opus', maxInputTokens: 200000, maxOutputTokens: 4096, inputPricePer1k: 0.015, outputPricePer1k: 0.075, isActive: 1 },
            { id: 'claude-3-haiku-20240307', providerId: 'anthropic', name: 'Claude 3 Haiku', maxInputTokens: 200000, maxOutputTokens: 4096, inputPricePer1k: 0.00025, outputPricePer1k: 0.00125, isActive: 1 },

            // Groq
            { id: 'llama3-70b-8192', providerId: 'groq', name: 'Llama 3 70B', maxInputTokens: 8192, maxOutputTokens: 4096, inputPricePer1k: 0, outputPricePer1k: 0, isActive: 1 },
            { id: 'llama3-8b-8192', providerId: 'groq', name: 'Llama 3 8B', maxInputTokens: 8192, maxOutputTokens: 4096, inputPricePer1k: 0, outputPricePer1k: 0, isActive: 1 },
            { id: 'mixtral-8x7b-32768', providerId: 'groq', name: 'Mixtral 8x7B', maxInputTokens: 32768, maxOutputTokens: 4096, inputPricePer1k: 0, outputPricePer1k: 0, isActive: 1 },
        ];

        for (const model of defaultModels) {
            try {
                await database.insert(modelsTable).values({
                    ...model,
                    createdAt: new Date().toISOString(),
                    updatedAt: new Date().toISOString(),
                });
                console.log(`    Added model: ${model.name} (${model.providerId})`);
            } catch (e) {
                console.error(`    Failed to seed model ${model.name}:`, e);
            }
        }
    } else if (skipSeeding) {
        console.log("  Skipping default seeding as SKIP_SEEDING is enabled.");
    } else {
        console.log("  Providers already exist, skipping default seeding.");
    }

    // 3. Seed an initial Demo Token if none exists
    try {
        const tokens = await database.select().from(tokensTable).limit(1);
        if (!skipSeeding && tokens.length === 0) {
            const demoToken = {
                id: 'demo-token-id',
                name: 'Initial Demo Token',
                token: `reze_${Math.random().toString(36).substring(2, 15)}`,
                createdAt: new Date().toISOString(),
                updatedAt: new Date().toISOString(),
                isActive: 1,
                tokenType: 'rpd',
                tier: 'plus', // Give the demo token 'plus' tier by default for testing
                creditBalance: 10.0, // Give some initial credits
                maxRequestsPerDay: 100,
                accessibleModelIds: '*', // All models
            };
            await database.insert(tokensTable).values(demoToken);
            console.log(`  Added initial demo token: ${demoToken.token}`);
            console.log(`  IMPORTANT: Use this token to test your setup.`);
        }
    } catch (e) {
        console.error('  Failed to seed initial token:', e);
    }

    console.log(`Seeding complete for ${type}.`);
}

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
                tier TEXT DEFAULT 'standard',
                creditBalance REAL DEFAULT 0,
                updatedAt TEXT
            );

            CREATE TABLE IF NOT EXISTS request_logs (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                tokenId TEXT NOT NULL,
                modelId TEXT NOT NULL,
                inputTokens INTEGER DEFAULT 0,
                outputTokens INTEGER DEFAULT 0,
                cacheReadTokens INTEGER DEFAULT 0,
                cacheWriteTokens INTEGER DEFAULT 0,
                cost REAL DEFAULT 0,
                originalCost REAL DEFAULT 0,
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
        const tablesToMigrate = [
            { name: 'providers', columns: ['createdAt', 'updatedAt', 'removeTopP', 'lastUsedKeyIndex'] },
            { name: 'models', columns: ['createdAt', 'updatedAt', 'pricingModelId', 'inputPricePer1k', 'outputPricePer1k', 'isActive'] },
            { name: 'tokens', columns: [
                'createdAt', 'updatedAt', 'tokenType', 'tier', 'creditBalance', 
                'maxRequestsPerDay', 'maxRequestsPerMinute', 'maxTokenUsage', 'maxCostUsage',
                'usageCount', 'inputTokens', 'outputTokens', 'totalCost', 'accessibleModelIds',
                'requestsToday', 'lastRequestDate', 'requestsThisMinute', 'lastRequestMinute'
            ] },
            { name: 'admin_sessions', columns: ['createdAt', 'updatedAt'] },
            { name: 'request_logs', columns: ['tokenId', 'modelId', 'inputTokens', 'outputTokens', 'cacheReadTokens', 'cacheWriteTokens', 'cost', 'originalCost', 'timestamp'] },
            { name: 'error_logs', columns: ['tokenId', 'modelId', 'providerId', 'errorType', 'errorMessage', 'timestamp'] },
            { name: 'admin_audit_log', columns: ['timestamp', 'event', 'ip', 'userAgent', 'details'] }
        ];

        for (const table of tablesToMigrate) {
            for (const column of table.columns) {
                try {
                    // Check if column exists by trying to select it
                    sqlite.prepare(`SELECT ${column} FROM ${table.name} LIMIT 0`).run();
                } catch (e: any) {
                    if (e.message.includes('no such column')) {
                        try {
                            const type = column.toLowerCase().includes('price') || column.toLowerCase().includes('balance') || column.toLowerCase().includes('cost') ? 'REAL' : 
                                         column.toLowerCase().includes('index') || column.toLowerCase().includes('count') || column.toLowerCase().includes('tokens') || column.toLowerCase().includes('topp') || column.toLowerCase().includes('active') ? 'INTEGER' : 'TEXT';
                            
                            let colDef = `${column} ${type}`;
                            if (column === 'tokenType') colDef = "tokenType TEXT DEFAULT 'rpd'";
                            if (column === 'tier') colDef = "tier TEXT DEFAULT 'standard'";
                            if (column === 'creditBalance') colDef = "creditBalance REAL DEFAULT 0";
                            if (column === 'removeTopP') colDef = "removeTopP INTEGER DEFAULT 0";
                            if (column === 'lastUsedKeyIndex') colDef = "lastUsedKeyIndex INTEGER DEFAULT 0";

                            sqlite.exec(`ALTER TABLE ${table.name} ADD COLUMN ${colDef}`);
                            console.log(`  Added missing column ${column} to ${table.name}`);
                        } catch (alterError) {
                            console.error(`  Failed to add column ${column} to ${table.name}:`, alterError);
                        }
                    }
                }
            }
        }

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
                        tier TEXT DEFAULT 'standard',
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
                        cachereadtokens INTEGER DEFAULT 0,
                        cachewritetokens INTEGER DEFAULT 0,
                        cost REAL DEFAULT 0,
                        originalcost REAL DEFAULT 0,
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
                try { await (database as any).execute(sql`ALTER TABLE tokens ADD COLUMN IF NOT EXISTS tokentype TEXT DEFAULT 'rpd'`); } catch(e) { console.error("Migration failed for tokentype:", e); }
                try { await (database as any).execute(sql`ALTER TABLE tokens ADD COLUMN IF NOT EXISTS tier TEXT DEFAULT 'standard'`); } catch(e) { console.error("Migration failed for tier:", e); }
                try { await (database as any).execute(sql`ALTER TABLE tokens ADD COLUMN IF NOT EXISTS creditbalance REAL DEFAULT 0`); } catch(e) { console.error("Migration failed for creditbalance:", e); }
                try { await (database as any).execute(sql`ALTER TABLE tokens ADD COLUMN IF NOT EXISTS "createdAt" TIMESTAMP DEFAULT NOW()`); } catch(e) { console.error("Migration failed for createdAt:", e); }
                try { await (database as any).execute(sql`ALTER TABLE tokens ADD COLUMN IF NOT EXISTS "updatedAt" TIMESTAMP DEFAULT NOW()`); } catch(e) { console.error("Migration failed for updatedAt:", e); }
                
                try { await (database as any).execute(sql`ALTER TABLE request_logs ADD COLUMN IF NOT EXISTS cachereadtokens INTEGER DEFAULT 0`); } catch(e) { console.error("Migration failed for cachereadtokens:", e); }
                try { await (database as any).execute(sql`ALTER TABLE request_logs ADD COLUMN IF NOT EXISTS cachewritetokens INTEGER DEFAULT 0`); } catch(e) { console.error("Migration failed for cachewritetokens:", e); }
                try { await (database as any).execute(sql`ALTER TABLE request_logs ADD COLUMN IF NOT EXISTS originalcost REAL DEFAULT 0`); } catch(e) { console.error("Migration failed for originalcost:", e); }
                
                try { await (database as any).execute(sql`ALTER TABLE providers ADD COLUMN IF NOT EXISTS "createdAt" TIMESTAMP DEFAULT NOW()`); } catch(e) {}
                try { await (database as any).execute(sql`ALTER TABLE providers ADD COLUMN IF NOT EXISTS "updatedAt" TIMESTAMP DEFAULT NOW()`); } catch(e) {}
                try { await (database as any).execute(sql`ALTER TABLE providers ADD COLUMN IF NOT EXISTS removetopp INTEGER DEFAULT 0`); } catch(e) {}
                try { await (database as any).execute(sql`ALTER TABLE providers ADD COLUMN IF NOT EXISTS lastusedkeyindex INTEGER DEFAULT 0`); } catch(e) {}

                try { await (database as any).execute(sql`ALTER TABLE models ADD COLUMN IF NOT EXISTS "createdAt" TIMESTAMP DEFAULT NOW()`); } catch(e) {}
                try { await (database as any).execute(sql`ALTER TABLE models ADD COLUMN IF NOT EXISTS "updatedAt" TIMESTAMP DEFAULT NOW()`); } catch(e) {}

                try { await (database as any).execute(sql`ALTER TABLE admin_sessions ADD COLUMN IF NOT EXISTS "createdAt" TIMESTAMP DEFAULT NOW()`); } catch(e) {}
                try { await (database as any).execute(sql`ALTER TABLE admin_sessions ADD COLUMN IF NOT EXISTS "updatedAt" TIMESTAMP DEFAULT NOW()`); } catch(e) {}

                try { await (database as any).execute(sql`CREATE TABLE IF NOT EXISTS sync_state (id TEXT PRIMARY KEY, "lastUpdatedAt" TIMESTAMP DEFAULT NOW())`); } catch(e) {}
            }
        } catch (err) {
            console.error('Failed to initialize PostgreSQL schema:', err);
            throw err;
        }
    }

    // Always seed after initialization (or check)
    await seedData(database, type);
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
            
            if (secondaryType === 'postgres') {
                (secondary.conn as any).end();
            } else {
                (secondary.conn as any).close();
            }
        }
    }
}
