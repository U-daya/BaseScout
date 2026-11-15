import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import pg from 'pg';
import { missionApi } from './api.js';
import { twilioConfig } from './notify.js';

const { DATABASE_URL, ORIGIN_TOKEN, GEMINI_API_KEY, GEMINI_MODEL = 'gemini-3.6-flash', XAI_API_KEY, XAI_MODEL = 'grok-4', HOST = '127.0.0.1', PORT = '8788' } = process.env;
if (!DATABASE_URL) throw Error('Set DATABASE_URL in server/.env.');
if (HOST !== '127.0.0.1' && !ORIGIN_TOKEN) throw Error('Set ORIGIN_TOKEN before exposing the backend.');
const db = new pg.Pool({ connectionString: DATABASE_URL, max: 5, connectionTimeoutMillis: 5000, statement_timeout: 5000 });
db.on('error', error => console.error('Idle database connection failed', error.code));
await db.query(await readFile(new URL('./schema.sql', import.meta.url), 'utf8'));
const twilio = twilioConfig(process.env);
const api = missionApi(db, ORIGIN_TOKEN, { apiKey: GEMINI_API_KEY, model: GEMINI_MODEL }, twilio, { apiKey: XAI_API_KEY, model: XAI_MODEL });
console.log(twilio ? 'Twilio SMS alerts enabled' : 'Twilio not configured; SMS alerts off');
console.log(GEMINI_API_KEY ? `Gemini debrief enabled (${GEMINI_MODEL})` : 'GEMINI_API_KEY not set; using rule-based debriefs');
console.log(XAI_API_KEY ? `Grok Ask Mission Control enabled (${XAI_MODEL})` : 'XAI_API_KEY not set; Ask Mission Control off');

createServer(async (incoming, outgoing) => {
  try {
    const chunks = [];
    let size = 0;
    for await (const chunk of incoming.iterator({ destroyOnReturn: false })) {
      size += chunk.length;
      if (size > 2048) {
        outgoing.writeHead(413, { 'Content-Type': 'application/json', Connection: 'close' });
        outgoing.end(JSON.stringify({ error: 'Request too large.' }));
        return;
      }
      chunks.push(chunk);
    }
    const request = new Request(new URL(incoming.url, 'http://localhost'), {
      method: incoming.method,
      headers: incoming.headers,
      body: chunks.length ? Buffer.concat(chunks) : undefined,
    });
    const response = await api(request);
    outgoing.writeHead(response.status, Object.fromEntries(response.headers));
    outgoing.end(await response.text());
  } catch (error) {
    console.error('Mission API request failed', error.code ?? error.name);
    outgoing.writeHead(503, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
    outgoing.end(JSON.stringify({ error: 'Mission storage unavailable. Retry shortly.' }));
  }
}).listen(Number(PORT), HOST, () => console.log(`Mission API listening on ${HOST}:${PORT}`));
