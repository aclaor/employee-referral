// Referleey API — Cloudflare Workers + D1.
// One catch-all handler with a small router. Every query is scoped to the
// signed-in user's company, so companies never see each other's data.

const STAGES = ['submitted', 'reviewing', 'interviewing', 'offer', 'hired', 'rejected'];
const SESSION_DAYS = 30;
const COOKIE = 'rl_session';

const SCHEMA = [
  `CREATE TABLE IF NOT EXISTS companies (
    id TEXT PRIMARY KEY, name TEXT NOT NULL, slug TEXT NOT NULL UNIQUE,
    join_code TEXT NOT NULL UNIQUE, default_bonus INTEGER NOT NULL DEFAULT 1000,
    currency TEXT NOT NULL DEFAULT 'USD', reward_policy TEXT NOT NULL DEFAULT '',
    about TEXT NOT NULL DEFAULT '', is_demo INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY, company_id TEXT NOT NULL, email TEXT NOT NULL UNIQUE,
    name TEXT NOT NULL, password_hash TEXT NOT NULL, salt TEXT NOT NULL,
    role TEXT NOT NULL DEFAULT 'employee', department TEXT NOT NULL DEFAULT '',
    ref_code TEXT NOT NULL UNIQUE, active INTEGER NOT NULL DEFAULT 1, created_at TEXT NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS sessions (
    token_hash TEXT PRIMARY KEY, user_id TEXT NOT NULL, expires_at TEXT NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS jobs (
    id TEXT PRIMARY KEY, company_id TEXT NOT NULL, title TEXT NOT NULL,
    department TEXT NOT NULL DEFAULT '', location TEXT NOT NULL DEFAULT '',
    type TEXT NOT NULL DEFAULT 'Full-time', description TEXT NOT NULL DEFAULT '',
    bonus INTEGER NOT NULL DEFAULT 0, status TEXT NOT NULL DEFAULT 'open', created_at TEXT NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS referrals (
    id TEXT PRIMARY KEY, company_id TEXT NOT NULL, job_id TEXT NOT NULL, referrer_id TEXT,
    candidate_name TEXT NOT NULL, candidate_email TEXT NOT NULL,
    candidate_phone TEXT NOT NULL DEFAULT '', linkedin TEXT NOT NULL DEFAULT '',
    relationship TEXT NOT NULL DEFAULT '', note TEXT NOT NULL DEFAULT '',
    source TEXT NOT NULL DEFAULT 'direct', status TEXT NOT NULL DEFAULT 'submitted',
    reward_amount INTEGER NOT NULL DEFAULT 0, reward_status TEXT NOT NULL DEFAULT 'none',
    created_at TEXT NOT NULL, updated_at TEXT NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS referral_events (
    id TEXT PRIMARY KEY, referral_id TEXT NOT NULL, status TEXT NOT NULL,
    note TEXT NOT NULL DEFAULT '', actor_name TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL)`,
  `CREATE INDEX IF NOT EXISTS idx_users_company ON users(company_id)`,
  `CREATE INDEX IF NOT EXISTS idx_jobs_company ON jobs(company_id)`,
  `CREATE INDEX IF NOT EXISTS idx_referrals_company ON referrals(company_id)`,
  `CREATE INDEX IF NOT EXISTS idx_referrals_referrer ON referrals(referrer_id)`,
  `CREATE UNIQUE INDEX IF NOT EXISTS idx_referrals_unique ON referrals(job_id, candidate_email)`,
  `CREATE INDEX IF NOT EXISTS idx_events_referral ON referral_events(referral_id)`,
];

let schemaReady = false;
async function ensureSchema(db) {
  if (schemaReady) return;
  await db.batch(SCHEMA.map((s) => db.prepare(s)));
  schemaReady = true;
}

// ---------- helpers ----------
class HttpError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}
const json = (data, status = 200, headers = {}) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', ...headers },
  });
const now = () => new Date().toISOString();
const uid = () => crypto.randomUUID();
const toHex = (buf) => [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
const fromHex = (hex) => new Uint8Array(hex.match(/.{2}/g).map((h) => parseInt(h, 16)));
function randomCode(len) {
  const chars = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
  const bytes = crypto.getRandomValues(new Uint8Array(len));
  return [...bytes].map((b) => chars[b % chars.length]).join('');
}
async function sha256(text) {
  return toHex(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text)));
}
async function hashPassword(password, saltHex) {
  const salt = saltHex ? fromHex(saltHex) : crypto.getRandomValues(new Uint8Array(16));
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', salt, iterations: 100000, hash: 'SHA-256' }, key, 256);
  return { hash: toHex(bits), salt: toHex(salt) };
}
function safeEqual(a, b) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}
function str(value, field, { max = 200, required = false } = {}) {
  const s = (value == null ? '' : String(value)).trim();
  if (required && !s) throw new HttpError(400, `${field} is required.`);
  if (s.length > max) throw new HttpError(400, `${field} must be ${max} characters or fewer.`);
  return s;
}
function email(value, field = 'Email') {
  const e = str(value, field, { max: 200, required: true }).toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e)) throw new HttpError(400, `${field} doesn't look like a valid address.`);
  return e;
}
function password(value) {
  const p = value == null ? '' : String(value);
  if (p.length < 8) throw new HttpError(400, 'Password must be at least 8 characters.');
  if (p.length > 200) throw new HttpError(400, 'Password is too long.');
  return p;
}
function money(value, field) {
  const n = Math.round(Number(value));
  if (!Number.isFinite(n) || n < 0 || n > 10000000) throw new HttpError(400, `${field} must be a number between 0 and 10,000,000.`);
  return n;
}
function slugify(name) {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'company';
}
async function body(request) {
  if (!(request.headers.get('content-type') || '').includes('application/json')) {
    throw new HttpError(415, 'Send JSON.');
  }
  try { return (await request.json()) || {}; } catch { throw new HttpError(400, 'Invalid JSON.'); }
}
function getCookie(request, name) {
  const raw = request.headers.get('cookie') || '';
  for (const part of raw.split(';')) {
    const [k, ...v] = part.trim().split('=');
    if (k === name) return v.join('=');
  }
  return null;
}
function sessionCookie(request, token, maxAge) {
  const secure = new URL(request.url).protocol === 'https:' ? ' Secure;' : '';
  return `${COOKIE}=${token}; HttpOnly;${secure} SameSite=Lax; Path=/; Max-Age=${maxAge}`;
}
async function startSession(db, request, userId) {
  const token = toHex(crypto.getRandomValues(new Uint8Array(32)));
  const expires = new Date(Date.now() + SESSION_DAYS * 864e5).toISOString();
  await db.prepare('INSERT INTO sessions (token_hash, user_id, expires_at) VALUES (?,?,?)')
    .bind(await sha256(token), userId, expires).run();
  return { 'set-cookie': sessionCookie(request, token, SESSION_DAYS * 86400) };
}
async function currentUser(db, request) {
  const token = getCookie(request, COOKIE);
  if (!token) return null;
  const row = await db.prepare(
    `SELECT u.id, u.company_id, u.email, u.name, u.role, u.department, u.ref_code, s.expires_at
     FROM sessions s JOIN users u ON u.id = s.user_id
     WHERE s.token_hash = ? AND u.active = 1`
  ).bind(await sha256(token)).first();
  if (!row || row.expires_at < now()) return null;
  delete row.expires_at;
  return row;
}
async function uniqueSlug(db, name) {
  const base = slugify(name);
  let slug = base;
  for (let i = 0; i < 5; i++) {
    const hit = await db.prepare('SELECT 1 FROM companies WHERE slug = ?').bind(slug).first();
    if (!hit) return slug;
    slug = `${base}-${randomCode(4).toLowerCase()}`;
  }
  return `${base}-${uid().slice(0, 8)}`;
}
const companyPublic = (c) => ({
  id: c.id, name: c.name, slug: c.slug, default_bonus: c.default_bonus,
  currency: c.currency, reward_policy: c.reward_policy, about: c.about,
});

// ---------- route handlers ----------
async function signupCompany(db, request) {
  const b = await body(request);
  const companyName = str(b.company, 'Company name', { max: 80, required: true });
  const name = str(b.name, 'Your name', { max: 80, required: true });
  const mail = email(b.email);
  const pw = password(b.password);
  if (await db.prepare('SELECT 1 FROM users WHERE email = ?').bind(mail).first()) {
    throw new HttpError(409, 'An account with this email already exists. Sign in instead.');
  }
  const { hash, salt } = await hashPassword(pw);
  const companyId = uid(), userId = uid(), ts = now();
  await db.batch([
    db.prepare('INSERT INTO companies (id, name, slug, join_code, created_at) VALUES (?,?,?,?,?)')
      .bind(companyId, companyName, await uniqueSlug(db, companyName), randomCode(8), ts),
    db.prepare('INSERT INTO users (id, company_id, email, name, password_hash, salt, role, department, ref_code, created_at) VALUES (?,?,?,?,?,?,?,?,?,?)')
      .bind(userId, companyId, mail, name, hash, salt, 'admin', '', randomCode(7).toLowerCase(), ts),
  ]);
  return json({ ok: true }, 201, await startSession(db, request, userId));
}

async function joinCompany(db, request) {
  const b = await body(request);
  const code = str(b.code, 'Invite code', { max: 20, required: true }).toUpperCase();
  const name = str(b.name, 'Your name', { max: 80, required: true });
  const mail = email(b.email);
  const pw = password(b.password);
  const department = str(b.department, 'Department', { max: 60 });
  const company = await db.prepare('SELECT id FROM companies WHERE join_code = ?').bind(code).first();
  if (!company) throw new HttpError(404, "That invite code doesn't match any company. Check the link from your admin.");
  if (await db.prepare('SELECT 1 FROM users WHERE email = ?').bind(mail).first()) {
    throw new HttpError(409, 'An account with this email already exists. Sign in instead.');
  }
  const { hash, salt } = await hashPassword(pw);
  const userId = uid();
  await db.prepare('INSERT INTO users (id, company_id, email, name, password_hash, salt, role, department, ref_code, created_at) VALUES (?,?,?,?,?,?,?,?,?,?)')
    .bind(userId, company.id, mail, name, hash, salt, 'employee', department, randomCode(7).toLowerCase(), now()).run();
  return json({ ok: true }, 201, await startSession(db, request, userId));
}

async function login(db, request) {
  const b = await body(request);
  const mail = email(b.email);
  const pw = String(b.password || '');
  const user = await db.prepare('SELECT id, password_hash, salt, active FROM users WHERE email = ?').bind(mail).first();
  const fail = new HttpError(401, 'Email or password is incorrect.');
  if (!user || user.salt === '-') throw fail;
  const { hash } = await hashPassword(pw, user.salt);
  if (!safeEqual(hash, user.password_hash)) throw fail;
  if (!user.active) throw new HttpError(403, 'This account has been removed by a company admin.');
  return json({ ok: true }, 200, await startSession(db, request, user.id));
}

async function logout(db, request) {
  const token = getCookie(request, COOKIE);
  if (token) await db.prepare('DELETE FROM sessions WHERE token_hash = ?').bind(await sha256(token)).run();
  return json({ ok: true }, 200, { 'set-cookie': sessionCookie(request, '', 0) });
}

async function demo(db, request) {
  const b = await body(request);
  const role = b.role === 'employee' ? 'employee' : 'admin';
  // Clear demo workspaces older than a day so they don't pile up.
  const cutoff = new Date(Date.now() - 864e5).toISOString();
  const old = `(SELECT id FROM companies WHERE is_demo = 1 AND created_at < ?)`;
  await db.batch([
    db.prepare(`DELETE FROM referral_events WHERE referral_id IN (SELECT id FROM referrals WHERE company_id IN ${old})`).bind(cutoff),
    db.prepare(`DELETE FROM referrals WHERE company_id IN ${old}`).bind(cutoff),
    db.prepare(`DELETE FROM jobs WHERE company_id IN ${old}`).bind(cutoff),
    db.prepare(`DELETE FROM sessions WHERE user_id IN (SELECT id FROM users WHERE company_id IN ${old})`).bind(cutoff),
    db.prepare(`DELETE FROM users WHERE company_id IN ${old}`).bind(cutoff),
    db.prepare(`DELETE FROM companies WHERE is_demo = 1 AND created_at < ?`).bind(cutoff),
  ]);

  const tag = randomCode(6).toLowerCase();
  const companyId = uid();
  const daysAgo = (d) => new Date(Date.now() - d * 864e5).toISOString();
  const stmts = [
    db.prepare('INSERT INTO companies (id, name, slug, join_code, default_bonus, currency, reward_policy, about, is_demo, created_at) VALUES (?,?,?,?,?,?,?,?,1,?)')
      .bind(companyId, 'Harbor & Pine', `harbor-pine-${tag}`, randomCode(8), 1500, 'USD',
        'Rewards are paid in the first payroll after your referral completes 90 days.',
        'Harbor & Pine builds booking software for independent hotels. 140 people across Singapore, Lisbon and Austin.', now()),
  ];
  const people = [
    ['Maya Okafor', 'People Ops', 'admin'], ['Daniel Reyes', 'Engineering', 'employee'],
    ['Aiko Tanaka', 'Design', 'employee'], ['Priya Nair', 'Sales', 'employee'],
    ['Tomás Silva', 'Engineering', 'employee'], ['Hannah Weiss', 'Customer Success', 'employee'],
  ];
  const users = people.map(([name, department, r], i) => {
    const u = { id: uid(), name, department, role: r };
    stmts.push(db.prepare('INSERT INTO users (id, company_id, email, name, password_hash, salt, role, department, ref_code, created_at) VALUES (?,?,?,?,?,?,?,?,?,?)')
      .bind(u.id, companyId, `demo-${tag}-${i}@demo.referleey.invalid`, name, '-', '-', r, department, randomCode(7).toLowerCase(), daysAgo(120 - i)));
    return u;
  });
  const jobDefs = [
    ['Senior Backend Engineer', 'Engineering', 'Singapore', 'Full-time', 3000, 'Own the reservations API that 2,000 hotels rely on every night. Go, Postgres, and a team that ships weekly.'],
    ['Product Designer', 'Design', 'Lisbon', 'Full-time', 2000, 'Design the front-desk experience end to end, from research with hotel staff to shipped interface.'],
    ['Account Executive, APAC', 'Sales', 'Singapore', 'Full-time', 2500, 'Bring independent hotels across Southeast Asia onto the platform. Full-cycle sales with a 45-day average close.'],
    ['Customer Success Manager', 'Customer Success', 'Austin', 'Full-time', 1500, 'Look after 60 hotel accounts through onboarding, training and renewal.'],
    ['Data Analyst', 'Engineering', 'Remote', 'Full-time', 1500, 'Turn booking data into pricing recommendations hotels can act on.'],
    ['Finance Operations Intern', 'Finance', 'Lisbon', 'Internship', 500, 'A six-month placement supporting month-end close and vendor payments.'],
  ];
  const jobs = jobDefs.map(([title, department, location, type, bonus, description], i) => {
    const j = { id: uid(), bonus };
    stmts.push(db.prepare('INSERT INTO jobs (id, company_id, title, department, location, type, description, bonus, status, created_at) VALUES (?,?,?,?,?,?,?,?,?,?)')
      .bind(j.id, companyId, title, department, location, type, description, bonus, i === 5 ? 'closed' : 'open', daysAgo(90 - i * 6)));
    return j;
  });
  // [candidate, job index, referrer index, status, days ago, reward paid?]
  const refDefs = [
    ['Lucas Meyer', 0, 1, 'hired', 150, true], ['Sofia Marino', 1, 2, 'hired', 118, true],
    ['Kenji Watanabe', 0, 4, 'hired', 64, false], ['Amara Diallo', 2, 3, 'offer', 21, false],
    ['Noah Fischer', 0, 1, 'interviewing', 16, false], ['Elena Petrova', 3, 5, 'interviewing', 13, false],
    ['Rahul Mehta', 4, 1, 'reviewing', 9, false], ['Chloe Martin', 1, 2, 'reviewing', 7, false],
    ['Ibrahim Hassan', 2, 3, 'submitted', 3, false], ['Mei Lin Chua', 4, 4, 'submitted', 2, false],
    ['Oliver Grant', 3, 1, 'rejected', 48, false], ['Yara Haddad', 2, 5, 'rejected', 80, false],
    ['Felix Braun', 0, 2, 'submitted', 1, false], ['Grace Owusu', 3, 3, 'hired', 100, true],
  ];
  const order = ['submitted', 'reviewing', 'interviewing', 'offer', 'hired'];
  refDefs.forEach(([cname, ji, ui, status, ago, paid]) => {
    const id = uid();
    const hired = status === 'hired';
    stmts.push(db.prepare(`INSERT INTO referrals (id, company_id, job_id, referrer_id, candidate_name, candidate_email, relationship, note, source, status, reward_amount, reward_status, created_at, updated_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`)
      .bind(id, companyId, jobs[ji].id, users[ui].id, cname,
        `${cname.toLowerCase().replace(/[^a-z]+/g, '.')}@example.com`, 'Former colleague',
        'We worked together for two years. Dependable, and great with customers.',
        'direct', status, hired ? jobs[ji].bonus : 0,
        hired ? (paid ? 'paid' : 'pending') : 'none', daysAgo(ago), daysAgo(Math.max(0, ago - 10))));
    const path = status === 'rejected' ? ['submitted', 'reviewing', 'rejected'] : order.slice(0, order.indexOf(status) + 1);
    path.forEach((s, k) => {
      stmts.push(db.prepare('INSERT INTO referral_events (id, referral_id, status, note, actor_name, created_at) VALUES (?,?,?,?,?,?)')
        .bind(uid(), id, s, '', k === 0 ? users[ui].name : 'Maya Okafor', daysAgo(Math.max(0, ago - k * 3))));
    });
  });
  await db.batch(stmts);
  const who = role === 'admin' ? users[0] : users[1];
  return json({ ok: true }, 201, await startSession(db, request, who.id));
}

async function me(db, user) {
  const company = await db.prepare('SELECT * FROM companies WHERE id = ?').bind(user.company_id).first();
  const out = { user, company: companyPublic(company), stages: STAGES };
  if (user.role === 'admin') out.company.join_code = company.join_code;
  return json(out);
}

async function leaderboardRows(db, companyId) {
  const { results } = await db.prepare(
    `SELECT u.id, u.name, u.department,
       COUNT(r.id) AS referrals,
       COALESCE(SUM(r.status = 'hired'), 0) AS hires,
       COALESCE(SUM(CASE WHEN r.reward_status IN ('pending','paid') THEN r.reward_amount ELSE 0 END), 0) AS earned
     FROM users u LEFT JOIN referrals r ON r.referrer_id = u.id
     WHERE u.company_id = ? AND u.active = 1
     GROUP BY u.id ORDER BY hires DESC, referrals DESC, u.name ASC LIMIT 50`
  ).bind(companyId).all();
  return results.map((r) => ({ ...r, points: r.referrals * 10 + r.hires * 100 }));
}

async function dashboard(db, user) {
  const admin = user.role === 'admin';
  const scope = admin ? 'company_id = ?' : 'referrer_id = ?';
  const key = admin ? user.company_id : user.id;
  const [byStatus, money, openJobs, team, recent, trend, board] = await Promise.all([
    db.prepare(`SELECT status, COUNT(*) AS n FROM referrals WHERE ${scope} GROUP BY status`).bind(key).all(),
    db.prepare(`SELECT COALESCE(SUM(CASE WHEN reward_status='pending' THEN reward_amount ELSE 0 END),0) AS pending,
                       COALESCE(SUM(CASE WHEN reward_status='paid' THEN reward_amount ELSE 0 END),0) AS paid
                FROM referrals WHERE ${scope}`).bind(key).first(),
    db.prepare(`SELECT COUNT(*) AS n FROM jobs WHERE company_id = ? AND status = 'open'`).bind(user.company_id).first(),
    db.prepare(`SELECT COUNT(*) AS n FROM users WHERE company_id = ? AND active = 1`).bind(user.company_id).first(),
    db.prepare(`SELECT r.id, r.candidate_name, r.status, r.created_at, j.title AS job_title, u.name AS referrer_name
                FROM referrals r JOIN jobs j ON j.id = r.job_id LEFT JOIN users u ON u.id = r.referrer_id
                WHERE r.${scope} ORDER BY r.created_at DESC LIMIT 6`).bind(key).all(),
    db.prepare(`SELECT substr(created_at,1,7) AS month, COUNT(*) AS n, COALESCE(SUM(status='hired'),0) AS hires
                FROM referrals WHERE ${scope} GROUP BY month ORDER BY month DESC LIMIT 6`).bind(key).all(),
    leaderboardRows(db, user.company_id),
  ]);
  const counts = Object.fromEntries(STAGES.map((s) => [s, 0]));
  for (const row of byStatus.results) counts[row.status] = row.n;
  const total = Object.values(counts).reduce((a, b) => a + b, 0);
  return json({
    counts, total, hires: counts.hired,
    rewards_pending: money.pending, rewards_paid: money.paid,
    open_jobs: openJobs.n, team: team.n,
    recent: recent.results, trend: trend.results.reverse(),
    leaderboard: board.slice(0, 5),
    rank: board.findIndex((r) => r.id === user.id) + 1,
  });
}

async function listJobs(db, user) {
  const { results } = await db.prepare(
    `SELECT j.*, (SELECT COUNT(*) FROM referrals r WHERE r.job_id = j.id) AS referral_count
     FROM jobs j WHERE j.company_id = ? ${user.role === 'admin' ? '' : "AND j.status = 'open'"}
     ORDER BY (j.status = 'open') DESC, j.created_at DESC`
  ).bind(user.company_id).all();
  return json({ jobs: results });
}
function jobFields(b, company) {
  const type = str(b.type, 'Type', { max: 30 }) || 'Full-time';
  return {
    title: str(b.title, 'Job title', { max: 120, required: true }),
    department: str(b.department, 'Department', { max: 60 }),
    location: str(b.location, 'Location', { max: 80 }),
    type,
    description: str(b.description, 'Description', { max: 4000 }),
    bonus: b.bonus === '' || b.bonus == null ? company.default_bonus : money(b.bonus, 'Referral reward'),
    status: b.status === 'closed' ? 'closed' : 'open',
  };
}
async function createJob(db, user, request) {
  const company = await db.prepare('SELECT default_bonus FROM companies WHERE id = ?').bind(user.company_id).first();
  const f = jobFields(await body(request), company);
  const id = uid();
  await db.prepare('INSERT INTO jobs (id, company_id, title, department, location, type, description, bonus, status, created_at) VALUES (?,?,?,?,?,?,?,?,?,?)')
    .bind(id, user.company_id, f.title, f.department, f.location, f.type, f.description, f.bonus, f.status, now()).run();
  return json({ id }, 201);
}
async function updateJob(db, user, request, id) {
  const company = await db.prepare('SELECT default_bonus FROM companies WHERE id = ?').bind(user.company_id).first();
  const f = jobFields(await body(request), company);
  const res = await db.prepare('UPDATE jobs SET title=?, department=?, location=?, type=?, description=?, bonus=?, status=? WHERE id=? AND company_id=?')
    .bind(f.title, f.department, f.location, f.type, f.description, f.bonus, f.status, id, user.company_id).run();
  if (!res.meta.changes) throw new HttpError(404, 'Job not found.');
  return json({ ok: true });
}
async function deleteJob(db, user, id) {
  const used = await db.prepare('SELECT COUNT(*) AS n FROM referrals WHERE job_id = ? AND company_id = ?').bind(id, user.company_id).first();
  if (used.n) throw new HttpError(409, 'This job has referrals, so it can\'t be deleted. Close it instead.');
  const res = await db.prepare('DELETE FROM jobs WHERE id = ? AND company_id = ?').bind(id, user.company_id).run();
  if (!res.meta.changes) throw new HttpError(404, 'Job not found.');
  return json({ ok: true });
}

const REFERRAL_SELECT = `SELECT r.*, j.title AS job_title, j.bonus AS job_bonus, u.name AS referrer_name
  FROM referrals r JOIN jobs j ON j.id = r.job_id LEFT JOIN users u ON u.id = r.referrer_id`;

async function listReferrals(db, user) {
  const admin = user.role === 'admin';
  const { results } = await db.prepare(
    `${REFERRAL_SELECT} WHERE ${admin ? 'r.company_id = ?' : 'r.referrer_id = ?'} ORDER BY r.created_at DESC LIMIT 1000`
  ).bind(admin ? user.company_id : user.id).all();
  return json({ referrals: results });
}
async function getReferral(db, user, id) {
  const r = await db.prepare(`${REFERRAL_SELECT} WHERE r.id = ? AND r.company_id = ?`).bind(id, user.company_id).first();
  if (!r || (user.role !== 'admin' && r.referrer_id !== user.id)) throw new HttpError(404, 'Referral not found.');
  const { results } = await db.prepare('SELECT status, note, actor_name, created_at FROM referral_events WHERE referral_id = ? ORDER BY created_at ASC').bind(id).all();
  return json({ referral: r, events: results });
}
async function insertReferral(db, { company_id, job, referrer, b, source }) {
  const cname = str(b.candidate_name ?? b.name, 'Candidate name', { max: 100, required: true });
  const cemail = email(b.candidate_email ?? b.email, 'Candidate email');
  const phone = str(b.candidate_phone ?? b.phone, 'Phone', { max: 40 });
  const linkedin = str(b.linkedin, 'Profile link', { max: 300 });
  if (linkedin && !/^https?:\/\//i.test(linkedin)) throw new HttpError(400, 'Profile link must start with http:// or https://');
  const relationship = str(b.relationship, 'Relationship', { max: 80 });
  const note = str(b.note, 'Note', { max: 2000 });
  if (job.status !== 'open') throw new HttpError(409, 'This job is closed to new referrals.');
  if (referrer && referrer.email === cemail) throw new HttpError(400, "You can't refer yourself.");
  const dup = await db.prepare('SELECT 1 FROM referrals WHERE job_id = ? AND candidate_email = ?').bind(job.id, cemail).first();
  if (dup) throw new HttpError(409, 'This candidate has already been put forward for this job. The first referral keeps the credit.');
  const id = uid(), ts = now();
  await db.batch([
    db.prepare(`INSERT INTO referrals (id, company_id, job_id, referrer_id, candidate_name, candidate_email, candidate_phone, linkedin, relationship, note, source, created_at, updated_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`)
      .bind(id, company_id, job.id, referrer ? referrer.id : null, cname, cemail, phone, linkedin, relationship, note, source, ts, ts),
    db.prepare('INSERT INTO referral_events (id, referral_id, status, note, actor_name, created_at) VALUES (?,?,?,?,?,?)')
      .bind(uid(), id, 'submitted', source === 'link' ? 'Applied through a referral link' : '', source === 'link' ? cname : referrer.name, ts),
  ]);
  return id;
}
async function createReferral(db, user, request) {
  const b = await body(request);
  const job = await db.prepare('SELECT id, status FROM jobs WHERE id = ? AND company_id = ?').bind(String(b.job_id || ''), user.company_id).first();
  if (!job) throw new HttpError(404, 'Choose a job to refer this person for.');
  const id = await insertReferral(db, { company_id: user.company_id, job, referrer: user, b, source: 'direct' });
  return json({ id }, 201);
}
async function updateReferral(db, user, request, id) {
  const b = await body(request);
  const r = await db.prepare(`${REFERRAL_SELECT} WHERE r.id = ? AND r.company_id = ?`).bind(id, user.company_id).first();
  if (!r) throw new HttpError(404, 'Referral not found.');
  const note = str(b.note, 'Note', { max: 1000 });
  const stmts = [];
  const ts = now();
  if (b.status !== undefined && b.status !== r.status) {
    if (!STAGES.includes(b.status)) throw new HttpError(400, 'Unknown status.');
    if (r.reward_status === 'paid') throw new HttpError(409, 'The reward for this referral is already paid, so its status is locked.');
    const hired = b.status === 'hired';
    const amount = hired && r.referrer_id ? r.job_bonus : 0;
    stmts.push(db.prepare('UPDATE referrals SET status=?, reward_amount=?, reward_status=?, updated_at=? WHERE id=?')
      .bind(b.status, amount, amount > 0 ? 'pending' : 'none', ts, id));
    stmts.push(db.prepare('INSERT INTO referral_events (id, referral_id, status, note, actor_name, created_at) VALUES (?,?,?,?,?,?)')
      .bind(uid(), id, b.status, note, user.name, ts));
  } else if (b.reward_status === 'paid') {
    if (r.reward_status !== 'pending') throw new HttpError(409, 'There is no pending reward on this referral.');
    stmts.push(db.prepare("UPDATE referrals SET reward_status='paid', updated_at=? WHERE id=?").bind(ts, id));
    stmts.push(db.prepare('INSERT INTO referral_events (id, referral_id, status, note, actor_name, created_at) VALUES (?,?,?,?,?,?)')
      .bind(uid(), id, 'paid', note, user.name, ts));
  } else if (note) {
    stmts.push(db.prepare('INSERT INTO referral_events (id, referral_id, status, note, actor_name, created_at) VALUES (?,?,?,?,?,?)')
      .bind(uid(), id, 'note', note, user.name, ts));
  } else {
    throw new HttpError(400, 'Nothing to update.');
  }
  await db.batch(stmts);
  return json({ ok: true });
}

async function listTeam(db, user) {
  const { results } = await db.prepare(
    `SELECT u.id, u.name, u.email, u.role, u.department, u.created_at,
       (SELECT COUNT(*) FROM referrals r WHERE r.referrer_id = u.id) AS referrals
     FROM users u WHERE u.company_id = ? AND u.active = 1 ORDER BY (u.role='admin') DESC, u.name ASC`
  ).bind(user.company_id).all();
  return json({ team: results });
}
async function updateMember(db, user, request, id) {
  const b = await body(request);
  if (id === user.id) throw new HttpError(400, "You can't change your own access. Ask another admin.");
  let res;
  if (b.remove === true) {
    res = await db.prepare('UPDATE users SET active = 0 WHERE id = ? AND company_id = ?').bind(id, user.company_id).run();
    await db.prepare('DELETE FROM sessions WHERE user_id = ?').bind(id).run();
  } else if (b.role === 'admin' || b.role === 'employee') {
    res = await db.prepare('UPDATE users SET role = ? WHERE id = ? AND company_id = ?').bind(b.role, id, user.company_id).run();
  } else throw new HttpError(400, 'Nothing to update.');
  if (!res.meta.changes) throw new HttpError(404, 'Team member not found.');
  return json({ ok: true });
}
async function updateCompany(db, user, request) {
  const b = await body(request);
  const name = str(b.name, 'Company name', { max: 80, required: true });
  const currency = str(b.currency, 'Currency', { max: 3, required: true }).toUpperCase();
  if (!/^[A-Z]{3}$/.test(currency)) throw new HttpError(400, 'Currency must be a 3-letter code like USD or SGD.');
  await db.prepare('UPDATE companies SET name=?, default_bonus=?, currency=?, reward_policy=?, about=? WHERE id=?')
    .bind(name, money(b.default_bonus, 'Default reward'), currency,
      str(b.reward_policy, 'Reward policy', { max: 500 }), str(b.about, 'About', { max: 1000 }), user.company_id).run();
  return json({ ok: true });
}
async function regenerateCode(db, user) {
  const code = randomCode(8);
  await db.prepare('UPDATE companies SET join_code = ? WHERE id = ?').bind(code, user.company_id).run();
  return json({ join_code: code });
}

// ---------- public (no sign-in) ----------
async function publicInvite(db, code) {
  const c = await db.prepare('SELECT name FROM companies WHERE join_code = ?').bind(code.toUpperCase()).first();
  if (!c) throw new HttpError(404, 'Invite not found.');
  return json({ company: c.name });
}
async function publicCompany(db, slug) {
  const c = await db.prepare('SELECT * FROM companies WHERE slug = ?').bind(slug).first();
  if (!c) throw new HttpError(404, 'Company not found.');
  const { results } = await db.prepare(
    `SELECT id, title, department, location, type, description FROM jobs WHERE company_id = ? AND status = 'open' ORDER BY created_at DESC`
  ).bind(c.id).all();
  return json({ company: { name: c.name, slug: c.slug, about: c.about }, jobs: results });
}
async function publicJob(db, id, ref) {
  const j = await db.prepare(
    `SELECT j.id, j.title, j.department, j.location, j.type, j.description, j.status, j.company_id, c.name AS company_name, c.slug AS company_slug, c.about AS company_about
     FROM jobs j JOIN companies c ON c.id = j.company_id WHERE j.id = ?`
  ).bind(id).first();
  if (!j) throw new HttpError(404, 'Job not found.');
  let referrer = null;
  if (ref) {
    const u = await db.prepare('SELECT name FROM users WHERE ref_code = ? AND company_id = ? AND active = 1').bind(ref.toLowerCase(), j.company_id).first();
    if (u) referrer = u.name.split(' ')[0];
  }
  delete j.company_id;
  return json({ job: j, referrer });
}
async function publicApply(db, request) {
  const b = await body(request);
  if (b.website) return json({ ok: true }, 201); // honeypot field: bots fill it, people never see it
  const job = await db.prepare('SELECT id, status, company_id FROM jobs WHERE id = ?').bind(String(b.job_id || '')).first();
  if (!job) throw new HttpError(404, 'Job not found.');
  const ref = str(b.ref, 'Referral code', { max: 20 }).toLowerCase();
  const referrer = ref
    ? await db.prepare('SELECT id, name, email FROM users WHERE ref_code = ? AND company_id = ? AND active = 1').bind(ref, job.company_id).first()
    : null;
  await insertReferral(db, { company_id: job.company_id, job, referrer, b, source: 'link' });
  return json({ ok: true }, 201);
}

// ---------- router ----------
export async function onRequest({ request, env, params }) {
  try {
    if (!env.DB) {
      return json({ error: 'Database is not connected. Add a D1 binding named DB to this Worker and redeploy.' }, 503);
    }
    const db = env.DB;
    await ensureSchema(db);
    const p = Array.isArray(params.path) ? params.path : [params.path].filter(Boolean);
    const m = request.method;
    const route = `${m} /${p.join('/')}`;
    const url = new URL(request.url);

    // Block cross-site writes: browsers always send Origin on cross-origin POST/PUT/DELETE.
    if (m !== 'GET') {
      const origin = request.headers.get('origin');
      if (origin && new URL(origin).host !== url.host) throw new HttpError(403, 'Cross-site request blocked.');
    }

    if (route === 'POST /auth/signup') return await signupCompany(db, request);
    if (route === 'POST /auth/join') return await joinCompany(db, request);
    if (route === 'POST /auth/login') return await login(db, request);
    if (route === 'POST /auth/logout') return await logout(db, request);
    if (route === 'POST /auth/demo') return await demo(db, request);
    if (m === 'GET' && p[0] === 'public' && p[1] === 'invite' && p[2]) return await publicInvite(db, p[2]);
    if (m === 'GET' && p[0] === 'public' && p[1] === 'company' && p[2]) return await publicCompany(db, p[2]);
    if (m === 'GET' && p[0] === 'public' && p[1] === 'job' && p[2]) return await publicJob(db, p[2], url.searchParams.get('ref'));
    if (route === 'POST /public/apply') return await publicApply(db, request);

    const user = await currentUser(db, request);
    if (!user) throw new HttpError(401, 'Sign in to continue.');
    const adminOnly = () => { if (user.role !== 'admin') throw new HttpError(403, 'Only company admins can do this.'); };

    if (route === 'GET /me') return await me(db, user);
    if (route === 'GET /dashboard') return await dashboard(db, user);
    if (route === 'GET /leaderboard') return json({ leaderboard: await leaderboardRows(db, user.company_id), me: user.id });
    if (route === 'GET /jobs') return await listJobs(db, user);
    if (route === 'POST /jobs') { adminOnly(); return await createJob(db, user, request); }
    if (p[0] === 'jobs' && p[1] && p.length === 2) {
      adminOnly();
      if (m === 'PUT') return await updateJob(db, user, request, p[1]);
      if (m === 'DELETE') return await deleteJob(db, user, p[1]);
    }
    if (route === 'GET /referrals') return await listReferrals(db, user);
    if (route === 'POST /referrals') return await createReferral(db, user, request);
    if (p[0] === 'referrals' && p[1] && p.length === 2) {
      if (m === 'GET') return await getReferral(db, user, p[1]);
      if (m === 'PUT') { adminOnly(); return await updateReferral(db, user, request, p[1]); }
    }
    if (route === 'GET /team') { adminOnly(); return await listTeam(db, user); }
    if (m === 'PUT' && p[0] === 'team' && p[1]) { adminOnly(); return await updateMember(db, user, request, p[1]); }
    if (route === 'PUT /company') { adminOnly(); return await updateCompany(db, user, request); }
    if (route === 'POST /company/invite-code') { adminOnly(); return await regenerateCode(db, user); }

    throw new HttpError(404, 'Not found.');
  } catch (err) {
    if (err instanceof HttpError) return json({ error: err.message }, err.status);
    if (String(err && err.message).includes('UNIQUE constraint failed: referrals')) {
      return json({ error: 'This candidate has already been put forward for this job.' }, 409);
    }
    console.error(err);
    return json({ error: 'Something went wrong on our side. Try again in a moment.' }, 500);
  }
}
