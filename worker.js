export default {
  async fetch(request, env) {
    const { pathname } = new URL(request.url);
    if (!pathname.startsWith('/api/')) return env.ASSETS.fetch(request);
    try {
      const url = new URL(env.VULTR_ORIGIN);
      if (url.protocol !== 'https:' || !env.ORIGIN_TOKEN) throw Error();
      url.pathname = pathname;
      url.search = '';
      const headers = new Headers({ Authorization: `Bearer ${env.ORIGIN_TOKEN}` });
      const contentType = request.headers.get('Content-Type');
      if (contentType) headers.set('Content-Type', contentType);
      return await fetch(url, {
        method: request.method,
        headers,
        body: request.body,
        redirect: 'manual',
      });
    } catch {
      return Response.json({ error: 'Mission API unavailable. Retry shortly.' },
        { status: 503, headers: { 'Cache-Control': 'no-store' } });
    }
  },
};
