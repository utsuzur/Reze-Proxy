import express from 'express';
import cors from 'cors';
import path from 'path';
import { fileURLToPath } from 'url';
import db from './db.ts';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT ? parseInt(process.env.PORT) : 3000;

app.use(cors());
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ limit: '50mb', extended: true }));

// Request Logger
app.use((req, res, next) => {
  console.log(`[${new Date().toISOString()}] ${req.method} ${req.url} - ${req.ip}`);
  next();
});

// --- Providers ---
app.get('/api/providers', (req, res) => {
  db.all('SELECT * FROM providers', [], (err, rows) => {
    if (err) return res.status(500).json({ error: err.message });
    const formatted = (rows as any[]).map(r => ({
        ...r,
        apiKey: r.apiKey ? `${r.apiKey.substring(0, 3)}...${r.apiKey.substring(r.apiKey.length - 4)}` : undefined
    }));
    res.json(formatted);
  });
});

app.post('/api/providers', (req, res) => {
  const { id, name, baseUrl, apiKey, type } = req.body;
  db.run('INSERT INTO providers (id, name, baseUrl, apiKey, type) VALUES (?, ?, ?, ?, ?)', 
    [id, name, baseUrl, apiKey, type], 
    function(err) {
      if (err) return res.status(500).json({ error: err.message });
      res.json({ id, name, baseUrl, apiKey, type });
    }
  );
});

app.put('/api/providers', (req, res) => {
  const { id, name, baseUrl, apiKey } = req.body;
  db.run('UPDATE providers SET name = ?, baseUrl = ?, apiKey = ? WHERE id = ?',
    [name, baseUrl, apiKey, id],
    function(err) {
      if (err) return res.status(500).json({ error: err.message });
      res.json({ updated: this.changes });
    }
  );
});

app.delete('/api/providers/:id', (req, res) => {
  const { id } = req.params;
  db.run('DELETE FROM providers WHERE id = ?', [id], function(err) {
    if (err) return res.status(500).json({ error: err.message });
    res.json({ deleted: this.changes });
  });
});

// --- Models ---
app.get('/api/models', (req, res) => {
  db.all('SELECT * FROM models', [], (err, rows) => {
    if (err) return res.status(500).json({ error: err.message });
    const formatted = (rows as any[]).map((r) => ({
        ...r, 
        isActive: !!r.isActive
    }));
    res.json(formatted);
  });
});

app.post('/api/models', (req, res) => {
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

app.put('/api/models', (req, res) => {
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
app.get('/api/tokens', (req, res) => {
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

app.post('/api/tokens', (req, res) => {
  const { id, name, token, createdAt, expiresAt, accessibleModelIds, usageCount, isActive, maxRequestsPerDay, maxRequestsPerMinute } = req.body;
  db.run('INSERT INTO tokens (id, name, token, createdAt, expiresAt, accessibleModelIds, usageCount, isActive, maxRequestsPerDay, maxRequestsPerMinute) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
    [id, name, token, createdAt, expiresAt, JSON.stringify(accessibleModelIds), usageCount, isActive !== undefined ? (isActive ? 1 : 0) : 1, maxRequestsPerDay, maxRequestsPerMinute],
    function(err) {
        if (err) return res.status(500).json({ error: err.message });
        res.json(req.body);
    }
  );
});

app.put('/api/tokens', (req, res) => {
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

app.delete('/api/tokens/:id', (req, res) => {
  const { id } = req.params;
  db.run('DELETE FROM tokens WHERE id = ?', [id], function(err) {
    if (err) return res.status(500).json({ error: err.message });
    res.json({ deleted: this.changes });
  });
});

// --- User Token Self-Service ---
app.delete('/api/logs/prune', (req, res) => {
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
  db.all('SELECT DISTINCT name FROM models WHERE isActive = 1', [], (err, rows) => {
    if (err) return res.status(500).json({ error: err.message });
    const models = (rows as any[]).map(r => ({
        id: r.name, // Expose the model name as ID
        object: "model",
        created: Math.floor(Date.now() / 1000),
        owned_by: "reze-proxy"
    }));
    res.json({ object: "list", data: models });
  });
});

app.post('/v1/chat/completions', async (req, res) => {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: { message: "Missing or invalid Authorization header", type: "invalid_request_error" } });
  }
  const token = authHeader.split(' ')[1];

      // Validate Token
    db.get('SELECT * FROM tokens WHERE token = ?', [token], async (err, row: any) => {
      if (err) return res.status(500).json({ error: { message: "Internal server error" } });
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

    // Update Rate Limit Counters
    db.run(`UPDATE tokens SET 
        requestsToday = CASE WHEN lastRequestDate = ? THEN requestsToday + 1 ELSE 1 END,
        lastRequestDate = ?,
        requestsThisMinute = CASE WHEN lastRequestMinute = ? THEN requestsThisMinute + 1 ELSE 1 END,
        lastRequestMinute = ?
        WHERE id = ?`, 
        [todayStr, todayStr, currentMinuteStr, currentMinuteStr, row.id]);

    const modelId = req.body.model;
    if (!modelId) return res.status(400).json({ error: { message: "Model is required" } });

    // Find Provider & Model FIRST to resolve Public Name -> Internal ID
    db.get('SELECT m.*, p.baseUrl, p.apiKey as providerKey FROM models m JOIN providers p ON m.providerId = p.id WHERE m.name = ? AND m.isActive = 1 LIMIT 1', [modelId], async (err, modelRow: any) => {
      if (err) return res.status(500).json({ error: { message: "Database error" } });
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
    });
  });
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
