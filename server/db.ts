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
  initializeTables();
});

function initializeTables() {
  db.run(`CREATE TABLE IF NOT EXISTS providers (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    baseUrl TEXT NOT NULL,
    apiKey TEXT,
    type TEXT NOT NULL
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

  // Migrations for Rate Limiting
  const columnsToAdd = [
    "ALTER TABLE tokens ADD COLUMN maxRequestsPerDay INTEGER DEFAULT NULL",
    "ALTER TABLE tokens ADD COLUMN maxRequestsPerMinute INTEGER DEFAULT NULL",
    "ALTER TABLE tokens ADD COLUMN requestsToday INTEGER DEFAULT 0",
    "ALTER TABLE tokens ADD COLUMN lastRequestDate TEXT DEFAULT NULL",
    "ALTER TABLE tokens ADD COLUMN requestsThisMinute INTEGER DEFAULT 0",
    "ALTER TABLE tokens ADD COLUMN lastRequestMinute TEXT DEFAULT NULL"
  ];

  columnsToAdd.forEach(sql => {
    db.run(sql, (err) => {
      // Ignore error if column already exists
      if (err && !err.message.includes("duplicate column name")) {
         // It's noisy to log every time on existing DB, so maybe suppress or check code
         // console.error("Migration error (safe to ignore if column exists):", err.message);
      }
    });
  });
}

export default db;
