import { DurableObject } from 'cloudflare:workers';

// Live Earth demo telemetry relay.
// The Raspberry Pi connects to /api/telemetry/push with the TELEMETRY_TOKEN secret and sends
// one JSON sample per message. Every browser connected to /api/telemetry/live receives each
// sample. One Durable Object instance holds all sockets, so the Pi and viewers meet in one place.
const MAX_MESSAGE = 2048;
const FRESH_MS = 2000;
const BATCH_SIZE = 40;   // samples per Tiger Data insert
const BATCH_MS = 2000;   // or every 2 seconds, whichever comes first

export class TelemetryRelay extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
    this.last = null;
    this.lastAt = 0;
    this.batch = [];
    this.batchStarted = 0;
  }

  // Send buffered Pi samples to the mission API, which stores them in Tiger Data.
  flush() {
    const samples = this.batch.splice(0);
    this.batchStarted = 0;
    const { VULTR_ORIGIN, ORIGIN_TOKEN } = this.env;
    if (!samples.length || !VULTR_ORIGIN || !ORIGIN_TOKEN) return;
    const url = new URL(VULTR_ORIGIN);
    url.pathname = '/api/telemetry/ingest';
    url.search = '';
    const sent = fetch(url, {
      method: 'POST',
      headers: { Authorization: `Bearer ${ORIGIN_TOKEN}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ samples }),
    }).catch(() => { /* storage is best-effort; live relay keeps working */ });
    this.ctx.waitUntil?.(sent);
  }

  async fetch(request) {
    const role = new URL(request.url).searchParams.get('role') === 'pi' ? 'pi' : 'viewer';
    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair);
    if (role === 'pi') for (const old of this.ctx.getWebSockets('pi')) old.close(4000, 'replaced by a newer Pi connection');
    this.ctx.acceptWebSocket(server, [role]);
    if (role === 'viewer' && this.last && Date.now() - this.lastAt < FRESH_MS) server.send(this.last);
    return new Response(null, { status: 101, webSocket: client });
  }

  webSocketMessage(ws, message) {
    if (!this.ctx.getTags(ws).includes('pi')) return; // viewers are read-only
    if (typeof message !== 'string' || message.length > MAX_MESSAGE) return;
    let sample;
    try { sample = JSON.parse(message); if (!sample || typeof sample !== 'object') return; } catch { return; }
    this.last = message;
    this.lastAt = Date.now();
    for (const viewer of this.ctx.getWebSockets('viewer')) {
      try { viewer.send(message); } catch { /* viewer went away */ }
    }
    this.batch.push(sample);
    if (!this.batchStarted) this.batchStarted = Date.now();
    if (this.batch.length >= BATCH_SIZE || Date.now() - this.batchStarted >= BATCH_MS) this.flush();
  }

  webSocketClose(ws, code) {
    try { ws.close(code === 1005 ? 1000 : code, 'closed'); } catch { /* already closed */ }
  }
}

async function tokenMatches(given, expected) {
  if (!given || !expected) return false;
  const a = new TextEncoder().encode(given), b = new TextEncoder().encode(expected);
  if (a.byteLength !== b.byteLength) return false;
  return crypto.subtle.timingSafeEqual(a, b);
}

async function telemetry(request, env, pathname) {
  if (request.headers.get('Upgrade') !== 'websocket') return new Response('Expected a WebSocket upgrade.', { status: 426 });
  const relay = env.TELEMETRY.get(env.TELEMETRY.idFromName('live-earth-demo'));
  if (pathname === '/api/telemetry/live') return relay.fetch(new Request('https://relay/?role=viewer', request));
  // Push: token in the Authorization header (preferred) or ?token= for clients that cannot set headers.
  const header = request.headers.get('Authorization')?.replace(/^Bearer\s+/i, '');
  const token = header || new URL(request.url).searchParams.get('token');
  if (!(await tokenMatches(token, env.TELEMETRY_TOKEN))) return new Response('Unauthorized.', { status: 401 });
  return relay.fetch(new Request('https://relay/?role=pi', request));
}

// Older API servers compared saved tests as JSON text, which Postgres jsonb reorders, so every new
// save came back 409 although it was stored. Confirm the stored mission matches the request instead.
async function confirmSaved(conflict, body, url, headers) {
  try {
    const sent = JSON.parse(body);
    const soils = { A: sent.padASoil, B: sent.padBSoil };
    url.pathname = `/api/missions/${encodeURIComponent(sent.id)}`;
    const stored = await fetch(url, { headers: { Authorization: headers.get('Authorization') } });
    if (!stored.ok) return conflict;
    const saved = await stored.json();
    const tests = saved?.report?.tests ?? [];
    const matches = saved.report.siteId === sent.siteId && Array.isArray(sent.order)
      && tests.length === sent.order.length && tests.every((t, i) => t.pad === sent.order[i] && t.soil === soils[t.pad]);
    return matches ? Response.json(saved, { status: 201, headers: { 'Cache-Control': 'no-store' } }) : conflict;
  } catch {
    return conflict;
  }
}

export default {
  async fetch(request, env) {
    const { pathname } = new URL(request.url);
    if (!pathname.startsWith('/api/')) return env.ASSETS.fetch(request);
    if (pathname === '/api/telemetry/live' || pathname === '/api/telemetry/push') return telemetry(request, env, pathname);
    // Only the relay itself may write telemetry history; it calls the API directly with the origin token.
    if (pathname === '/api/telemetry/ingest') return Response.json({ error: 'Not found.' }, { status: 404 });
    try {
      const url = new URL(env.VULTR_ORIGIN);
      if (url.protocol !== 'https:' || !env.ORIGIN_TOKEN) throw Error();
      url.pathname = pathname;
      url.search = '';
      const headers = new Headers({ Authorization: `Bearer ${env.ORIGIN_TOKEN}` });
      const contentType = request.headers.get('Content-Type');
      if (contentType) headers.set('Content-Type', contentType);
      const isSave = request.method === 'POST' && pathname === '/api/missions';
      const body = isSave ? await request.text() : request.body;
      const response = await fetch(url, { method: request.method, headers, body, redirect: 'manual' });
      return isSave && response.status === 409 ? await confirmSaved(response, body, url, headers) : response;
    } catch {
      return Response.json({ error: 'Mission API unavailable. Retry shortly.' },
        { status: 503, headers: { 'Cache-Control': 'no-store' } });
    }
  },
};
