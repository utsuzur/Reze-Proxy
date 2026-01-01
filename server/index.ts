import 'dotenv/config';
import express from 'express';
import path from 'path';
import * as crypto from 'node:crypto';
import { fileURLToPath } from 'url';
import bcrypt from 'bcryptjs';
import db from './db.ts';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
app.set('trust proxy', 1);

const PORT = process.env.PORT ? parseInt(process.env.PORT) : 3000;

const IS_PROD = process.env.NODE_ENV === 'production';
const ADMIN_COOKIE_NAME = IS_PROD ? '__Host-reze_admin' : 'reze_admin';
const CSRF_COOKIE_NAME = 'reze_csrf';
const ADMIN_SESSION_TTL_MS = 12 * 60 * 60 * 1000;

app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ limit: '50mb', extended: true }));

// Request Logger
app.use((req, res, next) => {
  console.log(`[${new Date().toISOString()}] ${req.method} ${req.url} - ${req.ip}`);
  next();
});

const base64Url = (buf: Buffer): string =>
 buf
   .toString('base64')
   .replace(/\+/g, '-')
   .replace(/\//g, '_')
   .replace(/=+$/g, '');

const randomBase64Url = (bytes: number): string => base64Url(crypto.randomBytes(bytes));

const sha256Hex = (data: string): string => crypto.createHash('sha256').update(data).digest('hex');

const timingSafeEqualHex = (aHex: string, bHex: string): boolean => {
 // Always compare buffers of equal length to avoid throwing.
 const a = Buffer.from(aHex, 'hex');
 const b = Buffer.from(bHex, 'hex');
 if (a.length !== b.length) return false;
 return crypto.timingSafeEqual(a, b);
};

const parseCookies = (cookieHeader?: string): Record<string, string> => {
 const out: Record<string, string> = {};
 if (!cookieHeader) return out;

 const parts = cookieHeader.split(';');
 for (const part of parts) {
   const idx = part.indexOf('=');
   if (idx === -1) continue;
   const rawKey = part.slice(0, idx).trim();
   const rawVal = part.slice(idx + 1).trim();
   if (!rawKey) continue;
   out[rawKey] = decodeURIComponent(rawVal);
 }
 return out;
};

// Helper to promisify db.get / db.run (shared across admin + proxy)
const dbGet = (sql: string, params: any[]) =>
 new Promise<any>((resolve, reject) => {
   db.get(sql, params, (err, row) => {
     if (err) reject(err);
     else resolve(row);
   });
 });

const dbRun = (sql: string, params: any[]) =>
 new Promise<void>((resolve, reject) => {
   db.run(sql, params, (err) => {
     if (err) reject(err);
     else resolve();
   });
 });

const dbRunChanges = (sql: string, params: any[]) =>
 new Promise<number>((resolve, reject) => {
   db.run(sql, params, function (err) {
     if (err) reject(err);
     else resolve(this.changes);
   });
 });

const setAdminCookie = (res: express.Response, value: string, maxAgeMs: number) => {
 res.cookie(ADMIN_COOKIE_NAME, value, {
   httpOnly: true,
   secure: IS_PROD,
   sameSite: 'strict',
   path: '/',
   maxAge: maxAgeMs
 });
};

const clearAdminCookie = (res: express.Response) => {
 res.cookie(ADMIN_COOKIE_NAME, '', {
   httpOnly: true,
   secure: IS_PROD,
   sameSite: 'strict',
   path: '/',
   maxAge: 0
 });
};

const setCsrfCookie = (res: express.Response, value: string, maxAgeMs: number) => {
 res.cookie(CSRF_COOKIE_NAME, value, {
   httpOnly: false,
   secure: IS_PROD,
   sameSite: 'strict',
   path: '/',
   maxAge: maxAgeMs
 });
};

const clearCsrfCookie = (res: express.Response) => {
 res.cookie(CSRF_COOKIE_NAME, '', {
   httpOnly: false,
   secure: IS_PROD,
   sameSite: 'strict',
   path: '/',
   maxAge: 0
 });
};

// --- Admin Login Rate Limiting (in-memory) ---
type RateState = { count: number; resetAt: number };
const ADMIN_LOGIN_WINDOW_MS = 15 * 60 * 1000;
const ADMIN_LOGIN_MAX_ATTEMPTS = 10;
const adminLoginAttemptsByIp = new Map<string, RateState>();

const checkAndIncrementAdminLogin = (ip: string): { allowed: boolean; retryAfterMs?: number } => {
 const now = Date.now();
 const entry = adminLoginAttemptsByIp.get(ip);
 if (!entry || now > entry.resetAt) {
   adminLoginAttemptsByIp.set(ip, { count: 1, resetAt: now + ADMIN_LOGIN_WINDOW_MS });
   return { allowed: true };
 }
 if (entry.count >= ADMIN_LOGIN_MAX_ATTEMPTS) {
   return { allowed: false, retryAfterMs: Math.max(0, entry.resetAt - now) };
 }
 entry.count += 1;
 return { allowed: true };
};

// Best-effort pruning
setInterval(() => {
 const now = Date.now();
 for (const [ip, entry] of adminLoginAttemptsByIp.entries()) {
   if (now > entry.resetAt) adminLoginAttemptsByIp.delete(ip);
 }
}, 60_000).unref?.();

const auditAdminEvent = async (
 req: express.Request,
 event: string,
 details?: Record<string, unknown>
) => {
 try {
   const timestamp = new Date().toISOString();
   const ip = req.ip;
   const userAgent = req.get('user-agent') || null;
   const detailsJson = details ? JSON.stringify(details) : null;
   await dbRun(
     'INSERT INTO admin_audit_log (timestamp, event, ip, userAgent, details) VALUES (?, ?, ?, ?, ?)',
     [timestamp, event, ip, userAgent, detailsJson]
   );
 } catch (e) {
   // Don't block auth flows on audit logging failures
   console.error('admin_audit_log insert failed', e);
 }
};

type AdminSessionRow = {
 id: number;
 selector: string;
 validatorHash: string;
 createdAt: string;
 lastSeenAt: string | null;
 expiresAt: string;
 revokedAt: string | null;
 ip: string | null;
 userAgent: string | null;
};

const getAdminSessionFromRequest = async (req: express.Request): Promise<AdminSessionRow | null> => {
 const cookies = parseCookies(req.headers.cookie);
 const raw = cookies[ADMIN_COOKIE_NAME];
 if (!raw) return null;

 const [selector, validator] = raw.split('.');
 if (!selector || !validator) return null;

 const row = (await dbGet('SELECT * FROM admin_sessions WHERE selector = ?', [
   selector
 ])) as AdminSessionRow | undefined;

 if (!row) return null;
 if (row.revokedAt) return null;

 const expiresMs = new Date(row.expiresAt).getTime();
 if (!Number.isFinite(expiresMs) || expiresMs <= Date.now()) return null;

 const validatorHash = sha256Hex(validator);
 if (!timingSafeEqualHex(validatorHash, row.validatorHash)) return null;

 return row;
};

const requireAdmin = async (req: express.Request, res: express.Response, next: express.NextFunction) => {
 try {
   // CSRF enforcement on state-changing methods (cookie-authenticated)
   if (!['GET', 'HEAD', 'OPTIONS'].includes(req.method)) {
     const cookies = parseCookies(req.headers.cookie);
     const csrfCookie = cookies[CSRF_COOKIE_NAME];
     const csrfHeader = req.get('x-csrf-token');
     if (!csrfCookie || !csrfHeader || csrfCookie !== csrfHeader) {
       return res.status(403).json({ error: 'CSRF validation failed' });
     }
   }

   const session = await getAdminSessionFromRequest(req);
   if (!session) {
     clearAdminCookie(res);
     return res.status(401).json({ error: 'Unauthorized' });
   }

   // Fire-and-forget lastSeenAt update
   db.run('UPDATE admin_sessions SET lastSeenAt = ? WHERE id = ?', [new Date().toISOString(), session.id]);

   (req as any).adminSession = session;
   next();
 } catch (e) {
   console.error('requireAdmin error', e);
   res.status(500).json({ error: 'Internal server error' });
 }
};

// --- Admin Auth ---
app.post('/api/admin/login', async (req, res) => {
 const adminUser = process.env.ADMIN_USER;
 const adminPasswordHash = process.env.ADMIN_PASSWORD_HASH;

 if (!adminUser || !adminPasswordHash) {
   return res.status(500).json({ ok: false, error: 'Admin auth is not configured' });
 }

 const { allowed, retryAfterMs } = checkAndIncrementAdminLogin(req.ip);
 if (!allowed) {
   res.setHeader('Retry-After', Math.ceil((retryAfterMs || 0) / 1000));
   await auditAdminEvent(req, 'login_rate_limited');
   return res.status(429).json({ ok: false, error: 'Too many login attempts' });
 }

 const username = typeof req.body?.username === 'string' ? req.body.username : '';
 const password = typeof req.body?.password === 'string' ? req.body.password : '';

 const isValidUser = username === adminUser;
 const isValidPass = password ? bcrypt.compareSync(password, adminPasswordHash) : false;

 if (!isValidUser || !isValidPass) {
   await auditAdminEvent(req, 'login_failure');
   return res.status(401).json({ ok: false, error: 'Invalid credentials' });
 }

 // Create session (retry on rare selector collisions)
 const nowIso = new Date().toISOString();
 const expiresAtIso = new Date(Date.now() + ADMIN_SESSION_TTL_MS).toISOString();

 let selector = '';
 let validator = '';
 let created = false;

 for (let attempt = 0; attempt < 3; attempt++) {
   selector = randomBase64Url(16);
   validator = randomBase64Url(32);
   const validatorHash = sha256Hex(validator);

   try {
     await dbRun(
       'INSERT INTO admin_sessions (selector, validatorHash, createdAt, lastSeenAt, expiresAt, revokedAt, ip, userAgent) VALUES (?, ?, ?, ?, ?, NULL, ?, ?)',
       [selector, validatorHash, nowIso, nowIso, expiresAtIso, req.ip, req.get('user-agent') || null]
     );
     created = true;
     break;
   } catch (e: any) {
     // SQLite constraint errors include "SQLITE_CONSTRAINT"
     if (String(e?.message || '').includes('SQLITE_CONSTRAINT')) continue;
     throw e;
   }
 }

 if (!created) {
   return res.status(500).json({ ok: false, error: 'Failed to create session' });
 }

 const csrf = randomBase64Url(32);
 setAdminCookie(res, `${selector}.${validator}`, ADMIN_SESSION_TTL_MS);
 setCsrfCookie(res, csrf, ADMIN_SESSION_TTL_MS);

 await auditAdminEvent(req, 'login_success');

 res.json({ ok: true });
});

app.get('/api/admin/me', requireAdmin, async (req, res) => {
 try {
   const session = (req as any).adminSession as AdminSessionRow;

   // Extend session expiry if needed? 
   // For now, we just verify. 
   // Rotation removed to prevent race conditions with parallel dashboard fetches.

   res.json({ authenticated: true });
 } catch (e) {
   console.error('/api/admin/me error', e);
   res.status(500).json({ error: 'Internal server error' });
 }
});

app.post('/api/admin/logout', requireAdmin, async (req, res) => {
 try {
   const session = (req as any).adminSession as AdminSessionRow;
   const nowIso = new Date().toISOString();

   await dbRun('UPDATE admin_sessions SET revokedAt = ? WHERE id = ?', [nowIso, session.id]);
   await auditAdminEvent(req, 'logout');

   clearAdminCookie(res);
   clearCsrfCookie(res);
   res.json({ ok: true });
 } catch (e) {
   console.error('/api/admin/logout error', e);
   res.status(500).json({ error: 'Internal server error' });
 }
});

app.post('/api/admin/logout-all', requireAdmin, async (req, res) => {
 try {
   const nowIso = new Date().toISOString();
   const revoked = await dbRunChanges('UPDATE admin_sessions SET revokedAt = ? WHERE revokedAt IS NULL', [
     nowIso
   ]);

   await auditAdminEvent(req, 'logout_all', { revoked });

   clearAdminCookie(res);
   clearCsrfCookie(res);
   res.json({ ok: true, revoked });
 } catch (e) {
   console.error('/api/admin/logout-all error', e);
   res.status(500).json({ error: 'Internal server error' });
 }
});

/**
 * Public read endpoints for the landing page (no admin cookie required).
 * These intentionally avoid returning provider base URLs / keys.
 */
app.get('/api/public/providers', (req, res) => {
  db.all(
    `SELECT DISTINCT p.id, p.name
     FROM providers p
     JOIN models m ON m.providerId = p.id
     WHERE m.isActive = 1
     ORDER BY p.name ASC`,
    [],
    (err, rows) => {
      if (err) return res.status(500).json({ error: err.message });
      res.json(rows);
    }
  );
});

app.get('/api/public/models', (req, res) => {
  db.all(
    `SELECT m.*, p.name as providerName 
     FROM models m 
     JOIN providers p ON m.providerId = p.id 
     WHERE m.isActive = 1`, 
    [], 
    (err, rows) => {
    if (err) return res.status(500).json({ error: err.message });
    const formatted = (rows as any[]).map((r) => ({
      ...r,
      id: `${r.providerName}/${r.name}`,
      isActive: true
    }));
    res.json(formatted);
  });
});

// --- Providers (Admin) ---
app.get('/api/providers', requireAdmin, (req, res) => {
  db.all('SELECT * FROM providers', [], (err, rows) => {
    if (err) return res.status(500).json({ error: err.message });
    const formatted = (rows as any[]).map(r => ({
        ...r,
        apiKey: r.apiKey ? `${r.apiKey.substring(0, 3)}...${r.apiKey.substring(r.apiKey.length - 4)}` : undefined
    }));
    res.json(formatted);
  });
});

app.post('/api/providers', requireAdmin, (req, res) => {
  const { id, name, baseUrl, apiKey, type } = req.body;
  db.run('INSERT INTO providers (id, name, baseUrl, apiKey, type) VALUES (?, ?, ?, ?, ?)', 
    [id, name, baseUrl, apiKey, type], 
    function(err) {
      if (err) return res.status(500).json({ error: err.message });
      res.json({ id, name, baseUrl, apiKey, type });
    }
  );
});

app.put('/api/providers', requireAdmin, (req, res) => {
  const { id, name, baseUrl, apiKey } = req.body;
  db.run('UPDATE providers SET name = ?, baseUrl = ?, apiKey = ? WHERE id = ?',
    [name, baseUrl, apiKey, id],
    function(err) {
      if (err) return res.status(500).json({ error: err.message });
      res.json({ updated: this.changes });
    }
  );
});

app.delete('/api/providers/:id', requireAdmin, (req, res) => {
  const { id } = req.params;
  db.run('DELETE FROM providers WHERE id = ?', [id], function(err) {
    if (err) return res.status(500).json({ error: err.message });
    res.json({ deleted: this.changes });
  });
});

// --- Models ---
app.get('/api/models', requireAdmin, (req, res) => {
  db.all('SELECT * FROM models', [], (err, rows) => {
    if (err) return res.status(500).json({ error: err.message });
    const formatted = (rows as any[]).map((r) => ({
        ...r, 
        isActive: !!r.isActive
    }));
    res.json(formatted);
  });
});

app.post('/api/models', requireAdmin, (req, res) => {
  const models = Array.isArray(req.body) ? req.body : [req.body];
  
  const stmt = db.prepare('INSERT OR REPLACE INTO models (id, providerId, name, maxInputTokens, maxOutputTokens, isActive) VALUES (?, ?, ?, ?, ?, ?)');
  
  db.serialize(() => {
    models.forEach((m: any) => {
        stmt.run(m.id, m.providerId, m.name, m.maxInputTokens, m.maxOutputTokens, m.isActive ? 1 : 0);
    });
    stmt.finalize((err) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json({ success: true, count: models.length });
    });
  });
});

app.put('/api/models', requireAdmin, (req, res) => {
    const m = req.body;
    db.run('UPDATE models SET name = ?, maxInputTokens = ?, maxOutputTokens = ?, isActive = ? WHERE id = ? AND providerId = ?',
        [m.name, m.maxInputTokens, m.maxOutputTokens, m.isActive ? 1 : 0, m.id, m.providerId],
        function(err) {
            if (err) return res.status(500).json({ error: err.message });
            res.json({ updated: this.changes });
        }
    );
});


// --- Tokens ---
app.get('/api/tokens', requireAdmin, (req, res) => {
  db.all('SELECT * FROM tokens', [], (err, rows) => {
    if (err) return res.status(500).json({ error: err.message });
    const formatted = (rows as any[]).map((r) => {
        let accessibleModelIds = [];
        try {
            accessibleModelIds = JSON.parse(r.accessibleModelIds || '[]');
        } catch (e) {
            console.error(`Error parsing accessibleModelIds for token ${r.id}:`, e);
        }
        return {
            ...r,
            isActive: r.isActive === 1,
            accessibleModelIds
        };
    });
    res.json(formatted);
  });
});

app.post('/api/tokens', requireAdmin, (req, res) => {
  const { id, name, token, createdAt, expiresAt, accessibleModelIds, usageCount, isActive, maxRequestsPerDay, maxRequestsPerMinute } = req.body;
  db.run('INSERT INTO tokens (id, name, token, createdAt, expiresAt, accessibleModelIds, usageCount, isActive, maxRequestsPerDay, maxRequestsPerMinute) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
    [id, name, token, createdAt, expiresAt, JSON.stringify(accessibleModelIds), usageCount, isActive !== undefined ? (isActive ? 1 : 0) : 1, maxRequestsPerDay, maxRequestsPerMinute],
    function(err) {
        if (err) return res.status(500).json({ error: err.message });
        res.json(req.body);
    }
  );
});

app.put('/api/tokens', requireAdmin, (req, res) => {
  const { id, name, token, expiresAt, accessibleModelIds, isActive, maxRequestsPerDay, maxRequestsPerMinute } = req.body;
  
  if (token) {
    db.run('UPDATE tokens SET name = ?, token = ?, expiresAt = ?, accessibleModelIds = ?, isActive = ?, maxRequestsPerDay = ?, maxRequestsPerMinute = ? WHERE id = ?',
      [name, token, expiresAt, JSON.stringify(accessibleModelIds), isActive ? 1 : 0, maxRequestsPerDay, maxRequestsPerMinute, id],
      function(err) {
          if (err) return res.status(500).json({ error: err.message });
          res.json({ updated: this.changes });
      }
    );
  } else {
    db.run('UPDATE tokens SET name = ?, expiresAt = ?, accessibleModelIds = ?, isActive = ?, maxRequestsPerDay = ?, maxRequestsPerMinute = ? WHERE id = ?',
      [name, expiresAt, JSON.stringify(accessibleModelIds), isActive ? 1 : 0, maxRequestsPerDay, maxRequestsPerMinute, id],
      function(err) {
          if (err) return res.status(500).json({ error: err.message });
          res.json({ updated: this.changes });
      }
    );
  }
});

app.delete('/api/tokens/:id', requireAdmin, (req, res) => {
  const { id } = req.params;
  db.run('DELETE FROM tokens WHERE id = ?', [id], function(err) {
    if (err) return res.status(500).json({ error: err.message });
    res.json({ deleted: this.changes });
  });
});

// --- Admin Maintenance ---
app.delete('/api/logs/prune', requireAdmin, (req, res) => {
    // Delete logs older than 30 days
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
    const timestamp = thirtyDaysAgo.toISOString();

    db.run('DELETE FROM request_logs WHERE timestamp < ?', [timestamp], function(err) {
        if (err) return res.status(500).json({ error: err.message });
        res.json({ deleted: this.changes, message: `Pruned logs older than ${timestamp}` });
    });
});

app.post('/api/my-token/details', (req, res) => {
    const { token } = req.body;
    if (!token) return res.status(400).json({ error: "Token is required" });

    db.get('SELECT * FROM tokens WHERE token = ?', [token], (err, row: any) => {
        if (err) return res.status(500).json({ error: err.message });
        if (!row) return res.status(404).json({ error: "Invalid token" });

        // Get recent logs
        db.all('SELECT * FROM request_logs WHERE tokenId = ? ORDER BY timestamp DESC LIMIT 50', [row.id], (err, logs) => {
            if (err) return res.status(500).json({ error: err.message });
            
            // Calculate remaining RPD
            const now = new Date();
            const todayStr = now.toISOString().split('T')[0];
            const remainingRequestsToday = (row.maxRequestsPerDay && row.maxRequestsPerDay > 0) 
                ? Math.max(0, row.maxRequestsPerDay - (row.lastRequestDate === todayStr ? row.requestsToday : 0))
                : null; // Null means unlimited

             // Get stats for graph (last 7 days maybe? or just return logs and let frontend handle it)
             // For now, returning raw logs is fine as requested "logging info (last 50 requests)"
            
            res.json({
                ...row,
                isActive: !!row.isActive,
                remainingRequestsToday,
                logs
            });
        });
    });
});

app.put('/api/my-token/name', (req, res) => {
    const { token, name } = req.body;
    if (!token || !name) return res.status(400).json({ error: "Token and name are required" });

    db.get('SELECT id FROM tokens WHERE token = ?', [token], (err, row: any) => {
        if (err) return res.status(500).json({ error: err.message });
        if (!row) return res.status(404).json({ error: "Invalid token" });

        db.run('UPDATE tokens SET name = ? WHERE id = ?', [name, row.id], function(err) {
            if (err) return res.status(500).json({ error: err.message });
            res.json({ success: true, name });
        });
    });
});

// --- Shrine Status ---
app.get('/api/status', (req, res) => {
  res.json({
    status: 'operational',
    name: 'Reze Proxy',
    version: '1.0.0',
    message: "Let's run away together.",
    endpoints: {
      admin: '/shrine',
      api: '/api'
    }
  });
});

import { countTokens } from './tokenService.ts';

// --- OpenAI Compatible Proxy ---

app.get('/v1/models', (req, res) => {
  db.all(
    `SELECT m.name, p.name as providerName 
     FROM models m 
     JOIN providers p ON m.providerId = p.id 
     WHERE m.isActive = 1`, 
    [], 
    (err, rows) => {
    if (err) return res.status(500).json({ error: err.message });
    // Use a Set to ensure uniqueness of the generated IDs if needed, 
    // though (providerName, modelName) should be unique if logic holds.
    const models = (rows as any[]).map(r => ({
        id: `${r.providerName}/${r.name}`, // Expose provider/model
        object: "model",
        created: Math.floor(Date.now() / 1000),
        owned_by: "reze-proxy"
    }));
    res.json({ object: "list", data: models });
  });
});

import NodeCache from 'node-cache';

const tokenCache = new NodeCache({ stdTTL: 60 }); // Cache tokens for 60 seconds
const modelCache = new NodeCache({ stdTTL: 300 }); // Cache model configs for 5 minutes

// dbGet helper is defined near the top for reuse (admin auth + proxy)

app.post('/v1/chat/completions', async (req, res) => {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: { message: "Missing or invalid Authorization header", type: "invalid_request_error" } });
  }
  const token = authHeader.split(' ')[1];

  try {
      // 1. Get Token (Cache -> DB)
      let row: any = tokenCache.get(token);
      if (!row) {
          row = await dbGet('SELECT * FROM tokens WHERE token = ?', [token]);
          if (row) tokenCache.set(token, row);
      }
      
      if (!row) return res.status(401).json({ error: { message: "Invalid API key" } });
  
      // Check if Token is Active
      if (row.isActive === 0) {
        return res.status(401).json({ error: { message: "API key disabled" } });
      }

    // Check Expiry
    if (row.expiresAt && new Date(row.expiresAt) < new Date()) {
      return res.status(401).json({ error: { message: "API key expired" } });
    }

    // Rate Limiting
    const now = new Date();
    const todayStr = now.toISOString().split('T')[0];
    const currentMinuteStr = now.toISOString().slice(0, 16);

    // Daily Limit
    if (row.maxRequestsPerDay && row.maxRequestsPerDay > 0) {
        if (row.lastRequestDate === todayStr && row.requestsToday >= row.maxRequestsPerDay) {
             return res.status(429).json({ error: { message: "Daily request limit reached. Resets at 00:00 UTC." } });
        }
    }

    // Minute Limit
    if (row.maxRequestsPerMinute && row.maxRequestsPerMinute > 0) {
         if (row.lastRequestMinute === currentMinuteStr && row.requestsThisMinute >= row.maxRequestsPerMinute) {
             return res.status(429).json({ error: { message: "Rate limit exceeded. Please wait a minute." } });
         }
    }

    // Update Rate Limit Counters (Async - don't block response)
    // We also update the cache to reflect the new counts immediately if we were using it for state, 
    // but here we just fire-and-forget the DB update. Ideally, a distributed cache (Redis) would handle increments.
    // For now, local cache might get stale regarding EXACT counts, but that's a trade-off for speed.
    // To ensure strict limits, we might want to invalidate the cache on hit, but that defeats the purpose.
    // We'll proceed with DB updates and just accept that the cached 'row' might lag slightly on counters 
    // within the 60s window. *However*, for strict rate limiting, we should probably fetch the latest counters 
    // or store counters separately. For this simple implementation, we'll stick to the cached row 
    // but invalidating it might be safer if we want strict enforcement.
    // IMPROVEMENT: Let's invalidate the token cache on every request so the next request fetches fresh counters.
    // This keeps auth fast (if we split it) but here counters are on the same row.
    // Optimization: Only invalidate if we are close to a limit? 
    // Let's simple invalidate for now to be safe with limits, OR just update the in-memory object too.
    
    // Increment in-memory to reflect immediate change (optimistic)
    if (row.lastRequestDate !== todayStr) { row.requestsToday = 1; row.lastRequestDate = todayStr; }
    else { row.requestsToday = (row.requestsToday || 0) + 1; }
    
    if (row.lastRequestMinute !== currentMinuteStr) { row.requestsThisMinute = 1; row.lastRequestMinute = currentMinuteStr; }
    else { row.requestsThisMinute = (row.requestsThisMinute || 0) + 1; }
    
    tokenCache.set(token, row); // Update cache with new counters

    db.run(`UPDATE tokens SET 
        requestsToday = CASE WHEN lastRequestDate = ? THEN requestsToday + 1 ELSE 1 END,
        lastRequestDate = ?,
        requestsThisMinute = CASE WHEN lastRequestMinute = ? THEN requestsThisMinute + 1 ELSE 1 END,
        lastRequestMinute = ?
        WHERE id = ?`, 
        [todayStr, todayStr, currentMinuteStr, currentMinuteStr, row.id]);

    const modelId = req.body.model;
    if (!modelId) return res.status(400).json({ error: { message: "Model is required" } });

    // 2. Get Model (Cache -> DB)
    let modelRow: any = modelCache.get(modelId);
    if (!modelRow) {
        // Try parsing "Provider/Model"
        if (modelId.includes('/')) {
            const parts = modelId.split('/');
            const providerName = parts[0];
            const modelName = parts.slice(1).join('/');
            
            modelRow = await dbGet(
                `SELECT m.*, p.baseUrl, p.apiKey as providerKey 
                 FROM models m 
                 JOIN providers p ON m.providerId = p.id 
                 WHERE p.name = ? AND m.name = ? AND m.isActive = 1 LIMIT 1`, 
                [providerName, modelName]
            );
        }

        // Fallback: Try searching by model name directly (legacy/ambiguous mode)
        if (!modelRow) {
            modelRow = await dbGet(
                `SELECT m.*, p.baseUrl, p.apiKey as providerKey 
                 FROM models m 
                 JOIN providers p ON m.providerId = p.id 
                 WHERE m.name = ? AND m.isActive = 1 LIMIT 1`, 
                [modelId]
            );
        }

        if (modelRow) modelCache.set(modelId, modelRow);
    }

      if (!modelRow) return res.status(404).json({ error: { message: "Unknown Model Name" } });

      // Check Access using the Internal ID (modelRow.id)
      let accessibleModels: string[] = [];
      try {
        accessibleModels = JSON.parse(row.accessibleModelIds || '[]');
      } catch (e) {
        console.error("Error parsing accessibleModelIds for token:", row.id, e);
        accessibleModels = []; 
      }
      
      // If list is empty, access to all models is assumed
      // We check against modelRow.id (the persistent ID), not modelId (the mutable name)
      if (accessibleModels.length > 0 && !accessibleModels.includes(modelRow.id)) {
         return res.status(403).json({ error: { message: "Model access denied for this token" } });
      }

      // Check Input Token Limit
      const messages = req.body.messages || [];
      const inputContent = messages.map((m: any) => m.content || '').join('\n');
      const currentInputTokens = countTokens(inputContent, modelId);

      if (modelRow.maxInputTokens && currentInputTokens > modelRow.maxInputTokens) {
        return res.status(400).json({ 
            error: { 
                message: `Input context length ${currentInputTokens} exceeds the limit of ${modelRow.maxInputTokens} for model '${modelId}'.`
            } 
        });
      }

      try {
        // Prepare Request
        const providerUrl = modelRow.baseUrl.replace(/\/+$/, '') + '/chat/completions';
        const headers: any = {
          'Content-Type': 'application/json',
        };
        if (modelRow.providerKey) {
          headers['Authorization'] = `Bearer ${modelRow.providerKey}`;
        }

        const isStreaming = req.body.stream === true;

        // Enforce max output tokens from model configuration
        // This acts as a hard cap: strict minimum of (user_requested, configured_limit)
        let finalMaxTokens = req.body.max_tokens;
        if (modelRow.maxOutputTokens) {
          if (!finalMaxTokens || finalMaxTokens > modelRow.maxOutputTokens) {
            finalMaxTokens = modelRow.maxOutputTokens;
          }
        }
        
        // Use the provider's actual model ID (modelRow.id) instead of the public name
        const requestBody = { ...req.body, model: modelRow.id };

        if (finalMaxTokens) {
          requestBody.max_tokens = finalMaxTokens;
        }

        // Proxy Request
        // We use global fetch (Node 18+)
        const proxyRes = await fetch(providerUrl, {
          method: 'POST',
          headers,
          body: JSON.stringify(requestBody)
        });

        if (!proxyRes.ok) {
           const errorText = await proxyRes.text();
           try {
              const errorJson = JSON.parse(errorText);
              return res.status(proxyRes.status).json(errorJson);
           } catch {
              return res.status(proxyRes.status).send(errorText);
           }
        }

        if (isStreaming) {
            // Forward headers for SSE
            res.setHeader('Content-Type', 'text/event-stream');
            res.setHeader('Cache-Control', 'no-cache');
            res.setHeader('Connection', 'keep-alive');
            
            if (proxyRes.body) {
                // @ts-ignore
                const reader = proxyRes.body.getReader();
                const decoder = new TextDecoder();
                
                let accumulatedOutput = "";

                try {
                    while (true) {
                        const { done, value } = await reader.read();
                        if (done) break;
                        
                        const chunk = decoder.decode(value, { stream: true });
                        res.write(chunk);
                        
                        // Accumulate for token counting (approximate)
                        // Parsing SSE chunks is tricky, but we can try to extract 'content'
                        const lines = chunk.split('\n');
                        for (const line of lines) {
                            if (line.startsWith('data: ') && line !== 'data: [DONE]') {
                                try {
                                    const json = JSON.parse(line.substring(6));
                                    if (json.choices?.[0]?.delta?.content) {
                                        accumulatedOutput += json.choices[0].delta.content;
                                    }
                                } catch (e) {
                                    // ignore parse errors for partial chunks
                                }
                            }
                        }
                    }
                } catch (error) {
                    console.error("Streaming error:", error);
                    res.end();
                } finally {
                    res.end();
                    
                    // Count tokens after stream finishes
                    const messages = req.body.messages || [];
                    const inputContent = messages.map((m: any) => m.content || '').join('\n');
                    const inputTokens = countTokens(inputContent, modelId);
                    const outputTokens = countTokens(accumulatedOutput, modelId);
                    
                     console.log(`[${new Date().toISOString()}] Stream Completion: Model=${modelId} | User=${row.name} | Input=${inputTokens} | Output=${outputTokens}`);
                    
                    db.run('UPDATE tokens SET usageCount = usageCount + 1, inputTokens = inputTokens + ?, outputTokens = outputTokens + ? WHERE id = ?', 
                        [inputTokens, outputTokens, row.id]);

                    db.run('INSERT INTO request_logs (tokenId, modelId, inputTokens, outputTokens, timestamp) VALUES (?, ?, ?, ?, ?)',
                        [row.id, modelId, inputTokens, outputTokens, new Date().toISOString()]);
                }
            } else {
                res.end();
            }
            return;
        }

        // Non-streaming handling (existing logic)
        const responseText = await proxyRes.text();

        let data;
        try {
            data = JSON.parse(responseText);
        } catch (e) {
            console.error("Failed to parse provider response as JSON:", responseText);
            return res.status(502).json({ error: { message: "Invalid JSON response from provider" } });
        }
        
        // Count Tokens (Approximation)
        const messages = req.body.messages || [];
        const inputContent = messages.map((m: any) => m.content || '').join('\n');
        const inputTokens = countTokens(inputContent, modelId);
        
        const outputContent = data.choices?.[0]?.message?.content || '';
        const outputTokens = countTokens(outputContent, modelId);

        // Log Request
        console.log(`[${new Date().toISOString()}] Completion: Model=${modelId} | User=${row.name} (${token.substring(0,6)}...) | Input=${inputTokens} | Output=${outputTokens}`);

        // Update Usage
        db.run('UPDATE tokens SET usageCount = usageCount + 1, inputTokens = inputTokens + ?, outputTokens = outputTokens + ? WHERE id = ?', 
          [inputTokens, outputTokens, row.id]);

        db.run('INSERT INTO request_logs (tokenId, modelId, inputTokens, outputTokens, timestamp) VALUES (?, ?, ?, ?, ?)',
            [row.id, modelId, inputTokens, outputTokens, new Date().toISOString()]);

        // Return Response
        res.json(data);

      } catch (e: any) {
        console.error("Proxy error:", e);
        res.status(502).json({ error: { message: "Bad Gateway: Failed to connect to provider" } });
      }
  } catch (err: any) {
      console.error("Server Error:", err);
      res.status(500).json({ error: { message: "Internal server error" } });
  }
});

// --- Static Frontend Serving ---
const distPath = path.join(__dirname, '../dist');
app.use(express.static(distPath));

// Handle SPA routing - return index.html for any non-API routes
app.get(/^(?!\/api|\/v1).*$/, (req, res, next) => {
  // Logic is redundant if regex handles it, but keeping 'next' safety or serving file
  res.sendFile(path.join(distPath, 'index.html'));
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`Server running on http://0.0.0.0:${PORT}`);
});
