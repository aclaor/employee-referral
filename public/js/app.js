// Referleey workspace: one page, hash-routed views for admins and employees.
const S = { user: null, company: null, stages: [] };
const view = $('#view');
const dlg = $('#dlg');
const isAdmin = () => S.user.role === 'admin';
const cash = (n) => money(n, S.company.currency);
const origin = location.origin;
const applyLink = (jobId) => `${origin}/apply?job=${encodeURIComponent(jobId)}&ref=${encodeURIComponent(S.user.ref_code)}`;
const careersLink = (withRef) => `${origin}/careers?c=${encodeURIComponent(S.company.slug)}${withRef ? `&ref=${encodeURIComponent(S.user.ref_code)}` : ''}`;

// ---------- dialog ----------
function openDialog(title, bodyHtml) {
  dlg.innerHTML = `
    <div class="dlg-head"><h2>${esc(title)}</h2><button class="dlg-x" type="button" aria-label="Close">×</button></div>
    <div class="dlg-body">${bodyHtml}</div>`;
  $('.dlg-x', dlg).addEventListener('click', () => dlg.close());
  if (!dlg.open) dlg.showModal();
  return dlg;
}
dlg.addEventListener('click', (e) => { if (e.target === dlg) dlg.close(); });

const head = (title, sub, actions = '') => `
  <div class="view-head">
    <div><h1>${esc(title)}</h1>${sub ? `<p>${esc(sub)}</p>` : ''}</div>
    <div class="head-actions">${actions}</div>
  </div>`;
const empty = (title, text, action = '') => `<div class="empty panel"><h3>${esc(title)}</h3><p>${esc(text)}</p>${action}</div>`;

// ---------- overview ----------
async function overview() {
  const d = await api('/dashboard');
  const admin = isAdmin();
  const max = Math.max(1, ...Object.values(d.counts));
  const trendMax = Math.max(1, ...d.trend.map((t) => t.n));
  const first = S.user.name.split(' ')[0];
  const monthName = (m) => new Date(`${m}-01T00:00:00`).toLocaleDateString(undefined, { month: 'short' });

  view.innerHTML = `
    ${head(admin ? `${S.company.name} referrals` : `Hello, ${first}`,
      admin ? 'How your referral program is doing right now.' : 'Your referrals and rewards at a glance.',
      admin ? `<a class="btn" href="#/jobs">Add a job</a>` : `<a class="btn" href="#/jobs">Refer someone</a>`)}
    ${admin && d.team <= 1 ? `<div class="callout"><h2>Invite your team</h2><p>Nobody else has joined yet. Send this link to your employees so they can start referring.</p>
      <div class="copybox"><input readonly value="${esc(`${origin}/join?code=${S.company.join_code}`)}" aria-label="Invite link"><button class="btn btn-sm" type="button" id="copy-invite">Copy link</button></div></div>` : ''}
    <div class="stats">
      <div><div class="num">${d.total}</div><div class="cap">${admin ? 'Referrals received' : 'People you referred'}</div></div>
      <div><div class="num">${d.hires}</div><div class="cap">${admin ? 'Hires from referrals' : 'Hired'}</div></div>
      <div><div class="num">${cash(d.rewards_pending)}</div><div class="cap">${admin ? 'Rewards to pay' : 'Rewards on the way'}</div></div>
      <div><div class="num">${admin ? cash(d.rewards_paid) : (d.rank ? `#${d.rank}` : 'n/a')}</div><div class="cap">${admin ? 'Rewards paid' : `Leaderboard rank, ${cash(d.rewards_paid)} paid`}</div></div>
    </div>
    ${admin ? '' : `<p class="muted small" style="margin-top:.75rem">Your referral links have been opened <b>${d.link_opens}</b> ${d.link_opens === 1 ? 'time' : 'times'}. <a href="#/jobs">Copy a link to share</a></p>`}
    <div class="grid-2">
      <section class="panel">
        <h2>${admin ? 'Pipeline' : 'Where your candidates stand'}</h2>
        ${d.total ? `<div class="funnel">${S.stages.map((s) => `
          <div class="funnel-row ${s}"><span>${esc(STAGE_LABEL[s])}</span>
            <div class="funnel-bar"><i style="width:${(d.counts[s] / max) * 100}%"></i></div><b>${d.counts[s]}</b></div>`).join('')}</div>`
        : `<p class="muted">${admin ? 'No referrals yet. They will appear here as your team submits them.' : 'You haven\'t referred anyone yet. Open roles are one click away.'}</p>`}
      </section>
      <section class="panel">
        <h2>Referrals by month</h2>
        ${d.trend.length ? `<div class="trend">${d.trend.map((t) => `
          <div><b>${t.n}</b><i style="height:${(t.n / trendMax) * 75}%"></i><span>${esc(monthName(t.month))}</span></div>`).join('')}</div>`
        : '<p class="muted">Nothing to chart yet.</p>'}
      </section>
    </div>
    <div class="grid-2">
      <section class="panel">
        <h2>Latest referrals</h2>
        ${d.recent.length ? `<ul class="rows">${d.recent.map((r) => `
          <li><div><div class="t">${esc(r.candidate_name)}</div><div class="s">${esc(r.job_title)}${admin ? `, referred by ${esc(r.referrer_name || 'careers page')}` : ''}</div></div>${pill(r.status)}</li>`).join('')}</ul>
          <p style="margin-top:1rem"><a href="#/referrals">See all referrals</a></p>`
        : '<p class="muted">Nothing here yet.</p>'}
      </section>
      <section class="panel">
        <h2>Top referrers</h2>
        <ul class="rows">${d.leaderboard.map((p, i) => `
          <li><span class="rank ${i === 0 ? 'top' : ''}">${i + 1}</span>
            <div style="flex:1"><div class="t">${esc(p.name)}${p.id === S.user.id ? ' (you)' : ''}</div><div class="s">${p.referrals} referred, ${p.hires} hired</div></div>
            <b>${p.points} pts</b></li>`).join('')}</ul>
        <p style="margin-top:1rem"><a href="#/leaderboard">Full leaderboard</a></p>
      </section>
    </div>
    ${S.company.reward_policy ? `<p class="muted small" style="margin-top:1.25rem">Reward policy: ${esc(S.company.reward_policy)}</p>` : ''}`;
  $('#copy-invite')?.addEventListener('click', () => copyText(`${origin}/join?code=${S.company.join_code}`, 'Invite link copied'));
}

// ---------- jobs ----------
async function jobsView() {
  const { jobs } = await api('/jobs');
  const admin = isAdmin();
  view.innerHTML = `
    ${head('Open roles', admin ? 'Post roles and set what a successful referral is worth.' : 'Know someone who fits? Refer them or share your link.',
      admin ? `<button class="btn btn-quiet" type="button" id="copy-careers">Copy careers page link</button><button class="btn" type="button" id="add-job">Add a job</button>`
            : `<button class="btn btn-quiet" type="button" id="copy-careers">Copy my careers link</button>`)}
    ${jobs.length ? `<div class="job-cards">${jobs.map((j) => `
      <article class="job-card">
        <div style="display:flex;justify-content:space-between;gap:.5rem;align-items:flex-start">
          <h3>${esc(j.title)}</h3>${admin ? pill(j.status === 'open' ? 'open' : 'closed').replace('>closed<', '>Closed<').replace('>open<', '>Open<') : ''}
        </div>
        <p class="meta">${esc([j.department, j.location, j.type].filter(Boolean).join(', '))}</p>
        <p class="desc">${esc(j.description)}</p>
        <div class="foot">
          <span class="reward-tag" title="Referral reward">${cash(j.bonus)}</span>
          <div class="acts">
            ${admin ? `<span class="muted small" style="align-self:center">${j.referral_count} referred</span><button class="btn btn-quiet btn-sm" data-edit="${esc(j.id)}" type="button">Edit</button>` : `<button class="btn btn-quiet btn-sm" data-link="${esc(j.id)}" type="button">Copy my link</button>`}
            ${j.status === 'open' ? `<button class="btn btn-sm" data-refer="${esc(j.id)}" type="button">Refer someone</button>` : ''}
          </div>
        </div>
      </article>`).join('')}</div>`
    : empty(admin ? 'Add your first job' : 'No open roles right now',
        admin ? 'Employees can start referring as soon as a role is posted.' : 'When your company posts a role, it will show up here.',
        admin ? '<button class="btn" type="button" id="add-job-2">Add a job</button>' : '')}`;

  const byId = Object.fromEntries(jobs.map((j) => [j.id, j]));
  $('#copy-careers').addEventListener('click', () => copyText(careersLink(!admin), 'Careers link copied'));
  $$('#add-job, #add-job-2').forEach((b) => b.addEventListener('click', () => jobDialog()));
  $$('[data-edit]').forEach((b) => b.addEventListener('click', () => jobDialog(byId[b.dataset.edit])));
  $$('[data-link]').forEach((b) => b.addEventListener('click', () => copyText(applyLink(b.dataset.link), 'Your referral link is copied')));
  $$('[data-refer]').forEach((b) => b.addEventListener('click', () => referDialog(byId[b.dataset.refer])));
}

function jobDialog(job) {
  const j = job || { title: '', department: '', location: '', type: 'Full-time', description: '', bonus: S.company.default_bonus, status: 'open' };
  const types = ['Full-time', 'Part-time', 'Contract', 'Internship'];
  openDialog(job ? 'Edit job' : 'Add a job', `
    <form id="job-form" novalidate>
      <div class="form-error hidden" role="alert"></div>
      <div class="field"><label for="j-title">Job title</label><input id="j-title" name="title" maxlength="120" value="${esc(j.title)}" required></div>
      <div class="field-row">
        <div class="field"><label for="j-dept">Department</label><input id="j-dept" name="department" maxlength="60" value="${esc(j.department)}"></div>
        <div class="field"><label for="j-loc">Location</label><input id="j-loc" name="location" maxlength="80" value="${esc(j.location)}" placeholder="City or Remote"></div>
      </div>
      <div class="field-row">
        <div class="field"><label for="j-type">Type</label><select id="j-type" name="type">${types.map((t) => `<option ${t === j.type ? 'selected' : ''}>${t}</option>`).join('')}</select></div>
        <div class="field"><label for="j-bonus">Referral reward (${esc(S.company.currency)})</label><input id="j-bonus" name="bonus" type="number" min="0" step="1" value="${esc(j.bonus)}"></div>
      </div>
      <div class="field"><label for="j-desc">Description</label><textarea id="j-desc" name="description" maxlength="4000">${esc(j.description)}</textarea></div>
      ${job ? `<div class="field"><label for="j-status">Status</label><select id="j-status" name="status"><option value="open" ${j.status === 'open' ? 'selected' : ''}>Open to referrals</option><option value="closed" ${j.status === 'closed' ? 'selected' : ''}>Closed</option></select></div>` : ''}
      <div class="dlg-foot">
        ${job ? '<button class="btn btn-danger" type="button" id="del-job" style="margin-right:auto">Delete job</button>' : ''}
        <button class="btn" type="submit">${job ? 'Save changes' : 'Add job'}</button>
      </div>
    </form>`);
  handleForm($('#job-form'), async (d) => {
    await api(job ? `/jobs/${job.id}` : '/jobs', { method: job ? 'PUT' : 'POST', body: d });
    dlg.close();
    toast(job ? 'Changes saved' : 'Job added');
    jobsView();
  });
  $('#del-job')?.addEventListener('click', async () => {
    try {
      await api(`/jobs/${job.id}`, { method: 'DELETE' });
      dlg.close(); toast('Job deleted'); jobsView();
    } catch (err) { toast(err.message, true); }
  });
}

function referDialog(job) {
  openDialog(`Refer someone for ${job.title}`, `
    <form id="ref-form" novalidate>
      <p class="muted small" style="margin-bottom:1rem">Reward if they're hired: <strong>${cash(job.bonus)}</strong>. Make sure they know you're putting them forward.</p>
      <div class="form-error hidden" role="alert"></div>
      <div class="field-row">
        <div class="field"><label for="r-name">Candidate's name</label><input id="r-name" name="candidate_name" maxlength="100" required></div>
        <div class="field"><label for="r-email">Candidate's email</label><input id="r-email" name="candidate_email" type="email" required></div>
      </div>
      <div class="field-row">
        <div class="field"><label for="r-phone">Phone</label><input id="r-phone" name="candidate_phone" maxlength="40" placeholder="Optional"></div>
        <div class="field"><label for="r-rel">How do you know them?</label><select id="r-rel" name="relationship">
          <option>Former colleague</option><option>Friend</option><option>Classmate</option><option>Professional network</option><option>Family</option><option>Other</option></select></div>
      </div>
      <div class="field"><label for="r-link">LinkedIn or portfolio link</label><input id="r-link" name="linkedin" type="url" maxlength="300" placeholder="https://"></div>
      <div class="field"><label for="r-note">Why would they be good at this?</label><textarea id="r-note" name="note" maxlength="2000"></textarea></div>
      <div class="dlg-foot"><button class="btn" type="submit">Submit referral</button></div>
    </form>`);
  handleForm($('#ref-form'), async (d) => {
    await api('/referrals', { method: 'POST', body: { ...d, job_id: job.id } });
    dlg.close();
    toast('Referral submitted');
    location.hash = '#/referrals';
    if (location.hash === '#/referrals') route();
  });
}

// ---------- referrals ----------
let referralCache = [];
async function referralsView() {
  const { referrals } = await api('/referrals');
  referralCache = referrals;
  const admin = isAdmin();
  view.innerHTML = `
    ${head(admin ? 'Referrals' : 'My referrals', admin ? 'Every candidate your team has put forward.' : 'Everyone you\'ve referred and where they stand.',
      admin && referrals.length ? '<button class="btn btn-quiet" type="button" id="export">Download spreadsheet</button>' : '')}
    ${referrals.length ? `
      <div class="toolbar">
        <input type="search" id="q" placeholder="Search name, job or referrer" aria-label="Search referrals">
        <select id="stage" aria-label="Filter by stage"><option value="">All stages</option>${S.stages.map((s) => `<option value="${s}">${esc(STAGE_LABEL[s])}</option>`).join('')}
          <option value="reward:pending">Reward pending</option></select>
      </div>
      <div class="table-wrap"><table>
        <thead><tr><th>Candidate</th><th>Job</th>${admin ? '<th>Referred by</th>' : ''}<th>Stage</th><th>Reward</th><th>Submitted</th></tr></thead>
        <tbody id="rows"></tbody></table></div>`
    : empty(admin ? 'No referrals yet' : 'Refer your first candidate', admin ? 'Post a job and invite your team to get the first ones in.' : 'Pick an open role and tell us who\'d be great at it.',
        `<a class="btn" href="#/jobs">${admin ? 'Go to open roles' : 'See open roles'}</a>`)}`;
  if (!referrals.length) return;

  const draw = () => {
    const q = $('#q').value.trim().toLowerCase();
    const st = $('#stage').value;
    const list = referrals.filter((r) =>
      (!st || (st === 'reward:pending' ? r.reward_status === 'pending' : r.status === st)) &&
      (!q || `${r.candidate_name} ${r.candidate_email} ${r.job_title} ${r.referrer_name || ''}`.toLowerCase().includes(q)));
    $('#rows').innerHTML = list.length ? list.map((r) => `
      <tr class="click" tabindex="0" data-id="${esc(r.id)}">
        <td><div class="t">${esc(r.candidate_name)}</div><div class="s">${esc(r.candidate_email)}</div></td>
        <td>${esc(r.job_title)}</td>
        ${admin ? `<td>${esc(r.referrer_name || 'Careers page')}</td>` : ''}
        <td>${pill(r.status)}</td>
        <td>${r.reward_status === 'none' ? '<span class="muted">n/a</span>' : `${cash(r.reward_amount)} ${pill(r.reward_status).replace('Reward ', '')}`}</td>
        <td class="muted">${esc(fmtDate(r.created_at))}</td>
      </tr>`).join('')
      : `<tr><td colspan="6" class="empty">No referrals match these filters.</td></tr>`;
    $$('#rows tr[data-id]').forEach((tr) => {
      tr.addEventListener('click', () => referralDialog(tr.dataset.id));
      tr.addEventListener('keydown', (e) => { if (e.key === 'Enter') referralDialog(tr.dataset.id); });
    });
  };
  $('#q').addEventListener('input', draw);
  $('#stage').addEventListener('change', draw);
  $('#export')?.addEventListener('click', exportCsv);
  draw();
}

async function referralDialog(id) {
  let data;
  try { data = await api(`/referrals/${id}`); } catch (err) { return toast(err.message, true); }
  const { referral: r, events } = data;
  const admin = isAdmin();
  const locked = r.reward_status === 'paid';
  const safeLink = /^https?:\/\//i.test(r.linkedin) ? r.linkedin : '';
  openDialog(r.candidate_name, `
    <dl class="facts">
      <div><dt>Job</dt><dd>${esc(r.job_title)}</dd></div>
      <div><dt>Stage</dt><dd>${pill(r.status)}</dd></div>
      <div><dt>Email</dt><dd>${esc(r.candidate_email)}</dd></div>
      <div><dt>Phone</dt><dd>${esc(r.candidate_phone || 'Not given')}</dd></div>
      <div><dt>Referred by</dt><dd>${esc(r.referrer_name || 'Careers page (no referrer)')}</dd></div>
      <div><dt>Connection</dt><dd>${esc(r.relationship || (r.source === 'link' ? 'Applied through a link' : 'Not given'))}</dd></div>
      <div><dt>Reward</dt><dd>${r.reward_status === 'none' ? `${cash(r.referrer_id ? r.job_bonus : 0)} if hired` : `${cash(r.reward_amount)} ${pill(r.reward_status)}`}</dd></div>
      <div><dt>Profile</dt><dd>${safeLink ? `<a href="${esc(safeLink)}" target="_blank" rel="noopener noreferrer">Open link</a>` : 'Not given'}</dd></div>
    </dl>
    ${r.note ? `<p class="small" style="margin-bottom:1.25rem"><span class="muted">Note from ${r.source === 'link' ? 'the candidate' : 'the referrer'}:</span><br>${esc(r.note)}</p>` : ''}
    <h3 style="font-size:1rem;margin-bottom:.75rem">History</h3>
    <ul class="timeline">${events.map((e) => `
      <li><strong>${esc(STAGE_LABEL[e.status] || e.status)}</strong>${e.note ? `: ${esc(e.note)}` : ''}
        <div class="s">${esc(fmtDate(e.created_at))}${e.actor_name ? `, ${esc(e.actor_name)}` : ''}</div></li>`).join('')}</ul>
    ${admin ? `
      <form id="upd-form" novalidate>
        <div class="form-error hidden" role="alert"></div>
        ${locked ? '<p class="muted small" style="margin-bottom:1rem">The reward is paid, so this referral\'s stage is locked. You can still add notes.</p>' : `
        <div class="field"><label for="u-status">Move to stage</label><select id="u-status" name="status">${S.stages.map((s) => `<option value="${s}" ${s === r.status ? 'selected' : ''}>${esc(STAGE_LABEL[s])}</option>`).join('')}</select></div>`}
        <div class="field"><label for="u-note">Note for the history</label><input id="u-note" name="note" maxlength="1000" placeholder="Optional. The referrer can see this."></div>
        <div class="dlg-foot">
          ${r.reward_status === 'pending' ? `<button class="btn btn-sun" type="button" id="pay" style="margin-right:auto">Mark ${cash(r.reward_amount)} as paid</button>` : ''}
          <button class="btn" type="submit">Save update</button>
        </div>
      </form>` : ''}`);
  if (!admin) return;
  const after = (msg) => { toast(msg); referralsView().then(() => referralDialog(id)); };
  handleForm($('#upd-form'), async (d) => {
    const bodyData = { note: d.note };
    if (d.status && d.status !== r.status) bodyData.status = d.status;
    if (!bodyData.status && !d.note.trim()) throw new Error('Choose a different stage or add a note.');
    await api(`/referrals/${id}`, { method: 'PUT', body: bodyData });
    after(bodyData.status ? `Moved to ${STAGE_LABEL[bodyData.status]}` : 'Note added');
  });
  $('#pay')?.addEventListener('click', async () => {
    try {
      await api(`/referrals/${id}`, { method: 'PUT', body: { reward_status: 'paid' } });
      after('Reward marked as paid');
    } catch (err) { toast(err.message, true); }
  });
}

function exportCsv() {
  const cell = (v) => {
    let s = String(v ?? '');
    if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`; // stop spreadsheets treating candidate input as formulas
    return `"${s.replace(/"/g, '""')}"`;
  };
  const header = ['Candidate', 'Email', 'Phone', 'Job', 'Referred by', 'Stage', 'Reward amount', 'Reward status', 'Submitted', 'Last update'];
  const lines = referralCache.map((r) => [r.candidate_name, r.candidate_email, r.candidate_phone, r.job_title, r.referrer_name || 'Careers page',
    STAGE_LABEL[r.status], r.reward_amount, r.reward_status, r.created_at.slice(0, 10), r.updated_at.slice(0, 10)].map(cell).join(','));
  const blob = new Blob([`﻿${header.map(cell).join(',')}\n${lines.join('\n')}`], { type: 'text/csv' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `referrals-${new Date().toISOString().slice(0, 10)}.csv`;
  a.click();
  URL.revokeObjectURL(a.href);
}

// ---------- leaderboard ----------
async function leaderboardView() {
  const { leaderboard } = await api('/leaderboard');
  view.innerHTML = `
    ${head('Leaderboard', '10 points for every referral, 100 for every hire.')}
    <div class="table-wrap"><table>
      <thead><tr><th>Rank</th><th>Name</th><th class="num-cell">Referred</th><th class="num-cell">Hired</th><th class="num-cell">Rewards earned</th><th class="num-cell">Points</th></tr></thead>
      <tbody>${leaderboard.map((p, i) => `
        <tr><td><span class="rank ${i < 3 && p.points ? 'top' : ''}">${i + 1}</span></td>
          <td><div class="t">${esc(p.name)}${p.id === S.user.id ? ' (you)' : ''}</div><div class="s">${esc(p.department)}</div></td>
          <td class="num-cell">${p.referrals}</td><td class="num-cell">${p.hires}</td>
          <td class="num-cell">${cash(p.earned)}</td><td class="num-cell"><b>${p.points}</b></td></tr>`).join('')}</tbody>
    </table></div>`;
}

// ---------- team (admin) ----------
async function teamView() {
  const { team } = await api('/team');
  const invite = `${origin}/join?code=${S.company.join_code}`;
  view.innerHTML = `
    ${head('Team', `${team.length} ${team.length === 1 ? 'person' : 'people'} in this workspace.`)}
    <div class="callout"><h2>Invite link</h2><p>Anyone with this link can join ${esc(S.company.name)} as an employee. Share it in your team chat or by email.</p>
      <div class="copybox"><input readonly id="invite" value="${esc(invite)}" aria-label="Invite link">
        <button class="btn btn-sm" type="button" id="copy-invite">Copy link</button>
        <button class="btn btn-quiet btn-sm" type="button" id="new-code">Reset link</button></div></div>
    <div class="table-wrap"><table>
      <thead><tr><th>Name</th><th>Department</th><th>Access</th><th class="num-cell">Referred</th><th>Joined</th><th></th></tr></thead>
      <tbody>${team.map((m) => `
        <tr><td><div class="t">${esc(m.name)}${m.id === S.user.id ? ' (you)' : ''}</div><div class="s">${esc(m.email.endsWith('.invalid') ? 'Demo account' : m.email)}</div></td>
          <td>${esc(m.department || 'Not set')}</td>
          <td>${m.role === 'admin' ? 'Admin' : 'Employee'}</td>
          <td class="num-cell">${m.referrals}</td>
          <td class="muted">${esc(fmtDate(m.created_at))}</td>
          <td class="num-cell">${m.id === S.user.id ? '' : `
            ${m.email.endsWith('.invalid') ? '' : `<button class="btn btn-quiet btn-sm" type="button" data-reset="${esc(m.id)}" data-name="${esc(m.name)}">Reset password</button>`}
            <button class="btn btn-quiet btn-sm" type="button" data-role="${esc(m.id)}" data-to="${m.role === 'admin' ? 'employee' : 'admin'}">${m.role === 'admin' ? 'Make employee' : 'Make admin'}</button>
            <button class="btn btn-danger btn-sm" type="button" data-remove="${esc(m.id)}" data-name="${esc(m.name)}">Remove</button>`}</td></tr>`).join('')}</tbody>
    </table></div>`;
  $('#copy-invite').addEventListener('click', () => copyText($('#invite').value, 'Invite link copied'));
  $('#new-code').addEventListener('click', () => {
    openDialog('Reset the invite link?', `<p class="muted" style="margin-bottom:1.25rem">The current link will stop working. People who already joined aren't affected.</p>
      <div class="dlg-foot"><button class="btn btn-ghost" type="button" id="no">Keep current link</button><button class="btn" type="button" id="yes">Reset link</button></div>`);
    $('#no').addEventListener('click', () => dlg.close());
    $('#yes').addEventListener('click', async () => {
      try {
        const d = await api('/company/invite-code', { method: 'POST', body: {} });
        S.company.join_code = d.join_code; dlg.close(); toast('Invite link reset'); teamView();
      } catch (err) { toast(err.message, true); }
    });
  });
  $$('[data-reset]').forEach((b) => b.addEventListener('click', () => {
    openDialog(`Reset ${b.dataset.name}'s password?`, `<p class="muted" style="margin-bottom:1.25rem">Their current password stops working and they're signed out everywhere. You'll get a temporary password to give them privately.</p>
      <div class="dlg-foot"><button class="btn btn-ghost" type="button" id="no">Cancel</button><button class="btn" type="button" id="yes">Reset password</button></div>`);
    $('#no').addEventListener('click', () => dlg.close());
    $('#yes').addEventListener('click', async () => {
      try {
        const r = await api(`/team/${b.dataset.reset}/reset-password`, { method: 'POST', body: {} });
        openDialog('Temporary password', `<p class="muted" style="margin-bottom:1rem">Give this to ${esc(b.dataset.name)}. They can change it under Account after signing in.</p>
          <div class="copybox"><input readonly value="${esc(r.temp_password)}" aria-label="Temporary password"><button class="btn btn-sm" type="button" id="cp">Copy</button></div>`);
        $('#cp').addEventListener('click', () => copyText(r.temp_password, 'Password copied'));
      } catch (err) { toast(err.message, true); }
    });
  }));
  $$('[data-role]').forEach((b) => b.addEventListener('click', async () => {
    try { await api(`/team/${b.dataset.role}`, { method: 'PUT', body: { role: b.dataset.to } }); toast('Access updated'); teamView(); }
    catch (err) { toast(err.message, true); }
  }));
  $$('[data-remove]').forEach((b) => b.addEventListener('click', () => {
    openDialog(`Remove ${b.dataset.name}?`, `<p class="muted" style="margin-bottom:1.25rem">They'll lose access straight away. Their past referrals and any rewards owed stay on record.</p>
      <div class="dlg-foot"><button class="btn btn-ghost" type="button" id="no">Cancel</button><button class="btn btn-danger" type="button" id="yes">Remove from workspace</button></div>`);
    $('#no').addEventListener('click', () => dlg.close());
    $('#yes').addEventListener('click', async () => {
      try { await api(`/team/${b.dataset.remove}`, { method: 'PUT', body: { remove: true } }); dlg.close(); toast('Removed from workspace'); teamView(); }
      catch (err) { toast(err.message, true); }
    });
  }));
}

// ---------- settings (admin) ----------
function settingsView() {
  const c = S.company;
  view.innerHTML = `
    ${head('Settings', 'Company details and how rewards work.')}
    <div class="callout"><h2>Your public careers page</h2><p>Lists every open role. Share it anywhere you advertise jobs.</p>
      <div class="copybox"><input readonly value="${esc(careersLink(false))}" aria-label="Careers page link">
        <button class="btn btn-sm" type="button" id="copy-careers">Copy link</button>
        <a class="btn btn-quiet btn-sm" href="${esc(careersLink(false))}" target="_blank" rel="noopener">Open page</a></div></div>
    <form class="panel" id="set-form" style="max-width:40rem" novalidate>
      <div class="form-error hidden" role="alert"></div>
      <div class="field"><label for="s-name">Company name</label><input id="s-name" name="name" maxlength="80" value="${esc(c.name)}" required></div>
      <div class="field-row">
        <div class="field"><label for="s-bonus">Default referral reward</label><input id="s-bonus" name="default_bonus" type="number" min="0" step="1" value="${esc(c.default_bonus)}"><p class="hint">Pre-filled when you add a job. Each job can have its own.</p></div>
        <div class="field"><label for="s-cur">Currency</label><input id="s-cur" name="currency" maxlength="3" value="${esc(c.currency)}" required><p class="hint">3-letter code, like USD, SGD or EUR.</p></div>
      </div>
      <div class="field"><label for="s-policy">Reward policy</label><textarea id="s-policy" name="reward_policy" maxlength="500" placeholder="For example: paid in the first payroll after the new hire completes 90 days.">${esc(c.reward_policy)}</textarea><p class="hint">Shown to employees on their overview.</p></div>
      <div class="field"><label for="s-about">About the company</label><textarea id="s-about" name="about" maxlength="1000" placeholder="Shown at the top of your careers page.">${esc(c.about)}</textarea></div>
      <button class="btn" type="submit">Save changes</button>
    </form>`;
  $('#copy-careers').addEventListener('click', () => copyText(careersLink(false), 'Careers link copied'));
  handleForm($('#set-form'), async (d) => {
    await api('/company', { method: 'PUT', body: d });
    await loadMe();
    toast('Changes saved');
    settingsView();
  });
}

// ---------- insights (admin) ----------
let insDays = 30;
async function insightsView() {
  const d = await api(`/insights?days=${insDays}`);
  const tot = (k) => d.rows.filter((r) => r.kind === k).reduce((t, r) => t + r.n, 0);
  const by = (k) => new Map(d.rows.filter((r) => r.kind === k).map((r) => [r.target, r.n]));
  const careers = tot('careers'), views = tot('job'), applied = tot('apply'), referred = tot('refer'), opens = tot('refclick'), joined = tot('join');
  const jv = by('job'), ja = by('apply'), jr = by('refer'), clicks = by('refclick');
  const pct = (a, b) => (b ? `${Math.round((a / b) * 100)}%` : 'n/a');
  const jobs = d.jobs.map((j) => ({ ...j, v: jv.get(j.id) || 0, a: ja.get(j.id) || 0, r: jr.get(j.id) || 0 }))
    .sort((a, b) => b.v - a.v || b.r - a.r);
  const sharers = d.people.map((p) => ({ ...p, n: clicks.get(p.ref) || 0 })).filter((p) => p.n).sort((a, b) => b.n - a.n).slice(0, 10);
  const days = [];
  for (let i = d.days - 1; i >= 0; i--) days.push(new Date(Date.now() - i * 864e5).toISOString().slice(0, 10));
  const dv = (day, k) => d.daily.filter((x) => x.day === day && x.kind === k).reduce((t, x) => t + x.n, 0);
  const daily = days.map((x) => dv(x, 'careers') + dv(x, 'job'));
  const max = Math.max(1, ...daily);
  const step = (label, n, hint) => `<div class="ins-step"><span>${label}</span><b>${n}</b><small>${hint}</small></div>`;
  const advice = (j) => j.status !== 'open' ? '' : j.v >= 10 && !j.a ? '<span class="tag warn">Many views, no applications. Try a clearer description or a bigger reward.</span>'
    : !j.v && !j.r ? '<span class="tag warn">No activity yet. Ask your team to share it.</span>' : j.v >= 5 && j.a / j.v >= 0.1 ? '<span class="tag good">Converting well</span>' : '';
  view.innerHTML = `
    ${head('Insights', 'How people find and respond to your jobs.')}
    <div class="chips" role="group" style="margin:-0.75rem 0 1.25rem">${[[7, '7 days'], [30, '30 days'], [90, '90 days']].map(([v, l]) => `<button type="button" class="chip ${insDays === v ? 'on' : ''}" data-days="${v}" aria-pressed="${insDays === v}">${l}</button>`).join('')}</div>
    <div class="ins-funnel">
      ${step('Careers page views', careers, 'People who opened your careers page')}
      ${step('Job page views', views, careers ? `${(views / careers).toFixed(1)} per careers view` : 'Including links shared by your team')}
      ${step('Applications', applied, views ? `${pct(applied, views)} of job views` : 'Through the careers page or a referral link')}
      ${step('Referrals by your team', referred, `${opens} referral link opens, ${joined} new teammates`)}
    </div>
    ${daily.some(Boolean) ? `<section class="panel"><h2>Careers and job page views per day</h2><div class="trend tall">${days.map((x, i) => `<div title="${x}: ${daily[i]} views"><b>${d.days <= 14 ? daily[i] || '' : ''}</b><i style="height:${(daily[i] / max) * 75}%"></i><span>${d.days <= 31 ? x.slice(8) : ''}</span></div>`).join('')}</div></section>` : ''}
    <section class="panel" style="margin-top:1.25rem"><h2>Jobs</h2>
      ${jobs.length ? `<div class="table-wrap flat"><table><thead><tr><th>Job</th><th class="num-cell">Views</th><th class="num-cell">Applications</th><th class="num-cell">Team referrals</th><th class="num-cell">Rate</th></tr></thead>
        <tbody>${jobs.map((j) => `<tr><td><div class="t">${esc(j.title)} ${j.status === 'open' ? '' : '<span class="pill">Closed</span>'}</div><div>${advice(j)}</div></td>
          <td class="num-cell"><b>${j.v}</b></td><td class="num-cell">${j.a}</td><td class="num-cell">${j.r}</td><td class="num-cell">${j.v ? pct(j.a, j.v) : 'n/a'}</td></tr>`).join('')}</tbody></table></div>`
        : '<p class="muted">Post a job to start seeing how it performs.</p>'}</section>
    <section class="panel" style="margin-top:1.25rem"><h2>Who's sharing their links</h2>
      ${sharers.length ? `<ul class="rows">${sharers.map((p, i) => `<li><span class="rank ${i === 0 ? 'top' : ''}">${i + 1}</span><div style="flex:1" class="t">${esc(p.name)}</div><b>${p.n} ${p.n === 1 ? 'open' : 'opens'}</b></li>`).join('')}</ul>`
        : '<p class="muted">Nobody\'s referral links have been opened in this period. Employees find their links on each job under Copy my link.</p>'}</section>
    <p class="muted small" style="margin-top:1rem">Counts are anonymous: no names, emails or IP addresses of visitors are stored.</p>`;
  $$('[data-days]').forEach((b) => b.addEventListener('click', () => { insDays = Number(b.dataset.days); insightsView(); }));
}

// ---------- help (support chat with Referleey) ----------
async function helpView() {
  const d = await api('/support');
  S.support_unread = 0;
  updateHelpBadge();
  view.innerHTML = `${head('Help', 'Questions about Referleey? Message the Referleey team here.')}
    <section class="panel chat-view">
      <div class="chat-thread" id="thread">${d.messages.length ? d.messages.map((m) => `<div class="msg ${m.from_admin ? 'them' : 'me'}"><p>${esc(m.body)}</p><time>${m.from_admin ? 'Referleey team, ' : ''}${esc(new Date(m.created_at).toLocaleString())}</time></div>`).join('')
        : '<p class="muted chat-empty">No messages yet. Ask anything about setting up your program, rewards or your account. Replies show up here.</p>'}</div>
      <form class="chat-reply" id="hform"><textarea id="hmsg" rows="2" maxlength="3000" placeholder="Write a message" aria-label="Message" required></textarea><button class="btn" type="submit">Send</button></form>
    </section>`;
  const th = $('#thread');
  th.scrollTop = th.scrollHeight;
  $('#hform').addEventListener('submit', async (e) => {
    e.preventDefault();
    const text = $('#hmsg').value.trim();
    if (!text) return;
    const btn = e.target.querySelector('button');
    btn.disabled = true;
    try { await api('/support', { method: 'POST', body: { body: text } }); toast('Message sent'); helpView(); }
    catch (err) { toast(err.message, true); btn.disabled = false; }
  });
}
function updateHelpBadge() {
  const a = $('#nav a[href="#/help"]');
  if (a) a.innerHTML = `Help${S.support_unread ? ` <span class="badge">${S.support_unread}</span>` : ''}`;
}

// ---------- account ----------
function accountView() {
  view.innerHTML = `${head('Account', 'Your sign-in details.')}
    <div class="panel" style="max-width:40rem">
      <dl class="facts"><div><dt>Name</dt><dd>${esc(S.user.name)}</dd></div><div><dt>Email</dt><dd>${esc(S.user.email.endsWith('.invalid') ? 'Demo account' : S.user.email)}</dd></div>
        <div><dt>Company</dt><dd>${esc(S.company.name)}</dd></div><div><dt>Access</dt><dd>${isAdmin() ? 'Admin' : 'Employee'}</dd></div></dl>
    </div>
    ${S.has_password ? `<form class="panel" id="pw-form" style="max-width:40rem;margin-top:1.25rem" novalidate>
      <h2>Change password</h2>
      <div class="form-error hidden" role="alert"></div>
      <div class="field"><label for="pw-cur">Current password</label><input id="pw-cur" name="current" type="password" autocomplete="current-password" required></div>
      <div class="field"><label for="pw-new">New password</label><input id="pw-new" name="next" type="password" minlength="8" autocomplete="new-password" required><p class="hint">At least 8 characters. You'll stay signed in here and be signed out on other devices.</p></div>
      <button class="btn" type="submit">Change password</button>
    </form>` : '<p class="muted" style="margin-top:1rem">Demo accounts don\'t have a password.</p>'}`;
  const f = $('#pw-form');
  if (f) handleForm(f, async (d) => { await api('/account/password', { method: 'PUT', body: d }); f.reset(); toast('Password changed'); });
}

// ---------- shell ----------
const ROUTES = {
  overview: { label: 'Overview', fn: overview },
  jobs: { label: 'Open roles', fn: jobsView },
  referrals: { label: 'Referrals', employeeLabel: 'My referrals', fn: referralsView },
  leaderboard: { label: 'Leaderboard', fn: leaderboardView },
  insights: { label: 'Insights', fn: insightsView, admin: true },
  team: { label: 'Team', fn: teamView, admin: true },
  settings: { label: 'Settings', fn: settingsView, admin: true },
  help: { label: 'Help', fn: helpView },
  account: { label: 'Account', fn: accountView },
};

async function loadMe() {
  const d = await api('/me');
  Object.assign(S, d);
  $('#co-name').textContent = S.company.name;
  $('#co-role').textContent = isAdmin() ? 'Admin workspace' : 'Employee workspace';
  $('#me-name').textContent = S.user.name;
  $('#me-email').textContent = S.user.email.endsWith('.invalid') ? 'Demo account' : S.user.email;
}

async function route() {
  const key = location.hash.replace(/^#\/?/, '') || 'overview';
  const r = ROUTES[key] && (!ROUTES[key].admin || isAdmin()) ? ROUTES[key] : ROUTES.overview;
  const active = r === ROUTES[key] ? key : 'overview';
  $('#nav').innerHTML = Object.entries(ROUTES).filter(([, v]) => !v.admin || isAdmin()).map(([k, v]) =>
    `<a href="#/${k}" class="${k === active ? 'on' : ''}" ${k === active ? 'aria-current="page"' : ''}>${esc(!isAdmin() && v.employeeLabel ? v.employeeLabel : v.label)}</a>`).join('');
  updateHelpBadge();
  $('#side').classList.remove('open');
  try {
    await r.fn();
  } catch (err) {
    if (err.status === 401) return void (location.href = '/login');
    view.innerHTML = empty('This page didn\'t load', err.message, '<button class="btn" type="button" onclick="route()">Try again</button>');
  }
}

$('#logout').addEventListener('click', async () => {
  try { await api('/auth/logout', { method: 'POST', body: {} }); } catch { /* signing out anyway */ }
  location.href = '/';
});
$('#menu').addEventListener('click', () => $('#side').classList.toggle('open'));
window.addEventListener('hashchange', route);

async function showAnnouncement() {
  try {
    const { announcement: a } = await api('/public/announcement');
    if (!a || a.audience === 'public' || (a.audience === 'admins' && !isAdmin())) return;
    showBanner(a, $('.main'));
  } catch { /* optional */ }
}
setInterval(async () => {
  try {
    const d = await api('/me');
    if (d.support_unread !== S.support_unread) { S.support_unread = d.support_unread; updateHelpBadge(); }
  } catch { /* ignore */ }
}, 60000);

loadMe().then(() => { showAnnouncement(); return route(); }).catch((err) => {
  if (err.status === 401) location.href = '/login';
  else view.innerHTML = empty('The workspace didn\'t load', err.message);
});
