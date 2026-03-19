import 'dotenv/config';
import express from 'express';
import path from 'path';
import * as crypto from 'node:crypto';
import { fileURLToPath } from 'url';
import bcrypt from 'bcryptjs';
import db, { dbReady, updateSyncState } from './db.ts';
import * as schema from './schema.ts';
import { eq, and, sql, desc, lt } from 'drizzle-orm';

const DB_TYPE = process.env.DB_TYPE || 'sqlite';

// Helper to get the correct table based on DB_TYPE
const getTable = (tableName: string) => {
  const prefix = DB_TYPE === 'postgres' ? 'pg' : 'sqlite';
  const key = `${prefix}${tableName.charAt(0).toUpperCase()}${tableName.slice(1)}` as keyof typeof schema;
  return schema[key] as any;
};

const providers = getTable('providers');
const models = getTable('models');
const tokens = getTable('tokens');
const requestLogs = getTable('requestLogs');
const adminSessions = getTable('adminSessions');
const adminAuditLog = getTable('adminAuditLog');
const errorLogs = getTable('errorLogs');

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

// Helper to promisify db.get / db.run (Legacy - replacing with Drizzle)
const dbGet = async (sqlStr: string, params: any[]) => {
    // This is a temporary bridge for complex raw queries if needed
    // For now, we'll try to use Drizzle directly
    return null;
};

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
   
   await db.insert(adminAuditLog).values({
     timestamp,
     event,
     ip,
     userAgent,
     details: detailsJson
   });
   await updateSyncState();
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

 const results = await db.select().from(adminSessions).where(eq(adminSessions.selector, selector)).limit(1);
 const row = results[0] as AdminSessionRow | undefined;

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

   // Update lastSeenAt and sync state only if it's been more than 5 minutes
   const lastSeen = session.lastSeenAt ? new Date(session.lastSeenAt).getTime() : 0;
   const fiveMinutesAgo = Date.now() - (5 * 60 * 1000);
   
   if (lastSeen < fiveMinutesAgo) {
     await db.update(adminSessions)
       .set({ lastSeenAt: new Date().toISOString(), updatedAt: new Date().toISOString() })
       .where(eq(adminSessions.id, session.id));
     await updateSyncState();
   }

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
     await db.insert(adminSessions).values({
       selector,
       validatorHash,
       createdAt: nowIso,
       lastSeenAt: nowIso,
       expiresAt: expiresAtIso,
       revokedAt: null,
       ip: req.ip,
       userAgent: req.get('user-agent') || null,
       updatedAt: nowIso
     });
     await updateSyncState();
     created = true;
     break;
   } catch (e: any) {
     // Drizzle/DB unique constraint error check
     if (e.message?.includes('UNIQUE') || e.code === '23505') continue; 
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

   await db.update(adminSessions)
     .set({ revokedAt: nowIso, updatedAt: nowIso })
     .where(eq(adminSessions.id, session.id));
   await updateSyncState();
     
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
   // Use sql to handle updates where a condition is met across all records
   const result = await db.update(adminSessions)
     .set({ revokedAt: nowIso, updatedAt: nowIso })
     .where(sql`${adminSessions.revokedAt} IS NULL`);
   await updateSyncState();

   // result might not contain 'changes' depending on the driver, but audit is enough
   await auditAdminEvent(req, 'logout_all');

   clearAdminCookie(res);
   clearCsrfCookie(res);
   res.json({ ok: true });
 } catch (e) {
   console.error('/api/admin/logout-all error', e);
   res.status(500).json({ error: 'Internal server error' });
 }
});

/**
 * Public read endpoints for the landing page (no admin cookie required).
 * These intentionally avoid returning provider base URLs / keys.
 */
app.get('/api/public/providers', async (req, res) => {
  try {
    const rows = await db.select({
      id: providers.id,
      name: providers.name,
      type: providers.type
    })
    .from(providers)
    .innerJoin(models, eq(models.providerId, providers.id))
    .where(eq(models.isActive, 1))
    .groupBy(providers.id)
    .orderBy(providers.name);
    
    res.json(rows);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/public/models', async (req, res) => {
  try {
    const rows = await db.select({
      id: models.id,
      providerId: models.providerId,
      name: models.name,
      maxInputTokens: models.maxInputTokens,
      maxOutputTokens: models.maxOutputTokens,
      pricingModelId: models.pricingModelId,
      inputPricePer1k: models.inputPricePer1k,
      outputPricePer1k: models.outputPricePer1k,
      isActive: models.isActive,
      providerName: providers.name
    })
    .from(models)
    .innerJoin(providers, eq(models.providerId, providers.id))
    .where(eq(models.isActive, 1));

    const formatted = rows.map((r) => ({
      ...r,
      id: `${r.providerName}/${r.name}`,
      isActive: true
    }));
    res.json(formatted);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
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
app.get('/api/providers', requireAdmin, async (req, res) => {
  try {
    const rows = await db.select().from(providers);
    const formatted = rows.map(r => {
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
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/providers', requireAdmin, async (req, res) => {
  const { id, name, baseUrl, apiKey, type, removeTopP } = req.body;
  try {
    const nowIso = new Date().toISOString();
    await db.insert(providers).values({
      id,
      name,
      baseUrl,
      apiKey,
      type,
      removeTopP: removeTopP ? 1 : 0,
      createdAt: nowIso,
      updatedAt: nowIso
    });
    await updateSyncState();
    res.json({ id, name, baseUrl, apiKey, type, removeTopP });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

app.put('/api/providers', requireAdmin, async (req, res) => {
  const { id, name, baseUrl, apiKey, removeTopP } = req.body;
  const nowIso = new Date().toISOString();
  
  try {
    if (apiKey && !apiKey.includes('...')) {
      await db.update(providers)
        .set({ name, baseUrl, apiKey, removeTopP: removeTopP ? 1 : 0, updatedAt: nowIso })
        .where(eq(providers.id, id));
    } else {
      await db.update(providers)
        .set({ name, baseUrl, removeTopP: removeTopP ? 1 : 0, updatedAt: nowIso })
        .where(eq(providers.id, id));
    }
    await updateSyncState();
    res.json({ updated: 1 });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

app.delete('/api/providers/:id', requireAdmin, async (req, res) => {
  const { id } = req.params;
  try {
    await db.delete(providers).where(eq(providers.id, id));
    await updateSyncState();
    res.json({ deleted: 1 });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// --- Models ---
app.get('/api/models', requireAdmin, async (req, res) => {
  try {
    const rows = await db.select().from(models);
    const formatted = rows.map((r) => ({
        ...r, 
        isActive: !!r.isActive
    }));
    res.json(formatted);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/models', requireAdmin, async (req, res) => {
  const modelData = Array.isArray(req.body) ? req.body : [req.body];
  const nowIso = new Date().toISOString();
  
  try {
    // Upsert logic for Drizzle (onConflictDoUpdate)
    // Note: SQLite and PG have slightly different conflict syntax in Drizzle if not using the common helper,
    // but here we can just use a loop if it's easier or use the specific driver features.
    // To be safe across both, we can do it in a loop for now or use the insert...onConflict syntax.
    
    for (const m of modelData) {
        await db.insert(models).values({
            id: m.id,
            providerId: m.providerId,
            name: m.name,
            maxInputTokens: m.maxInputTokens,
            maxOutputTokens: m.maxOutputTokens,
            pricingModelId: m.pricingModelId,
            inputPricePer1k: m.inputPricePer1k || 0,
            outputPricePer1k: m.outputPricePer1k || 0,
            isActive: m.isActive ? 1 : 0,
            createdAt: nowIso,
            updatedAt: nowIso
        }).onConflictDoUpdate({
            target: [models.id, models.providerId],
            set: {
                name: m.name,
                maxInputTokens: m.maxInputTokens,
                maxOutputTokens: m.maxOutputTokens,
                pricingModelId: m.pricingModelId,
                inputPricePer1k: m.inputPricePer1k || 0,
                outputPricePer1k: m.outputPricePer1k || 0,
                isActive: m.isActive ? 1 : 0,
                updatedAt: nowIso
            }
        });
    }
    await updateSyncState();
    res.json({ success: true, count: modelData.length });
  } catch (err: any) {
    console.error("Models upsert error:", err);
    res.status(500).json({ error: err.message });
  }
});

app.put('/api/models', requireAdmin, async (req, res) => {
    const m = req.body;
    const nowIso = new Date().toISOString();
    try {
        await db.update(models)
            .set({
                name: m.name,
                maxInputTokens: m.maxInputTokens,
                maxOutputTokens: m.maxOutputTokens,
                pricingModelId: m.pricingModelId,
                inputPricePer1k: m.inputPricePer1k || 0,
                outputPricePer1k: m.outputPricePer1k || 0,
                isActive: m.isActive ? 1 : 0,
                updatedAt: nowIso
            })
            .where(and(eq(models.id, m.id), eq(models.providerId, m.providerId)));
        await updateSyncState();
        res.json({ updated: 1 });
    } catch (err: any) {
        res.status(500).json({ error: err.message });
    }
});


// --- Tokens ---
app.get('/api/tokens', requireAdmin, async (req, res) => {
  try {
    const rows = await db.select().from(tokens);
    const formatted = rows.map((r) => {
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
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/tokens', requireAdmin, async (req, res) => {
  const { id, name, token, createdAt, expiresAt, accessibleModelIds, usageCount, isActive, maxRequestsPerDay, maxRequestsPerMinute, maxTokenUsage, maxCostUsage, tokenType, creditBalance } = req.body;
  const nowIso = new Date().toISOString();
  try {
    await db.insert(tokens).values({
      id,
      name,
      token,
      createdAt: createdAt || nowIso,
      expiresAt: expiresAt,
      accessibleModelIds: JSON.stringify(accessibleModelIds),
      usageCount: usageCount || 0,
      isActive: isActive !== undefined ? (isActive ? 1 : 0) : 1,
      maxRequestsPerDay,
      maxRequestsPerMinute,
      maxTokenUsage,
      maxCostUsage,
      tokenType: tokenType || 'rpd',
      creditBalance: creditBalance || 0,
      updatedAt: nowIso
    });
    await updateSyncState();
    res.json(req.body);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

app.put('/api/tokens', requireAdmin, async (req, res) => {
  const { id, name, token, expiresAt, accessibleModelIds, isActive, maxRequestsPerDay, maxRequestsPerMinute, maxTokenUsage, maxCostUsage, tokenType, creditBalance } = req.body;
  const nowIso = new Date().toISOString();
  
  try {
    const updateData: any = {
      name,
      expiresAt,
      accessibleModelIds: JSON.stringify(accessibleModelIds),
      isActive: isActive ? 1 : 0,
      maxRequestsPerDay,
      maxRequestsPerMinute,
      maxTokenUsage,
      maxCostUsage,
      tokenType,
      creditBalance,
      updatedAt: nowIso
    };
    if (token) updateData.token = token;

    await db.update(tokens).set(updateData).where(eq(tokens.id, id));
    await updateSyncState();
    res.json({ updated: 1 });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

app.delete('/api/tokens/:id', requireAdmin, async (req, res) => {
  const { id } = req.params;
  try {
    await db.delete(tokens).where(eq(tokens.id, id));
    await updateSyncState();
    res.json({ deleted: 1 });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// --- Admin Maintenance ---
app.delete('/api/logs/prune', requireAdmin, async (req, res) => {
    // Delete logs older than 30 days
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
    const timestamp = thirtyDaysAgo;

    try {
        await db.delete(requestLogs).where(lt(requestLogs.timestamp, timestamp));
        await updateSyncState();
        res.json({ success: true, message: `Pruned logs older than ${timestamp.toISOString()}` });
    } catch (err: any) {
        res.status(500).json({ error: err.message });
    }
});

app.get('/api/errors', requireAdmin, async (req, res) => {
    try {
        const rows = await db.select().from(errorLogs).orderBy(desc(errorLogs.timestamp)).limit(100);
        res.json(rows);
    } catch (err: any) {
        res.status(500).json({ error: err.message });
    }
});

app.delete('/api/errors/prune', requireAdmin, async (req, res) => {
    try {
        await db.delete(errorLogs);
        await updateSyncState();
        res.json({ success: true, message: `Cleared all error logs` });
    } catch (err: any) {
        res.status(500).json({ error: err.message });
    }
});

app.post('/api/my-token/details', async (req, res) => {
    const { token: tokenStr } = req.body;
    if (!tokenStr) return res.status(400).json({ error: "Token is required" });

    try {
        const tokenRows = await db.select().from(tokens).where(eq(tokens.token, tokenStr)).limit(1);
        const row = tokenRows[0];
        if (!row) return res.status(404).json({ error: "Invalid token" });

        const logs = await db.select().from(requestLogs).where(eq(requestLogs.tokenId, row.id)).orderBy(desc(requestLogs.timestamp)).limit(50);
        
        // Calculate remaining RPD
        const now = new Date();
        const todayStr = now.toISOString().split('T')[0];
        const remainingRequestsToday = (row.maxRequestsPerDay && row.maxRequestsPerDay > 0) 
            ? Math.max(0, row.maxRequestsPerDay - (row.lastRequestDate === todayStr ? (row.requestsToday || 0) : 0))
            : null; 
        
        res.json({
            ...row,
            isActive: !!row.isActive,
            remainingRequestsToday,
            logs
        });
    } catch (err: any) {
        res.status(500).json({ error: err.message });
    }
});

app.put('/api/my-token/name', async (req, res) => {
    const { token: tokenStr, name } = req.body;
    if (!tokenStr || !name) return res.status(400).json({ error: "Token and name are required" });

    try {
        const tokenRows = await db.select({ id: tokens.id }).from(tokens).where(eq(tokens.token, tokenStr)).limit(1);
        const row = tokenRows[0];
        if (!row) return res.status(404).json({ error: "Invalid token" });

        await db.update(tokens).set({ name, updatedAt: new Date().toISOString() }).where(eq(tokens.id, row.id));
        await updateSyncState();
        res.json({ success: true, name });
    } catch (err: any) {
        res.status(500).json({ error: err.message });
    }
});

// --- Shrine Status ---
app.get('/api/status', (req, res) => {
  res.json({
    status: 'operational',
    name: 'Reze Proxy',
    version: '1.0.0',
    message: "Let's run away together.",
    database: {
        type: DB_TYPE,
        externalConnected: DB_TYPE === 'postgres',
        syncEnabled: process.env.DB_SYNC_ON_STARTUP === 'true'
    },
    endpoints: {
      admin: '/shrine',
      api: '/api'
    }
  });
});

import { countTokens, countMessagesTokens } from './tokenService.ts';

// --- OpenAI Compatible Proxy ---

app.get('/v1/models', async (req, res) => {
  try {
    const rows = await db.select({
      name: models.name,
      providerName: providers.name
    })
    .from(models)
    .innerJoin(providers, eq(models.providerId, providers.id))
    .where(eq(models.isActive, 1));

    const formatted = rows.map(r => ({
        id: `${r.providerName}/${r.name}`, // Expose provider/model
        object: "model",
        created: Math.floor(Date.now() / 1000),
        owned_by: "reze-proxy"
    }));
    res.json({ object: "list", data: formatted });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
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
  
  let tokenStr = "";
  if (typeof authHeader === 'string') {
      tokenStr = authHeader.startsWith('Bearer ') ? authHeader.split(' ')[1] : authHeader;
  }

  try {
      // 1. Get Token (Cache -> DB)
      let row: any = tokenCache.get(tokenStr);
      if (!row) {
          const results = await db.select().from(tokens).where(eq(tokens.token, tokenStr)).limit(1);
          row = results[0];
          if (row) tokenCache.set(tokenStr, row);
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
        if (((row.inputTokens || 0) + (row.outputTokens || 0)) >= row.maxTokenUsage) {
            return res.status(403).json({ error: { message: "Overall token usage limit reached." } });
        }
    }

    // Budget Limit
    if (row.maxCostUsage && row.maxCostUsage > 0) {
        if ((row.totalCost || 0) >= row.maxCostUsage) {
            return res.status(403).json({ error: { message: "Budget limit reached. Please contact admin to increase balance." } });
        }
    }

    // Credit System check
    if (row.tokenType === 'credits') {
        if ((row.creditBalance || 0) <= 0) {
            return res.status(403).json({ error: { message: "Insufficient credits. Please contact admin to top up." } });
        }
    }

    // Daily Limit
    if (row.maxRequestsPerDay && row.maxRequestsPerDay > 0) {
        if (row.lastRequestDate === todayStr && (row.requestsToday || 0) >= row.maxRequestsPerDay) {
             return res.status(429).json({ error: { message: "Daily request limit reached. Resets at 00:00 UTC." } });
        }
    }

    // Minute Limit
    if (row.maxRequestsPerMinute && row.maxRequestsPerMinute > 0) {
         if (row.lastRequestMinute === currentMinuteStr && (row.requestsThisMinute || 0) >= row.maxRequestsPerMinute) {
             return res.status(429).json({ error: { message: "Rate limit exceeded. Please wait a minute." } });
         }
    }
    
    // Increment in-memory to reflect immediate change (optimistic)
    if (row.lastRequestDate !== todayStr) { row.requestsToday = 1; row.lastRequestDate = todayStr; }
    else { row.requestsToday = (row.requestsToday || 0) + 1; }
    
    if (row.lastRequestMinute !== currentMinuteStr) { row.requestsThisMinute = 1; row.lastRequestMinute = currentMinuteStr; }
    else { row.requestsThisMinute = (row.requestsThisMinute || 0) + 1; }
    
    tokenCache.set(tokenStr, row); // Update cache with new counters

    await db.update(tokens).set({
        requestsToday: row.requestsToday,
        lastRequestDate: todayStr,
        requestsThisMinute: row.requestsThisMinute,
        lastRequestMinute: currentMinuteStr,
        updatedAt: now.toISOString()
    }).where(eq(tokens.id, row.id));
    await updateSyncState();

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
            
            const results = await db.select({
                id: models.id,
                providerId: models.providerId,
                name: models.name,
                maxInputTokens: models.maxInputTokens,
                maxOutputTokens: models.maxOutputTokens,
                pricingModelId: models.pricingModelId,
                inputPricePer1k: models.inputPricePer1k,
                outputPricePer1k: models.outputPricePer1k,
                isActive: models.isActive,
                baseUrl: providers.baseUrl,
                providerKey: providers.apiKey,
                providerType: providers.type,
                removeTopP: providers.removeTopP,
                lastUsedKeyIndex: providers.lastUsedKeyIndex
            })
            .from(models)
            .innerJoin(providers, eq(models.providerId, providers.id))
            .where(and(eq(providers.name, providerName), eq(models.name, modelName), eq(models.isActive, 1)))
            .limit(1);
            
            modelRow = results[0];
        }

        // Fallback: Try searching by model name directly (legacy/ambiguous mode)
        if (!modelRow) {
            const results = await db.select({
                id: models.id,
                providerId: models.providerId,
                name: models.name,
                maxInputTokens: models.maxInputTokens,
                maxOutputTokens: models.maxOutputTokens,
                pricingModelId: models.pricingModelId,
                inputPricePer1k: models.inputPricePer1k,
                outputPricePer1k: models.outputPricePer1k,
                isActive: models.isActive,
                baseUrl: providers.baseUrl,
                providerKey: providers.apiKey,
                providerType: providers.type,
                removeTopP: providers.removeTopP,
                lastUsedKeyIndex: providers.lastUsedKeyIndex
            })
            .from(models)
            .innerJoin(providers, eq(models.providerId, providers.id))
            .where(and(eq(models.name, modelId), eq(models.isActive, 1)))
            .limit(1);
            
            modelRow = results[0];
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
      const currentInputTokens = countMessagesTokens(messages, modelId, modelRow.providerType);

      if (row.maxTokenUsage && row.maxTokenUsage > 0) {
        if (((row.inputTokens || 0) + (row.outputTokens || 0) + currentInputTokens) > row.maxTokenUsage) {
            return res.status(403).json({ 
                error: { 
                    message: `Request would exceed the token usage limit. Current: ${(row.inputTokens || 0) + (row.outputTokens || 0)}, This Request: ${currentInputTokens}, Max: ${row.maxTokenUsage}`
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
          const parsed = JSON.parse(modelRow.providerKey || '[]');
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

               await db.insert(errorLogs).values({
                   tokenId: row.id,
                   modelId,
                   providerId: modelRow.providerId,
                   errorType: 'provider_error',
                   errorMessage: `Key Index ${keyIndex} - Status ${proxyRes.status}: ${errorText}`,
                   timestamp: new Date().toISOString()
               });
               await updateSyncState();

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

            await db.update(providers).set({ lastUsedKeyIndex: keyIndex, updatedAt: new Date().toISOString() }).where(eq(providers.id, modelRow.providerId));
            await updateSyncState();
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
                    let streamUsage: { prompt_tokens?: number, completion_tokens?: number } = {};
                    let lineBuffer = "";

                    try {
                        while (true) {
                            const { done, value } = await reader.read();
                            if (done) break;
                            const chunk = decoder.decode(value, { stream: true });
                            
                            const fullChunk = lineBuffer + chunk;
                            const lines = fullChunk.split('\n');
                            lineBuffer = lines.pop() || "";

                            if (isAnthropic) {
                                for (const line of lines) {
                                    if (line.startsWith('data: ')) {
                                        try {
                                            const dataStr = line.substring(6);
                                            if (dataStr === '[DONE]') {
                                                if (inputFormat === 'openai') res.write('data: [DONE]\n\n');
                                                continue;
                                            }
                                            const anthropicEvent = JSON.parse(dataStr);
                                            
                                            if (anthropicEvent.type === 'message_start') {
                                                streamUsage.prompt_tokens = anthropicEvent.message?.usage?.input_tokens;
                                            } else if (anthropicEvent.type === 'message_delta') {
                                                if (anthropicEvent.usage?.output_tokens) {
                                                    streamUsage.completion_tokens = anthropicEvent.usage.output_tokens;
                                                }
                                            }

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
                                    for (const line of lines) {
                                        if (line.startsWith('data: ') && line !== 'data: [DONE]') {
                                            try {
                                                const json = JSON.parse(line.substring(6));
                                                
                                                if (json.usage) {
                                                    streamUsage.prompt_tokens = json.usage.prompt_tokens;
                                                    streamUsage.completion_tokens = json.usage.completion_tokens;
                                                }

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
                                    
                                    for (const line of lines) {
                                        if (line.startsWith('data: ') && line !== 'data: [DONE]') {
                                            try {
                                                const json = JSON.parse(line.substring(6));
                                                if (json.usage) {
                                                    streamUsage.prompt_tokens = json.usage.prompt_tokens;
                                                    streamUsage.completion_tokens = json.usage.completion_tokens;
                                                }
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
                        
                        try {
                            const inputTokens = streamUsage.prompt_tokens || currentInputTokens;
                            const outputTokens = streamUsage.completion_tokens || countTokens(accumulatedOutput, modelId, modelRow.providerType);
                            const cost = ((inputTokens * (modelRow.inputPricePer1k || 0)) / 1000) + ((outputTokens * (modelRow.outputPricePer1k || 0)) / 1000);

                            const updateValues: any = {
                                usageCount: (row.usageCount || 0) + 1,
                                inputTokens: (row.inputTokens || 0) + inputTokens,
                                outputTokens: (row.outputTokens || 0) + outputTokens,
                                totalCost: (row.totalCost || 0) + cost,
                                updatedAt: new Date().toISOString()
                            };

                            if (row.tokenType === 'credits') {
                                updateValues.creditBalance = (row.creditBalance || 0) - cost;
                            }

                            await db.update(tokens).set(updateValues).where(eq(tokens.id, row.id));

                            await db.insert(requestLogs).values({
                                tokenId: row.id,
                                modelId,
                                inputTokens,
                                outputTokens,
                                cost,
                                timestamp: new Date().toISOString()
                            });
                            await updateSyncState();
                        } catch (dbErr) {
                            console.error("Error updating usage after stream:", dbErr);
                        }
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
            
            const inputTokens = data.usage?.prompt_tokens || currentInputTokens;
            const outputContent = inputFormat === 'openai' ? (data.choices?.[0]?.message?.content || '') : (data.content?.[0]?.text || '');
            const outputTokens = data.usage?.completion_tokens || countTokens(outputContent, modelId, modelRow.providerType);
            const cost = ((inputTokens * (modelRow.inputPricePer1k || 0)) / 1000) + ((outputTokens * (modelRow.outputPricePer1k || 0)) / 1000);

            const updateValues: any = {
                usageCount: (row.usageCount || 0) + 1,
                inputTokens: (row.inputTokens || 0) + inputTokens,
                outputTokens: (row.outputTokens || 0) + outputTokens,
                totalCost: (row.totalCost || 0) + cost,
                updatedAt: new Date().toISOString()
            };

            if (row.tokenType === 'credits') {
                updateValues.creditBalance = (row.creditBalance || 0) - cost;
            }

            await db.update(tokens).set(updateValues).where(eq(tokens.id, row.id));

            await db.insert(requestLogs).values({
                tokenId: row.id,
                modelId,
                inputTokens,
                outputTokens,
                cost,
                timestamp: new Date().toISOString()
            });
            await updateSyncState();

            return res.json(data);

          } catch (e: any) {
            try {
                await db.insert(errorLogs).values({
                    tokenId: row.id,
                    modelId,
                    providerId: modelRow.providerId,
                    errorType: 'server_error',
                    errorMessage: `Key Index ${keyIndex} - ${e.message || String(e)}`,
                    timestamp: new Date().toISOString()
                });
                await updateSyncState();
            } catch (dbErr) {
                console.error("Failed to log error to DB:", dbErr);
            }
            
            if (currentAttempt < apiKeys.length) continue;
            if (!res.headersSent) {
                return res.json({ error: { message: "All attempts failed" } });
            }
            return;
          }
      }
  } catch (err: any) {
      console.error("handleChatRequest error:", err);
      if (!res.headersSent) {
          res.status(500).json({ error: { message: "Internal server error" } });
      }
  }
}

app.post('/v1/chat/completions', (req, res) => handleChatRequest(req, res, 'openai'));
app.post('/v1/messages', (req, res) => handleChatRequest(req, res, 'anthropic'));

// --- Static Frontend Serving ---
const distPath = path.join(__dirname, '../dist');
app.use(express.static(distPath));

import { syncDatabases } from './sync.ts';
import { initializeSchemas } from './initDb.ts';

// Handle SPA routing - return index.html for any non-API routes
app.get(/^(?!\/api|\/v1).*$/, (req, res, next) => {
  // Logic is redundant if regex handles it, but keeping 'next' safety or serving file
  res.sendFile(path.join(distPath, 'index.html'));
});

const startServer = async () => {
    try {
        // 1. Initialize schema (ensures tables exist in both DBs)
        await initializeSchemas();

        // 2. Run sync if configured
        if (process.env.DB_SYNC_ON_STARTUP === 'true') {
            console.log('Starting database synchronization...');
            await syncDatabases();
        }

        app.listen(PORT, '0.0.0.0', () => {
            console.log(`Server running on http://0.0.0.0:${PORT}`);
        });
    } catch (err) {
        console.error('Failed to start server:', err);
        process.exit(1);
    }
};

startServer();
