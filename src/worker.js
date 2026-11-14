// Entry point for Cloudflare Workers: /api/* goes to the API, a few SEO files are generated,
// everything else is a static file from public/.
import { onRequest, ensureSchema } from './api.js';
import { sitemap, robots, indexNowKey, withVerification } from './seo.js';

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname.startsWith('/api/')) {
      const path = url.pathname.slice(5).split('/').filter(Boolean);
      return onRequest({ request, env, params: { path } });
    }
    if (env.DB && (url.pathname === '/sitemap.xml' || url.pathname === '/robots.txt' || /^\/[0-9a-f]{32}\.txt$/.test(url.pathname))) {
      await ensureSchema(env.DB);
      if (url.pathname === '/sitemap.xml') return sitemap(request, env);
      if (url.pathname === '/robots.txt') return robots(request, env);
      const key = await indexNowKey(env);
      if (url.pathname === `/${key}.txt`) return new Response(key, { headers: { 'content-type': 'text/plain' } });
    }
    return withVerification(await env.ASSETS.fetch(request), env);
  },
};
