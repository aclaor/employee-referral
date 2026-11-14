// Referleey site admin (/admin): the platform owner's view of every company.
const view = $('#view');
const dlg = $('#dlg');
const O = (path, opts) => api(`/owner${path}`, opts);
const n = (v) => Number(v || 0).toLocaleString();
const pctOf = (a, b) => (b ? `${Math.round((a / b) * 100)}%` : 'n/a');
const ago = (iso) => {
  if (!iso) return 'never';
  const s = (Date.now() - new Date(iso).getTime()) / 1000;
  if (s < 3600) return `${Math.max(1, Math.round(s / 60))} min ago`;
  if (s < 86400) return `${Math.round(s / 3600)} h ago`;
  if (s < 86400 * 30) return `${Math.round(s / 86400)} days ago`;
  return fmtDate(iso);
};

function openDialog(title, html, wide = false) {
  dlg.classList.toggle('wide', wide);
  dlg.innerHTML = `<div class="dlg-head"><h2>${esc(title)}</h2><button class="dlg-x" type="button" aria-label="Close">×</button></div><div class="dlg-body">${html}</div>`;
  $('.dlg-x', dlg).addEventListener('click', () => dlg.close());
  if (!dlg.open) dlg.showModal();
}
dlg.addEventListener('click', (e) => { if (e.target === dlg) dlg.close(); });
function confirmDialog(title, text, action, onYes, danger = true) {
  openDialog(title, `<p class="muted" style="margin-bottom:1.25rem">${esc(text)}</p>
    <div class="dlg-foot"><button class="btn btn-ghost" type="button" id="c-no">Cancel</button><button class="btn ${danger ? 'btn-danger' : ''}" type="button" id="c-yes">${esc(action)}</button></div>`);
  $('#c-no').addEventListener('click', () => dlg.close());
  $('#c-yes').addEventListener('click', async (e) => {
    e.target.disabled = true;
    try { await onYes(); dlg.close(); } catch (err) { toast(err.message, true); e.target.disabled = false; }
  });
}
function showTempPassword(name, temp) {
  openDialog('Temporary password', `<p class="muted" style="margin-bottom:1rem">Give this to ${esc(name)} privately. They're signed out everywhere and can sign in with it, then change it under Account.</p>
    <div class="copybox"><input readonly value="${esc(temp)}" aria-label="Temporary password"><button class="btn btn-sm" type="button" id="copy-temp">Copy</button></div>`);
  $('#copy-temp').addEventListener('click', () => copyText(temp, 'Password copied'));
}
const head = (title, sub, actions = '') => `<div class="view-head"><div><h1>${esc(title)}</h1>${sub ? `<p>${esc(sub)}</p>` : ''}</div><div class="head-actions">${actions}</div></div>`;
const empty = (title, text) => `<div class="empty panel"><h3>${esc(title)}</h3><p>${esc(text)}</p></div>`;
function downloadCsv(name, header, rows) {
  const cell = (v) => {
    let s = String(v ?? '');
    if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
    return `"${s.replace(/"/g, '""')}"`;
  };
  const blob = new Blob([`﻿${[header, ...rows].map((r) => r.map(cell).join(',')).join('\n')}`], { type: 'text/csv' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `${name}-${new Date().toISOString().slice(0, 10)}.csv`;
  a.click();
  URL.revokeObjectURL(a.href);
}
function chips(current, values, attr) {
  return `<div class="chips" role="group">${values.map(([v, label]) => `<button type="button" class="chip ${String(current) === String(v) ? 'on' : ''}" data-${attr}="${v}" aria-pressed="${String(current) === String(v)}">${label}</button>`).join('')}</div>`;
}
function bars(series, key, label) {
  const max = Math.max(1, ...series.map((s) => s[key]));
  return `<div class="trend">${series.map((s) => `<div title="${esc(s.d)}: ${s[key]} ${label}"><b>${s[key] || ''}</b><i style="height:${(s[key] / max) * 75}%"></i><span>${esc(s.d.slice(8))}</span></div>`).join('')}</div>`;
}

// ---------- Dashboard ----------
async function dashboard() {
  const d = await O('/dashboard');
  setBadge('messages', d.unread);
  view.innerHTML = `${head('Dashboard', 'How the whole platform is doing.')}
    ${d.unread ? `<div class="notice"><b>${d.unread} conversation${d.unread > 1 ? 's' : ''} waiting for a reply.</b> <a href="#messages">Open messages</a></div>` : ''}
    <div class="stats">
      <div><div class="num">${n(d.companies)}</div><div class="cap">Companies, ${n(d.d30.companies)} new in 30 days${d.suspended ? `, ${d.suspended} suspended` : ''}</div></div>
      <div><div class="num">${n(d.people)}</div><div class="cap">People, ${n(d.d30.people)} joined in 30 days</div></div>
      <div><div class="num">${n(d.referrals)}</div><div class="cap">Referrals, ${n(d.d30.referrals)} in 30 days, ${n(d.today.referrals)} today</div></div>
      <div><div class="num">${n(d.hires)}</div><div class="cap">Hires, ${n(d.d30.hires)} in 30 days</div></div>
    </div>
    <div class="grid-2">
      <section class="panel"><h2>New companies, last 14 days</h2>${bars(d.daily, 'signups', 'new companies')}</section>
      <section class="panel"><h2>Referrals, last 14 days</h2>${bars(d.daily, 'referrals', 'referrals')}</section>
    </div>
    <div class="grid-2">
      <section class="panel"><h2>Newest companies</h2>
        ${d.recent.length ? `<ul class="rows">${d.recent.map((c) => `<li><div><div class="t"><a href="#companies/${esc(c.id)}">${esc(c.name)}</a></div><div class="s">${c.members} ${c.members === 1 ? 'person' : 'people'}, signed up ${esc(ago(c.created_at))}</div></div></li>`).join('')}</ul>`
          : '<p class="muted">No companies yet. They appear here when someone creates a workspace.</p>'}</section>
      <section class="panel"><h2>Most active, last 30 days</h2>
        ${d.top.length ? `<ul class="rows">${d.top.map((c, i) => `<li><span class="rank ${i === 0 ? 'top' : ''}">${i + 1}</span><div style="flex:1"><div class="t"><a href="#companies/${esc(c.id)}">${esc(c.name)}</a></div><div class="s">${c.referrals} referrals, ${c.hires} hired</div></div></li>`).join('')}</ul>`
          : '<p class="muted">No referrals in the last 30 days.</p>'}</section>
    </div>
    <div class="mini-stats">
      <span><b>${n(d.open_jobs)}</b> open jobs</span><span><b>${money(d.rewards)}</b> in referral rewards earned</span>
      <span><b>${n(d.subscribers)}</b> newsletter subscribers</span><span><b>${n(d.demos)}</b> demo workspaces</span>
    </div>`;
}

// ---------- Insights ----------
let insDays = 7;
async function insights() {
  const d = await O(`/insights?days=${insDays}`);
  const site = (k) => d.site.filter((r) => r.kind === k);
  const tot = (k) => d.daily.filter((r) => r.kind === k).reduce((t, r) => t + r.n, 0);
  const visits = tot('visit'), signups = tot('signup');
  const signupViews = site('page').filter((r) => r.target === 'signup').reduce((t, r) => t + r.n, 0);
  const careers = tot('careers'), jobViews = tot('job'), applied = tot('apply'), referred = tot('refer'), joined = tot('join');
  const days = [];
  for (let i = d.days - 1; i >= 0; i--) days.push(new Date(Date.now() - i * 864e5).toISOString().slice(0, 10));
  const dv = (day, k) => d.daily.filter((x) => x.day === day && x.kind === k).reduce((t, x) => t + x.n, 0);
  const maxV = Math.max(1, ...days.map((x) => dv(x, 'visit')));
  const step = (label, value, prev, hint) => `<div class="ins-step"><span>${label}</span><b>${n(value)}</b><small>${prev != null ? `${pctOf(value, prev)} of previous step` : hint || ''}</small></div>`;
  const sources = site('visit').slice(0, 15);
  const advice = (r) => r.views >= 10 && !r.applied ? '<span class="tag warn">Many views, no applications. Check the title, reward and description.</span>'
    : r.views >= 5 && r.applied / r.views >= 0.1 ? '<span class="tag good">Converting well</span>' : '';

  view.innerHTML = `${head('Insights', 'What visitors do on Referleey and on company careers pages.', chips(insDays, [[1, 'Today'], [7, '7 days'], [30, '30 days'], [90, '90 days']], 'days'))}
    <p class="muted small" style="margin:-0.75rem 0 1.25rem">Counts are anonymous: no names, emails or IP addresses. Each visitor counts once per page per visit.</p>
    <h2 class="sub-h">Getting companies on board</h2>
    <div class="ins-funnel">${step('Site visits', visits, null, 'People who opened the landing page')}${step('Viewed sign-up', signupViews, visits)}${step('Created a workspace', signups, signupViews)}${step('Employees joined', joined, null, 'Through invite links')}</div>
    <h2 class="sub-h">Hiring activity across companies</h2>
    <div class="ins-funnel">${step('Careers page views', careers, null, 'All companies')}${step('Job page views', jobViews, null, careers ? `${(jobViews / careers).toFixed(1)} per careers view` : '')}${step('Applications', applied, jobViews)}${step('Referrals by employees', referred, null, 'Submitted inside workspaces')}</div>
    ${visits ? `<section class="panel"><h2>Daily site visits</h2><div class="trend tall">${days.map((x) => `<div title="${x}: ${dv(x, 'visit')} visits, ${dv(x, 'signup')} sign-ups"><b>${d.days <= 14 ? dv(x, 'visit') || '' : ''}</b><i style="height:${(dv(x, 'visit') / maxV) * 75}%"></i><span>${d.days <= 31 ? x.slice(8) : ''}</span></div>`).join('')}</div></section>` : ''}
    <div class="grid-2">
      <section class="panel"><h2>Where visitors came from</h2>
        ${sources.length ? `<table><tbody>${sources.map((r) => `<tr><td>${r.target === '-' ? 'Direct or unknown' : esc(r.target)}</td><td class="num-cell"><b>${n(r.n)}</b></td></tr>`).join('')}</tbody></table>` : '<p class="muted">No visits recorded yet.</p>'}</section>
      <section class="panel"><h2>Most viewed pages</h2>
        ${site('page').length ? `<table><tbody>${site('page').slice(0, 15).map((r) => `<tr><td>/${esc(r.target)}</td><td class="num-cell"><b>${n(r.n)}</b></td></tr>`).join('')}</tbody></table>` : '<p class="muted">No page views recorded yet.</p>'}</section>
    </div>
    <section class="panel"><h2>Companies by careers traffic</h2>
      ${d.companies.length ? `<div class="table-wrap flat"><table><thead><tr><th>Company</th><th class="num-cell">Careers views</th><th class="num-cell">Job views</th><th class="num-cell">Applications</th><th class="num-cell">Employee referrals</th><th class="num-cell">Referral link opens</th><th class="num-cell">Joined</th></tr></thead>
        <tbody>${d.companies.map((c) => `<tr><td><a href="#companies/${esc(c.id)}">${esc(c.name)}</a>${c.is_demo ? ' <span class="pill">Demo</span>' : ''}</td><td class="num-cell">${n(c.careers)}</td><td class="num-cell">${n(c.job_views)}</td><td class="num-cell"><b>${n(c.applied)}</b></td><td class="num-cell">${n(c.referred)}</td><td class="num-cell">${n(c.link_opens)}</td><td class="num-cell">${n(c.joined)}</td></tr>`).join('')}</tbody></table></div>`
        : '<p class="muted">No careers page traffic yet.</p>'}</section>
    <section class="panel"><h2>Jobs people looked at</h2>
      <p class="muted small" style="margin:-0.5rem 0 1rem">Jobs with lots of views and no applications usually need a clearer title, a better description or a bigger referral reward.</p>
      ${d.jobs.length ? `<div class="table-wrap flat"><table><thead><tr><th>Job</th><th>Company</th><th class="num-cell">Views</th><th class="num-cell">Applications</th><th class="num-cell">Rate</th></tr></thead>
        <tbody>${d.jobs.map((j) => `<tr><td><a href="/apply?job=${encodeURIComponent(j.job_id)}" target="_blank" rel="noopener">${esc(j.title)}</a><div>${advice(j)}</div></td><td>${esc(j.company)}</td><td class="num-cell"><b>${n(j.views)}</b></td><td class="num-cell">${n(j.applied)}</td><td class="num-cell">${j.views ? pctOf(j.applied, j.views) : 'n/a'}</td></tr>`).join('')}</tbody></table></div>`
        : '<p class="muted">No job views yet. They appear as people open job pages.</p>'}</section>`;
  $$('[data-days]').forEach((b) => b.addEventListener('click', () => { insDays = Number(b.dataset.days); insights(); }));
}

// ---------- Companies ----------
let companyDemo = 0;
async function companies(sub) {
  if (sub) return companyDetail(sub);
  const { companies: list } = await O(`/companies?demo=${companyDemo}`);
  view.innerHTML = `${head('Companies', `${list.length} ${companyDemo ? 'demo workspaces' : list.length === 1 ? 'company' : 'companies'}.`,
    `${chips(companyDemo, [[0, 'Real companies'], [1, 'Demo workspaces']], 'demo')}${list.length && !companyDemo ? '<button class="btn btn-quiet" type="button" id="csv">Download spreadsheet</button>' : ''}${companyDemo && list.length ? '<button class="btn btn-danger" type="button" id="clean">Delete all demos</button>' : ''}`)}
    ${list.length ? `<div class="toolbar"><input type="search" id="q" placeholder="Search company or admin email" aria-label="Search companies">
      <select id="f" aria-label="Filter"><option value="">All</option><option value="active">Active</option><option value="suspended">Suspended</option><option value="quiet">No referrals yet</option></select></div>
      <div class="table-wrap"><table><thead><tr><th>Company</th><th class="num-cell">People</th><th class="num-cell">Open jobs</th><th class="num-cell">Referrals</th><th class="num-cell">Hires</th><th>Last referral</th><th>Signed up</th></tr></thead><tbody id="rows"></tbody></table></div>`
      : empty(companyDemo ? 'No demo workspaces' : 'No companies yet', companyDemo ? 'Demo workspaces appear when visitors click Explore the demo. They are removed automatically after a day.' : 'Companies appear here when someone creates a workspace.')}`;
  $$('[data-demo]').forEach((b) => b.addEventListener('click', () => { companyDemo = Number(b.dataset.demo); companies(); }));
  $('#clean')?.addEventListener('click', () => confirmDialog('Delete all demo workspaces?', 'Anyone exploring the demo right now will be signed out.', 'Delete demos', async () => { await O('/demo-cleanup', { method: 'POST', body: {} }); toast('Demo workspaces deleted'); companies(); }));
  $('#csv')?.addEventListener('click', () => downloadCsv('referleey-companies', ['Company', 'Admin email', 'People', 'Open jobs', 'Referrals', 'Hires', 'Suspended', 'Signed up'],
    list.map((c) => [c.name, c.owner_email, c.members, c.open_jobs, c.referrals, c.hires, c.suspended ? 'yes' : 'no', c.created_at.slice(0, 10)])));
  if (!list.length) return;
  const draw = () => {
    const q = $('#q').value.trim().toLowerCase(), f = $('#f').value;
    const rows = list.filter((c) => (!q || `${c.name} ${c.owner_email || ''}`.toLowerCase().includes(q))
      && (!f || (f === 'active' ? !c.suspended : f === 'suspended' ? c.suspended : !c.referrals)));
    $('#rows').innerHTML = rows.length ? rows.map((c) => `<tr class="click" tabindex="0" data-id="${esc(c.id)}">
      <td><div class="t">${esc(c.name)} ${c.suspended ? '<span class="pill rejected">Suspended</span>' : ''}</div><div class="s">${esc(c.owner_email || 'No admin')}</div></td>
      <td class="num-cell">${c.members}</td><td class="num-cell">${c.open_jobs}</td><td class="num-cell">${c.referrals}</td><td class="num-cell">${c.hires}</td>
      <td class="muted">${esc(c.last_referral ? ago(c.last_referral) : 'none yet')}</td><td class="muted">${esc(fmtDate(c.created_at))}</td></tr>`).join('')
      : '<tr><td colspan="7" class="empty">No companies match.</td></tr>';
    $$('#rows tr[data-id]').forEach((tr) => {
      const go = () => { location.hash = `#companies/${tr.dataset.id}`; };
      tr.addEventListener('click', go);
      tr.addEventListener('keydown', (e) => { if (e.key === 'Enter') go(); });
    });
  };
  $('#q').addEventListener('input', draw);
  $('#f').addEventListener('change', draw);
  draw();
}

async function companyDetail(id) {
  const d = await O(`/companies/${encodeURIComponent(id)}`);
  const c = d.company;
  const cash = (v) => money(v, c.currency);
  const total = Object.values(d.by_status).reduce((a, b) => a + b, 0);
  view.innerHTML = `<p style="margin-bottom:1rem"><a href="#companies">All companies</a></p>
    ${head(c.name, `Signed up ${fmtDate(c.created_at)}${c.is_demo ? ', demo workspace' : ''}`,
      `<a class="btn btn-quiet" href="/careers?c=${encodeURIComponent(c.slug)}" target="_blank" rel="noopener">Open careers page</a>
       <button class="btn ${c.suspended ? '' : 'btn-ghost'}" type="button" id="suspend">${c.suspended ? 'Restore workspace' : 'Suspend workspace'}</button>
       <button class="btn btn-danger" type="button" id="del">Delete company</button>`)}
    ${c.suspended ? '<div class="notice bad">This workspace is suspended. Its people can\'t sign in, new people can\'t join, and its careers page is hidden.</div>' : ''}
    <div class="stats">
      <div><div class="num">${d.members.length}</div><div class="cap">People</div></div>
      <div><div class="num">${total}</div><div class="cap">Referrals</div></div>
      <div><div class="num">${d.by_status.hired}</div><div class="cap">Hired</div></div>
      <div><div class="num">${cash(d.rewards)}</div><div class="cap">Rewards earned by employees</div></div>
    </div>
    <div class="mini-stats"><span><b>${n(d.views30.careers)}</b> careers page views in 30 days</span><span><b>${n(d.views30.job)}</b> job views</span>
      <span><b>${n(d.views30.apply)}</b> applications</span><span><b>${n(d.views30.refclick)}</b> referral link opens</span><span>Default reward <b>${cash(c.default_bonus)}</b></span><span>Invite code <b>${esc(c.join_code)}</b></span></div>
    <section class="panel" style="margin-top:1.25rem"><h2>People</h2>
      <div class="table-wrap flat"><table><thead><tr><th>Name</th><th>Access</th><th class="num-cell">Referred</th><th>Joined</th><th></th></tr></thead><tbody>
      ${d.members.map((m) => `<tr><td><div class="t">${esc(m.name)}</div><div class="s">${esc(m.email.endsWith('.invalid') ? 'Demo account' : m.email)}${m.department ? `, ${esc(m.department)}` : ''}</div></td>
        <td>${m.role === 'admin' ? 'Admin' : 'Employee'}</td><td class="num-cell">${m.referrals}</td><td class="muted">${esc(fmtDate(m.created_at))}</td>
        <td class="num-cell"><button class="btn btn-quiet btn-sm" type="button" data-reset="${esc(m.id)}" data-name="${esc(m.name)}">Reset password</button>
          <button class="btn btn-quiet btn-sm" type="button" data-role="${esc(m.id)}" data-to="${m.role === 'admin' ? 'employee' : 'admin'}">${m.role === 'admin' ? 'Make employee' : 'Make admin'}</button></td></tr>`).join('')}
      </tbody></table></div></section>
    <div class="grid-2">
      <section class="panel"><h2>Jobs</h2>${d.jobs.length ? `<ul class="rows">${d.jobs.map((j) => `<li><div><div class="t">${esc(j.title)}</div><div class="s">${esc(j.location || 'No location')}, reward ${cash(j.bonus)}, ${j.referrals} referred</div></div><span class="pill ${j.status === 'open' ? 'open' : ''}">${j.status === 'open' ? 'Open' : 'Closed'}</span></li>`).join('')}</ul>` : '<p class="muted">No jobs posted yet.</p>'}</section>
      <section class="panel"><h2>Latest referrals</h2>${d.recent.length ? `<ul class="rows">${d.recent.map((r) => `<li><div><div class="t">${esc(r.candidate_name)}</div><div class="s">${esc(r.job_title)}, ${r.referrer_name ? `referred by ${esc(r.referrer_name)}` : 'careers page'}</div></div>${pill(r.status)}</li>`).join('')}</ul>` : '<p class="muted">No referrals yet.</p>'}</section>
    </div>`;
  $('#suspend').addEventListener('click', () => {
    const suspend = !c.suspended;
    if (!suspend) return O(`/companies/${c.id}`, { method: 'PUT', body: { suspended: false } }).then(() => { toast('Workspace restored'); companyDetail(id); }).catch((e) => toast(e.message, true));
    confirmDialog(`Suspend ${c.name}?`, 'Everyone in this workspace is signed out and can\'t sign back in until you restore it. Nothing is deleted.', 'Suspend workspace',
      async () => { await O(`/companies/${c.id}`, { method: 'PUT', body: { suspended: true } }); toast('Workspace suspended'); companyDetail(id); });
  });
  $('#del').addEventListener('click', () => confirmDialog(`Delete ${c.name}?`, `This permanently deletes the company, its ${d.members.length} people, ${d.jobs.length} jobs and ${total} referrals. It can't be undone.`, 'Delete for good',
    async () => { await O(`/companies/${c.id}`, { method: 'DELETE' }); toast('Company deleted'); location.hash = '#companies'; }));
  $$('[data-reset]').forEach((b) => b.addEventListener('click', () => confirmDialog(`Reset ${b.dataset.name}'s password?`, 'Their current password stops working and they\'re signed out everywhere. You\'ll get a temporary password to give them.', 'Reset password',
    async () => { const r = await O(`/people/${b.dataset.reset}/reset-password`, { method: 'POST', body: {} }); setTimeout(() => showTempPassword(b.dataset.name, r.temp_password), 50); }, false)));
  $$('[data-role]').forEach((b) => b.addEventListener('click', async () => {
    try { await O(`/people/${b.dataset.role}`, { method: 'PUT', body: { role: b.dataset.to } }); toast('Access updated'); companyDetail(id); } catch (e) { toast(e.message, true); }
  }));
}

// ---------- People ----------
async function people() {
  const { people: list } = await O('/people');
  view.innerHTML = `${head('People', `${list.length} accounts across all companies.`, list.length ? '<button class="btn btn-quiet" type="button" id="csv">Download spreadsheet</button>' : '')}
    ${list.length ? `<div class="toolbar"><input type="search" id="q" placeholder="Search name, email or company" aria-label="Search people">
      <select id="f" aria-label="Filter"><option value="">Everyone</option><option value="admin">Company admins</option><option value="employee">Employees</option><option value="removed">Removed</option></select></div>
      <div class="table-wrap"><table><thead><tr><th>Name</th><th>Company</th><th>Access</th><th class="num-cell">Referred</th><th>Joined</th><th></th></tr></thead><tbody id="rows"></tbody></table></div>`
      : empty('No people yet', 'Accounts appear here as companies sign up and invite their teams.')}`;
  $('#csv')?.addEventListener('click', () => downloadCsv('referleey-people', ['Name', 'Email', 'Company', 'Access', 'Department', 'Referrals', 'Active', 'Joined'],
    list.map((p) => [p.name, p.email, p.company, p.role, p.department, p.referrals, p.active ? 'yes' : 'no', p.created_at.slice(0, 10)])));
  if (!list.length) return;
  const draw = () => {
    const q = $('#q').value.trim().toLowerCase(), f = $('#f').value;
    const rows = list.filter((p) => (!q || `${p.name} ${p.email} ${p.company}`.toLowerCase().includes(q))
      && (!f || (f === 'removed' ? !p.active : p.active && p.role === f))).slice(0, 500);
    $('#rows').innerHTML = rows.length ? rows.map((p) => `<tr>
      <td><div class="t">${esc(p.name)} ${p.active ? '' : '<span class="pill rejected">Removed</span>'}</div><div class="s">${esc(p.email)}</div></td>
      <td><a href="#companies/${esc(p.company_id)}">${esc(p.company)}</a></td><td>${p.role === 'admin' ? 'Admin' : 'Employee'}</td>
      <td class="num-cell">${p.referrals}</td><td class="muted">${esc(fmtDate(p.created_at))}</td>
      <td class="num-cell">${p.active ? `<button class="btn btn-quiet btn-sm" type="button" data-reset="${esc(p.id)}" data-name="${esc(p.name)}">Reset password</button>
        <button class="btn btn-danger btn-sm" type="button" data-remove="${esc(p.id)}" data-name="${esc(p.name)}">Remove</button>`
        : `<button class="btn btn-quiet btn-sm" type="button" data-restore="${esc(p.id)}">Restore</button>`}</td></tr>`).join('')
      : '<tr><td colspan="6" class="empty">No one matches.</td></tr>';
    $$('[data-reset]').forEach((b) => b.addEventListener('click', () => confirmDialog(`Reset ${b.dataset.name}'s password?`, 'Their current password stops working and they\'re signed out everywhere.', 'Reset password',
      async () => { const r = await O(`/people/${b.dataset.reset}/reset-password`, { method: 'POST', body: {} }); setTimeout(() => showTempPassword(b.dataset.name, r.temp_password), 50); }, false)));
    $$('[data-remove]').forEach((b) => b.addEventListener('click', () => confirmDialog(`Remove ${b.dataset.name}?`, 'They lose access straight away. Their referrals stay on record and you can restore them later.', 'Remove',
      async () => { await O(`/people/${b.dataset.remove}`, { method: 'PUT', body: { active: false } }); toast('Removed'); people(); })));
    $$('[data-restore]').forEach((b) => b.addEventListener('click', async () => {
      try { await O(`/people/${b.dataset.restore}`, { method: 'PUT', body: { active: true } }); toast('Restored'); people(); } catch (e) { toast(e.message, true); }
    }));
  };
  $('#q').addEventListener('input', draw);
  $('#f').addEventListener('change', draw);
  draw();
}

// ---------- Referrals ----------
async function referrals() {
  const { referrals: list } = await O('/referrals');
  view.innerHTML = `${head('Referrals', `${list.length} referrals across all companies.`, list.length ? '<button class="btn btn-quiet" type="button" id="csv">Download spreadsheet</button>' : '')}
    ${list.length ? `<div class="toolbar"><input type="search" id="q" placeholder="Search candidate, job, company or referrer" aria-label="Search referrals">
      <select id="f" aria-label="Filter by stage"><option value="">All stages</option>${Object.keys(STAGE_LABEL).slice(0, 6).map((s) => `<option value="${s}">${esc(STAGE_LABEL[s])}</option>`).join('')}<option value="reward:pending">Reward pending</option></select></div>
      <div class="table-wrap"><table><thead><tr><th>Candidate</th><th>Job</th><th>Company</th><th>Referred by</th><th>Stage</th><th>Reward</th><th>Submitted</th></tr></thead><tbody id="rows"></tbody></table></div>`
      : empty('No referrals yet', 'Referrals from every company show up here.')}`;
  $('#csv')?.addEventListener('click', () => downloadCsv('referleey-referrals', ['Candidate', 'Email', 'Job', 'Company', 'Referred by', 'Stage', 'Reward', 'Reward status', 'Submitted'],
    list.map((r) => [r.candidate_name, r.candidate_email, r.job_title, r.company, r.referrer_name || 'Careers page', STAGE_LABEL[r.status], r.reward_amount, r.reward_status, r.created_at.slice(0, 10)])));
  if (!list.length) return;
  const draw = () => {
    const q = $('#q').value.trim().toLowerCase(), f = $('#f').value;
    const rows = list.filter((r) => (!f || (f === 'reward:pending' ? r.reward_status === 'pending' : r.status === f))
      && (!q || `${r.candidate_name} ${r.candidate_email} ${r.job_title} ${r.company} ${r.referrer_name || ''}`.toLowerCase().includes(q))).slice(0, 500);
    $('#rows').innerHTML = rows.length ? rows.map((r) => `<tr><td><div class="t">${esc(r.candidate_name)}</div><div class="s">${esc(r.candidate_email)}</div></td>
      <td>${esc(r.job_title)}</td><td>${esc(r.company)}</td><td>${esc(r.referrer_name || 'Careers page')}</td><td>${pill(r.status)}</td>
      <td>${r.reward_status === 'none' ? '<span class="muted">n/a</span>' : `${money(r.reward_amount, r.currency)} ${pill(r.reward_status).replace('Reward ', '')}`}</td>
      <td class="muted">${esc(fmtDate(r.created_at))}</td></tr>`).join('') : '<tr><td colspan="7" class="empty">No referrals match.</td></tr>';
  };
  $('#q').addEventListener('input', draw);
  $('#f').addEventListener('change', draw);
  draw();
}

// ---------- Messages ----------
let openThread = null;
let pollTimer = null;
async function messages(sub) {
  if (sub) openThread = sub;
  const { threads } = await O('/threads');
  setBadge('messages', threads.filter((t) => t.unread_admin).length);
  view.innerHTML = `${head('Messages', 'Questions from company admins, employees and visitors.')}
    ${threads.length ? `<div class="chat-admin">
      <div class="panel chat-list" id="tlist">${threads.map((t) => `<button type="button" class="chat-row ${t.id === openThread ? 'on' : ''}" data-t="${esc(t.id)}">
        <span class="chat-top"><b>${esc(t.name)}</b>${t.unread_admin ? `<span class="badge">${t.unread_admin}</span>` : ''}</span>
        <span class="s">${esc(t.company || 'Website visitor')}${t.status === 'closed' ? ', closed' : ''}</span>
        <span class="s clip">${esc(t.last_body || '')}</span></button>`).join('')}</div>
      <div class="panel chat-view" id="tview"><p class="muted">Pick a conversation on the left.</p></div></div>`
      : empty('No messages yet', 'Messages appear here when someone uses the contact form on the landing page or the Help tab in their workspace.')}`;
  $$('[data-t]').forEach((b) => b.addEventListener('click', () => { openThread = b.dataset.t; $$('[data-t]').forEach((x) => x.classList.toggle('on', x === b)); showThread(openThread); }));
  if (openThread && threads.some((t) => t.id === openThread)) showThread(openThread);
}
async function showThread(id) {
  const box = $('#tview');
  if (!box) return;
  const d = await O(`/threads/${id}`);
  const t = d.thread;
  const row = $(`[data-t="${CSS.escape(id)}"] .badge`);
  if (row) { row.remove(); setBadge('messages', $$('#tlist .badge').length); }
  const draft = $('#reply')?.value || '';
  box.innerHTML = `<div class="chat-head"><div><b>${esc(t.name)}</b><div class="s">${esc(t.email)}${t.company ? `, ${esc(t.company)}` : ', website visitor'}</div></div>
      <div class="head-actions"><a class="btn btn-quiet btn-sm" href="mailto:${encodeURIComponent(t.email)}">Email</a>
      <button class="btn btn-quiet btn-sm" type="button" id="tstatus">${t.status === 'closed' ? 'Reopen' : 'Mark as done'}</button>
      <button class="btn btn-danger btn-sm" type="button" id="tdel">Delete</button></div></div>
    <div class="chat-thread" id="thread">${d.messages.map((m) => `<div class="msg ${m.from_admin ? 'me' : 'them'}"><p>${esc(m.body)}</p><time>${esc(new Date(m.created_at).toLocaleString())}</time></div>`).join('')}</div>
    ${t.user_id ? `<form class="chat-reply" id="rform"><textarea id="reply" rows="2" maxlength="3000" placeholder="Write a reply. They'll see it in their workspace." aria-label="Reply" required></textarea><button class="btn" type="submit">Send reply</button></form>`
      : `<p class="muted small chat-note">This message came from the public contact form, so they can't see replies on the site. Reply by email: <a href="mailto:${encodeURIComponent(t.email)}">${esc(t.email)}</a></p>`}`;
  const th = $('#thread');
  th.scrollTop = th.scrollHeight;
  if ($('#reply')) $('#reply').value = draft;
  $('#rform')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const text = $('#reply').value.trim();
    if (!text) return;
    try { await O(`/threads/${id}`, { method: 'POST', body: { body: text } }); $('#reply').value = ''; toast('Reply sent'); showThread(id); } catch (err) { toast(err.message, true); }
  });
  $('#tstatus').addEventListener('click', async () => { await O(`/threads/${id}`, { method: 'PUT', body: { status: t.status === 'closed' ? 'open' : 'closed' } }); messages(); });
  $('#tdel').addEventListener('click', () => confirmDialog('Delete this conversation?', 'The messages are removed for both sides.', 'Delete', async () => { await O(`/threads/${id}`, { method: 'DELETE' }); openThread = null; toast('Conversation deleted'); messages(); }));
}

// ---------- Announcement ----------
async function announcement() {
  const { announcement: a } = await O('/announcement');
  const live = a && a.text && (!a.ends_at || a.ends_at > new Date().toISOString());
  const endVal = a?.ends_at ? new Date(new Date(a.ends_at).getTime() - new Date().getTimezoneOffset() * 6e4).toISOString().slice(0, 16) : '';
  view.innerHTML = `${head('Announcement', 'A banner across the top of the site, for news, maintenance or offers.')}
    <div class="notice ${live ? 'good' : ''}">${live ? 'Your announcement is showing now.' : a?.text ? 'Your announcement has ended and is hidden.' : 'No announcement is showing.'}</div>
    <form class="panel" id="af" style="max-width:44rem" novalidate>
      <div class="form-error hidden" role="alert"></div>
      <div class="field"><label for="a-text">Message</label><input id="a-text" name="text" maxlength="280" value="${esc(a?.text || '')}" placeholder="For example: New, export your referral pipeline to a spreadsheet."></div>
      <div class="field"><label for="a-link">Link</label><input id="a-link" name="link" maxlength="300" value="${esc(a?.link || '')}" placeholder="Optional, like /signup or https://…"></div>
      <div class="field-row">
        <div class="field"><label for="a-aud">Who sees it</label><select id="a-aud" name="audience">
          ${[['all', 'Everyone'], ['public', 'Public pages only'], ['workspace', 'Signed-in workspaces only'], ['admins', 'Company admins only']].map(([v, l]) => `<option value="${v}" ${(a?.audience || 'all') === v ? 'selected' : ''}>${l}</option>`).join('')}</select></div>
        <div class="field"><label for="a-end">Ends</label><input id="a-end" name="ends_at" type="datetime-local" value="${esc(endVal)}"><p class="hint">Leave empty to keep it up until you remove it.</p></div>
      </div>
      <div class="dlg-foot" style="justify-content:flex-start"><button class="btn" type="submit">Save announcement</button>${a?.text ? '<button class="btn btn-ghost" type="button" id="a-clear">Remove announcement</button>' : ''}</div>
    </form>
    <h2 class="sub-h">Preview</h2><div class="announce static" id="a-prev"></div>`;
  const prev = () => { const t = $('#a-text').value.trim(); $('#a-prev').innerHTML = t ? `<span>${esc(t)}</span>${$('#a-link').value.trim() ? ' <a href="#" onclick="return false">Learn more</a>' : ''}` : '<span class="muted">Type a message to preview it.</span>'; };
  $('#a-text').addEventListener('input', prev); $('#a-link').addEventListener('input', prev); prev();
  handleForm($('#af'), async (f) => {
    await O('/announcement', { method: 'PUT', body: { ...f, ends_at: f.ends_at ? new Date(f.ends_at).toISOString() : '' } });
    toast(f.text.trim() ? 'Announcement saved' : 'Announcement removed'); announcement();
  });
  $('#a-clear')?.addEventListener('click', async () => { await O('/announcement', { method: 'PUT', body: { text: '' } }); toast('Announcement removed'); announcement(); });
}

// ---------- Subscribers ----------
async function subscribers() {
  const { subscribers: list } = await O('/subscribers');
  view.innerHTML = `${head('Subscribers', `${list.length} ${list.length === 1 ? 'person has' : 'people have'} signed up for news from the landing page.`, list.length ? '<button class="btn btn-quiet" type="button" id="csv">Download spreadsheet</button>' : '')}
    ${list.length ? `<div class="table-wrap"><table><thead><tr><th>Email</th><th>Signed up</th><th></th></tr></thead><tbody>
      ${list.map((s) => `<tr><td>${esc(s.email)}</td><td class="muted">${esc(fmtDate(s.created_at))}</td><td class="num-cell"><button class="btn btn-quiet btn-sm" type="button" data-unsub="${esc(s.email)}">Remove</button></td></tr>`).join('')}</tbody></table></div>`
      : empty('No subscribers yet', 'The sign-up box is at the bottom of the landing page.')}`;
  $('#csv')?.addEventListener('click', () => downloadCsv('referleey-subscribers', ['Email', 'Signed up'], list.map((s) => [s.email, s.created_at.slice(0, 10)])));
  $$('[data-unsub]').forEach((b) => b.addEventListener('click', () => confirmDialog(`Remove ${b.dataset.unsub}?`, 'They won\'t be in future exports.', 'Remove',
    async () => { await O(`/subscribers/${encodeURIComponent(b.dataset.unsub)}`, { method: 'DELETE' }); toast('Removed'); subscribers(); })));
}

// ---------- Setup ----------
async function setup() {
  const s = await O('/setup');
  const row = (ok, title, text) => `<div class="check-row"><span class="dot ${ok ? 'ok' : ''}" aria-hidden="true"></span><div><b>${title}</b><div class="s">${text}</div></div></div>`;
  const last = s.indexnow_last ? `Last sent ${new Date(s.indexnow_last.at).toLocaleString()}: ${s.indexnow_last.count} pages, ${[200, 202].includes(s.indexnow_last.status) ? 'accepted' : `response ${s.indexnow_last.status}`}.` : 'Not sent yet.';
  view.innerHTML = `${head('Setup', 'Connections, search engines and housekeeping.')}
    <section class="panel checks">
      ${row(true, 'Database', 'Connected and ready.')}
      ${row(true, 'Admin password', 'Set with the ADMIN_PASSWORD secret. Change it in Cloudflare under Worker, Settings, Variables and Secrets.')}
      ${row(s.custom_domain, 'Your own domain', s.custom_domain ? `Running on ${esc(s.site)}.` : `Running on ${esc(s.site)}. Add a custom domain in Cloudflare under Worker, Settings, Domains & Routes, then set a SITE_URL variable to it.`)}
    </section>
    <section class="panel"><h2>Search engines</h2>
      <p class="muted small" style="margin:-0.5rem 0 1rem">The landing page, sign-up page, every company's careers page and every open job are listed in your sitemap so Google and Bing can find them.</p>
      <div class="checks">
        ${row(true, 'Sitemap', `<a href="${esc(s.sitemap)}" target="_blank" rel="noopener">${esc(s.sitemap)}</a>, ${n(s.pages)} pages`)}
        ${row(true, 'Robots file', `<a href="${esc(s.robots)}" target="_blank" rel="noopener">${esc(s.robots)}</a>. Workspaces and this admin are kept out of search results.`)}
        ${row(s.google, 'Google Search Console', s.google ? 'Verification tag installed.' : 'Verify with the Domain (DNS) option, or add a GOOGLE_SITE_VERIFICATION secret with the code Google gives you. Then submit the sitemap.')}
        ${row(s.bing, 'Bing Webmaster Tools', s.bing ? 'Verification tag installed.' : 'Easiest: import from Google Search Console once Google is verified, or add a BING_SITE_VERIFICATION secret.')}
        ${row(!!s.indexnow_last, 'Bing instant indexing (IndexNow)', esc(last))}
      </div>
      <div class="head-actions" style="margin-top:1.25rem">
        <button class="btn" type="button" id="indexnow">Send all pages to Bing now</button>
        <a class="btn btn-quiet" href="https://search.google.com/search-console" target="_blank" rel="noopener">Open Google Search Console</a>
        <a class="btn btn-quiet" href="https://www.bing.com/webmasters" target="_blank" rel="noopener">Open Bing Webmaster Tools</a>
      </div></section>
    <section class="panel"><h2>Demo workspaces</h2>
      <p class="muted">${n(s.demos)} demo workspace${s.demos === 1 ? '' : 's'} right now. Each visitor who clicks Explore the demo gets one, and they're deleted automatically after a day.</p>
      ${s.demos ? '<button class="btn btn-quiet" type="button" id="demos" style="margin-top:1rem">Delete all demo workspaces now</button>' : ''}</section>`;
  $('#indexnow').addEventListener('click', async (e) => {
    e.target.disabled = true;
    try { const r = await O('/indexnow', { method: 'POST', body: {} }); toast([200, 202].includes(r.status) ? `Sent ${r.count} pages to Bing` : `Bing replied ${r.status}`); setup(); }
    catch (err) { toast(err.message, true); e.target.disabled = false; }
  });
  $('#demos')?.addEventListener('click', () => confirmDialog('Delete all demo workspaces?', 'Anyone exploring the demo right now will be signed out.', 'Delete demos', async () => { await O('/demo-cleanup', { method: 'POST', body: {} }); toast('Demo workspaces deleted'); setup(); }));
}

// ---------- shell ----------
const TABS = [
  ['dashboard', 'Dashboard', dashboard], ['insights', 'Insights', insights], ['companies', 'Companies', companies],
  ['people', 'People', people], ['referrals', 'Referrals', referrals], ['messages', 'Messages', messages],
  ['announcement', 'Announcement', announcement], ['subscribers', 'Subscribers', subscribers], ['setup', 'Setup', setup],
];
const badges = {};
function setBadge(key, count) {
  badges[key] = count;
  const el = $(`#badge-${key}`);
  if (el) el.innerHTML = count ? `<span class="badge">${count}</span>` : '';
}
async function route() {
  clearInterval(pollTimer);
  const [key, sub] = location.hash.replace(/^#\/?/, '').split('/');
  const tab = TABS.find((t) => t[0] === key) || TABS[0];
  $('#nav').innerHTML = TABS.map(([k, label]) => `<a href="#${k}" class="${k === tab[0] ? 'on' : ''}" ${k === tab[0] ? 'aria-current="page"' : ''}>${label}<span id="badge-${k}">${badges[k] ? `<span class="badge">${badges[k]}</span>` : ''}</span></a>`).join('');
  $('#side').classList.remove('open');
  try {
    await tab[2](sub ? decodeURIComponent(sub) : undefined);
  } catch (err) {
    if (err.status === 401) return start();
    view.innerHTML = empty("This page didn't load", err.message);
  }
  if (tab[0] === 'messages') pollTimer = setInterval(() => { if (openThread && !$('#reply')?.value) showThread(openThread); }, 15000);
}
async function refreshBadge() {
  try { const { threads } = await O('/threads'); setBadge('messages', threads.filter((t) => t.unread_admin).length); } catch { /* ignore */ }
}
async function start() {
  const me = await O('/me');
  if (!me.signed_in) {
    $('#shell').classList.add('hidden');
    $('#login').classList.remove('hidden');
    if (!me.configured) {
      $('#login-sub').innerHTML = 'The admin isn\'t switched on yet. In Cloudflare, open this Worker, go to Settings, Variables and Secrets, and add a secret named <b>ADMIN_PASSWORD</b>. Then come back and sign in with it.';
    }
    return;
  }
  $('#login').classList.add('hidden');
  $('#shell').classList.remove('hidden');
  refreshBadge();
  route();
}
handleForm($('#login-form'), async (d) => { await O('/login', { method: 'POST', body: d }); $('#pw').value = ''; start(); });
$('#logout').addEventListener('click', async () => { await O('/logout', { method: 'POST', body: {} }).catch(() => {}); start(); });
$('#menu').addEventListener('click', () => $('#side').classList.toggle('open'));
window.addEventListener('hashchange', () => { if (!$('#shell').classList.contains('hidden')) route(); });
setInterval(refreshBadge, 60000);
start().catch((e) => { view.innerHTML = empty("The admin didn't load", e.message); });
