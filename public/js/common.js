// Shared helpers for every page.
const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

function esc(value) {
  return String(value ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

async function api(path, { method = 'GET', body } = {}) {
  let res;
  try {
    res = await fetch(`/api${path}`, {
      method,
      credentials: 'same-origin',
      headers: body ? { 'content-type': 'application/json' } : {},
      body: body ? JSON.stringify(body) : undefined,
    });
  } catch {
    throw new Error("Can't reach the server. Check your connection and try again.");
  }
  let data = {};
  try { data = await res.json(); } catch { /* non-JSON response */ }
  if (!res.ok) {
    const err = new Error(data.error || `Request failed (${res.status}).`);
    err.status = res.status;
    throw err;
  }
  return data;
}

function money(amount, currency = 'USD') {
  try {
    return new Intl.NumberFormat(undefined, { style: 'currency', currency, maximumFractionDigits: 0 }).format(amount || 0);
  } catch {
    return `${currency} ${amount || 0}`;
  }
}
function fmtDate(iso) {
  if (!iso) return '';
  return new Date(iso).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
}
const STAGE_LABEL = {
  submitted: 'Submitted', reviewing: 'In review', interviewing: 'Interviewing',
  offer: 'Offer', hired: 'Hired', rejected: 'Not moving forward',
  paid: 'Reward paid', pending: 'Reward pending', note: 'Note', none: 'No reward',
};
const pill = (status) => `<span class="pill ${esc(status)}">${esc(STAGE_LABEL[status] || status)}</span>`;

let toastTimer;
function toast(message, bad = false) {
  $('.toast')?.remove();
  const el = document.createElement('div');
  el.className = `toast${bad ? ' bad' : ''}`;
  el.setAttribute('role', 'status');
  el.textContent = message;
  document.body.append(el);
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.remove(), 3200);
}

async function copyText(text, done = 'Link copied') {
  try {
    await navigator.clipboard.writeText(text);
    toast(done);
  } catch {
    window.prompt('Copy this link:', text);
  }
}

// Wire a form: disables the button while saving and shows errors in place.
function handleForm(form, onSubmit) {
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const btn = form.querySelector('button[type=submit]');
    const errBox = form.querySelector('.form-error');
    errBox?.classList.add('hidden');
    const label = btn.textContent;
    btn.disabled = true;
    btn.textContent = 'Working…';
    try {
      await onSubmit(Object.fromEntries(new FormData(form)));
    } catch (err) {
      if (errBox) { errBox.textContent = err.message; errBox.classList.remove('hidden'); }
      else toast(err.message, true);
    } finally {
      btn.disabled = false;
      btn.textContent = label;
    }
  });
}

async function startDemo(role, button) {
  if (button) { button.disabled = true; button.textContent = 'Setting up the demo…'; }
  try {
    await api('/auth/demo', { method: 'POST', body: { role } });
    location.href = '/app';
  } catch (err) {
    toast(err.message, true);
    if (button) { button.disabled = false; button.textContent = 'Explore the demo'; }
  }
}
