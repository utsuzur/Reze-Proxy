import sqlite3 from 'sqlite3';

const dbPath = './reze.db';
const verbose = sqlite3.verbose();
const db = new verbose.Database(dbPath, (err) => {
  if (err) {
    console.error('Error opening database', err);
  } else {
    console.log('Connected to the SQLite database.');
  }
});

db.serialize(() => {
  db.run("PRAGMA foreign_keys = ON;"); // Enable foreign key constraints
  db.run("PRAGMA journal_mode = WAL;"); // Enable Write-Ahead Logging for better concurrency
  db.run("PRAGMA synchronous = NORMAL;"); // Faster writes with reasonable safety
  initializeTables();
});

function initializeTables() {
  db.run(`CREATE TABLE IF NOT EXISTS providers (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    baseUrl TEXT NOT NULL,
    apiKey TEXT, -- Store as JSON array string for multiple keys
    type TEXT DEFAULT 'openai_compatible',
    removeTopP INTEGER DEFAULT 0,
    lastUsedKeyIndex INTEGER DEFAULT 0
  )`);

  db.run(`CREATE TABLE IF NOT EXISTS models (
    id TEXT,
    providerId TEXT,
    name TEXT NOT NULL,
    maxInputTokens INTEGER,
    maxOutputTokens INTEGER,
    isActive INTEGER DEFAULT 1,
    PRIMARY KEY (id, providerId),
    FOREIGN KEY(providerId) REFERENCES providers(id) ON DELETE CASCADE
  )`);

  db.run(`CREATE TABLE IF NOT EXISTS tokens (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    token TEXT NOT NULL,
    createdAt TEXT,
    expiresAt TEXT,
    accessibleModelIds TEXT, -- JSON stringified array
    usageCount INTEGER DEFAULT 0,
    inputTokens INTEGER DEFAULT 0,
    outputTokens INTEGER DEFAULT 0,
    isActive INTEGER DEFAULT 1
  )`);

  // Indices for Performance
  db.run("CREATE UNIQUE INDEX IF NOT EXISTS idx_tokens_token ON tokens(token)");
  db.run("CREATE INDEX IF NOT EXISTS idx_models_name ON models(name)");
  db.run("CREATE INDEX IF NOT EXISTS idx_models_providerId ON models(providerId)");
  db.run("CREATE UNIQUE INDEX IF NOT EXISTS idx_providers_name ON providers(name)");

  // Migrations for Rate Limiting
  const columnsToAdd = [
    "ALTER TABLE tokens ADD COLUMN maxRequestsPerDay INTEGER DEFAULT NULL",
    "ALTER TABLE tokens ADD COLUMN maxRequestsPerMinute INTEGER DEFAULT NULL",
    "ALTER TABLE tokens ADD COLUMN requestsToday INTEGER DEFAULT 0",
    "ALTER TABLE tokens ADD COLUMN lastRequestDate TEXT DEFAULT NULL",
    "ALTER TABLE tokens ADD COLUMN requestsThisMinute INTEGER DEFAULT 0",
    "ALTER TABLE tokens ADD COLUMN lastRequestMinute TEXT DEFAULT NULL",
    "ALTER TABLE providers ADD COLUMN lastUsedKeyIndex INTEGER DEFAULT 0"
  ];

  columnsToAdd.forEach(sql => {
    db.run(sql, (err) => {
      if (err) {
        if (!err.message.includes("duplicate column name")) {
          console.error(`Migration failed: ${sql}`, err);
        }
      } else {
        console.log(`Migration applied: ${sql}`);
      }
    });
  });

  db.run(`CREATE TABLE IF NOT EXISTS request_logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    tokenId TEXT NOT NULL,
    modelId TEXT NOT NULL,
    inputTokens INTEGER DEFAULT 0,
    outputTokens INTEGER DEFAULT 0,
    timestamp TEXT NOT NULL,
    FOREIGN KEY(tokenId) REFERENCES tokens(id) ON DELETE CASCADE
  )`);

  db.run("CREATE INDEX IF NOT EXISTS idx_request_logs_tokenId ON request_logs(tokenId)");
  db.run("CREATE INDEX IF NOT EXISTS idx_request_logs_timestamp ON request_logs(timestamp)");

  // --- Admin Sessions (Cookie-based, server-side) ---
  db.run(`CREATE TABLE IF NOT EXISTS admin_sessions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    selector TEXT NOT NULL UNIQUE,
    validatorHash TEXT NOT NULL,
    createdAt TEXT NOT NULL,
    lastSeenAt TEXT,
    expiresAt TEXT NOT NULL,
    revokedAt TEXT,
    ip TEXT,
    userAgent TEXT
  )`);

  db.run("CREATE UNIQUE INDEX IF NOT EXISTS idx_admin_sessions_selector ON admin_sessions(selector)");
  db.run("CREATE INDEX IF NOT EXISTS idx_admin_sessions_expiresAt ON admin_sessions(expiresAt)");
  db.run("CREATE INDEX IF NOT EXISTS idx_admin_sessions_revokedAt ON admin_sessions(revokedAt)");

  // --- Admin Audit Log (Optional but recommended) ---
  db.run(`CREATE TABLE IF NOT EXISTS admin_audit_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    timestamp TEXT NOT NULL,
    event TEXT NOT NULL,
    ip TEXT,
    userAgent TEXT,
    details TEXT
  )`);

  db.run("CREATE INDEX IF NOT EXISTS idx_admin_audit_log_timestamp ON admin_audit_log(timestamp)");

  // --- Error Logs ---
  db.run(`CREATE TABLE IF NOT EXISTS error_logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    tokenId TEXT,
    modelId TEXT,
    providerId TEXT,
    errorType TEXT, -- 'provider_error' or 'server_error'
    errorMessage TEXT,
    timestamp TEXT NOT NULL,
    FOREIGN KEY(tokenId) REFERENCES tokens(id) ON DELETE SET NULL
  )`);

  db.run("CREATE INDEX IF NOT EXISTS idx_error_logs_timestamp ON error_logs(timestamp)");
}

export const dbReady = new Promise<void>((resolve, reject) => {
  db.serialize(() => {
      // Verify migrations success
      db.all("PRAGMA table_info(providers)", (err, rows) => {
        if (err) return reject(err);
        const hasRemoveTopP = (rows as any[]).some(r => r.name === 'removeTopP');
        if (!hasRemoveTopP) {
           console.log("Critical column removeTopP missing, attempting emergency repair...");
           db.run("ALTER TABLE providers ADD COLUMN removeTopP INTEGER DEFAULT 0", (err) => {
               if (err) return reject(new Error("Emergency repair failed: " + err.message));
               console.log("Emergency repair successful: removeTopP column added.");
               resolve();
           });
        } else {
            resolve();
        }
      });
  });
});

export default db;
