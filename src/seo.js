// Search engine helpers: sitemap, robots.txt, IndexNow key, verification tags.

export function siteBase(request, env) {
  if (env.SITE_URL) return String(env.SITE_URL).replace(/\/+$/, '');
  return new URL(request.url).origin;
}

export async function indexNowKey(env) {
  const data = new TextEncoder().encode(`referleey-indexnow:${env.ADMIN_PASSWORD || 'none'}`);
  const hex = [...new Uint8Array(await crypto.subtle.digest('SHA-256', data))].map((b) => b.toString(16).padStart(2, '0')).join('');
  return hex.slice(0, 32);
}

export async function sitemapUrls(db, base) {
  const urls = [
    { loc: `${base}/`, priority: '1.0' },
    { loc: `${base}/signup`, priority: '0.8' },
    { loc: `${base}/login`, priority: '0.3' },
  ];
  const [companies, jobs] = await Promise.all([
    db.prepare(`SELECT c.slug, MAX(j.created_at) AS updated FROM companies c JOIN jobs j ON j.company_id = c.id AND j.status = 'open'
                WHERE c.is_demo = 0 AND c.suspended = 0 GROUP BY c.id LIMIT 5000`).all(),
    db.prepare(`SELECT j.id, j.created_at FROM jobs j JOIN companies c ON c.id = j.company_id
                WHERE j.status = 'open' AND c.is_demo = 0 AND c.suspended = 0 ORDER BY j.created_at DESC LIMIT 40000`).all(),
  ]);
  for (const c of companies.results) urls.push({ loc: `${base}/careers?c=${encodeURIComponent(c.slug)}`, lastmod: c.updated?.slice(0, 10), priority: '0.7' });
  for (const j of jobs.results) urls.push({ loc: `${base}/apply?job=${encodeURIComponent(j.id)}`, lastmod: j.created_at?.slice(0, 10), priority: '0.6' });
  return urls;
}

const xmlEsc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

export async function sitemap(request, env) {
  const urls = await sitemapUrls(env.DB, siteBase(request, env));
  const xml = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls.map((u) =>
    `  <url><loc>${xmlEsc(u.loc)}</loc>${u.lastmod ? `<lastmod>${u.lastmod}</lastmod>` : ''}<priority>${u.priority}</priority></url>`).join('\n')}\n</urlset>\n`;
  return new Response(xml, { headers: { 'content-type': 'application/xml; charset=utf-8', 'cache-control': 'public, max-age=3600' } });
}

export function robots(request, env) {
  const base = siteBase(request, env);
  return new Response(`User-agent: *\nAllow: /\nDisallow: /app\nDisallow: /admin\nDisallow: /api/\n\nSitemap: ${base}/sitemap.xml\n`,
    { headers: { 'content-type': 'text/plain; charset=utf-8' } });
}

// Adds Google / Bing verification tags to public HTML pages when the secrets are set.
export function withVerification(response, env) {
  const tags = [];
  const clean = (v) => String(v).replace(/[^\w\-=.]/g, '');
  if (env.GOOGLE_SITE_VERIFICATION) tags.push(`<meta name="google-site-verification" content="${clean(env.GOOGLE_SITE_VERIFICATION)}">`);
  if (env.BING_SITE_VERIFICATION) tags.push(`<meta name="msvalidate.01" content="${clean(env.BING_SITE_VERIFICATION)}">`);
  if (!tags.length || !(response.headers.get('content-type') || '').includes('text/html')) return response;
  return new HTMLRewriter().on('head', { element(el) { el.append(tags.join(''), { html: true }); } }).transform(response);
}
