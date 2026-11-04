'use strict';
/* Personal Hub — purchases, expenses, bills and notes, synced to Google Drive. */

// ---------- helpers ----------
const $ = (s, el = document) => el.querySelector(s);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
const now = () => Date.now();
const LS = {
  get(k) { try { return localStorage.getItem(k); } catch { return null; } },
  set(k, v) { try { localStorage.setItem(k, v); } catch {} },
  del(k) { try { localStorage.removeItem(k); } catch {} },
};
const localISO = (d) => new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
const today = () => localISO(new Date());
const parseISO = (s) => { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d || 1); };
const daysUntil = (iso) => Math.round((parseISO(iso) - parseISO(today())) / 864e5);
const shiftMonth = (ym, n) => { const d = parseISO(ym + '-01'); d.setMonth(d.getMonth() + n); return localISO(d).slice(0, 7); };
const monthLabel = (ym, short) => parseISO(ym + '-01').toLocaleDateString('en-IN', { month: short ? 'short' : 'long', year: 'numeric' });
const fmtDate = (iso) => {
  const d = parseISO(iso), sameYear = d.getFullYear() === new Date().getFullYear();
  return d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', ...(sameYear ? {} : { year: 'numeric' }) });
};
const dayLabel = (iso) => {
  const n = daysUntil(iso);
  if (n === 0) return 'Today';
  if (n === -1) return 'Yesterday';
  return parseISO(iso).toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short' });
};
const inr = new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 });
const money = (n) => inr.format(Math.round(+n || 0));
// Short Indian-style amounts for chart labels: ₹950, ₹12.4k, ₹1.2L, ₹1.5Cr
const compact = (n) => {
  n = Math.round(+n || 0);
  const f = (x, u) => '₹' + (x >= 100 ? Math.round(x) : x.toFixed(1).replace(/\.0$/, '')) + u;
  return n >= 1e7 ? f(n / 1e7, 'Cr') : n >= 1e5 ? f(n / 1e5, 'L') : n >= 1e3 ? f(n / 1e3, 'k') : '₹' + n;
};
const sum = (list, key = 'amount') => list.reduce((a, r) => a + (+r[key] || 0), 0);
function addMonths(iso, n, day) {
  const d = parseISO(iso), t = new Date(d.getFullYear(), d.getMonth() + n, 1);
  const last = new Date(t.getFullYear(), t.getMonth() + 1, 0).getDate();
  t.setDate(Math.min(day || d.getDate(), last));
  return localISO(t);
}
function toast(msg) {
  const t = $('#toast'); t.textContent = msg; t.classList.add('show');
  clearTimeout(toast.t); toast.t = setTimeout(() => t.classList.remove('show'), 2600);
}
// In-app confirmation (works everywhere, unlike the browser's confirm box)
function ask(msg, ok = 'Delete') {
  return new Promise((res) => {
    const d = $('#ask');
    d.innerHTML = `<div class="sheet-body" style="padding-top:20px"><p style="margin:0;font-size:15px">${esc(msg)}</p></div>
      <div class="sheet-foot"><button type="button" class="btn" value="no">Cancel</button><button type="button" class="btn ${ok === 'Delete' ? 'dangerfill' : 'primary'}" value="yes">${esc(ok)}</button></div>`;
    d.onclick = (e) => {
      const v = e.target.closest('button')?.value;
      if (v || e.target === d) { d.close(); res(v === 'yes'); }
    };
    d.showModal();
  });
}
function download(name, text, type) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([text], { type }));
  a.download = name; document.body.appendChild(a); a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
}

// ---------- lists ----------
const CATS = {
  essentials: ['Household', 'Toiletries & personal care', 'Cleaning supplies', 'Kitchenware', 'Appliances', 'Repairs & maintenance', 'Health & medicines', 'Other'],
  lifestyle: ['Gadgets & electronics', 'Clothing & footwear', 'Home décor', 'Furniture', 'Hobbies & sports', 'Books & learning', 'Travel gear', 'Other'],
  expense: ['Food & dining', 'Groceries', 'Transport & fuel', 'Bills & utilities', 'Rent', 'Health', 'Essentials', 'Lifestyle', 'Entertainment', 'Education', 'Travel', 'EMI & loans', 'Gifts', 'Personal care', 'Other'],
  bill: ['Electricity', 'Water', 'Phone & internet', 'Subscriptions & OTT', 'Insurance', 'EMI & loan', 'Rent', 'Credit card', 'Other'],
  pay: ['UPI', 'Card', 'Cash', 'Net banking', 'Other'],
};
const FREQ = { monthly: 1, bimonthly: 2, quarterly: 3, halfyearly: 6, yearly: 12, once: 0 };
const FREQ_LABEL = { monthly: 'Monthly', bimonthly: 'Every 2 months', quarterly: 'Quarterly', halfyearly: 'Half-yearly', yearly: 'Yearly', once: 'One-time' };
const PRIO = { high: 0, medium: 1, low: 2 };

// ---------- storage ----------
const KEY = 'ph:data';
const COLS = ['purchases', 'expenses', 'bills', 'notes'];
const Store = {
  data: {},
  load() {
    try { this.data = JSON.parse(LS.get(KEY)) || {}; } catch { this.data = {}; }
    COLS.forEach((c) => { if (!Array.isArray(this.data[c])) this.data[c] = []; });
  },
  persist() { LS.set(KEY, JSON.stringify(this.data)); },
  all(col) { return this.data[col].filter((r) => !r.deleted); },
  get(col, id) { return this.data[col].find((r) => r.id === id && !r.deleted); },
  put(col, rec) {
    rec = { ...rec, updatedAt: now() };
    if (!rec.id) { rec.id = uid(); rec.createdAt = rec.updatedAt; }
    const i = this.data[col].findIndex((r) => r.id === rec.id);
    if (i < 0) this.data[col].push(rec); else this.data[col][i] = rec;
    return rec;
  },
  del(col, id) {
    const i = this.data[col].findIndex((r) => r.id === id);
    if (i >= 0) this.data[col][i] = { id, deleted: true, updatedAt: now() };
  },
};
const all = (c) => Store.all(c);
function commit(msg) { Store.persist(); Sync.schedule(); render(); if (msg) toast(msg); }

// Merge two copies record-by-record: the most recently edited version wins.
function mergeData(a, b) {
  const out = {}, cutoff = now() - 120 * 864e5;
  COLS.forEach((c) => {
    const m = new Map();
    [...(a?.[c] || []), ...(b?.[c] || [])].forEach((r) => {
      if (!r || !r.id) return;
      const e = m.get(r.id);
      if (!e || (r.updatedAt || 0) > (e.updatedAt || 0)) m.set(r.id, r);
    });
    out[c] = [...m.values()].filter((r) => !(r.deleted && r.updatedAt < cutoff));
  });
  return out;
}

// ---------- Google Drive sync ----------
const API = 'https://www.googleapis.com/drive/v3';
const UPLOAD = 'https://www.googleapis.com/upload/drive/v3';
const FOLDER_NAME = 'Personal Hub';
const FILE_NAME = 'personal-hub-data.json';
const SCOPE = 'https://www.googleapis.com/auth/drive.file https://www.googleapis.com/auth/calendar.events';
const CAL = 'https://www.googleapis.com/calendar/v3/calendars/primary/events';
const REMIND_HOUR = '09:00'; // reminders pop up at 9:00 AM
const clientId = () => {
  const id = (window.PH_CONFIG && window.PH_CONFIG.GOOGLE_CLIENT_ID) || '';
  return id.includes('apps.googleusercontent.com') ? id : '';
};

const Sync = {
  token: null, exp: 0, client: null, busy: false, again: false, timer: null,
  state: 'local', lastSync: +LS.get('ph:lastSync') || 0,
  connected() { return LS.get('ph:connected') === '1'; },
  valid() { return !!this.token && now() < this.exp - 60000; },
  restore() {
    try { const t = JSON.parse(LS.get('ph:token')); if (t) { this.token = t.t; this.exp = t.e; } } catch {}
    this.refreshStatus();
  },
  onGisLoaded() { this.ensureClient(); },
  ensureClient() {
    if (this.client) return true;
    if (!window.google?.accounts?.oauth2 || !clientId()) return false;
    this.client = google.accounts.oauth2.initTokenClient({
      client_id: clientId(), scope: SCOPE,
      callback: (r) => this.onToken(r),
      error_callback: (e) => this.setStatus('error', e?.type === 'popup_closed' ? 'Sign-in cancelled' : 'Sign-in failed'),
    });
    return true;
  },
  signIn() {
    if (!clientId()) { toast('Add your Google Client ID in config.js first (see setup guide)'); return; }
    if (!navigator.onLine) { toast('You are offline. Changes are saved on this device.'); return; }
    if (!this.ensureClient()) { toast('Google sign-in is still loading. Try again in a moment.'); return; }
    this.client.requestAccessToken({ prompt: this.connected() ? '' : 'consent' });
  },
  onToken(r) {
    if (r.error) { this.setStatus('error', 'Sign-in failed'); return; }
    this.token = r.access_token; this.exp = now() + r.expires_in * 1000;
    LS.set('ph:token', JSON.stringify({ t: this.token, e: this.exp }));
    LS.set('ph:connected', '1');
    this.sync();
  },
  signOut() {
    if (this.token && window.google?.accounts?.oauth2) google.accounts.oauth2.revoke(this.token, () => {});
    this.token = null; this.exp = 0;
    ['ph:token', 'ph:connected', 'ph:fileId', 'ph:lastSync'].forEach((k) => LS.del(k));
    this.lastSync = 0; this.refreshStatus();
  },
  refreshStatus() {
    if (!this.connected()) this.setStatus('local');
    else if (!navigator.onLine) this.setStatus('offline');
    else if (!this.valid()) this.setStatus('pending', 'Tap to sync');
    else this.setStatus('synced');
  },
  setStatus(state, label) {
    this.state = state;
    const labels = { local: 'Connect Drive', pending: 'Tap to sync', syncing: 'Syncing…', synced: 'Synced', offline: 'Offline', error: 'Sync failed' };
    const b = $('#syncBtn'); if (!b) return;
    b.dataset.state = state; $('#syncLabel').textContent = label || labels[state];
  },
  tap() { if (this.valid()) this.sync(); else this.signIn(); },
  schedule() {
    if (!this.connected()) return;
    if (!navigator.onLine) return this.setStatus('offline');
    if (!this.valid()) return this.setStatus('pending', 'Tap to sync');
    this.setStatus('pending', 'Saving…');
    clearTimeout(this.timer); this.timer = setTimeout(() => this.sync(), 2500);
  },
  async api(url, opts = {}) {
    const res = await fetch(url, { ...opts, headers: { Authorization: 'Bearer ' + this.token, ...(opts.headers || {}) } });
    if (res.status === 401) { this.token = null; this.exp = 0; LS.del('ph:token'); throw new Error('auth'); }
    if (!res.ok) throw new Error('Drive error ' + res.status);
    return res;
  },
  async findFile() {
    let id = LS.get('ph:fileId');
    if (id) {
      try { const j = await (await this.api(`${API}/files/${id}?fields=id,trashed`)).json(); if (!j.trashed) return id; }
      catch (e) { if (e.message === 'auth') throw e; }
      LS.del('ph:fileId');
    }
    const q = encodeURIComponent(`name='${FILE_NAME}' and trashed=false`);
    const j = await (await this.api(`${API}/files?q=${q}&spaces=drive&orderBy=modifiedTime desc&fields=files(id)`)).json();
    id = j.files?.[0]?.id || null;
    if (id) LS.set('ph:fileId', id);
    return id;
  },
  async folderId() {
    const q = encodeURIComponent(`name='${FOLDER_NAME}' and mimeType='application/vnd.google-apps.folder' and trashed=false`);
    const j = await (await this.api(`${API}/files?q=${q}&fields=files(id)`)).json();
    if (j.files?.[0]) return j.files[0].id;
    const r = await this.api(`${API}/files?fields=id`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: FOLDER_NAME, mimeType: 'application/vnd.google-apps.folder' }),
    });
    return (await r.json()).id;
  },
  async sync() {
    if (this.busy) { this.again = true; return; }
    if (!navigator.onLine) return this.setStatus('offline');
    if (!this.valid()) return this.refreshStatus();
    clearTimeout(this.timer);
    this.busy = true; this.setStatus('syncing');
    try {
      const id = await this.findFile();
      let remote = null;
      if (id) { try { remote = await (await this.api(`${API}/files/${id}?alt=media`)).json(); } catch (e) { if (e.message === 'auth') throw e; } }
      Store.data = mergeData(Store.data, remote); Store.persist();
      await Reminders.sync();
      const body = JSON.stringify({ app: 'Personal Hub', version: 1, savedAt: new Date().toISOString(), ...Store.data });
      if (id) {
        await this.api(`${UPLOAD}/files/${id}?uploadType=media`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body });
      } else {
        const parent = await this.folderId(), b = 'ph' + uid();
        const meta = JSON.stringify({ name: FILE_NAME, mimeType: 'application/json', parents: [parent] });
        const mp = `--${b}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${meta}\r\n--${b}\r\nContent-Type: application/json\r\n\r\n${body}\r\n--${b}--`;
        const r = await this.api(`${UPLOAD}/files?uploadType=multipart&fields=id`, { method: 'POST', headers: { 'Content-Type': 'multipart/related; boundary=' + b }, body: mp });
        LS.set('ph:fileId', (await r.json()).id);
      }
      this.lastSync = now(); LS.set('ph:lastSync', this.lastSync);
      this.setStatus('synced');
      if (!$('#sheet').open) render();
    } catch (e) {
      console.error(e);
      if (e.message === 'auth') this.setStatus('pending', 'Tap to sync');
      else this.setStatus(navigator.onLine ? 'error' : 'offline');
    } finally {
      this.busy = false;
      if (this.again) { this.again = false; this.schedule(); }
    }
  },
};

// ---------- bill reminders (Google Calendar) ----------
// Each bill with a reminder becomes a repeating 9:00 AM event in your Google Calendar,
// so your phone and computer notify you even when this app is closed.
const Reminders = {
  error: LS.get('ph:calError') || '',
  trash() { try { return JSON.parse(LS.get('ph:calTrash')) || []; } catch { return []; } },
  forget(eventId) { if (eventId) LS.set('ph:calTrash', JSON.stringify([...this.trash(), eventId])); },
  wanted: (b) => b.remind != null && b.remind !== '' && b.remind !== 'off' && !b.done && !!b.due,
  // What the calendar event depends on; when this changes the event is updated.
  sig: (b) => JSON.stringify([b.name, b.amount, b.freq, b.dueDay, b.remind, b.freq === 'once' || !FREQ[b.freq] ? b.due : '']),
  event(b) {
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone || 'Asia/Kolkata';
    const months = FREQ[b.freq] || 0, day = b.dueDay || +b.due.slice(8, 10), days = +b.remind || 0;
    const byDay = day > 28 ? `;BYMONTHDAY=${Array.from({ length: day - 27 }, (_, i) => 28 + i).join(',')};BYSETPOS=-1` : `;BYMONTHDAY=${day}`;
    const [hh, mm] = REMIND_HOUR.split(':').map(Number), end = `${String(hh).padStart(2, '0')}:${String(mm + 15).padStart(2, '0')}`;
    const overrides = [{ method: 'popup', minutes: 0 }];
    if (days) overrides.push({ method: 'popup', minutes: days * 1440 });
    return {
      summary: `Bill due: ${b.name}${b.amount != null ? ' · ' + money(b.amount) : ''}`,
      description: `${FREQ_LABEL[b.freq] || ''} bill${b.autopay ? ' (on autopay)' : ''}. Mark it paid in Personal Hub.${b.notes ? '\n\n' + b.notes : ''}`,
      start: { dateTime: `${b.due}T${REMIND_HOUR}:00`, timeZone: tz },
      end: { dateTime: `${b.due}T${end}:00`, timeZone: tz },
      recurrence: months ? [`RRULE:FREQ=MONTHLY;INTERVAL=${months}${byDay}`] : [],
      reminders: { useDefault: false, overrides },
      transparency: 'transparent',
      extendedProperties: { private: { personalHubBill: b.id } },
    };
  },
  setError(msg) { this.error = msg; msg ? LS.set('ph:calError', msg) : LS.del('ph:calError'); },
  async sync() {
    const call = (url, method, body) => Sync.api(url, { method, headers: { 'Content-Type': 'application/json' }, body: body && JSON.stringify(body) });
    try {
      for (const id of this.trash()) {
        try { await call(`${CAL}/${id}`, 'DELETE'); } catch (e) { if (!/ 40[34]| 410/.test(e.message)) throw e; }
        LS.set('ph:calTrash', JSON.stringify(this.trash().filter((x) => x !== id)));
      }
      for (const b of all('bills')) {
        if (this.wanted(b)) {
          if (b.calEventId && b.calSig === this.sig(b)) continue;
          let ev = null;
          if (b.calEventId) { try { ev = await (await call(`${CAL}/${b.calEventId}`, 'PUT', this.event(b))).json(); } catch (e) { if (!/ 404| 410/.test(e.message)) throw e; } }
          if (!ev) ev = await (await call(CAL, 'POST', this.event(b))).json();
          Store.put('bills', { ...b, calEventId: ev.id, calSig: this.sig(b) });
        } else if (b.calEventId) {
          try { await call(`${CAL}/${b.calEventId}`, 'DELETE'); } catch (e) { if (!/ 40[34]| 410/.test(e.message)) throw e; }
          Store.put('bills', { ...b, calEventId: null, calSig: null });
        }
      }
      Store.persist(); this.setError('');
    } catch (e) {
      if (e.message === 'auth') throw e;
      console.error('Calendar', e);
      this.setError(/ 403/.test(e.message) ? 'perm' : 'fail');
    }
  },
  count: () => all('bills').filter((b) => Reminders.wanted(b)).length,
};

// ---------- sheet (dialog) & forms ----------
const sheet = () => $('#sheet');
function openSheet(html, after) {
  const d = sheet(); d.innerHTML = html;
  if (!d.open) d.showModal();
  if (after) after(d);
}
function closeSheet() { const d = sheet(); if (d.open) d.close(); }

function opts(list, val) {
  return list.map((o) => {
    const [v, l] = Array.isArray(o) ? o : [o, o];
    return `<option value="${esc(v)}"${String(v) === String(val ?? '') ? ' selected' : ''}>${esc(l)}</option>`;
  }).join('');
}
function fieldHTML(f, values) {
  if (Array.isArray(f)) return `<div class="grid2">${f.map((x) => fieldHTML(x, values)).join('')}</div>`;
  const v = values[f.name] ?? f.value ?? '';
  const req = f.required ? ' required' : '';
  const lab = `<span>${esc(f.label)}</span>`;
  switch (f.type) {
    case 'select': return `<label class="field">${lab}<select name="${f.name}"${req}>${opts(f.options, v)}</select></label>`;
    case 'textarea': return `<label class="field">${lab}<textarea name="${f.name}" placeholder="${esc(f.ph || '')}">${esc(v)}</textarea></label>`;
    case 'check': return `<label class="field check"><input type="checkbox" name="${f.name}"${v ? ' checked' : ''}><span>${esc(f.label)}</span></label>`;
    case 'amount': return `<label class="field">${lab}<input class="amount-input" type="number" inputmode="decimal" step="any" min="0" name="${f.name}" value="${esc(v)}" placeholder="₹ 0"${req}></label>`;
    default: return `<label class="field">${lab}<input type="${f.type || 'text'}" name="${f.name}" value="${esc(v)}" placeholder="${esc(f.ph || '')}"${req}${f.type === 'number' ? ' inputmode="decimal" step="any" min="0"' : ''}></label>`;
  }
}
function formSheet({ title, fields, values = {}, submit = 'Save', onSubmit, onDelete, extra = '', after }) {
  const flat = fields.flat();
  openSheet(`
    <form method="dialog" id="frm">
      <div class="sheet-head"><h2>${esc(title)}</h2>
        <button type="button" class="icon-btn" data-act="close" aria-label="Close"><svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6 6 18"/></svg></button></div>
      <div class="sheet-body">${fields.map((f) => fieldHTML(f, values)).join('')}${extra}</div>
      <div class="sheet-foot">
        ${onDelete ? '<button type="button" class="btn danger" id="del">Delete</button>' : ''}
        <button type="button" class="btn" data-act="close">Cancel</button>
        <button type="submit" class="btn primary">${esc(submit)}</button>
      </div>
    </form>`, (d) => {
    const form = $('#frm', d);
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      const vals = {};
      flat.forEach((f) => {
        const el = form.elements[f.name];
        if (f.type === 'check') vals[f.name] = el.checked;
        else if (f.type === 'amount' || f.type === 'number') vals[f.name] = el.value === '' ? null : Math.max(0, parseFloat(el.value) || 0);
        else vals[f.name] = el.value.trim();
      });
      if (onSubmit(vals) !== false) closeSheet();
    });
    if (onDelete) $('#del', d).onclick = async () => { if (await ask('Delete this item?')) { onDelete(); closeSheet(); } };
    const first = form.querySelector('input:not([type=checkbox]),textarea');
    if (first && !first.value && window.matchMedia('(min-width: 640px)').matches) first.focus();
    if (after) after(form);
  });
}

// ---------- purchases ----------
function purchaseForm(p = {}) {
  const isNew = !p.id, list = p.list || UI.buyList, bought = p.status === 'bought';
  const fields = [
    { name: 'name', label: 'What to buy', required: true, ph: 'e.g. Mixer grinder, running shoes' },
    [{ name: 'list', label: 'List', type: 'select', options: [['essentials', 'Essentials'], ['lifestyle', 'Lifestyle']], value: list },
      { name: 'category', label: 'Category', type: 'select', options: CATS[list] }],
    [{ name: 'estimate', label: 'Estimated price (₹)', type: 'number' },
      { name: 'priority', label: 'Priority', type: 'select', options: [['high', 'High'], ['medium', 'Medium'], ['low', 'Low']], value: 'medium' }],
    { name: 'buyBy', label: 'Plan to buy by (month)', type: 'month' },
    { name: 'link', label: 'Product link (optional)', type: 'url', ph: 'https://' },
    { name: 'notes', label: 'Notes', type: 'textarea', ph: 'Model, size, colour, shop…' },
  ];
  if (bought) fields.splice(3, 0, [{ name: 'actualPrice', label: 'Paid (₹)', type: 'number' }, { name: 'boughtDate', label: 'Bought on', type: 'date' }]);
  const extra = p.link ? `<p><a class="linkish" href="${esc(p.link)}" target="_blank" rel="noopener">Open product link ↗</a></p>` : '';
  formSheet({
    title: isNew ? 'Plan a purchase' : 'Edit purchase', fields, values: p, extra,
    onSubmit: (v) => { Store.put('purchases', { status: 'planned', ...p, ...v }); commit(isNew ? 'Added to your plan' : 'Saved'); },
    onDelete: isNew ? null : () => { Store.del('purchases', p.id); commit('Deleted'); },
    after: (form) => {
      const cat = form.elements.category;
      form.elements.list.addEventListener('change', (e) => { cat.innerHTML = opts(CATS[e.target.value]); });
    },
  });
}
function markBought(p) {
  formSheet({
    title: 'Bought: ' + p.name, submit: 'Mark bought',
    fields: [
      { name: 'amount', label: 'Price paid (₹)', type: 'amount', required: true, value: p.estimate ?? '' },
      [{ name: 'date', label: 'Date', type: 'date', value: today(), required: true }, { name: 'pay', label: 'Paid by', type: 'select', options: CATS.pay }],
      { name: 'addExpense', label: 'Add to Expenses', type: 'check', value: true },
    ],
    onSubmit: (v) => {
      let expenseId = null;
      if (v.addExpense) {
        expenseId = Store.put('expenses', {
          amount: v.amount, date: v.date, pay: v.pay, note: p.name, purchaseId: p.id,
          category: p.list === 'lifestyle' ? 'Lifestyle' : 'Essentials',
        }).id;
      }
      Store.put('purchases', { ...p, status: 'bought', actualPrice: v.amount, boughtDate: v.date, expenseId });
      commit(v.addExpense ? 'Marked bought and added to Expenses' : 'Marked bought');
    },
  });
}
async function unBuy(p) {
  if (!(await ask(`Move "${p.name}" back to your plan?` + (p.expenseId ? ' Its expense entry will be removed.' : ''), 'Move back'))) return;
  if (p.expenseId) Store.del('expenses', p.expenseId);
  const { actualPrice, boughtDate, expenseId, ...rest } = p;
  Store.put('purchases', { ...rest, status: 'planned' });
  commit('Moved back to plan');
}
const sortPlanned = (a, b) => (PRIO[a.priority] ?? 1) - (PRIO[b.priority] ?? 1) || (a.buyBy || '9999').localeCompare(b.buyBy || '9999') || a.createdAt - b.createdAt;

function purchaseRow(p) {
  const bought = p.status === 'bought', cm = today().slice(0, 7);
  const late = !bought && p.buyBy && p.buyBy < cm;
  const badge = !bought && p.priority !== 'low' ? ` <span class="badge ${p.priority}">${p.priority === 'high' ? 'High' : 'Med'}</span>` : '';
  const when = bought ? `Bought ${fmtDate(p.boughtDate)}` : p.buyBy ? `<span class="${late ? 'late-text' : ''}">by ${monthLabel(p.buyBy, true)}${late ? ' · overdue' : ''}</span>` : 'No date';
  return `<div class="row"><span class="dot-cat ${p.list}"></span>
    <div class="main" data-act="edit-purchase" data-id="${p.id}"><div class="t">${esc(p.name)}${badge}</div>
      <div class="m">${when} · ${esc(p.category || '')}</div></div>
    <div class="amt">${bought ? money(p.actualPrice) : p.estimate != null ? money(p.estimate) : '—'}${!bought && p.estimate != null ? '<small>est.</small>' : ''}</div>
    ${bought ? `<button class="pill-btn ghost" data-act="unbuy" data-id="${p.id}">Undo</button>` : `<button class="pill-btn" data-act="bought" data-id="${p.id}">Bought</button>`}
  </div>`;
}
function vBuy() {
  const cm = today().slice(0, 7);
  const list = all('purchases').filter((p) => p.list === UI.buyList);
  const planned = list.filter((p) => p.status !== 'bought').sort(sortPlanned);
  const bought = list.filter((p) => p.status === 'bought').sort((a, b) => (b.boughtDate || '').localeCompare(a.boughtDate || ''));
  const dueNow = planned.filter((p) => p.buyBy && p.buyBy <= cm);
  const showPlanned = UI.buyStatus === 'planned', rows = showPlanned ? planned : bought;
  const boughtMonth = bought.filter((p) => (p.boughtDate || '').startsWith(cm));
  return `
    <div class="seg ${UI.buyList}">
      <button data-act="buy-list" data-v="essentials" class="${UI.buyList === 'essentials' ? 'on' : ''}">Essentials</button>
      <button data-act="buy-list" data-v="lifestyle" class="${UI.buyList === 'lifestyle' ? 'on' : ''}">Lifestyle</button>
    </div>
    <div class="chips">
      <button class="chip ${showPlanned ? 'on' : ''}" data-act="buy-status" data-v="planned">To buy (${planned.length})</button>
      <button class="chip ${!showPlanned ? 'on' : ''}" data-act="buy-status" data-v="bought">Bought (${bought.length})</button>
    </div>
    ${showPlanned
      ? `<div class="card summary"><div>Total planned<b>${money(sum(planned, 'estimate'))}</b></div><div style="text-align:right">Due this month<b>${money(sum(dueNow, 'estimate'))}</b></div></div>`
      : `<div class="card summary"><div>Bought this month<b>${money(sum(boughtMonth, 'actualPrice'))}</b></div><div style="text-align:right">All time<b>${money(sum(bought, 'actualPrice'))}</b></div></div>`}
    ${rows.length ? `<div class="card list">${rows.map(purchaseRow).join('')}</div>`
      : `<div class="card empty"><b>${showPlanned ? 'Nothing planned yet' : 'Nothing bought yet'}</b>${showPlanned ? `Tap + to plan your next ${UI.buyList === 'essentials' ? 'essential (household items, toiletries, repairs…)' : 'lifestyle buy (gadgets, clothes, décor…)'}` : 'Items you mark as bought show up here.'}</div>`}`;
}

// ---------- expenses ----------
function expenseForm(e = {}) {
  const isNew = !e.id;
  formSheet({
    title: isNew ? 'Add expense' : 'Edit expense', values: e,
    fields: [
      { name: 'amount', label: 'Amount (₹)', type: 'amount', required: true },
      [{ name: 'category', label: 'Category', type: 'select', options: CATS.expense }, { name: 'date', label: 'Date', type: 'date', required: true, value: today() }],
      [{ name: 'note', label: 'Note', ph: 'What was it for?' }, { name: 'pay', label: 'Paid by', type: 'select', options: CATS.pay }],
    ],
    extra: e.purchaseId ? '<p class="m" style="font-size:13px;color:var(--muted)">Linked to an item in your purchase plan.</p>' : '',
    onSubmit: (v) => { Store.put('expenses', { ...e, ...v }); commit(isNew ? 'Expense added' : 'Saved'); },
    onDelete: isNew ? null : () => {
      Store.del('expenses', e.id);
      const p = e.purchaseId && Store.get('purchases', e.purchaseId);
      if (p) Store.put('purchases', { ...p, expenseId: null });
      commit('Deleted');
    },
  });
}
function expenseRow(e) {
  return `<div class="row"><div class="main" data-act="edit-expense" data-id="${e.id}">
      <div class="t">${esc(e.note || e.category)}</div><div class="m">${esc(e.note ? e.category : '')}${e.note && e.pay ? ' · ' : ''}${esc(e.pay || '')}</div></div>
    <div class="amt">${money(e.amount)}</div></div>`;
}
function vSpend() {
  const m = UI.month, list = all('expenses').filter((e) => (e.date || '').startsWith(m))
    .sort((a, b) => b.date.localeCompare(a.date) || b.createdAt - a.createdAt);
  const total = sum(list), prev = sum(all('expenses').filter((e) => (e.date || '').startsWith(shiftMonth(m, -1))));
  const byCat = {}; list.forEach((e) => { byCat[e.category] = (byCat[e.category] || 0) + (+e.amount || 0); });
  const cats = Object.entries(byCat).sort((a, b) => b[1] - a[1]), max = cats[0]?.[1] || 1;
  const diff = prev ? Math.round(((total - prev) / prev) * 100) : null;
  let days = '', last = '';
  list.forEach((e) => {
    if (e.date !== last) { if (last) days += '</div>'; days += `<div class="daylabel">${dayLabel(e.date)}</div><div class="card list">`; last = e.date; }
    days += expenseRow(e);
  });
  if (last) days += '</div>';
  return `
    <div class="monthnav">
      <button class="icon-btn" data-act="month" data-v="-1" aria-label="Previous month"><svg viewBox="0 0 24 24"><path d="m15 6-6 6 6 6"/></svg></button>
      <strong>${monthLabel(m)}</strong>
      <button class="icon-btn" data-act="month" data-v="1" aria-label="Next month" ${m >= today().slice(0, 7) ? 'disabled style="opacity:.3"' : ''}><svg viewBox="0 0 24 24"><path d="m9 6 6 6-6 6"/></svg></button>
    </div>
    <div class="card stat hero"><div class="k">Spent in ${monthLabel(m, true)}</div><div class="v">${money(total)}</div>
      <div class="s">${list.length} entr${list.length === 1 ? 'y' : 'ies'}${diff !== null ? ` · ${diff >= 0 ? '+' : ''}${diff}% vs ${monthLabel(shiftMonth(m, -1), true)}` : ''}</div></div>
    ${cats.length ? `<div class="section"><h2>By category</h2></div><div class="card bars">${cats.map(([c, v]) => `
      <div class="bar"><div class="lab"><span>${esc(c)}</span><span>${money(v)}</span></div><div class="track"><div class="fill" style="width:${Math.max(3, (v / max) * 100)}%"></div></div></div>`).join('')}</div>` : ''}
    ${list.length ? `<div class="section"><h2>Entries</h2><button class="linkish" data-act="csv-month">Export CSV</button></div>${days}`
      : '<div class="card empty" style="margin-top:12px"><b>No expenses this month</b>Tap + to add one. It takes a few seconds.</div>'}`;
}
function csv(rows) {
  const q = (s) => `"${String(s ?? '').replace(/"/g, '""')}"`;
  return ['Date,Category,Note,Paid by,Amount', ...rows.sort((a, b) => a.date.localeCompare(b.date)).map((e) => [e.date, q(e.category), q(e.note), q(e.pay), e.amount].join(','))].join('\n');
}

// ---------- bills ----------
const activeBills = () => all('bills').filter((b) => !b.done && b.due).sort((a, b) => a.due.localeCompare(b.due));
function billForm(b = {}) {
  const isNew = !b.id;
  formSheet({
    title: isNew ? 'Add bill or subscription' : 'Edit bill', values: b,
    fields: [
      { name: 'name', label: 'Name', required: true, ph: 'e.g. KSEB electricity, Netflix, LIC' },
      [{ name: 'amount', label: 'Amount (₹)', type: 'number' }, { name: 'category', label: 'Type', type: 'select', options: CATS.bill }],
      [{ name: 'freq', label: 'Repeats', type: 'select', options: Object.entries(FREQ_LABEL), value: 'monthly' }, { name: 'due', label: 'Next due date', type: 'date', required: true }],
      { name: 'remind', label: 'Remind me', type: 'select', value: '2', options: [['off', 'No reminder'], ['0', 'On the due date'], ['1', '1 day before'], ['2', '2 days before'], ['3', '3 days before'], ['5', '5 days before'], ['7', '1 week before']] },
      { name: 'autopay', label: 'On autopay', type: 'check' },
      { name: 'notes', label: 'Notes', type: 'textarea', ph: 'Consumer number, account, how you pay…' },
    ],
    onSubmit: (v) => { Store.put('bills', { ...b, ...v, dueDay: +v.due.slice(8, 10), done: false }); commit(isNew ? 'Bill added' : 'Saved'); },
    onDelete: isNew ? null : () => { Reminders.forget(b.calEventId); Store.del('bills', b.id); commit('Deleted'); },
  });
}
function payBill(b) {
  formSheet({
    title: 'Paid: ' + b.name, submit: 'Mark paid',
    fields: [
      { name: 'amount', label: 'Amount paid (₹)', type: 'amount', required: true, value: b.amount ?? '' },
      [{ name: 'date', label: 'Paid on', type: 'date', value: today(), required: true }, { name: 'pay', label: 'Paid by', type: 'select', options: CATS.pay }],
      { name: 'addExpense', label: 'Add to Expenses', type: 'check', value: true },
    ],
    onSubmit: (v) => {
      if (v.addExpense) {
        const category = b.category === 'Rent' ? 'Rent' : b.category === 'EMI & loan' ? 'EMI & loans' : 'Bills & utilities';
        Store.put('expenses', { amount: v.amount, date: v.date, pay: v.pay, note: b.name, category, billId: b.id });
      }
      const months = FREQ[b.freq] ?? 1;
      const next = months ? addMonths(b.due, months, b.dueDay) : b.due;
      Store.put('bills', { ...b, lastPaid: v.date, ...(months ? { due: next } : { done: true }) });
      commit(months ? `Paid · next due ${fmtDate(next)}` : 'Paid');
    },
  });
}
function dueText(iso) {
  const n = daysUntil(iso);
  if (n < 0) return `<span class="late-text">${-n} day${n === -1 ? '' : 's'} overdue</span>`;
  if (n === 0) return '<span class="late-text">Due today</span>';
  if (n === 1) return 'Due tomorrow';
  if (n <= 7) return `Due in ${n} days`;
  return 'Due ' + fmtDate(iso);
}
function billRow(b) {
  return `<div class="row"><div class="main" data-act="edit-bill" data-id="${b.id}">
      <div class="t">${esc(b.name)}${b.autopay ? ' <span class="badge">Autopay</span>' : ''}${Reminders.wanted(b) ? ' <svg class="bell" viewBox="0 0 24 24" aria-label="Reminder on"><path d="M6 8a6 6 0 1 1 12 0c0 7 3 9 3 9H3s3-2 3-9"/><path d="M10.3 21a1.9 1.9 0 0 0 3.4 0"/></svg>' : ''}</div>
      <div class="m">${dueText(b.due)} · ${FREQ_LABEL[b.freq] || ''}</div></div>
    <div class="amt">${b.amount != null ? money(b.amount) : '—'}</div>
    <button class="pill-btn" data-act="pay" data-id="${b.id}">Paid</button></div>`;
}
function vBills() {
  const bills = activeBills();
  const recurring = bills.filter((b) => FREQ[b.freq]);
  const monthly = recurring.reduce((a, b) => a + (+b.amount || 0) / FREQ[b.freq], 0);
  const groups = [['Overdue', (n) => n < 0], ['Next 7 days', (n) => n >= 0 && n <= 7], ['Later', (n) => n > 7]];
  const body = groups.map(([label, test]) => {
    const g = bills.filter((b) => test(daysUntil(b.due)));
    return g.length ? `<div class="section"><h2>${label}</h2></div><div class="card list">${g.map(billRow).join('')}</div>` : '';
  }).join('');
  return `<div class="card summary"><div>Average per month<b>${money(monthly)}</b></div><div style="text-align:right">Per year<b>${money(monthly * 12)}</b></div></div>
    ${body || '<div class="card empty"><b>No bills yet</b>Add electricity, phone, internet, OTT, insurance, EMIs… and see what is due at a glance.</div>'}`;
}

// ---------- notes ----------
function noteForm(n = {}) {
  const isNew = !n.id, items = n.items || [];
  const li = (it) => `<li class="${it.done ? 'done' : ''}" data-id="${esc(it.id)}"><input type="checkbox" ${it.done ? 'checked' : ''}><input type="text" value="${esc(it.text)}"><button type="button" data-rm aria-label="Remove">×</button></li>`;
  openSheet(`
    <form method="dialog" id="frm">
      <div class="sheet-head"><h2>${isNew ? 'New note' : 'Note'}</h2>
        <button type="button" class="icon-btn" data-act="close" aria-label="Close"><svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6 6 18"/></svg></button></div>
      <div class="sheet-body">
        <label class="field"><span>Title</span><input name="title" value="${esc(n.title)}" placeholder="Title"></label>
        <label class="field"><span>Note</span><textarea name="body" placeholder="Write anything…">${esc(n.body)}</textarea></label>
        <div class="field"><span>Checklist</span><ul class="checklist" id="cl">${items.map(li).join('')}</ul>
          <input id="newItem" placeholder="+ Add item, press Enter" style="margin-top:8px"></div>
        <label class="field check"><input type="checkbox" name="pinned" ${n.pinned ? 'checked' : ''}><span>Pin to Home</span></label>
      </div>
      <div class="sheet-foot">
        ${isNew ? '' : '<button type="button" class="btn danger" id="del">Delete</button>'}
        <button type="button" class="btn" data-act="close">Cancel</button>
        <button type="submit" class="btn primary">Save</button>
      </div>
    </form>`, (d) => {
    const form = $('#frm', d), cl = $('#cl', d), ni = $('#newItem', d);
    const addItem = () => { const t = ni.value.trim(); if (!t) return; cl.insertAdjacentHTML('beforeend', li({ id: uid(), text: t })); ni.value = ''; };
    ni.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); addItem(); } });
    cl.addEventListener('click', (e) => { if (e.target.matches('[data-rm]')) e.target.closest('li').remove(); });
    cl.addEventListener('change', (e) => { if (e.target.type === 'checkbox') e.target.closest('li').classList.toggle('done', e.target.checked); });
    form.addEventListener('submit', (e) => {
      e.preventDefault(); addItem();
      const v = {
        title: form.elements.title.value.trim(), body: form.elements.body.value.trim(), pinned: form.elements.pinned.checked,
        items: [...cl.children].map((x) => ({ id: x.dataset.id, text: x.querySelector('[type=text]').value.trim(), done: x.querySelector('[type=checkbox]').checked })).filter((x) => x.text),
      };
      closeSheet();
      if (isNew && !v.title && !v.body && !v.items.length) return;
      Store.put('notes', { ...n, ...v }); commit(isNew ? 'Note saved' : 'Saved');
    });
    if (!isNew) $('#del', d).onclick = async () => { if (await ask('Delete this note?')) { Store.del('notes', n.id); closeSheet(); commit('Deleted'); } };
  });
}
function noteCard(n) {
  const items = n.items || [], done = items.filter((i) => i.done).length;
  const preview = n.body || items.filter((i) => !i.done).slice(0, 4).map((i) => '☐ ' + i.text).join('\n');
  return `<div class="card note" data-act="edit-note" data-id="${n.id}">${n.pinned ? '<span class="pin">● Pinned</span>' : ''}
    <h3>${esc(n.title || (n.body ? '' : 'Checklist'))}</h3><p>${esc(preview)}</p>
    ${items.length ? `<p style="margin-top:6px;font-size:12px">${done}/${items.length} done</p>` : ''}</div>`;
}
function notesGrid() {
  const q = UI.noteQuery.toLowerCase();
  const notes = all('notes').filter((n) => !q || [n.title, n.body, ...(n.items || []).map((i) => i.text)].join(' ').toLowerCase().includes(q))
    .sort((a, b) => (b.pinned ? 1 : 0) - (a.pinned ? 1 : 0) || b.updatedAt - a.updatedAt);
  return notes.length ? `<div class="notes">${notes.map(noteCard).join('')}</div>`
    : `<div class="card empty"><b>${q ? 'No matching notes' : 'No notes yet'}</b>${q ? '' : 'Tap + for a note or checklist.'}</div>`;
}
function vNotes() {
  return `<input class="search" id="noteSearch" type="search" placeholder="Search notes" value="${esc(UI.noteQuery)}"><div id="notesGrid">${notesGrid()}</div>`;
}

// ---------- dashboard ----------
// Vertical bars in plain HTML. cols: [{ label, parts: [{ v, cls }], tip, hi, show }]
function vbars(cols) {
  const tot = (c) => c.parts.reduce((a, p) => a + p.v, 0), max = Math.max(1, ...cols.map(tot));
  return `<div class="vbars">${cols.map((c) => {
    const t = tot(c);
    return `<div class="vcol${c.hi ? ' hi' : ''}" data-tip="${esc(c.tip)}" tabindex="0"><div class="vplot">
      <div class="vstack" style="height:${t ? Math.max(1.5, (t / max) * 100) : 0}%">${c.show && t ? `<span class="vval">${compact(t)}</span>` : ''}
      ${c.parts.filter((p) => p.v > 0).map((p) => `<div class="vseg ${p.cls || ''}" style="flex:${p.v}"></div>`).join('')}</div></div>
      <div class="vlab">${esc(c.label)}</div></div>`;
  }).join('')}</div>`;
}
function vHome() {
  const t = today(), m = t.slice(0, 7), h = new Date().getHours();
  const exp = all('expenses'), inMonth = (ym) => exp.filter((e) => (e.date || '').startsWith(ym));
  const spent = sum(inMonth(m)), prev = sum(inMonth(shiftMonth(m, -1)));
  const purchases = all('purchases');
  const planned = purchases.filter((p) => p.status !== 'bought').sort(sortPlanned);
  const boughtNow = purchases.filter((p) => p.status === 'bought' && (p.boughtDate || '').startsWith(m));
  const bills = activeBills(), next30 = bills.filter((b) => daysUntil(b.due) <= 30), soon = bills.filter((b) => daysUntil(b.due) <= 7);
  const overdue = bills.filter((b) => daysUntil(b.due) < 0).length;
  const pinned = all('notes').filter((n) => n.pinned).sort((a, b) => b.updatedAt - a.updatedAt);
  const recent = [...exp].sort((a, b) => b.date.localeCompare(a.date) || b.createdAt - a.createdAt).slice(0, 5);
  const greet = h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening';
  const empty = !exp.length && !purchases.length && !bills.length;

  // 6-month spending trend
  const months = [-5, -4, -3, -2, -1, 0].map((n) => shiftMonth(m, n));
  const totals = months.map((x) => sum(inMonth(x)));
  const past = totals.slice(0, 5).filter((v) => v > 0), avg = past.length ? sum(past.map((v) => ({ amount: v }))) / past.length : 0;
  const trend = vbars(months.map((x, i) => ({
    label: parseISO(x + '-01').toLocaleDateString('en-IN', { month: 'short' }), hi: x === m, show: x === m || totals[i] === Math.max(...totals),
    parts: [{ v: totals[i] }], tip: `${monthLabel(x)}\n${money(totals[i])}${x === m ? ' so far' : ''}`,
  })));
  const diff = prev ? Math.round(((spent - prev) / prev) * 100) : null;

  // This month by category
  const byCat = {}; inMonth(m).forEach((e) => { byCat[e.category] = (byCat[e.category] || 0) + (+e.amount || 0); });
  let cats = Object.entries(byCat).sort((a, b) => b[1] - a[1]);
  if (cats.length > 5) cats = [...cats.slice(0, 4), ['Everything else', cats.slice(4).reduce((a, c) => a + c[1], 0)]];
  const cmax = cats[0]?.[1] || 1;

  // Purchase plan by month (Now = this month + overdue)
  const buckets = [{ label: 'Now', test: (p) => p.buyBy && p.buyBy <= m, name: 'This month & overdue' },
    ...[1, 2, 3].map((n) => { const x = shiftMonth(m, n); return { label: parseISO(x + '-01').toLocaleDateString('en-IN', { month: 'short' }), test: (p) => p.buyBy === x, name: monthLabel(x) }; }),
    { label: 'Later', test: (p) => !p.buyBy || p.buyBy > shiftMonth(m, 3), name: 'Later or no date' }];
  const est = (list, l) => sum(list.filter((p) => p.list === l), 'estimate');
  const plan = vbars(buckets.map((b, i) => {
    const items = planned.filter(b.test), e = est(items, 'essentials'), l = est(items, 'lifestyle');
    return { label: b.label, hi: i === 0, show: true, parts: [{ v: e, cls: 'ess' }, { v: l, cls: 'life' }],
      tip: `${b.name} · ${items.length} item${items.length === 1 ? '' : 's'}\nEssentials ${money(e)}\nLifestyle ${money(l)}` };
  }));

  return `
    <p style="margin:0 0 12px;color:var(--muted)">${greet} · ${new Date().toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'long' })}</p>
    <div class="card stat hero" data-act="tab" data-tab="spend" style="cursor:pointer"><div class="k">Spent in ${monthLabel(m)}</div><div class="v">${money(spent)}</div>
      <div class="s">${diff !== null ? `${diff >= 0 ? '+' : ''}${diff}% vs last month (${money(prev)})` : 'No spending recorded last month'}</div></div>
    <div class="stats three" style="margin-top:10px">
      <div class="card stat" data-act="tab" data-tab="bills" style="cursor:pointer"><div class="k">Bills, 30 days</div><div class="v">${money(sum(next30))}</div><div class="s">${overdue ? `<span class="late-text">${overdue} overdue</span>` : `${next30.length} due`}</div></div>
      <div class="card stat" data-act="tab" data-tab="buy" style="cursor:pointer"><div class="k">To buy</div><div class="v">${money(sum(planned, 'estimate'))}</div><div class="s">${planned.length} item${planned.length === 1 ? '' : 's'}</div></div>
      <div class="card stat" data-act="tab" data-tab="buy" style="cursor:pointer"><div class="k">Bought</div><div class="v">${money(sum(boughtNow, 'actualPrice'))}</div><div class="s">this month</div></div>
    </div>
    ${empty ? '<div class="card empty" style="margin-top:12px"><b>Welcome to Personal Hub</b>Tap + to log your first expense, or use the tabs below to plan purchases, add bills and keep notes. Charts appear here as you go.</div>' : `
    <div class="section"><h2>Spending, last 6 months</h2></div>
    <div class="card chart"><div class="chart-head"><span>Monthly average <b>${money(avg)}</b></span><span>This month <b>${money(spent)}</b></span></div>${trend}</div>
    ${cats.length ? `<div class="section"><h2>Where it went in ${monthLabel(m, true).split(' ')[0]}</h2><button class="linkish" data-act="tab" data-tab="spend">Details</button></div>
    <div class="card bars">${cats.map(([c, v]) => `<div class="bar"><div class="lab"><span>${esc(c)}<span class="pct">${Math.round((v / spent) * 100)}%</span></span><span>${money(v)}</span></div>
      <div class="track"><div class="fill" style="width:${Math.max(2, (v / cmax) * 100)}%"></div></div></div>`).join('')}</div>` : ''}
    ${planned.length ? `<div class="section"><h2>Purchase plan by month</h2><button class="linkish" data-act="tab" data-tab="buy">Full plan</button></div>
    <div class="card chart"><div class="legend"><span><i></i>Essentials <b>${money(est(planned, 'essentials'))}</b></span><span><i class="life"></i>Lifestyle <b>${money(est(planned, 'lifestyle'))}</b></span></div>${plan}</div>` : ''}`}
    ${soon.length ? `<div class="section"><h2>Bills due this week</h2><button class="linkish" data-act="tab" data-tab="bills">All bills</button></div><div class="card list">${soon.slice(0, 5).map(billRow).join('')}</div>` : ''}
    ${planned.length ? `<div class="section"><h2>Next to buy</h2></div><div class="card list">${planned.slice(0, 4).map(purchaseRow).join('')}</div>` : ''}
    ${pinned.length ? `<div class="section"><h2>Pinned notes</h2></div><div class="notes">${pinned.map(noteCard).join('')}</div>` : ''}
    ${recent.length ? `<div class="section"><h2>Recent expenses</h2><button class="linkish" data-act="tab" data-tab="spend">See all</button></div><div class="card list">${recent.map(expenseRow).join('')}</div>` : ''}`;
}

// Chart tooltips (hover on computer, tap on phone)
(function tips() {
  const tip = document.createElement('div'); tip.id = 'tip'; tip.hidden = true; document.body.appendChild(tip);
  const show = (el) => {
    const r = el.querySelector('.vstack')?.getBoundingClientRect() || el.getBoundingClientRect();
    tip.textContent = el.dataset.tip; tip.hidden = false;
    const w = tip.offsetWidth / 2 + 8;
    tip.style.left = Math.min(innerWidth - w, Math.max(w, r.left + r.width / 2)) + 'px';
    tip.style.top = Math.max(tip.offsetHeight + 12, r.top) + 'px';
  };
  const hide = () => { tip.hidden = true; };
  document.addEventListener('pointerover', (e) => { const el = e.target.closest('.vcol[data-tip]'); el ? show(el) : hide(); });
  document.addEventListener('focusin', (e) => { const el = e.target.closest('.vcol[data-tip]'); if (el) show(el); });
  document.addEventListener('focusout', hide);
  addEventListener('scroll', hide, { passive: true });
})();

// ---------- settings ----------
let installPrompt = null;
window.addEventListener('beforeinstallprompt', (e) => { e.preventDefault(); installPrompt = e; });
function ago(ts) {
  const s = (now() - ts) / 1000;
  if (s < 60) return 'just now'; if (s < 3600) return Math.round(s / 60) + ' min ago';
  if (s < 86400) return Math.round(s / 3600) + ' h ago'; return new Date(ts).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' });
}
function settings() {
  const c = Sync.connected(), counts = COLS.map((k) => `${all(k).length} ${k}`).join(' · ');
  openSheet(`
    <div class="sheet-head"><h2>Settings</h2><button type="button" class="icon-btn" data-act="close" aria-label="Close"><svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6 6 18"/></svg></button></div>
    <div class="sheet-body" style="padding-bottom:24px">
      <div class="card setting"><h3>Google Drive</h3>
        ${clientId() ? '' : '<div class="warnbox">Google sign-in is not set up yet. Paste your Client ID into config.js (see the setup guide, Step 1).</div>'}
        <p>${c ? `Connected. ${Sync.lastSync ? 'Last synced ' + ago(Sync.lastSync) + '.' : ''} Your data is in Drive → <b>${FOLDER_NAME}</b> → ${FILE_NAME}.` : 'Not connected. Your data is saved on this device only.'}</p>
        <div class="actions">${c ? '<button class="pill-btn" data-act="sync-now">Sync now</button><button class="pill-btn ghost" data-act="disconnect">Disconnect</button>' : '<button class="pill-btn" data-act="sync-now">Connect Google Drive</button>'}</div></div>
      ${installPrompt ? '<div class="card setting"><h3>Install app</h3><p>Add Personal Hub to your home screen or desktop.</p><div class="actions"><button class="pill-btn" data-act="install">Install</button></div></div>' : ''}
      <div class="card setting"><h3>Bill reminders</h3>
        ${Reminders.error === 'perm' ? '<div class="warnbox">Google Calendar access is missing. Tap <b>Allow Calendar</b> and tick the Calendar box. If it still fails, check that the Google Calendar API is enabled (setup guide, Step 2).</div>'
          : Reminders.error ? '<div class="warnbox">Reminders could not be updated last time. They will retry on the next sync.</div>' : ''}
        <p>${Reminders.count()} bill${Reminders.count() === 1 ? ' has' : 's have'} reminders. ${c ? 'They are added to your Google Calendar at 9:00 AM, so your phone and computer notify you even when this app is closed.' : 'Connect Google Drive to send them to your Google Calendar, so your phone and computer notify you even when this app is closed.'} Set the timing for each bill when you add or edit it.</p>
        ${c && Reminders.error === 'perm' ? '<div class="actions"><button class="pill-btn" data-act="allow-cal">Allow Calendar</button></div>' : ''}</div>
      <div class="card setting"><h3>Backup &amp; export</h3><p>${counts}</p>
        <div class="actions"><button class="pill-btn ghost" data-act="backup">Download backup</button>
          <button class="pill-btn ghost" data-act="restore">Restore from backup</button>
          <button class="pill-btn ghost" data-act="csv-all">Expenses CSV</button></div>
        <input type="file" id="restoreFile" accept=".json,application/json" hidden></div>
      <p style="font-size:12px;color:var(--muted);text-align:center">Personal Hub v1.0 · Works offline · Syncs when online</p>
    </div>`, (d) => {
    $('#restoreFile', d).addEventListener('change', async (e) => {
      const f = e.target.files[0]; if (!f) return;
      try { Store.data = mergeData(Store.data, JSON.parse(await f.text())); closeSheet(); commit('Backup restored'); }
      catch { toast('That file is not a valid backup'); }
    });
  });
}

// ---------- render & actions ----------
const UI = { tab: LS.get('ph:tab') || 'home', buyList: 'essentials', buyStatus: 'planned', month: today().slice(0, 7), noteQuery: '' };
const VIEWS = { home: ['Dashboard', vHome], buy: ['Purchase plan', vBuy], spend: ['Expenses', vSpend], bills: ['Bills', vBills], notes: ['Notes', vNotes] };
function render() {
  const [title, fn] = VIEWS[UI.tab] || VIEWS.home;
  $('#title').textContent = title;
  $('#view').innerHTML = fn();
  document.querySelectorAll('#tabbar button').forEach((b) => b.classList.toggle('on', b.dataset.tab === UI.tab));
  // Badge on the Bills tab: overdue or due within 2 days
  const due = activeBills().filter((b) => daysUntil(b.due) <= 2).length, tab = $('#tabbar [data-tab=bills]');
  let badge = tab.querySelector('.tbadge');
  if (!badge) { badge = document.createElement('i'); badge.className = 'tbadge'; tab.appendChild(badge); }
  badge.textContent = due; badge.hidden = !due;
  const s = $('#noteSearch');
  if (s) s.addEventListener('input', (e) => { UI.noteQuery = e.target.value; $('#notesGrid').innerHTML = notesGrid(); });
}
const byId = (col, id) => Store.get(col, id);
const ACTIONS = {
  tab: (el) => { UI.tab = el.dataset.tab; LS.set('ph:tab', UI.tab); render(); window.scrollTo(0, 0); },
  add: () => ({ home: expenseForm, spend: expenseForm, buy: purchaseForm, bills: billForm, notes: noteForm }[UI.tab] || expenseForm)(),
  close: closeSheet,
  'edit-purchase': (el, id) => purchaseForm(byId('purchases', id)),
  bought: (el, id) => markBought(byId('purchases', id)),
  unbuy: (el, id) => unBuy(byId('purchases', id)),
  'buy-list': (el) => { UI.buyList = el.dataset.v; render(); },
  'buy-status': (el) => { UI.buyStatus = el.dataset.v; render(); },
  'edit-expense': (el, id) => expenseForm(byId('expenses', id)),
  month: (el) => { UI.month = shiftMonth(UI.month, +el.dataset.v); render(); },
  'csv-month': () => download(`expenses-${UI.month}.csv`, csv(all('expenses').filter((e) => (e.date || '').startsWith(UI.month))), 'text/csv'),
  'csv-all': () => download(`expenses-all-${today()}.csv`, csv(all('expenses')), 'text/csv'),
  'edit-bill': (el, id) => billForm(byId('bills', id)),
  pay: (el, id) => payBill(byId('bills', id)),
  'edit-note': (el, id) => noteForm(byId('notes', id)),
  sync: () => Sync.tap(),
  settings,
  'sync-now': () => { closeSheet(); Sync.tap(); },
  'allow-cal': () => { closeSheet(); if (Sync.ensureClient()) Sync.client.requestAccessToken({ prompt: 'consent' }); else Sync.signIn(); },
  disconnect: async () => { if (await ask('Disconnect Google Drive on this device? Your data stays on this device and in Drive.', 'Disconnect')) { Sync.signOut(); settings(); } },
  install: async () => { if (!installPrompt) return; installPrompt.prompt(); await installPrompt.userChoice; installPrompt = null; closeSheet(); },
  backup: () => download(`personal-hub-backup-${today()}.json`, JSON.stringify({ app: 'Personal Hub', version: 1, ...Store.data }), 'application/json'),
  restore: () => $('#restoreFile').click(),
};
document.addEventListener('click', (e) => {
  const el = e.target.closest('[data-act]');
  if (!el || !ACTIONS[el.dataset.act]) return;
  ACTIONS[el.dataset.act](el, el.dataset.id);
});
sheet().addEventListener('click', (e) => { if (e.target === sheet()) closeSheet(); });

// ---------- start ----------
Store.load();
Sync.restore();
render();
if (Sync.valid()) Sync.sync();
if (new URLSearchParams(location.search).get('add') === 'expense') { history.replaceState(null, '', location.pathname); expenseForm(); }
window.addEventListener('online', () => (Sync.valid() ? Sync.sync() : Sync.refreshStatus()));
window.addEventListener('offline', () => Sync.connected() && Sync.setStatus('offline'));
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState !== 'visible') return;
  if (Sync.valid() && now() - Sync.lastSync > 60000) Sync.sync(); else if (!Sync.valid()) Sync.refreshStatus();
  if (!sheet().open) render(); // refresh "today"-based views
});
if (!window.PH_CONFIG?.PREVIEW && 'serviceWorker' in navigator && location.protocol.startsWith('http')) navigator.serviceWorker.register('sw.js').catch(() => {});
