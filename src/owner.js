// Site-owner admin API (/api/owner/*). Signs in with the ADMIN_PASSWORD secret,
// the same way the LeeysPremium admin does, and sees every company on the platform.
import {
  HttpError, json, now, uid, str, body, getCookie, safeEqual, sha256,
  getSetting, setSetting, resetPasswordFor, STAGES,
} from './api.js';
import { siteBase, indexNowKey, sitemapUrls } from './seo.js';

const OWNER_COOKIE = 'rl_owner';
const OWNER_HOURS = 12;

async function hmac(env, text) {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(`rl-owner:${env.ADMIN_PASSWORD}`),
    { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(text));
  return [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, '0')).join('');
}
function ownerCookie(request, value, maxAge) {
  const secure = new URL(request.url).protocol === 'https:' ? ' Secure;' : '';
  return `${OWNER_COOKIE}=${value}; HttpOnly;${secure} SameSite=Strict; Path=/; Max-Age=${maxAge}`;
}
async function isOwner(request, env) {
  if (!env.ADMIN_PASSWORD) return false;
  const raw = getCookie(request, OWNER_COOKIE);
  if (!raw) return false;
  const [exp, sig] = raw.split('.');
  if (!exp || !sig || Number(exp) < Date.now()) return false;
  return safeEqual(sig, await hmac(env, `session:${exp}`));
}

const daysAgoISO = (d) => new Date(Date.now() - d * 864e5).toISOString();
const dayKey = (d) => daysAgoISO(d).slice(0, 10);
function rangeDays(url, def = 30) {
  return Math.min(365, Math.max(1, Number(url.searchParams.get('days')) || def));
}

// Removes companies and everything that belongs to them.
async function deleteCompanies(db, where, binds = []) {
  const ids = `(SELECT id FROM companies WHERE ${where})`;
  await db.batch([
    db.prepare(`DELETE FROM referral_events WHERE referral_id IN (SELECT id FROM referrals WHERE company_id IN ${ids})`).bind(...binds),
    db.prepare(`DELETE FROM referrals WHERE company_id IN ${ids}`).bind(...binds),
    db.prepare(`DELETE FROM jobs WHERE company_id IN ${ids}`).bind(...binds),
    db.prepare(`DELETE FROM sessions WHERE user_id IN (SELECT id FROM users WHERE company_id IN ${ids})`).bind(...binds),
    db.prepare(`DELETE FROM messages WHERE thread_id IN (SELECT id FROM threads WHERE company_id IN ${ids})`).bind(...binds),
    db.prepare(`DELETE FROM threads WHERE company_id IN ${ids}`).bind(...binds),
    db.prepare(`DELETE FROM stats WHERE company_id IN ${ids}`).bind(...binds),
    db.prepare(`DELETE FROM users WHERE company_id IN ${ids}`).bind(...binds),
    db.prepare(`DELETE FROM companies WHERE ${where}`).bind(...binds),
  ]);
}

// ---------- dashboard ----------
async function dashboard(db) {
  const d30 = daysAgoISO(30), today = dayKey(0);
  const one = (sql, ...b) => db.prepare(sql).bind(...b).first();
  const [companies, people, refs, hires, jobs, newCo, newPeople, refs30, hires30, unread, subs, demos, todayCo, todayRefs, signupDaily, refDaily, recent, top] = await Promise.all([
    one(`SELECT COUNT(*) AS n, COALESCE(SUM(suspended),0) AS suspended FROM companies WHERE is_demo = 0`),
    one(`SELECT COUNT(*) AS n FROM users u JOIN companies c ON c.id = u.company_id WHERE c.is_demo = 0 AND u.active = 1`),
    one(`SELECT COUNT(*) AS n FROM referrals r JOIN companies c ON c.id = r.company_id WHERE c.is_demo = 0`),
    one(`SELECT COUNT(*) AS n, COALESCE(SUM(CASE WHEN reward_status IN ('pending','paid') THEN reward_amount ELSE 0 END),0) AS rewards
         FROM referrals r JOIN companies c ON c.id = r.company_id WHERE c.is_demo = 0 AND r.status = 'hired'`),
    one(`SELECT COUNT(*) AS n FROM jobs j JOIN companies c ON c.id = j.company_id WHERE c.is_demo = 0 AND j.status = 'open'`),
    one(`SELECT COUNT(*) AS n FROM companies WHERE is_demo = 0 AND created_at >= ?`, d30),
    one(`SELECT COUNT(*) AS n FROM users u JOIN companies c ON c.id = u.company_id WHERE c.is_demo = 0 AND u.created_at >= ?`, d30),
    one(`SELECT COUNT(*) AS n FROM referrals r JOIN companies c ON c.id = r.company_id WHERE c.is_demo = 0 AND r.created_at >= ?`, d30),
    one(`SELECT COUNT(*) AS n FROM referral_events e JOIN referrals r ON r.id = e.referral_id JOIN companies c ON c.id = r.company_id
         WHERE c.is_demo = 0 AND e.status = 'hired' AND e.created_at >= ?`, d30),
    one(`SELECT COUNT(*) AS n FROM threads WHERE unread_admin > 0`),
    one(`SELECT COUNT(*) AS n FROM subscribers`),
    one(`SELECT COUNT(*) AS n FROM companies WHERE is_demo = 1`),
    one(`SELECT COUNT(*) AS n FROM companies WHERE is_demo = 0 AND created_at >= ?`, today),
    one(`SELECT COUNT(*) AS n FROM referrals r JOIN companies c ON c.id = r.company_id WHERE c.is_demo = 0 AND r.created_at >= ?`, today),
    db.prepare(`SELECT substr(created_at,1,10) AS d, COUNT(*) AS n FROM companies WHERE is_demo = 0 AND created_at >= ? GROUP BY d`).bind(dayKey(13)).all(),
    db.prepare(`SELECT substr(r.created_at,1,10) AS d, COUNT(*) AS n FROM referrals r JOIN companies c ON c.id = r.company_id
                WHERE c.is_demo = 0 AND r.created_at >= ? GROUP BY d`).bind(dayKey(13)).all(),
    db.prepare(`SELECT c.id, c.name, c.created_at, (SELECT COUNT(*) FROM users u WHERE u.company_id = c.id AND u.active = 1) AS members
                FROM companies c WHERE c.is_demo = 0 ORDER BY c.created_at DESC LIMIT 6`).all(),
    db.prepare(`SELECT c.id, c.name, COUNT(r.id) AS referrals, COALESCE(SUM(r.status = 'hired'),0) AS hires
                FROM companies c JOIN referrals r ON r.company_id = c.id WHERE c.is_demo = 0 AND r.created_at >= ?
                GROUP BY c.id ORDER BY referrals DESC LIMIT 6`).bind(d30).all(),
  ]);
  const days = [];
  for (let i = 13; i >= 0; i--) {
    const d = dayKey(i);
    days.push({ d, signups: signupDaily.results.find((x) => x.d === d)?.n || 0, referrals: refDaily.results.find((x) => x.d === d)?.n || 0 });
  }
  return json({
    companies: companies.n, suspended: companies.suspended, people: people.n, referrals: refs.n,
    hires: hires.n, rewards: hires.rewards, open_jobs: jobs.n,
    d30: { companies: newCo.n, people: newPeople.n, referrals: refs30.n, hires: hires30.n },
    today: { companies: todayCo.n, referrals: todayRefs.n },
    unread: unread.n, subscribers: subs.n, demos: demos.n,
    daily: days, recent: recent.results, top: top.results,
  });
}

// ---------- insights ----------
async function insights(db, url) {
  const days = rangeDays(url, 7);
  const since = dayKey(days - 1);
  const [site, daily, perCompany, jobs] = await Promise.all([
    db.prepare(`SELECT kind, target, SUM(n) AS n FROM stats WHERE company_id = '' AND day >= ? GROUP BY kind, target ORDER BY n DESC`).bind(since).all(),
    db.prepare(`SELECT day, kind, SUM(n) AS n FROM stats WHERE day >= ? AND kind IN ('visit','signup','careers','job','apply','refer','join') GROUP BY day, kind`).bind(since).all(),
    db.prepare(`SELECT c.id, c.name, c.is_demo,
                  COALESCE(SUM(CASE WHEN s.kind='careers' THEN s.n END),0) AS careers,
                  COALESCE(SUM(CASE WHEN s.kind='job' THEN s.n END),0) AS job_views,
                  COALESCE(SUM(CASE WHEN s.kind='apply' THEN s.n END),0) AS applied,
                  COALESCE(SUM(CASE WHEN s.kind='refer' THEN s.n END),0) AS referred,
                  COALESCE(SUM(CASE WHEN s.kind='refclick' THEN s.n END),0) AS link_opens,
                  COALESCE(SUM(CASE WHEN s.kind='join' THEN s.n END),0) AS joined
                FROM stats s JOIN companies c ON c.id = s.company_id
                WHERE s.day >= ? GROUP BY c.id ORDER BY careers + job_views DESC LIMIT 40`).bind(since).all(),
    db.prepare(`SELECT s.target AS job_id, j.title, c.name AS company, SUM(CASE WHEN s.kind='job' THEN s.n ELSE 0 END) AS views,
                  SUM(CASE WHEN s.kind='apply' THEN s.n ELSE 0 END) AS applied
                FROM stats s JOIN jobs j ON j.id = s.target JOIN companies c ON c.id = j.company_id
                WHERE s.day >= ? AND s.kind IN ('job','apply') AND c.is_demo = 0
                GROUP BY s.target ORDER BY views DESC LIMIT 25`).bind(since).all(),
  ]);
  return json({ days, site: site.results, daily: daily.results, companies: perCompany.results, jobs: jobs.results });
}

// ---------- companies ----------
async function listCompanies(db, url) {
  const demo = url.searchParams.get('demo') === '1';
  const { results } = await db.prepare(
    `SELECT c.id, c.name, c.slug, c.created_at, c.suspended, c.is_demo, c.currency,
       (SELECT COUNT(*) FROM users u WHERE u.company_id = c.id AND u.active = 1) AS members,
       (SELECT email FROM users u WHERE u.company_id = c.id AND u.role = 'admin' AND u.active = 1 ORDER BY u.created_at LIMIT 1) AS owner_email,
       (SELECT COUNT(*) FROM jobs j WHERE j.company_id = c.id AND j.status = 'open') AS open_jobs,
       (SELECT COUNT(*) FROM referrals r WHERE r.company_id = c.id) AS referrals,
       (SELECT COUNT(*) FROM referrals r WHERE r.company_id = c.id AND r.status = 'hired') AS hires,
       (SELECT MAX(r.created_at) FROM referrals r WHERE r.company_id = c.id) AS last_referral
     FROM companies c WHERE c.is_demo = ? ORDER BY c.created_at DESC LIMIT 2000`
  ).bind(demo ? 1 : 0).all();
  return json({ companies: results });
}
async function getCompany(db, id) {
  const c = await db.prepare('SELECT * FROM companies WHERE id = ?').bind(id).first();
  if (!c) throw new HttpError(404, 'Company not found.');
  const [members, jobs, refs, counts, views] = await Promise.all([
    db.prepare(`SELECT u.id, u.name, u.email, u.role, u.department, u.created_at,
                  (SELECT COUNT(*) FROM referrals r WHERE r.referrer_id = u.id) AS referrals
                FROM users u WHERE u.company_id = ? AND u.active = 1 ORDER BY (u.role='admin') DESC, u.name`).bind(id).all(),
    db.prepare(`SELECT j.id, j.title, j.status, j.bonus, j.location, (SELECT COUNT(*) FROM referrals r WHERE r.job_id = j.id) AS referrals
                FROM jobs j WHERE j.company_id = ? ORDER BY (j.status='open') DESC, j.created_at DESC`).bind(id).all(),
    db.prepare(`SELECT r.id, r.candidate_name, r.status, r.created_at, j.title AS job_title, u.name AS referrer_name
                FROM referrals r JOIN jobs j ON j.id = r.job_id LEFT JOIN users u ON u.id = r.referrer_id
                WHERE r.company_id = ? ORDER BY r.created_at DESC LIMIT 10`).bind(id).all(),
    db.prepare(`SELECT status, COUNT(*) AS n, COALESCE(SUM(CASE WHEN reward_status IN ('pending','paid') THEN reward_amount ELSE 0 END),0) AS rewards
                FROM referrals WHERE company_id = ? GROUP BY status`).bind(id).all(),
    db.prepare(`SELECT kind, SUM(n) AS n FROM stats WHERE company_id = ? AND day >= ? GROUP BY kind`).bind(id, dayKey(29)).all(),
  ]);
  const byStatus = Object.fromEntries(STAGES.map((s) => [s, 0]));
  let rewards = 0;
  for (const r of counts.results) { byStatus[r.status] = r.n; rewards += r.rewards; }
  return json({
    company: { id: c.id, name: c.name, slug: c.slug, created_at: c.created_at, suspended: c.suspended, is_demo: c.is_demo,
      currency: c.currency, default_bonus: c.default_bonus, about: c.about, reward_policy: c.reward_policy, join_code: c.join_code },
    members: members.results, jobs: jobs.results, recent: refs.results, by_status: byStatus, rewards,
    views30: Object.fromEntries(views.results.map((v) => [v.kind, v.n])),
  });
}
async function updateCompany(db, request, id) {
  const b = await body(request);
  if (typeof b.suspended !== 'boolean') throw new HttpError(400, 'Nothing to update.');
  const res = await db.prepare('UPDATE companies SET suspended = ? WHERE id = ?').bind(b.suspended ? 1 : 0, id).run();
  if (!res.meta.changes) throw new HttpError(404, 'Company not found.');
  if (b.suspended) await db.prepare('DELETE FROM sessions WHERE user_id IN (SELECT id FROM users WHERE company_id = ?)').bind(id).run();
  return json({ ok: true });
}

// ---------- people ----------
async function listPeople(db) {
  const { results } = await db.prepare(
    `SELECT u.id, u.name, u.email, u.role, u.department, u.created_at, u.active, c.id AS company_id, c.name AS company, c.is_demo,
       (SELECT COUNT(*) FROM referrals r WHERE r.referrer_id = u.id) AS referrals,
       (SELECT MAX(expires_at) FROM sessions s WHERE s.user_id = u.id) AS last_session
     FROM users u JOIN companies c ON c.id = u.company_id
     WHERE c.is_demo = 0 ORDER BY u.created_at DESC LIMIT 5000`
  ).all();
  return json({ people: results });
}
async function updatePerson(db, request, id) {
  const b = await body(request);
  let res;
  if (b.role === 'admin' || b.role === 'employee') {
    res = await db.prepare('UPDATE users SET role = ? WHERE id = ?').bind(b.role, id).run();
  } else if (typeof b.active === 'boolean') {
    res = await db.prepare('UPDATE users SET active = ? WHERE id = ?').bind(b.active ? 1 : 0, id).run();
    if (!b.active) await db.prepare('DELETE FROM sessions WHERE user_id = ?').bind(id).run();
  } else throw new HttpError(400, 'Nothing to update.');
  if (!res.meta.changes) throw new HttpError(404, 'Person not found.');
  return json({ ok: true });
}
async function resetPerson(db, id) {
  const u = await db.prepare('SELECT salt FROM users WHERE id = ?').bind(id).first();
  if (!u) throw new HttpError(404, 'Person not found.');
  if (u.salt === '-') throw new HttpError(400, "Demo accounts don't have a password.");
  return json({ temp_password: await resetPasswordFor(db, id) });
}

// ---------- referrals ----------
async function listReferrals(db) {
  const { results } = await db.prepare(
    `SELECT r.id, r.candidate_name, r.candidate_email, r.status, r.reward_amount, r.reward_status, r.source, r.created_at, r.updated_at,
       j.title AS job_title, c.name AS company, c.currency, u.name AS referrer_name
     FROM referrals r JOIN jobs j ON j.id = r.job_id JOIN companies c ON c.id = r.company_id LEFT JOIN users u ON u.id = r.referrer_id
     WHERE c.is_demo = 0 ORDER BY r.created_at DESC LIMIT 5000`
  ).all();
  return json({ referrals: results });
}

// ---------- messages ----------
async function listThreads(db) {
  const { results } = await db.prepare(
    `SELECT t.*, c.name AS company,
       (SELECT body FROM messages m WHERE m.thread_id = t.id ORDER BY created_at DESC LIMIT 1) AS last_body
     FROM threads t LEFT JOIN companies c ON c.id = t.company_id
     ORDER BY t.unread_admin > 0 DESC, t.last_at DESC LIMIT 300`
  ).all();
  return json({ threads: results });
}
async function getThread(db, id) {
  const t = await db.prepare(`SELECT t.*, c.name AS company FROM threads t LEFT JOIN companies c ON c.id = t.company_id WHERE t.id = ?`).bind(id).first();
  if (!t) throw new HttpError(404, 'Conversation not found.');
  const { results } = await db.prepare('SELECT from_admin, body, created_at FROM messages WHERE thread_id = ? ORDER BY created_at ASC LIMIT 1000').bind(id).all();
  if (t.unread_admin) await db.prepare('UPDATE threads SET unread_admin = 0 WHERE id = ?').bind(id).run();
  return json({ thread: t, messages: results });
}
async function replyThread(db, request, id) {
  const b = await body(request);
  const text = str(b.body, 'Reply', { max: 3000, required: true });
  const t = await db.prepare('SELECT id FROM threads WHERE id = ?').bind(id).first();
  if (!t) throw new HttpError(404, 'Conversation not found.');
  const ts = now();
  await db.batch([
    db.prepare('INSERT INTO messages (id, thread_id, from_admin, body, created_at) VALUES (?,?,1,?,?)').bind(uid(), id, text, ts),
    db.prepare("UPDATE threads SET unread_user = unread_user + 1, last_at = ?, status = 'open' WHERE id = ?").bind(ts, id),
  ]);
  return json({ ok: true }, 201);
}
async function updateThread(db, request, id) {
  const b = await body(request);
  if (b.status !== 'open' && b.status !== 'closed') throw new HttpError(400, 'Unknown status.');
  await db.prepare('UPDATE threads SET status = ? WHERE id = ?').bind(b.status, id).run();
  return json({ ok: true });
}
async function deleteThread(db, id) {
  await db.batch([
    db.prepare('DELETE FROM messages WHERE thread_id = ?').bind(id),
    db.prepare('DELETE FROM threads WHERE id = ?').bind(id),
  ]);
  return json({ ok: true });
}

// ---------- announcement ----------
async function saveAnnouncement(db, request) {
  const b = await body(request);
  const text = str(b.text, 'Announcement', { max: 280 });
  const link = str(b.link, 'Link', { max: 300 });
  if (link && !/^(https?:\/\/|\/)/i.test(link)) throw new HttpError(400, 'The link must start with https:// or /');
  const audience = ['all', 'public', 'workspace', 'admins'].includes(b.audience) ? b.audience : 'all';
  let endsAt = null;
  if (b.ends_at) {
    const d = new Date(b.ends_at);
    if (Number.isNaN(d.getTime())) throw new HttpError(400, 'End date is not valid.');
    endsAt = d.toISOString();
  }
  await setSetting(db, 'announcement', text ? { text, link, audience, ends_at: endsAt, updated_at: now() } : null).run();
  return json({ ok: true });
}

// ---------- setup ----------
async function setup(db, request, env) {
  const base = siteBase(request, env);
  const [urls, last, demos] = await Promise.all([
    sitemapUrls(db, base), getSetting(db, 'indexnow_last', null),
    db.prepare('SELECT COUNT(*) AS n FROM companies WHERE is_demo = 1').first(),
  ]);
  return json({
    site: base, custom_domain: !/\.workers\.dev$|localhost|127\.0\.0\.1/.test(new URL(base).hostname),
    sitemap: `${base}/sitemap.xml`, robots: `${base}/robots.txt`, pages: urls.length,
    google: !!env.GOOGLE_SITE_VERIFICATION, bing: !!env.BING_SITE_VERIFICATION,
    site_url_set: !!env.SITE_URL, indexnow_last: last, demos: demos.n,
  });
}
async function submitIndexNow(db, request, env) {
  const base = siteBase(request, env);
  const host = new URL(base).hostname;
  if (!base.startsWith('https://') || /workers\.dev$/.test(host)) {
    throw new HttpError(400, 'Instant indexing only works on your own https domain. Connect a custom domain first.');
  }
  const urls = (await sitemapUrls(db, base)).map((u) => u.loc).slice(0, 10000);
  const key = await indexNowKey(env);
  const res = await fetch('https://api.indexnow.org/indexnow', {
    method: 'POST', headers: { 'content-type': 'application/json; charset=utf-8' },
    body: JSON.stringify({ host, key, keyLocation: `${base}/${key}.txt`, urlList: urls }),
  });
  const last = { at: now(), count: urls.length, status: res.status };
  await setSetting(db, 'indexnow_last', last).run();
  return json(last);
}

// ---------- router ----------
export async function ownerRoutes({ db, request, env, p, m, url }) {
  const route = `${m} /${p.slice(1).join('/')}`;
  if (route === 'POST /login') {
    if (!env.ADMIN_PASSWORD) throw new HttpError(503, 'Set the ADMIN_PASSWORD secret in Cloudflare first (Worker → Settings → Variables and Secrets).');
    const b = await body(request);
    const [a1, a2] = await Promise.all([hmac(env, `pw:${b.password || ''}`), hmac(env, `pw:${env.ADMIN_PASSWORD}`)]);
    if (!safeEqual(a1, a2)) {
      await new Promise((r) => setTimeout(r, 600)); // slow down guessing
      throw new HttpError(401, 'That password is incorrect.');
    }
    const exp = Date.now() + OWNER_HOURS * 36e5;
    return json({ ok: true }, 200, { 'set-cookie': ownerCookie(request, `${exp}.${await hmac(env, `session:${exp}`)}`, OWNER_HOURS * 3600) });
  }
  if (route === 'POST /logout') return json({ ok: true }, 200, { 'set-cookie': ownerCookie(request, '', 0) });
  if (route === 'GET /me') return json({ configured: !!env.ADMIN_PASSWORD, signed_in: await isOwner(request, env) });

  if (!(await isOwner(request, env))) throw new HttpError(401, 'Sign in to the admin.');
  const id = p[2] ? decodeURIComponent(p[2]) : null;

  if (route === 'GET /dashboard') return dashboard(db);
  if (route === 'GET /insights') return insights(db, url);
  if (route === 'GET /companies') return listCompanies(db, url);
  if (p[1] === 'companies' && id && p.length === 3) {
    if (m === 'GET') return getCompany(db, id);
    if (m === 'PUT') return updateCompany(db, request, id);
    if (m === 'DELETE') {
      const c = await db.prepare('SELECT id FROM companies WHERE id = ?').bind(id).first();
      if (!c) throw new HttpError(404, 'Company not found.');
      await deleteCompanies(db, 'id = ?', [id]);
      return json({ ok: true });
    }
  }
  if (route === 'GET /people') return listPeople(db);
  if (p[1] === 'people' && id && p.length === 3 && m === 'PUT') return updatePerson(db, request, id);
  if (p[1] === 'people' && id && p[3] === 'reset-password' && m === 'POST') return resetPerson(db, id);
  if (route === 'GET /referrals') return listReferrals(db);
  if (route === 'GET /threads') return listThreads(db);
  if (p[1] === 'threads' && id && p.length === 3) {
    if (m === 'GET') return getThread(db, id);
    if (m === 'POST') return replyThread(db, request, id);
    if (m === 'PUT') return updateThread(db, request, id);
    if (m === 'DELETE') return deleteThread(db, id);
  }
  if (route === 'GET /announcement') return json({ announcement: await getSetting(db, 'announcement', null) });
  if (route === 'PUT /announcement') return saveAnnouncement(db, request);
  if (route === 'GET /subscribers') {
    const { results } = await db.prepare('SELECT email, created_at FROM subscribers ORDER BY created_at DESC').all();
    return json({ subscribers: results });
  }
  if (p[1] === 'subscribers' && id && m === 'DELETE') {
    await db.prepare('DELETE FROM subscribers WHERE email = ?').bind(id.toLowerCase()).run();
    return json({ ok: true });
  }
  if (route === 'GET /setup') return setup(db, request, env);
  if (route === 'POST /indexnow') return submitIndexNow(db, request, env);
  if (route === 'POST /demo-cleanup') {
    await deleteCompanies(db, 'is_demo = 1');
    return json({ ok: true });
  }
  throw new HttpError(404, 'Not found.');
}
