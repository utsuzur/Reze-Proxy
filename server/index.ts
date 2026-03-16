import 'dotenv/config';
import express from 'express';
import path from 'path';
import * as crypto from 'node:crypto';
import { fileURLToPath } from 'url';
import bcrypt from 'bcryptjs';
import db, { dbReady } from './db.ts';

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

// --- Format Conversion Helpers ---

function convertOpenAIToAnthropic(body: any, modelId: string) {
  const { messages, stream, max_tokens, temperature, top_p, stop } = body;
  
  // Extract system message
  let system = "";
  const filteredMessages = messages.filter((m: any) => {
    if (m.role === 'system') {
      system = m.content;
      return false;
    }
    return true;
  });

  return {
    model: modelId,
    messages: filteredMessages,
    system: system || undefined,
    max_tokens: max_tokens || 4096, // Anthropic requires max_tokens
    temperature: temperature,
    top_p: top_p,
    stop_sequences: Array.isArray(stop) ? stop : (stop ? [stop] : undefined),
    stream
  };
}

function convertAnthropicToOpenAI(anthropicRes: any, modelId: string) {
    return {
        id: anthropicRes.id,
        object: "chat.completion",
        created: Math.floor(Date.now() / 1000),
        model: modelId,
        choices: [
            {
                index: 0,
                message: {
                    role: "assistant",
                    content: anthropicRes.content[0].text
                },
                finish_reason: anthropicRes.stop_reason === "end_turn" ? "stop" : anthropicRes.stop_reason
            }
        ],
        usage: {
            prompt_tokens: anthropicRes.usage.input_tokens,
            completion_tokens: anthropicRes.usage.output_tokens,
            total_tokens: anthropicRes.usage.input_tokens + anthropicRes.usage.output_tokens
        }
    };
}

function convertAnthropicToOpenAIRequest(body: any) {
    const { model, messages, system, max_tokens, stop_sequences, stream, temperature, top_p } = body;
    
    const openaiMessages = [...messages];
    if (system) {
        openaiMessages.unshift({ role: 'system', content: system });
    }

    return {
        model,
        messages: openaiMessages,
        max_tokens,
        stop: stop_sequences,
        stream,
        temperature,
        top_p
    };
}

function convertOpenAIToAnthropicResponse(openaiRes: any, modelId: string) {
    return {
        id: openaiRes.id || "msg_" + Math.random().toString(36).substring(7),
        type: "message",
        role: "assistant",
        model: modelId,
        content: [
            {
                type: "text",
                text: openaiRes.choices?.[0]?.message?.content || ""
            }
        ],
        stop_reason: openaiRes.choices?.[0]?.finish_reason === "stop" ? "end_turn" : (openaiRes.choices?.[0]?.finish_reason || "end_turn"),
        stop_sequence: null,
        usage: {
            input_tokens: openaiRes.usage?.prompt_tokens || 0,
            output_tokens: openaiRes.usage?.completion_tokens || 0
        }
    };
}

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
    `SELECT DISTINCT p.id, p.name, p.type
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

app.get('/api/admin/search-prices', requireAdmin, async (req, res) => {
    try {
        const response = await fetch('https://openrouter.ai/api/v1/models');
        if (!response.ok) throw new Error(`OpenRouter returned ${response.status}`);
        const data = await response.json();
        
        // Return a simplified list for the frontend
        const prices = data.data.map((m: any) => ({
            id: m.id,
            name: m.name,
            inputPrice: parseFloat(m.pricing.prompt) * 1000, // Price per 1k tokens
            outputPrice: parseFloat(m.pricing.completion) * 1000
        }));
        
        res.json(prices);
    } catch (e: any) {
        console.error('Error fetching prices:', e);
        res.status(500).json({ error: "Failed to fetch pricing data from OpenRouter" });
    }
});

app.post('/api/admin/fetch-models', requireAdmin, async (req, res) => {
    const { url, key, type } = req.body;
    if (!url) return res.status(400).json({ error: "URL is required" });

    try {
        const cleanBase = url.replace(/\/+$/, '');
        let fetchUrl = '';
        
        if (type === 'anthropic') {
            const baseWithoutV1 = cleanBase.endsWith('/v1') ? cleanBase.slice(0, -3) : cleanBase;
            fetchUrl = `${baseWithoutV1}/v1/models`;
        } else {
            fetchUrl = `${cleanBase}/models`;
        }
        
        const headers: any = {
            'Accept': 'application/json'
        };

        if (key) {
            if (type === 'anthropic') {
                headers['x-api-key'] = key;
                headers['anthropic-version'] = '2023-06-01';
            } else {
                headers['Authorization'] = `Bearer ${key}`;
            }
        }

        const response = await fetch(fetchUrl, { headers });
        if (!response.ok) {
            const errorText = await response.text();
            throw new Error(`Provider returned ${response.status}: ${errorText || response.statusText}`);
        }

        const data = await response.json();
        res.json(data);
    } catch (e: any) {
        console.error("Fetch models error:", e);
        res.status(500).json({ error: e.message || "Failed to fetch models" });
    }
});

// --- Providers (Admin) ---
app.get('/api/providers', requireAdmin, (req, res) => {
  db.all('SELECT * FROM providers', [], (err, rows) => {
    if (err) return res.status(500).json({ error: err.message });
    const formatted = (rows as any[]).map(r => {
        let displayKey = r.apiKey;
        if (r.apiKey) {
            try {
                const parsed = JSON.parse(r.apiKey);
                if (Array.isArray(parsed)) {
                    displayKey = `${parsed.length} keys: [${parsed[0].substring(0, 3)}..., ${parsed[parsed.length-1].substring(parsed[parsed.length-1].length - 4)}]`;
                } else {
                    displayKey = `${r.apiKey.substring(0, 3)}...${r.apiKey.substring(r.apiKey.length - 4)}`;
                }
            } catch (e) {
                displayKey = `${r.apiKey.substring(0, 3)}...${r.apiKey.substring(r.apiKey.length - 4)}`;
            }
        }
        return {
            ...r,
            apiKey: displayKey
        };
    });
    res.json(formatted);
  });
});

app.post('/api/providers', requireAdmin, (req, res) => {
  const { id, name, baseUrl, apiKey, type, removeTopP } = req.body;
  db.run('INSERT INTO providers (id, name, baseUrl, apiKey, type, removeTopP) VALUES (?, ?, ?, ?, ?, ?)', 
    [id, name, baseUrl, apiKey, type, removeTopP ? 1 : 0], 
    function(err) {
      if (err) return res.status(500).json({ error: err.message });
      res.json({ id, name, baseUrl, apiKey, type, removeTopP });
    }
  );
});

app.put('/api/providers', requireAdmin, (req, res) => {
  const { id, name, baseUrl, apiKey, removeTopP } = req.body;
  
  if (apiKey && !apiKey.includes('...')) {
    db.run('UPDATE providers SET name = ?, baseUrl = ?, apiKey = ?, removeTopP = ? WHERE id = ?',
      [name, baseUrl, apiKey, removeTopP ? 1 : 0, id],
      function(err) {
        if (err) return res.status(500).json({ error: err.message });
        res.json({ updated: this.changes });
      }
    );
  } else {
    db.run('UPDATE providers SET name = ?, baseUrl = ?, removeTopP = ? WHERE id = ?',
      [name, baseUrl, removeTopP ? 1 : 0, id],
      function(err) {
        if (err) return res.status(500).json({ error: err.message });
        res.json({ updated: this.changes });
      }
    );
  }
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
  
  const stmt = db.prepare('INSERT OR REPLACE INTO models (id, providerId, name, maxInputTokens, maxOutputTokens, pricingModelId, inputPricePer1k, outputPricePer1k, isActive) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)');
  
  db.serialize(() => {
    models.forEach((m: any) => {
        stmt.run(m.id, m.providerId, m.name, m.maxInputTokens, m.maxOutputTokens, m.pricingModelId, m.inputPricePer1k || 0, m.outputPricePer1k || 0, m.isActive ? 1 : 0);
    });
    stmt.finalize((err) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json({ success: true, count: models.length });
    });
  });
});

app.put('/api/models', requireAdmin, (req, res) => {
    const m = req.body;
    db.run('UPDATE models SET name = ?, maxInputTokens = ?, maxOutputTokens = ?, pricingModelId = ?, inputPricePer1k = ?, outputPricePer1k = ?, isActive = ? WHERE id = ? AND providerId = ?',
        [m.name, m.maxInputTokens, m.maxOutputTokens, m.pricingModelId, m.inputPricePer1k || 0, m.outputPricePer1k || 0, m.isActive ? 1 : 0, m.id, m.providerId],
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
  const { id, name, token, createdAt, expiresAt, accessibleModelIds, usageCount, isActive, maxRequestsPerDay, maxRequestsPerMinute, maxTokenUsage, maxCostUsage } = req.body;
  db.run('INSERT INTO tokens (id, name, token, createdAt, expiresAt, accessibleModelIds, usageCount, isActive, maxRequestsPerDay, maxRequestsPerMinute, maxTokenUsage, maxCostUsage) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
    [id, name, token, createdAt, expiresAt, JSON.stringify(accessibleModelIds), usageCount, isActive !== undefined ? (isActive ? 1 : 0) : 1, maxRequestsPerDay, maxRequestsPerMinute, maxTokenUsage, maxCostUsage],
    function(err) {
        if (err) return res.status(500).json({ error: err.message });
        res.json(req.body);
    }
  );
});

app.put('/api/tokens', requireAdmin, (req, res) => {
  const { id, name, token, expiresAt, accessibleModelIds, isActive, maxRequestsPerDay, maxRequestsPerMinute, maxTokenUsage, maxCostUsage } = req.body;
  
  if (token) {
    db.run('UPDATE tokens SET name = ?, token = ?, expiresAt = ?, accessibleModelIds = ?, isActive = ?, maxRequestsPerDay = ?, maxRequestsPerMinute = ?, maxTokenUsage = ?, maxCostUsage = ? WHERE id = ?',
      [name, token, expiresAt, JSON.stringify(accessibleModelIds), isActive ? 1 : 0, maxRequestsPerDay, maxRequestsPerMinute, maxTokenUsage, maxCostUsage, id],
      function(err) {
          if (err) return res.status(500).json({ error: err.message });
          res.json({ updated: this.changes });
      }
    );
  } else {
    db.run('UPDATE tokens SET name = ?, expiresAt = ?, accessibleModelIds = ?, isActive = ?, maxRequestsPerDay = ?, maxRequestsPerMinute = ?, maxTokenUsage = ?, maxCostUsage = ? WHERE id = ?',
      [name, expiresAt, JSON.stringify(accessibleModelIds), isActive ? 1 : 0, maxRequestsPerDay, maxRequestsPerMinute, maxTokenUsage, maxCostUsage, id],
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

app.get('/api/errors', requireAdmin, (req, res) => {
    db.all('SELECT * FROM error_logs ORDER BY timestamp DESC LIMIT 100', [], (err, rows) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json(rows);
    });
});

app.delete('/api/errors/prune', requireAdmin, (req, res) => {
    // Delete ALL error logs
    db.run('DELETE FROM error_logs', [], function(err) {
        if (err) return res.status(500).json({ error: err.message });
        res.json({ deleted: this.changes, message: `Cleared all error logs` });
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

// --- OpenAI Compatible Proxy ---

async function handleChatRequest(req: express.Request, res: express.Response, inputFormat: 'openai' | 'anthropic' = 'openai') {
  const authHeader = req.headers.authorization || (inputFormat === 'anthropic' ? req.headers['x-api-key'] : undefined);
  if (!authHeader || (typeof authHeader === 'string' && !authHeader.startsWith('Bearer ') && inputFormat === 'openai')) {
    return res.status(401).json({ error: { message: "Missing or invalid Authorization header", type: "invalid_request_error" } });
  }
  
  let token = "";
  if (typeof authHeader === 'string') {
      token = authHeader.startsWith('Bearer ') ? authHeader.split(' ')[1] : authHeader;
  }

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

    // Token Usage Limit
    if (row.maxTokenUsage && row.maxTokenUsage > 0) {
        if ((row.inputTokens + row.outputTokens) >= row.maxTokenUsage) {
            return res.status(403).json({ error: { message: "Overall token usage limit reached." } });
        }
    }

    // Budget Limit
    if (row.maxCostUsage && row.maxCostUsage > 0) {
        if (row.totalCost >= row.maxCostUsage) {
            return res.status(403).json({ error: { message: "Budget limit reached. Please contact admin to increase balance." } });
        }
    }

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

    let body = req.body;
    if (inputFormat === 'anthropic') {
        body = convertAnthropicToOpenAIRequest(body);
    }

    const modelId = body.model;
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
                `SELECT m.*, p.baseUrl, p.apiKey as providerKey, p.type as providerType, p.removeTopP, p.lastUsedKeyIndex 
                 FROM models m 
                 JOIN providers p ON m.providerId = p.id 
                 WHERE p.name = ? AND m.name = ? AND m.isActive = 1 LIMIT 1`, 
                [providerName, modelName]
            );
        }

        // Fallback: Try searching by model name directly (legacy/ambiguous mode)
        if (!modelRow) {
            modelRow = await dbGet(
                `SELECT m.*, p.baseUrl, p.apiKey as providerKey, p.type as providerType, p.removeTopP, p.lastUsedKeyIndex 
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
      
      if (accessibleModels.length > 0 && !accessibleModels.includes(modelRow.id)) {
         return res.status(403).json({ error: { message: "Model access denied for this token" } });
      }

      // Check Input Token Limit
      const messages = body.messages || [];
      const inputContent = messages.map((m: any) => m.content || '').join('\n');
      const currentInputTokens = countTokens(inputContent, modelId);

      if (row.maxTokenUsage && row.maxTokenUsage > 0) {
        if ((row.inputTokens + row.outputTokens + currentInputTokens) > row.maxTokenUsage) {
            return res.status(403).json({ 
                error: { 
                    message: `Request would exceed the token usage limit. Current: ${row.inputTokens + row.outputTokens}, This Request: ${currentInputTokens}, Max: ${row.maxTokenUsage}`
                } 
            });
        }
      }

      if (modelRow.maxInputTokens && currentInputTokens > modelRow.maxInputTokens) {
        return res.status(400).json({ 
            error: { 
                message: `Input context length ${currentInputTokens} exceeds the limit of ${modelRow.maxInputTokens} for model '${modelId}'.`
            } 
        });
      }

      // --- Key Pool Rotation & Retries ---
      let apiKeys: string[] = [];
      try {
          const parsed = JSON.parse(modelRow.providerKey);
          apiKeys = Array.isArray(parsed) ? parsed : [modelRow.providerKey];
      } catch (e) {
          apiKeys = modelRow.providerKey ? [modelRow.providerKey] : [];
      }

      if (apiKeys.length === 0) {
          return res.status(500).json({ error: { message: "No API Key configured for this provider" } });
      }

      let lastUsedIndex = modelRow.lastUsedKeyIndex || 0;
      let startIndex = (lastUsedIndex + 1) % apiKeys.length;
      let currentAttempt = 0;
      let success = false;

      while (currentAttempt < apiKeys.length) {
          const keyIndex = (startIndex + currentAttempt) % apiKeys.length;
          const currentKey = apiKeys[keyIndex];
          currentAttempt++;

          try {
            // Prepare Request
            const isAnthropic = modelRow.providerType === 'anthropic';
            const cleanBase = modelRow.baseUrl.replace(/\/+$/, '');
            let providerUrl = '';
            
            if (isAnthropic) {
                // For Anthropic, we need /v1/messages. Ensure we don't double /v1
                const baseWithoutV1 = cleanBase.endsWith('/v1') ? cleanBase.slice(0, -3) : cleanBase;
                providerUrl = `${baseWithoutV1}/v1/messages`;
            } else {
                // For OpenAI compatible, we expect the user to provide the full base (e.g. .../v1)
                providerUrl = `${cleanBase}/chat/completions`;
            }
                
            const headers: any = {
              'Content-Type': 'application/json'
            };

            if (isAnthropic) {
                headers['x-api-key'] = currentKey;
                headers['anthropic-version'] = '2023-06-01';
            } else {
                headers['Authorization'] = `Bearer ${currentKey}`;
            }

            const isStreaming = body.stream === true;

            // Enforce max output tokens
            let finalMaxTokens = body.max_tokens;
            if (modelRow.maxOutputTokens) {
              if (!finalMaxTokens || finalMaxTokens > modelRow.maxOutputTokens) {
                finalMaxTokens = modelRow.maxOutputTokens;
              }
            }
            
            let requestBody = { ...body, model: modelRow.id };

            if (finalMaxTokens) {
              requestBody.max_tokens = finalMaxTokens;
            }

            if (modelRow.removeTopP) {
                delete requestBody.top_p;
            }

            if (isAnthropic) {
                requestBody = convertOpenAIToAnthropic(requestBody, modelRow.id);
            }

            // Proxy Request
            const proxyRes = await fetch(providerUrl, {
              method: 'POST',
              headers,
              body: JSON.stringify(requestBody)
            });

            if (!proxyRes.ok) {
               const errorText = await proxyRes.text();
               console.error(`Provider Key ${keyIndex} Error (${proxyRes.status}):`, errorText);

               db.run('INSERT INTO error_logs (tokenId, modelId, providerId, errorType, errorMessage, timestamp) VALUES (?, ?, ?, ?, ?, ?)',
                    [row.id, modelId, modelRow.providerId, 'provider_error', `Key Index ${keyIndex} - Status ${proxyRes.status}: ${errorText}`, new Date().toISOString()]);

               if (currentAttempt < apiKeys.length) continue;

               return res.json({
                  id: "chatcmpl-error",
                  object: "chat.completion",
                  created: Math.floor(Date.now() / 1000),
                  model: modelId,
                  choices: [{ index: 0, message: { role: "assistant", content: "No API Key can be used to make this request" }, finish_reason: "stop" }],
                  usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 }
               });
            }

            db.run('UPDATE providers SET lastUsedKeyIndex = ? WHERE id = ?', [keyIndex, modelRow.providerId]);
            success = true;

            if (isStreaming) {
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
                            
                            if (isAnthropic) {
                                const lines = chunk.split('\n');
                                for (const line of lines) {
                                    if (line.startsWith('data: ')) {
                                        try {
                                            const dataStr = line.substring(6);
                                            if (dataStr === '[DONE]') {
                                                if (inputFormat === 'openai') res.write('data: [DONE]\n\n');
                                                continue;
                                            }
                                            const anthropicEvent = JSON.parse(dataStr);
                                            
                                            if (inputFormat === 'anthropic') {
                                                res.write(line + '\n\n'); // Pass through
                                                if (anthropicEvent.type === 'content_block_delta') {
                                                    accumulatedOutput += anthropicEvent.delta.text || "";
                                                }
                                            } else {
                                                // Convert to OpenAI
                                                let openaiChunk = null;
                                                if (anthropicEvent.type === 'content_block_delta') {
                                                    const content = anthropicEvent.delta.text || "";
                                                    accumulatedOutput += content;
                                                    openaiChunk = {
                                                        id: "anthropic-msg",
                                                        object: "chat.completion.chunk",
                                                        created: Math.floor(Date.now() / 1000),
                                                        model: modelId,
                                                        choices: [{ index: 0, delta: { content }, finish_reason: null }]
                                                    };
                                                } else if (anthropicEvent.type === 'message_stop') {
                                                    openaiChunk = {
                                                        id: "anthropic-msg",
                                                        object: "chat.completion.chunk",
                                                        created: Math.floor(Date.now() / 1000),
                                                        model: modelId,
                                                        choices: [{ index: 0, delta: {}, finish_reason: "stop" }]
                                                    };
                                                }
                                                if (openaiChunk) res.write(`data: ${JSON.stringify(openaiChunk)}\n\n`);
                                            }
                                        } catch (e) {}
                                    }
                                }
                            } else {
                                // Destination is OpenAI
                                if (inputFormat === 'anthropic') {
                                    // Convert OpenAI SSE to Anthropic SSE
                                    const lines = chunk.split('\n');
                                    for (const line of lines) {
                                        if (line.startsWith('data: ') && line !== 'data: [DONE]') {
                                            try {
                                                const json = JSON.parse(line.substring(6));
                                                const content = json.choices?.[0]?.delta?.content || "";
                                                if (content) {
                                                    accumulatedOutput += content;
                                                    const anthropicChunk = {
                                                        type: "content_block_delta",
                                                        index: 0,
                                                        delta: { type: "text_delta", text: content }
                                                    };
                                                    res.write(`data: ${JSON.stringify(anthropicChunk)}\n\n`);
                                                }
                                                
                                                if (json.choices?.[0]?.finish_reason) {
                                                    const anthropicStop = { type: "message_delta", delta: { stop_reason: "end_turn", stop_sequence: null }, usage: { output_tokens: 0 } };
                                                    res.write(`data: ${JSON.stringify(anthropicStop)}\n\n`);
                                                    res.write(`data: {"type": "message_stop"}\n\n`);
                                                }
                                            } catch (e) {}
                                        } else if (line === 'data: [DONE]') {
                                            // Handled in finally
                                        }
                                    }
                                } else {
                                    res.write(chunk);
                                    
                                    const lines = chunk.split('\n');
                                    for (const line of lines) {
                                        if (line.startsWith('data: ') && line !== 'data: [DONE]') {
                                            try {
                                                const json = JSON.parse(line.substring(6));
                                                if (json.choices?.[0]?.delta?.content) {
                                                    accumulatedOutput += json.choices[0].delta.content;
                                                }
                                            } catch (e) {}
                                        }
                                    }
                                }
                            }
                        }
                    } catch (error) {
                        res.end();
                    } finally {
                        if (inputFormat === 'openai' && !isAnthropic) res.write('data: [DONE]\n\n');
                        res.end();
                        
                        const inputTokens = countTokens(inputContent, modelId);
                        const outputTokens = countTokens(accumulatedOutput, modelId);
                        const cost = ((inputTokens * (modelRow.inputPricePer1k || 0)) / 1000) + ((outputTokens * (modelRow.outputPricePer1k || 0)) / 1000);

                        db.run('UPDATE tokens SET usageCount = usageCount + 1, inputTokens = inputTokens + ?, outputTokens = outputTokens + ?, totalCost = totalCost + ? WHERE id = ?', [inputTokens, outputTokens, cost, row.id]);
                        db.run('INSERT INTO request_logs (tokenId, modelId, inputTokens, outputTokens, cost, timestamp) VALUES (?, ?, ?, ?, ?, ?)', [row.id, modelId, inputTokens, outputTokens, cost, new Date().toISOString()]);
                    }
                } else {
                    res.end();
                }
                return;
            }

            const responseText = await proxyRes.text();
            let data;
            try {
                data = JSON.parse(responseText);
                if (isAnthropic && inputFormat === 'openai') {
                    data = convertAnthropicToOpenAI(data, modelId);
                } else if (!isAnthropic && inputFormat === 'anthropic') {
                    data = convertOpenAIToAnthropicResponse(data, modelId);
                }
            } catch (e) {
                return res.status(502).json({ error: { message: "Invalid JSON response from provider" } });
            }
            
            const inputTokens = countTokens(inputContent, modelId);
            const outputContent = inputFormat === 'openai' ? (data.choices?.[0]?.message?.content || '') : (data.content?.[0]?.text || '');
            const outputTokens = countTokens(outputContent, modelId);
            const cost = ((inputTokens * (modelRow.inputPricePer1k || 0)) / 1000) + ((outputTokens * (modelRow.outputPricePer1k || 0)) / 1000);

            db.run('UPDATE tokens SET usageCount = usageCount + 1, inputTokens = inputTokens + ?, outputTokens = outputTokens + ?, totalCost = totalCost + ? WHERE id = ?', [inputTokens, outputTokens, cost, row.id]);
            db.run('INSERT INTO request_logs (tokenId, modelId, inputTokens, outputTokens, cost, timestamp) VALUES (?, ?, ?, ?, ?, ?)', [row.id, modelId, inputTokens, outputTokens, cost, new Date().toISOString()]);

            return res.json(data);

          } catch (e: any) {
            db.run('INSERT INTO error_logs (tokenId, modelId, providerId, errorType, errorMessage, timestamp) VALUES (?, ?, ?, ?, ?, ?)', [row.id, modelId, modelRow.providerId, 'server_error', `Key Index ${keyIndex} - ${e.message || String(e)}`, new Date().toISOString()]);
            if (currentAttempt < apiKeys.length) continue;
            return res.json({ error: { message: "All attempts failed" } });
          }
      }
  } catch (err: any) {
      res.status(500).json({ error: { message: "Internal server error" } });
  }
}

app.post('/v1/chat/completions', (req, res) => handleChatRequest(req, res, 'openai'));
app.post('/v1/messages', (req, res) => handleChatRequest(req, res, 'anthropic'));

// --- Static Frontend Serving ---
const distPath = path.join(__dirname, '../dist');
app.use(express.static(distPath));

// Handle SPA routing - return index.html for any non-API routes
app.get(/^(?!\/api|\/v1).*$/, (req, res, next) => {
  // Logic is redundant if regex handles it, but keeping 'next' safety or serving file
  res.sendFile(path.join(distPath, 'index.html'));
});

dbReady.then(() => {
  app.listen(PORT, '0.0.0.0', () => {
    console.log(`Server running on http://0.0.0.0:${PORT}`);
  });
}).catch(err => {
  console.error('Failed to initialize database:', err);
  process.exit(1);
});
