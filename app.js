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
  expense: ['Food & dining', 'Groceries', 'Transport & fuel', 'Vehicle', 'Bills & utilities', 'Rent', 'Health', 'Essentials', 'Lifestyle', 'Entertainment', 'Education', 'Travel', 'EMI & loans', 'Gifts', 'Personal care', 'Other'],
  bill: ['Electricity', 'Water', 'Phone & internet', 'Subscriptions & OTT', 'Insurance', 'EMI & loan', 'Rent', 'Credit card', 'Other'],
  pay: ['UPI', 'Card', 'Cash', 'Net banking', 'Other'],
};
const FREQ = { monthly: 1, bimonthly: 2, quarterly: 3, halfyearly: 6, yearly: 12, once: 0 };
const FREQ_LABEL = { monthly: 'Monthly', bimonthly: 'Every 2 months', quarterly: 'Quarterly', halfyearly: 'Half-yearly', yearly: 'Yearly', once: 'One-time' };
const PRIO = { high: 0, medium: 1, low: 2 };

// ---------- storage ----------
const KEY = 'ph:data';
const COLS = ['purchases', 'expenses', 'bills', 'notes', 'vehicles'];
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
    if (r.error) { this.fail('Google sign-in did not finish (' + r.error + '). Tap the sync button to try again.'); return; }
    if (r.scope && !r.scope.includes('drive.file')) {
      this.fail('Google Drive permission was not given. Open Settings, tap Reconnect, and tick the box for Google Drive files.');
      return;
    }
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
  // Remember why sync failed, in plain words, so Settings can show it.
  lastError: LS.get('ph:syncError') || '',
  fail(msg) { this.lastError = msg; LS.set('ph:syncError', msg); this.setStatus('error'); },
  explain(e) {
    const t = `${e.message} ${e.reason || ''} ${e.detail || ''}`;
    if (e instanceof TypeError || /Failed to fetch|NetworkError/i.test(t))
      return 'Could not reach Google. Check the internet connection. If an ad or tracker blocker is on, allow this site.';
    if (/accessNotConfigured|SERVICE_DISABLED|has not been used|is disabled/i.test(t))
      return 'The Google Drive API is turned off in your Google Cloud project. Go to console.cloud.google.com → APIs & Services → Library → Google Drive API → Enable (setup guide, Step 2.3). Wait 2 minutes, then tap Sync now.';
    if (/insufficient|SCOPE|PERMISSION_DENIED/i.test(t))
      return 'Google Drive permission was not given. Tap Reconnect below and tick the box for Google Drive files.';
    if (/ 429|rateLimit/i.test(t)) return 'Google asked the app to slow down. It will try again in a minute.';
    return 'Google returned an error: ' + (e.detail || e.message) + '. Tap Sync now to retry.';
  },
  tap() {
    if (this.state === 'error' && this.lastError) toast('Sync failed. Open Settings (⚙) to see why.');
    if (this.valid()) this.sync(); else this.signIn();
  },
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
    if (!res.ok) {
      let j = null; try { j = await res.json(); } catch {}
      const err = new Error('Google error ' + res.status);
      err.reason = j?.error?.errors?.[0]?.reason || j?.error?.status || '';
      err.detail = j?.error?.message || '';
      throw err;
    }
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
      this.lastError = ''; LS.del('ph:syncError');
      this.setStatus('synced');
      if (!$('#sheet').open) render();
    } catch (e) {
      console.error(e);
      if (e.message === 'auth') this.setStatus('pending', 'Tap to sync');
      else if (!navigator.onLine) this.setStatus('offline');
      else this.fail(this.explain(e));
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
  vehicleEvent(v, it, d) {
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone || 'Asia/Kolkata', days = +it.remind || 0;
    const overrides = [{ method: 'popup', minutes: 0 }];
    if (days) overrides.push({ method: 'popup', minutes: Math.min(days * 1440, 40320) });
    const exp = it.mode === 'expiry', who = v.name + (v.reg ? ` (${v.reg})` : '');
    return {
      summary: `${it.name} ${exp ? 'expires' : 'due'}: ${who}`,
      description: exp ? `Renew before it expires. Mark it renewed in Personal Hub.`
        : `${d.dueKm != null ? `Due at ${km(d.dueKm)}${d.by === 'km' ? ' (date estimated from your driving; it moves when you update km)' : ''}. ` : ''}Mark it done in Personal Hub.`,
      start: { dateTime: `${d.date}T${REMIND_HOUR}:00`, timeZone: tz },
      end: { dateTime: `${d.date}T09:15:00`, timeZone: tz },
      reminders: { useDefault: false, overrides },
      transparency: 'transparent',
      extendedProperties: { private: { personalHubVehicle: `${v.id}:${it.id}` } },
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
      for (const v of all('vehicles')) {
        let changed = false; const items = [];
        for (const it of v.items || []) {
          const d = itemDue(v, it), on = it.remind != null && it.remind !== 'off';
          let n = it;
          if (on && d.date && d.date >= today()) {
            const sig = JSON.stringify([v.name, v.reg, it.name, d.date, it.remind]);
            if (!(it.calEventId && it.calSig === sig)) {
              const body = this.vehicleEvent(v, it, d);
              let ev = null;
              if (it.calEventId) { try { ev = await (await call(`${CAL}/${it.calEventId}`, 'PUT', body)).json(); } catch (e) { if (!/ 404| 410/.test(e.message)) throw e; } }
              if (!ev) ev = await (await call(CAL, 'POST', body)).json();
              n = { ...it, calEventId: ev.id, calSig: sig }; changed = true;
            }
          } else if (it.calEventId && (!on || !d.date)) {
            try { await call(`${CAL}/${it.calEventId}`, 'DELETE'); } catch (e) { if (!/ 40[34]| 410/.test(e.message)) throw e; }
            n = { ...it, calEventId: null, calSig: null }; changed = true;
          } // overdue items keep their past event
          items.push(n);
        }
        if (changed) Store.put('vehicles', { ...v, items });
      }
      Store.persist(); this.setError('');
    } catch (e) {
      if (e.message === 'auth') throw e;
      console.error('Calendar', e);
      this.setError(/ 403/.test(e.message) ? 'perm' : 'fail');
    }
  },
  count: () => all('bills').filter((b) => Reminders.wanted(b)).length + all('vehicles').reduce((a, v) => a + (v.items || []).filter((i) => i.remind && i.remind !== 'off').length, 0),
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

// ---------- vehicles ----------
const VTYPE = { car: 'Car', bike: 'Two-wheeler' };
const kmFmt = new Intl.NumberFormat('en-IN');
const km = (n) => kmFmt.format(Math.round(+n || 0)) + ' km';
const addDays = (iso, n) => { const d = parseISO(iso); d.setDate(d.getDate() + Math.round(n)); return localISO(d); };
const V_REMIND = [['off', 'No reminder'], ['0', 'On the due date'], ['1', '1 day before'], ['3', '3 days before'], ['7', '1 week before'], ['14', '2 weeks before'], ['28', '4 weeks before']];
// Starting intervals. Edit them per vehicle to match your owner's manual.
const VDEFAULTS = {
  car: [
    { kind: 'service', name: 'General service', mode: 'interval', everyKm: 10000, everyMonths: 12, remind: '7' },
    { kind: 'alignment', name: 'Wheel alignment', mode: 'interval', everyKm: 5000, everyMonths: 6, remind: '7' },
    { kind: 'puc', name: 'PUC certificate', mode: 'expiry', renewMonths: 6, remind: '7' },
    { kind: 'insurance', name: 'Insurance', mode: 'expiry', renewMonths: 12, remind: '14' },
  ],
  bike: [
    { kind: 'service', name: 'General service', mode: 'interval', everyKm: 3000, everyMonths: 3, remind: '7' },
    { kind: 'puc', name: 'PUC certificate', mode: 'expiry', renewMonths: 6, remind: '7' },
    { kind: 'insurance', name: 'Insurance', mode: 'expiry', renewMonths: 12, remind: '14' },
  ],
};
const ICON = {
  car: '<svg viewBox="0 0 24 24"><path d="M5 11l1.5-4.2A2 2 0 0 1 8.4 5.5h7.2a2 2 0 0 1 1.9 1.3L19 11"/><rect x="3" y="11" width="18" height="6" rx="2"/><path d="M6 17v2M18 17v2"/><circle cx="7.5" cy="14" r=".6"/><circle cx="16.5" cy="14" r=".6"/></svg>',
  bike: '<svg viewBox="0 0 24 24"><circle cx="5.5" cy="16" r="3"/><circle cx="18.5" cy="16" r="3"/><path d="M5.5 16h6l3.5-6.5h2.5l1 6.5"/><path d="M15 9.5 13 6.5h-3"/></svg>',
};

// Average km per day, from your odometer updates (needs readings at least 2 weeks apart).
function kmRate(v) {
  const log = (v.odoLog || []).filter((x) => x.date && x.km != null).sort((a, b) => a.date.localeCompare(b.date));
  if (log.length < 2) return null;
  const a = log[0], b = log[log.length - 1], days = (parseISO(b.date) - parseISO(a.date)) / 864e5;
  return days >= 14 && b.km > a.km ? (b.km - a.km) / days : null;
}
// When an item is due: by date, by km (date estimated from your driving), whichever comes first.
function itemDue(v, it) {
  if (it.mode === 'expiry') return it.expires ? { date: it.expires, days: daysUntil(it.expires), by: 'date' } : { unknown: true };
  const dateDue = it.lastDate && +it.everyMonths ? addMonths(it.lastDate, +it.everyMonths) : null;
  const dueKm = it.lastKm != null && it.lastKm !== '' && +it.everyKm ? +it.lastKm + +it.everyKm : null;
  if (!dateDue && dueKm == null) return { unknown: true };
  const kmLeft = dueKm != null && v.odo != null ? dueKm - v.odo : null, rate = kmRate(v);
  const kmDate = kmLeft != null && rate ? addDays(v.odoDate || today(), Math.max(0, kmLeft) / rate) : null;
  let date = dateDue, by = 'date';
  if (kmDate && (!date || kmDate < date)) { date = kmDate; by = 'km'; }
  // If the reading is over a week old, estimate today's km from your usual driving
  const age = v.odoDate ? -daysUntil(v.odoDate) : 0;
  const estLeft = kmLeft != null && rate && age > 7 ? Math.round(kmLeft - rate * age) : null;
  return { date, days: date ? daysUntil(date) : null, by, dueKm, kmLeft, estLeft };
}
function itemState(it, d) {
  if (d.unknown) return 'unknown';
  if ((d.days != null && d.days < 0) || (d.kmLeft != null && d.kmLeft <= 0)) return 'overdue';
  if ((d.days != null && d.days <= 14) || (d.kmLeft != null && +it.everyKm && d.kmLeft <= +it.everyKm * 0.1)) return 'soon';
  return 'ok';
}
function vehicleDues() {
  const rank = { overdue: 0, soon: 1, ok: 2, unknown: 3 }, out = [];
  all('vehicles').forEach((v) => (v.items || []).forEach((it) => { const d = itemDue(v, it); out.push({ v, it, d, state: itemState(it, d) }); }));
  return out.sort((a, b) => rank[a.state] - rank[b.state] || (a.d.date || '9999').localeCompare(b.d.date || '9999'));
}
function daysText(n) {
  if (n == null) return '';
  if (n < 0) return `${-n} day${n === -1 ? '' : 's'} ago`;
  if (n === 0) return 'today';
  if (n === 1) return 'tomorrow';
  if (n < 60) return `in ${n} days`;
  return `in ${Math.round(n / 30.4)} months`;
}
function dueLine(it, d) {
  if (d.unknown) return it.mode === 'expiry' ? 'Add the expiry date' : 'Set when it was last done';
  const parts = [];
  if (it.mode === 'expiry') parts.push(`${d.days < 0 ? 'Expired' : 'Expires'} ${fmtDate(d.date)} · ${daysText(d.days)}`);
  else {
    if (d.date) parts.push(`${d.by === 'km' ? 'About ' : 'Due '}${fmtDate(d.date)}${d.days < 0 ? ' · ' + daysText(d.days) : ''}`);
    const left = d.estLeft != null ? d.estLeft : d.kmLeft, about = d.estLeft != null ? 'about ' : '';
    if (left != null) parts.push(left > 0 ? `${about}${km(left)} left` : `${about}${km(-left)} over`);
  }
  return parts.join(' · ');
}
function stateBadge(it, state) {
  if (state === 'overdue') return ` <span class="badge late">${it.mode === 'expiry' ? 'Expired' : 'Overdue'}</span>`;
  if (state === 'soon') return ' <span class="badge due">Due soon</span>';
  return '';
}
// Pill shown on the dashboard card: days left, coloured by urgency
function duePill(it, d, state) {
  let t;
  if (d.unknown) t = 'Set date';
  else if (state === 'overdue') t = it.mode === 'expiry' ? 'Expired' : d.kmLeft != null && d.kmLeft <= 0 && !(d.days < 0) ? `${kmFmt.format(-d.kmLeft)} km over` : `${-d.days}d overdue`;
  else if (d.days === 0) t = 'Today';
  else t = d.days < 60 ? `${d.days} day${d.days === 1 ? '' : 's'}` : `${Math.round(d.days / 30.4)} mo`;
  return `<span class="dpill ${state}">${t}</span>`;
}
const vItem = (v, itemId) => (v.items || []).find((i) => i.id === itemId);
const odoAge = (v) => (v.odoDate ? -daysUntil(v.odoDate) : null);

function vehicleForm(v = {}) {
  const isNew = !v.id, type = v.type || 'car';
  const fields = [
    [{ name: 'name', label: 'Name', required: true, ph: 'e.g. Swift, Activa' }, { name: 'type', label: 'Type', type: 'select', options: Object.entries(VTYPE), value: type }],
    [{ name: 'reg', label: 'Registration no.', ph: 'KL 07 AB 1234' }, { name: 'odo', label: 'Current km reading', type: 'number', required: true }],
  ];
  if (isNew) fields.push(
    [{ name: 'svcDate', label: 'Last service date', type: 'date' }, { name: 'svcKm', label: 'km at that service', type: 'number' }],
    [{ name: 'alDate', label: 'Last wheel alignment', type: 'date' }, { name: 'alKm', label: 'km at alignment', type: 'number' }],
    [{ name: 'pucExp', label: 'PUC expires on', type: 'date' }, { name: 'insExp', label: 'Insurance expires on', type: 'date' }],
  );
  formSheet({
    title: isNew ? 'Add vehicle' : 'Edit vehicle', values: { ...v, odo: v.odo ?? '' },
    extra: isNew ? '<p class="hint">Leave blank anything you don\'t know. You can fill it in later. Service intervals start with common values; change them to match your owner\'s manual.</p>' : '',
    fields,
    onSubmit: (f) => {
      if (!isNew) {
        const rec = { ...v, name: f.name, type: f.type, reg: f.reg.toUpperCase() };
        if (f.odo != null && f.odo !== v.odo) Object.assign(rec, logKm(v, f.odo, today()));
        Store.put('vehicles', rec); commit('Saved'); return;
      }
      for (const k of ['svcKm', 'alKm']) if (f[k] != null && f[k] > f.odo) { toast(`km at the last ${k === 'svcKm' ? 'service' : 'alignment'} is more than the current reading`); return false; }
      const items = VDEFAULTS[f.type].map((d) => ({ ...d, id: uid() }));
      const set = (kind, o) => { const it = items.find((i) => i.kind === kind); if (it) Object.assign(it, o); };
      set('service', { lastDate: f.svcDate || null, lastKm: f.svcKm });
      set('alignment', { lastDate: f.alDate || null, lastKm: f.alKm });
      set('puc', { expires: f.pucExp || null });
      set('insurance', { expires: f.insExp || null });
      const odoLog = [{ date: today(), km: f.odo }];
      if (f.svcDate && f.svcKm != null) odoLog.push({ date: f.svcDate, km: f.svcKm });
      if (f.type === 'car' && f.alDate && f.alKm != null) odoLog.push({ date: f.alDate, km: f.alKm });
      Store.put('vehicles', { name: f.name, type: f.type, reg: f.reg.toUpperCase(), odo: f.odo, odoDate: today(), odoLog, items, history: [] });
      UI.tab = 'vehicles'; LS.set('ph:tab', 'vehicles');
      commit('Vehicle added');
    },
    onDelete: isNew ? null : () => {
      (v.items || []).forEach((i) => Reminders.forget(i.calEventId));
      Store.del('vehicles', v.id); commit('Vehicle deleted');
    },
    after: (form) => {
      const al = form.elements.alDate?.closest('.grid2');
      const sync = () => { if (al) al.hidden = form.elements.type.value !== 'car'; };
      form.elements.type.addEventListener('change', sync); sync();
    },
  });
}
// Returns the odometer fields after a new reading (keeps the last 40 readings).
function logKm(v, reading, date) {
  const odoLog = [...(v.odoLog || []), { date, km: reading }].sort((a, b) => a.date.localeCompare(b.date)).slice(-40);
  const latest = odoLog[odoLog.length - 1];
  return { odo: latest.km, odoDate: latest.date, odoLog };
}
function kmForm(v) {
  formSheet({
    title: 'Update km: ' + v.name, submit: 'Update',
    fields: [{ name: 'odo', label: `Odometer reading (last: ${km(v.odo)})`, type: 'amount', required: true }, { name: 'date', label: 'Date', type: 'date', value: today(), required: true }],
    after: (form) => { form.elements.odo.placeholder = 'km'; },
    onSubmit: (f) => {
      if (f.odo < v.odo && f.date >= (v.odoDate || '')) { toast(`That is lower than the last reading (${km(v.odo)})`); return false; }
      Store.put('vehicles', { ...v, ...logKm(v, f.odo, f.date) }); commit('km updated');
    },
  });
}
function itemForm(v, it = null) {
  const isNew = !it; it = it || { mode: 'interval', remind: '7' };
  const interval = [[{ name: 'everyKm', label: 'Every (km)', type: 'number' }, { name: 'everyMonths', label: 'Or every (months)', type: 'number' }],
    [{ name: 'lastDate', label: 'Last done on', type: 'date' }, { name: 'lastKm', label: 'km when last done', type: 'number' }]];
  const expiry = [[{ name: 'expires', label: 'Expires on', type: 'date' }, { name: 'renewMonths', label: 'Valid for (months)', type: 'number' }]];
  const fields = [{ name: 'name', label: 'Item', required: true, ph: 'e.g. Tyre rotation, Battery check' }];
  if (isNew) fields.push({ name: 'mode', label: 'Kind', type: 'select', options: [['interval', 'Repeats every few km or months'], ['expiry', 'Has an expiry date (renewal)']] });
  if (isNew || it.mode === 'interval') fields.push(...interval);
  if (isNew || it.mode === 'expiry') fields.push(...expiry);
  fields.push({ name: 'remind', label: 'Remind me', type: 'select', options: V_REMIND });
  formSheet({
    title: isNew ? `Add item: ${v.name}` : it.name, values: it,
    extra: it.kind === 'puc' ? '<p class="hint">PUC validity is printed on your certificate (usually 6 or 12 months).</p>' : '',
    fields,
    onSubmit: (f) => {
      const mode = f.mode || it.mode;
      const rec = { ...it, ...f, mode, id: it.id || uid(), kind: it.kind || 'custom', lastDate: f.lastDate || null, expires: f.expires || null };
      if (mode === 'interval' && !rec.everyKm && !rec.everyMonths) { toast('Enter km, months, or both'); return false; }
      const items = isNew ? [...(v.items || []), rec] : v.items.map((i) => (i.id === it.id ? rec : i));
      Store.put('vehicles', { ...v, items }); commit(isNew ? 'Item added' : 'Saved');
    },
    onDelete: isNew ? null : () => {
      Reminders.forget(it.calEventId);
      Store.put('vehicles', { ...v, items: v.items.filter((i) => i.id !== it.id) }); commit('Item deleted');
    },
    after: (form) => {
      if (!isNew) return;
      const groups = (names) => names.map((n) => form.elements[n].closest('.grid2'));
      const sync = () => {
        const exp = form.elements.mode.value === 'expiry';
        groups(['everyKm', 'lastDate']).forEach((g) => { g.hidden = exp; });
        groups(['expires']).forEach((g) => { g.hidden = !exp; });
      };
      form.elements.mode.addEventListener('change', sync); sync();
    },
  });
}
function doneForm(v, it) {
  const exp = it.mode === 'expiry';
  const nextExp = exp ? addDays(addMonths(it.expires && it.expires >= today() ? it.expires : today(), +it.renewMonths || 12), it.expires && it.expires >= today() ? 0 : -1) : null;
  const fields = exp
    ? [[{ name: 'date', label: 'Renewed on', type: 'date', value: today(), required: true }, { name: 'expires', label: 'New expiry date', type: 'date', value: nextExp, required: true }]]
    : [[{ name: 'date', label: 'Done on', type: 'date', value: today(), required: true }, { name: 'km', label: 'km reading', type: 'number', value: v.odo, required: true }]];
  fields.push({ name: 'cost', label: 'Cost (₹)', type: 'number' },
    { name: 'notes', label: exp ? 'Notes' : 'Garage / notes', ph: exp ? (it.kind === 'insurance' ? 'Insurer, policy no.' : 'Testing centre') : 'Garage, work done' },
    { name: 'addExpense', label: 'Add cost to Expenses', type: 'check', value: true });
  formSheet({
    title: (exp ? 'Renewed: ' : 'Done: ') + it.name, submit: exp ? 'Save renewal' : 'Mark done', fields,
    onSubmit: (f) => {
      let rec = { ...v };
      // Record the reading, unless it is lower than a newer one (keeps the odometer from going backwards)
      if (!exp && f.km != null && (f.km >= (v.odo || 0) || f.date < (v.odoDate || ''))) Object.assign(rec, logKm(v, f.km, f.date));
      let expenseId = null;
      if (f.addExpense && f.cost) expenseId = Store.put('expenses', { amount: f.cost, date: f.date, category: 'Vehicle', note: `${v.name}: ${it.name}`, pay: 'UPI', vehicleId: v.id }).id;
      const upd = exp ? { expires: f.expires } : { lastDate: f.date, lastKm: f.km };
      rec.items = v.items.map((i) => (i.id === it.id ? { ...i, ...upd } : i));
      rec.history = [...(v.history || []), { id: uid(), item: it.name, date: f.date, km: exp ? null : f.km, cost: f.cost, notes: f.notes, expires: exp ? f.expires : null, expenseId }];
      Store.put('vehicles', rec);
      const next = itemDue(rec, rec.items.find((i) => i.id === it.id));
      commit(next.date ? `Saved · next ${exp ? 'expiry' : 'due'} ${fmtDate(next.date)}` : 'Saved');
    },
  });
}
function historySheet(v) {
  const h = [...(v.history || [])].sort((a, b) => b.date.localeCompare(a.date));
  openSheet(`
    <div class="sheet-head"><h2>${esc(v.name)} history</h2><button type="button" class="icon-btn" data-act="close" aria-label="Close"><svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6 6 18"/></svg></button></div>
    <div class="sheet-body" style="padding-bottom:24px">
      <div class="card summary"><div>Total spent<b>${money(sum(h, 'cost'))}</b></div><div style="text-align:right">Entries<b>${h.length}</b></div></div>
      ${h.length ? `<div class="card list">${h.map((x) => `<div class="row"><div class="main" style="cursor:default"><div class="t">${esc(x.item)}</div>
        <div class="m">${fmtDate(x.date)}${x.km != null ? ' · ' + km(x.km) : ''}${x.expires ? ' · valid till ' + fmtDate(x.expires) : ''}${x.notes ? ' · ' + esc(x.notes) : ''}</div></div>
        <div class="amt">${x.cost ? money(x.cost) : '—'}</div></div>`).join('')}</div>`
        : '<div class="card empty"><b>No history yet</b>Services and renewals you mark as done appear here.</div>'}
    </div>`);
}
function vehicleCard(v) {
  const age = odoAge(v), stale = age != null && age > 30;
  const rows = (v.items || []).map((it) => {
    const d = itemDue(v, it), st = itemState(it, d);
    return `<div class="row"><div class="main" data-act="v-item" data-id="${v.id}" data-item="${it.id}">
        <div class="t">${esc(it.name)}${stateBadge(it, st)}</div><div class="m${st === 'overdue' ? ' late-text' : ''}">${dueLine(it, d)}</div></div>
      ${d.unknown ? `<button class="pill-btn ghost" data-act="v-item" data-id="${v.id}" data-item="${it.id}">Set</button>`
        : `<button class="pill-btn" data-act="v-done" data-id="${v.id}" data-item="${it.id}">${it.mode === 'expiry' ? 'Renewed' : 'Done'}</button>`}</div>`;
  }).join('');
  return `<div class="card vcard">
    <div class="vhead"><span class="vico">${ICON[v.type] || ICON.car}</span>
      <div class="main"><div class="t">${esc(v.name)}</div><div class="m">${esc(v.reg || VTYPE[v.type])}${v.reg ? ' · ' + VTYPE[v.type] : ''}</div></div>
      <button class="icon-btn" data-act="v-edit" data-id="${v.id}" aria-label="Edit vehicle"><svg viewBox="0 0 24 24"><path d="M4 20h4L19 9l-4-4L4 16v4Z"/><path d="m13.5 6.5 4 4"/></svg></button></div>
    <div class="odo"><div><div class="k">Odometer</div><b>${km(v.odo)}</b>
      <div class="m${stale ? ' warn-text' : ''}">${age == null ? '' : age === 0 ? 'updated today' : `updated ${age} day${age === 1 ? '' : 's'} ago`}${stale ? ' · please update' : ''}</div></div>
      <button class="pill-btn" data-act="v-km" data-id="${v.id}">Update km</button></div>
    <div class="list">${rows || '<div class="empty">No items. Add one below.</div>'}</div>
    <div class="vfoot"><button class="linkish" data-act="v-additem" data-id="${v.id}">+ Add item</button>
      <button class="linkish" data-act="v-history" data-id="${v.id}">History (${(v.history || []).length})</button></div>
  </div>`;
}
function vVehicles() {
  const vs = all('vehicles').sort((a, b) => a.createdAt - b.createdAt);
  if (!vs.length) return `<div class="card empty"><b>No vehicles yet</b>Add your car or two-wheeler to track service, wheel alignment, PUC and insurance dates.
    <div style="margin-top:14px"><button class="pill-btn" data-act="v-add">Add vehicle</button></div></div>`;
  const dues = vehicleDues(), over = dues.filter((x) => x.state === 'overdue').length, soon = dues.filter((x) => x.state === 'soon').length;
  const y = today().slice(0, 4), spent = sum(all('expenses').filter((e) => e.category === 'Vehicle' && (e.date || '').startsWith(y)));
  return `<div class="card summary"><div>Needs attention<b>${over ? `<span class="late-text">${over} overdue</span>` : '0 overdue'}${soon ? ` · ${soon} soon` : ''}</b></div>
      <div style="text-align:right">Spent in ${y}<b>${money(spent)}</b></div></div>
    <div class="vgrid">${vs.map(vehicleCard).join('')}</div>`;
}
// Dashboard: every vehicle due date in one place (separate from bills)
function vehicleDueCard() {
  const vs = all('vehicles');
  if (!vs.length) return `<div class="section"><h2>Vehicle due dates</h2></div>
    <div class="card empty" style="padding:18px"><b>Track service, PUC and insurance</b>Add your car or two-wheeler and the due dates show up here.
      <div style="margin-top:12px"><button class="pill-btn" data-act="v-add">Add vehicle</button></div></div>`;
  const dues = vehicleDues(), shown = dues.slice(0, 6), more = dues.length - shown.length;
  const stale = vs.filter((v) => odoAge(v) > 30);
  return `<div class="section"><h2>Vehicle due dates</h2><button class="linkish" data-act="tab" data-tab="vehicles">All vehicles</button></div>
    <div class="card list duecard">${shown.map(({ v, it, d, state }) => `<div class="row" data-act="tab" data-tab="vehicles" style="cursor:pointer">
        <span class="vico sm">${ICON[v.type] || ICON.car}</span>
        <div class="main"><div class="t">${esc(it.name)}</div><div class="m">${esc(v.name)} · ${d.unknown ? 'date not set' : (it.mode === 'expiry' ? 'expires ' : d.by === 'km' ? 'about ' : 'due ') + fmtDate(d.date)}</div></div>
        ${duePill(it, d, state)}</div>`).join('')}
      ${more > 0 ? `<button class="row linkish morerow" data-act="tab" data-tab="vehicles">${more} more</button>` : ''}
      ${stale.map((v) => `<div class="row nudge"><div class="main" style="cursor:default"><div class="m">${esc(v.name)} km last updated ${odoAge(v)} days ago. km-based dates may be off.</div></div>
        <button class="pill-btn ghost" data-act="v-km" data-id="${v.id}">Update km</button></div>`).join('')}
    </div>`;
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
    ${soon.length ? `<div class="section"><h2>Bills due this week</h2><button class="linkish" data-act="tab" data-tab="bills">All bills</button></div><div class="card list">${soon.slice(0, 5).map(billRow).join('')}</div>` : ''}
    ${cats.length ? `<div class="section"><h2>Where it went in ${monthLabel(m, true).split(' ')[0]}</h2><button class="linkish" data-act="tab" data-tab="spend">Details</button></div>
    <div class="card bars">${cats.map(([c, v]) => `<div class="bar"><div class="lab"><span>${esc(c)}<span class="pct">${Math.round((v / spent) * 100)}%</span></span><span>${money(v)}</span></div>
      <div class="track"><div class="fill" style="width:${Math.max(2, (v / cmax) * 100)}%"></div></div></div>`).join('')}</div>` : ''}
    ${vehicleDueCard()}
    ${empty ? '<div class="card empty" style="margin-top:12px"><b>Welcome to Personal Hub</b>Tap + to log your first expense, or use the tabs below to plan purchases, add bills and keep notes. Charts appear here as you go.</div>' : `
    <div class="section"><h2>Spending, last 6 months</h2></div>
    <div class="card chart"><div class="chart-head"><span>Monthly average <b>${money(avg)}</b></span><span>This month <b>${money(spent)}</b></span></div>${trend}</div>
    ${planned.length ? `<div class="section"><h2>Purchase plan by month</h2><button class="linkish" data-act="tab" data-tab="buy">Full plan</button></div>
    <div class="card chart"><div class="legend"><span><i></i>Essentials <b>${money(est(planned, 'essentials'))}</b></span><span><i class="life"></i>Lifestyle <b>${money(est(planned, 'lifestyle'))}</b></span></div>${plan}</div>` : ''}`}
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
        ${Sync.state === 'error' && Sync.lastError ? `<div class="warnbox" style="color:var(--danger);background:var(--danger-soft)"><b>Sync failed.</b> ${esc(Sync.lastError)}</div>` : ''}
        <p>${c ? `Connected. ${Sync.lastSync ? 'Last synced ' + ago(Sync.lastSync) + '.' : ''} Your data is in Drive → <b>${FOLDER_NAME}</b> → ${FILE_NAME}.` : 'Not connected. Your data is saved on this device only.'}</p>
        <div class="actions">${c ? '<button class="pill-btn" data-act="sync-now">Sync now</button><button class="pill-btn ghost" data-act="reconnect">Reconnect</button><button class="pill-btn ghost" data-act="disconnect">Disconnect</button>' : '<button class="pill-btn" data-act="sync-now">Connect Google Drive</button>'}</div></div>
      ${installPrompt ? '<div class="card setting"><h3>Install app</h3><p>Add Personal Hub to your home screen or desktop.</p><div class="actions"><button class="pill-btn" data-act="install">Install</button></div></div>' : ''}
      <div class="card setting"><h3>Bill reminders</h3>
        ${Reminders.error === 'perm' ? '<div class="warnbox">Google Calendar access is missing. Tap <b>Allow Calendar</b> and tick the Calendar box. If it still fails, check that the Google Calendar API is enabled (setup guide, Step 2).</div>'
          : Reminders.error ? '<div class="warnbox">Reminders could not be updated last time. They will retry on the next sync.</div>' : ''}
        <p>${Reminders.count()} reminder${Reminders.count() === 1 ? ' is' : 's are'} on (bills and vehicles). ${c ? 'They are added to your Google Calendar at 9:00 AM, so your phone and computer notify you even when this app is closed.' : 'Connect Google Drive to send them to your Google Calendar, so your phone and computer notify you even when this app is closed.'} Set the timing for each bill when you add or edit it.</p>
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
const VIEWS = { home: ['Dashboard', vHome], buy: ['Purchase plan', vBuy], spend: ['Expenses', vSpend], bills: ['Bills', vBills], vehicles: ['Vehicles', vVehicles], notes: ['Notes', vNotes] };
function render() {
  const [title, fn] = VIEWS[UI.tab] || VIEWS.home;
  $('#title').textContent = title;
  $('#view').innerHTML = fn();
  document.querySelectorAll('#tabbar button').forEach((b) => b.classList.toggle('on', b.dataset.tab === UI.tab));
  // Tab badges: bills overdue or due within 2 days; vehicle items overdue or due soon
  const setBadge = (name, n) => {
    const tab = $(`#tabbar [data-tab=${name}]`); let badge = tab.querySelector('.tbadge');
    if (!badge) { badge = document.createElement('i'); badge.className = 'tbadge'; tab.appendChild(badge); }
    badge.textContent = n; badge.hidden = !n;
  };
  setBadge('bills', activeBills().filter((b) => daysUntil(b.due) <= 2).length);
  setBadge('vehicles', vehicleDues().filter((x) => x.state === 'overdue' || x.state === 'soon').length);
  const s = $('#noteSearch');
  if (s) s.addEventListener('input', (e) => { UI.noteQuery = e.target.value; $('#notesGrid').innerHTML = notesGrid(); });
}
const byId = (col, id) => Store.get(col, id);
const ACTIONS = {
  tab: (el) => { UI.tab = el.dataset.tab; LS.set('ph:tab', UI.tab); render(); window.scrollTo(0, 0); },
  add: () => ({ home: expenseForm, spend: expenseForm, buy: purchaseForm, bills: billForm, vehicles: vehicleForm, notes: noteForm }[UI.tab] || expenseForm)(),
  close: closeSheet,
  'v-add': () => vehicleForm(),
  'v-edit': (el, id) => vehicleForm(byId('vehicles', id)),
  'v-km': (el, id) => kmForm(byId('vehicles', id)),
  'v-item': (el, id) => { const v = byId('vehicles', id); itemForm(v, vItem(v, el.dataset.item)); },
  'v-additem': (el, id) => itemForm(byId('vehicles', id)),
  'v-done': (el, id) => { const v = byId('vehicles', id); doneForm(v, vItem(v, el.dataset.item)); },
  'v-history': (el, id) => historySheet(byId('vehicles', id)),
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
  reconnect: () => { closeSheet(); if (Sync.ensureClient()) Sync.client.requestAccessToken({ prompt: 'consent' }); else Sync.signIn(); },
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
