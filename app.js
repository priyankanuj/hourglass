import { DB } from '/db.js';

// Register the service worker immediately, before anything else runs, so it's
// detectable as early as possible (PWA audits like PWABuilder check shortly
// after the page loads).
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('/sw.js').catch(() => {});
}

// ---------------------------------------------------------------------------
// Date / hour-key helpers
// ---------------------------------------------------------------------------
function pad2(n) { return String(n).padStart(2, '0'); }

function dayKeyFromDate(d) {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}
function hourKeyFromDate(d) {
  return `${dayKeyFromDate(d)}T${pad2(d.getHours())}`;
}
function hourKeyToLabel(hourKey) {
  const h = parseInt(hourKey.slice(11, 13), 10);
  const next = (h + 1) % 24;
  return `${pad2(h)}:00 – ${pad2(next)}:00`;
}
function hourKeyToDay(hourKey) { return hourKey.slice(0, 10); }
function hourKeyToHour(hourKey) { return parseInt(hourKey.slice(11, 13), 10); }

// The most recent *completed* hour slot (previous hour, rolls over midnight naturally)
function latestCompletedHourKey(now = new Date()) {
  const slot = new Date(now);
  slot.setMinutes(0, 0, 0);
  slot.setHours(slot.getHours() - 1);
  return hourKeyFromDate(slot);
}
function todayCompletedHourKeys(now = new Date()) {
  const day = dayKeyFromDate(now);
  const currentHour = now.getHours();
  const keys = [];
  for (let h = 0; h < currentHour; h++) keys.push(`${day}T${pad2(h)}`);
  return keys;
}

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------
const state = {
  actions: [],
  todos: [],
  entries: [],
  editingHourKey: null,
  selectedActionIds: new Set(),
  calMonth: new Date().getMonth(),
  calYear: new Date().getFullYear(),
  deviceId: null
};

const actionsById = () => Object.fromEntries(state.actions.map(a => [a.id, a]));

function streakForAction(actionId) {
  const days = new Set(
    state.entries.filter(e => e.actionIds && e.actionIds.includes(actionId))
      .map(e => hourKeyToDay(e.hourKey))
  );
  const cursor = new Date();
  cursor.setHours(0, 0, 0, 0);
  let key = dayKeyFromDate(cursor);
  if (!days.has(key)) {
    cursor.setDate(cursor.getDate() - 1);
    key = dayKeyFromDate(cursor);
    if (!days.has(key)) return 0;
  }
  let streak = 0;
  while (days.has(key)) {
    streak++;
    cursor.setDate(cursor.getDate() - 1);
    key = dayKeyFromDate(cursor);
  }
  return streak;
}

function pointsForEntry(entry) {
  const map = actionsById();
  return (entry.actionIds || []).reduce((sum, id) => sum + (map[id] ? map[id].points : 0), 0);
}

function dayStats(dayKey) {
  const dayEntries = state.entries.filter(e => hourKeyToDay(e.hourKey) === dayKey);
  const points = dayEntries.reduce((s, e) => s + pointsForEntry(e), 0);
  const energies = dayEntries.map(e => e.energy).filter(v => typeof v === 'number');
  const avgEnergy = energies.length ? (energies.reduce((a, b) => a + b, 0) / energies.length) : null;
  return { points, avgEnergy, count: dayEntries.length };
}

// ---------------------------------------------------------------------------
// Reload data from DB
// ---------------------------------------------------------------------------
async function reloadAll() {
  state.actions = await DB.listActions();
  state.todos = await DB.listTodos();
  state.entries = await DB.listEntries();
}

// ---------------------------------------------------------------------------
// Clock
// ---------------------------------------------------------------------------
function tickClock() {
  const now = new Date();
  document.getElementById('clock-time').textContent =
    `${pad2(now.getHours())}:${pad2(now.getMinutes())}`;
  document.getElementById('clock-date').textContent =
    now.toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long' });
}

// ---------------------------------------------------------------------------
// Tabs
// ---------------------------------------------------------------------------
function switchView(name) {
  document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
  document.getElementById(`view-${name}`).classList.add('active');
  document.querySelectorAll('.tab-btn').forEach(b => b.classList.toggle('active', b.dataset.view === name));
  if (name === 'history') renderCalendar();
}
document.querySelectorAll('.tab-btn').forEach(btn => {
  btn.addEventListener('click', () => switchView(btn.dataset.view));
});

// ---------------------------------------------------------------------------
// LOG VIEW
// ---------------------------------------------------------------------------
function pickEditingHourKey() {
  // Prefer an explicitly chosen hour (e.g. tapped from the ledger); otherwise
  // the latest completed hour that has no entry yet.
  if (state.editingHourKey) return state.editingHourKey;
  return latestCompletedHourKey();
}

function renderLogView() {
  const hourKey = pickEditingHourKey();
  const existing = state.entries.find(e => e.hourKey === hourKey);
  const pendingCard = document.getElementById('pending-card');
  const emptyCard = document.getElementById('all-caught-up');

  const allLogged = todayCompletedHourKeys().every(k => state.entries.some(e => e.hourKey === k));
  if (allLogged && !state.editingHourKey) {
    pendingCard.hidden = true;
    emptyCard.hidden = false;
  } else {
    pendingCard.hidden = false;
    emptyCard.hidden = true;

    document.getElementById('pending-range').textContent = hourKeyToLabel(hourKey);
    document.getElementById('energy-range').value = existing ? existing.energy : 5;
    document.getElementById('energy-value').textContent = existing ? existing.energy : 5;

    state.selectedActionIds = new Set(existing ? existing.actionIds : []);
    renderActionChips();
    renderTodoChecklist();
  }

  renderTodayLedger();
}

function renderActionChips() {
  const wrap = document.getElementById('action-chips');
  wrap.innerHTML = '';
  if (state.actions.length === 0) {
    wrap.innerHTML = '<p class="empty-hint">No actions yet — add one to start tracking.</p>';
    return;
  }
  state.actions.forEach(a => {
    const chip = document.createElement('button');
    chip.type = 'button';
    chip.className = 'chip' + (state.selectedActionIds.has(a.id) ? ' selected' : '');
    const streak = streakForAction(a.id);
    chip.innerHTML = `<span>${escapeHtml(a.name)}</span>` +
      `<span class="chip-pts">${a.points > 0 ? '+' : ''}${a.points}</span>` +
      (streak > 0 ? `<span class="chip-streak">🔥${streak}</span>` : '');
    chip.addEventListener('click', () => {
      if (state.selectedActionIds.has(a.id)) state.selectedActionIds.delete(a.id);
      else state.selectedActionIds.add(a.id);
      renderActionChips();
    });
    wrap.appendChild(chip);
  });
}

function renderTodoChecklist() {
  const wrap = document.getElementById('todo-checklist');
  wrap.innerHTML = '';
  const open = state.todos.filter(t => !t.done);
  const doneToday = state.todos.filter(t => t.done && t.completedAt &&
    dayKeyFromDate(new Date(t.completedAt)) === dayKeyFromDate(new Date()));
  const list = [...open, ...doneToday];
  if (list.length === 0) {
    wrap.innerHTML = '<p class="empty-hint">No to-dos yet — add one if something comes to mind.</p>';
    return;
  }
  list.forEach(t => {
    const row = document.createElement('label');
    row.className = 'todo-row' + (t.done ? ' done' : '');
    row.innerHTML = `<input type="checkbox" ${t.done ? 'checked' : ''} />` +
      `<span class="todo-text">${escapeHtml(t.text)}</span>`;
    row.querySelector('input').addEventListener('change', async (e) => {
      t.done = e.target.checked;
      t.completedAt = t.done ? Date.now() : null;
      await DB.saveTodo(t);
      renderTodoChecklist();
      renderTodosManageList();
    });
    wrap.appendChild(row);
  });
}

function renderTodayLedger() {
  const wrap = document.getElementById('today-log-list');
  wrap.innerHTML = '';
  const keys = todayCompletedHourKeys();
  const map = actionsById();
  if (keys.length === 0) {
    wrap.innerHTML = '<p class="empty-hint">The first hour of the day is still running.</p>';
  }
  keys.slice().reverse().forEach(hourKey => {
    const entry = state.entries.find(e => e.hourKey === hourKey);
    const row = document.createElement('div');
    row.className = 'ledger-row';
    if (entry) {
      const names = (entry.actionIds || []).map(id => map[id] ? map[id].name : null).filter(Boolean);
      const pts = pointsForEntry(entry);
      row.innerHTML = `<span class="lr-time mono">${pad2(hourKeyToHour(hourKey))}:00</span>` +
        `<span class="lr-energy">⚡${entry.energy}</span>` +
        `<span class="lr-actions">${names.length ? escapeHtml(names.join(', ')) : '—'}</span>` +
        `<span class="lr-points ${pts >= 0 ? 'pos' : 'neg'}">${pts >= 0 ? '+' : ''}${pts}</span>`;
      row.addEventListener('click', () => { state.editingHourKey = hourKey; renderLogView(); scrollToPending(); });
    } else {
      row.style.opacity = '0.6';
      row.innerHTML = `<span class="lr-time mono">${pad2(hourKeyToHour(hourKey))}:00</span>` +
        `<span class="lr-actions muted">Not logged — tap to fill in</span>`;
      row.addEventListener('click', () => { state.editingHourKey = hourKey; renderLogView(); scrollToPending(); });
    }
    wrap.appendChild(row);
  });

  const dayKey = dayKeyFromDate(new Date());
  const { points } = dayStats(dayKey);
  document.getElementById('today-total').textContent = `${points >= 0 ? '+' : ''}${points} pts today`;
}

function scrollToPending() {
  document.getElementById('pending-card').scrollIntoView({ behavior: 'smooth', block: 'start' });
}

document.getElementById('energy-range').addEventListener('input', (e) => {
  document.getElementById('energy-value').textContent = e.target.value;
});

document.getElementById('save-entry-btn').addEventListener('click', async () => {
  const hourKey = pickEditingHourKey();
  const energy = parseInt(document.getElementById('energy-range').value, 10);
  const entry = {
    hourKey,
    energy,
    actionIds: Array.from(state.selectedActionIds),
    savedAt: Date.now()
  };
  await DB.saveEntry(entry);
  state.editingHourKey = null;
  await reloadAll();
  renderLogView();
});

// ---------------------------------------------------------------------------
// ACTIONS VIEW
// ---------------------------------------------------------------------------
function renderActionsManageList() {
  const wrap = document.getElementById('actions-list');
  wrap.innerHTML = '';
  if (state.actions.length === 0) {
    wrap.innerHTML = '<p class="empty-hint">No actions yet. Add the things you do often — points can be positive or negative.</p>';
    return;
  }
  state.actions.forEach(a => {
    const streak = streakForAction(a.id);
    const row = document.createElement('div');
    row.className = 'action-manage-row';
    row.innerHTML = `<span class="amr-name">${escapeHtml(a.name)}</span>` +
      (streak > 0 ? `<span class="amr-streak">🔥 ${streak}d streak</span>` : '') +
      `<input type="number" class="amr-points-input mono" value="${a.points}" step="1" />` +
      `<button class="amr-del" aria-label="Delete">🗑</button>`;
    row.querySelector('.amr-points-input').addEventListener('change', async (e) => {
      a.points = parseInt(e.target.value, 10) || 0;
      await DB.saveAction(a);
      await reloadAll();
    });
    row.querySelector('.amr-del').addEventListener('click', async () => {
      if (!confirm(`Delete "${a.name}"? Past log entries keep their history, but this action will no longer be selectable.`)) return;
      await DB.deleteAction(a.id);
      await reloadAll();
      renderActionsManageList();
      renderLogView();
    });
    wrap.appendChild(row);
  });
}

document.getElementById('new-action-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const name = document.getElementById('new-action-name').value.trim();
  const points = parseInt(document.getElementById('new-action-points').value, 10) || 0;
  if (!name) return;
  await DB.saveAction({ name, points, createdAt: Date.now() });
  e.target.reset();
  await reloadAll();
  renderActionsManageList();
  renderLogView();
});

// ---------------------------------------------------------------------------
// TODOS VIEW
// ---------------------------------------------------------------------------
function renderTodosManageList() {
  const wrap = document.getElementById('todos-manage-list');
  wrap.innerHTML = '';
  if (state.todos.length === 0) {
    wrap.innerHTML = '<p class="empty-hint">Nothing on your list yet.</p>';
    return;
  }
  state.todos.forEach(t => {
    const row = document.createElement('div');
    row.className = 'todo-row' + (t.done ? ' done' : '');
    row.innerHTML = `<input type="checkbox" ${t.done ? 'checked' : ''} />` +
      `<span class="todo-text">${escapeHtml(t.text)}</span>` +
      `<button class="row-del" aria-label="Delete">🗑</button>`;
    row.querySelector('input').addEventListener('change', async (e) => {
      t.done = e.target.checked;
      t.completedAt = t.done ? Date.now() : null;
      await DB.saveTodo(t);
      await reloadAll();
      renderTodosManageList();
      renderTodoChecklist();
    });
    row.querySelector('.row-del').addEventListener('click', async () => {
      await DB.deleteTodo(t.id);
      await reloadAll();
      renderTodosManageList();
      renderTodoChecklist();
    });
    wrap.appendChild(row);
  });
}

document.getElementById('new-todo-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const text = document.getElementById('new-todo-text').value.trim();
  if (!text) return;
  await DB.saveTodo({ text, done: false, createdAt: Date.now(), completedAt: null });
  e.target.reset();
  await reloadAll();
  renderTodosManageList();
  renderTodoChecklist();
});

// ---------------------------------------------------------------------------
// Quick-add (used from within the log card)
// ---------------------------------------------------------------------------
function openPrompt(title, bodyHtml, onMount) {
  document.getElementById('prompt-title').textContent = title;
  const body = document.getElementById('prompt-body');
  body.innerHTML = bodyHtml;
  document.getElementById('prompt-modal').hidden = false;
  onMount(body);
}
function closePrompt() { document.getElementById('prompt-modal').hidden = true; }
document.getElementById('prompt-close').addEventListener('click', closePrompt);
document.querySelector('#prompt-modal .sheet-backdrop').addEventListener('click', closePrompt);

document.getElementById('quick-add-action-btn').addEventListener('click', () => {
  openPrompt('New action', `
    <form id="qa-action-form" class="inline-form" style="flex-direction:column;">
      <input type="text" id="qa-action-name" placeholder="Action name" required />
      <input type="number" id="qa-action-points" placeholder="Points (e.g. 2 or -3)" step="1" required />
      <button type="submit" class="primary-btn">Add & select</button>
    </form>
  `, (body) => {
    body.querySelector('#qa-action-form').addEventListener('submit', async (e) => {
      e.preventDefault();
      const name = body.querySelector('#qa-action-name').value.trim();
      const points = parseInt(body.querySelector('#qa-action-points').value, 10) || 0;
      if (!name) return;
      const action = { name, points, createdAt: Date.now() };
      await DB.saveAction(action);
      await reloadAll();
      const saved = state.actions.find(a => a.name === name && a.points === points);
      if (saved) state.selectedActionIds.add(saved.id);
      renderActionChips();
      renderActionsManageList();
      closePrompt();
    });
  });
});

document.getElementById('quick-add-todo-btn').addEventListener('click', () => {
  openPrompt('New to-do', `
    <form id="qa-todo-form" class="inline-form" style="flex-direction:column;">
      <input type="text" id="qa-todo-text" placeholder="What needs doing?" required />
      <button type="submit" class="primary-btn">Add to-do</button>
    </form>
  `, (body) => {
    body.querySelector('#qa-todo-form').addEventListener('submit', async (e) => {
      e.preventDefault();
      const text = body.querySelector('#qa-todo-text').value.trim();
      if (!text) return;
      await DB.saveTodo({ text, done: false, createdAt: Date.now(), completedAt: null });
      await reloadAll();
      renderTodoChecklist();
      renderTodosManageList();
      closePrompt();
    });
  });
});

// ---------------------------------------------------------------------------
// HISTORY VIEW — calendar
// ---------------------------------------------------------------------------
function renderCalendar() {
  const grid = document.getElementById('calendar-grid');
  grid.innerHTML = '';
  const y = state.calYear, m = state.calMonth;
  document.getElementById('cal-month-label').textContent =
    new Date(y, m, 1).toLocaleDateString(undefined, { month: 'long', year: 'numeric' });

  ['Su','Mo','Tu','We','Th','Fr','Sa'].forEach(d => {
    const el = document.createElement('div');
    el.className = 'cal-dow';
    el.textContent = d;
    grid.appendChild(el);
  });

  const firstDow = new Date(y, m, 1).getDay();
  const daysInMonth = new Date(y, m + 1, 0).getDate();
  const todayKey = dayKeyFromDate(new Date());

  for (let i = 0; i < firstDow; i++) {
    const el = document.createElement('div');
    el.className = 'cal-day empty';
    grid.appendChild(el);
  }
  for (let d = 1; d <= daysInMonth; d++) {
    const dayKey = `${y}-${pad2(m + 1)}-${pad2(d)}`;
    const { points, avgEnergy, count } = dayStats(dayKey);
    const el = document.createElement('div');
    el.className = 'cal-day' + (count ? ' has-data' : '') + (points > 0 ? ' pos' : points < 0 ? ' neg' : '') +
      (dayKey === todayKey ? ' today' : '');
    el.innerHTML = `<span class="cal-daynum">${d}</span>` +
      (count ? `<span class="cal-points">${points >= 0 ? '+' : ''}${points}</span>` : '');
    el.addEventListener('click', () => showDayDetail(dayKey, avgEnergy, points));
    grid.appendChild(el);
  }
}

document.getElementById('cal-prev').addEventListener('click', () => {
  state.calMonth--; if (state.calMonth < 0) { state.calMonth = 11; state.calYear--; }
  renderCalendar();
});
document.getElementById('cal-next').addEventListener('click', () => {
  state.calMonth++; if (state.calMonth > 11) { state.calMonth = 0; state.calYear++; }
  renderCalendar();
});

function showDayDetail(dayKey, avgEnergy, points) {
  const panel = document.getElementById('day-detail');
  panel.hidden = false;
  document.getElementById('day-detail-title').textContent =
    new Date(dayKey + 'T00:00').toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'short' });
  document.getElementById('day-detail-points').textContent = `${points >= 0 ? '+' : ''}${points}`;
  document.getElementById('day-detail-energy').textContent = avgEnergy != null ? avgEnergy.toFixed(1) : '–';

  const map = actionsById();
  const hoursWrap = document.getElementById('day-detail-hours');
  hoursWrap.innerHTML = '';
  const dayEntries = state.entries.filter(e => hourKeyToDay(e.hourKey) === dayKey)
    .sort((a, b) => a.hourKey.localeCompare(b.hourKey));
  if (dayEntries.length === 0) {
    hoursWrap.innerHTML = '<p class="empty-hint">No hours logged this day.</p>';
  }
  dayEntries.forEach(entry => {
    const names = (entry.actionIds || []).map(id => map[id] ? map[id].name : null).filter(Boolean);
    const pts = pointsForEntry(entry);
    const row = document.createElement('div');
    row.className = 'ledger-row';
    row.innerHTML = `<span class="lr-time mono">${pad2(hourKeyToHour(entry.hourKey))}:00</span>` +
      `<span class="lr-energy">⚡${entry.energy}</span>` +
      `<span class="lr-actions">${names.length ? escapeHtml(names.join(', ')) : '—'}</span>` +
      `<span class="lr-points ${pts >= 0 ? 'pos' : 'neg'}">${pts >= 0 ? '+' : ''}${pts}</span>`;
    hoursWrap.appendChild(row);
  });
  panel.scrollIntoView({ behavior: 'smooth', block: 'start' });
}
document.getElementById('day-detail-close').addEventListener('click', () => {
  document.getElementById('day-detail').hidden = true;
});

// ---------------------------------------------------------------------------
// Settings sheet / notifications
// ---------------------------------------------------------------------------
function populateHourSelects() {
  ['notif-start', 'notif-end'].forEach(id => {
    const sel = document.getElementById(id);
    sel.innerHTML = '';
    for (let h = 0; h < 24; h++) {
      const opt = document.createElement('option');
      opt.value = h;
      opt.textContent = `${pad2(h)}:00`;
      sel.appendChild(opt);
    }
  });
}

async function openSettingsSheet() {
  const enabled = await DB.getSetting('notifEnabled', false);
  const startHour = await DB.getSetting('notifStartHour', 8);
  const endHour = await DB.getSetting('notifEndHour', 22);
  document.getElementById('notif-enabled').checked = enabled;
  document.getElementById('notif-start').value = startHour;
  document.getElementById('notif-end').value = endHour;
  document.getElementById('notif-status').textContent =
    enabled ? `Reminders on, ${pad2(startHour)}:00–${pad2(endHour)}:00 daily.` : 'Reminders are off.';
  document.getElementById('settings-sheet').hidden = false;
}
document.getElementById('settings-btn').addEventListener('click', openSettingsSheet);
document.getElementById('settings-close').addEventListener('click', () => {
  document.getElementById('settings-sheet').hidden = true;
});
document.querySelector('#settings-sheet .sheet-backdrop').addEventListener('click', () => {
  document.getElementById('settings-sheet').hidden = true;
});

function urlBase64ToUint8Array(base64String) {
  const padding = '='.repeat((4 - base64String.length % 4) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const raw = atob(base64);
  return Uint8Array.from([...raw].map(c => c.charCodeAt(0)));
}

function getDeviceId() {
  let id = localStorage.getItem('hourglass-device-id');
  if (!id) {
    id = 'dev_' + Date.now() + '_' + Math.random().toString(36).slice(2, 10);
    localStorage.setItem('hourglass-device-id', id);
  }
  return id;
}

async function enablePushReminders(startHour, endHour) {
  if (!('serviceWorker' in navigator) || !('PushManager' in window)) {
    throw new Error('This browser does not support push notifications.');
  }
  const permission = await Notification.requestPermission();
  if (permission !== 'granted') throw new Error('Notification permission was not granted.');

  const reg = await navigator.serviceWorker.ready;
  let sub = await reg.pushManager.getSubscription();
  if (!sub) {
    const keyResp = await fetch('/api/vapid-public-key');
    if (!keyResp.ok) throw new Error('Could not reach the reminder server (has this been deployed to Netlify with VAPID keys set?).');
    const { publicKey } = await keyResp.json();
    sub = await reg.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(publicKey)
    });
  }

  const tzOffsetHours = -new Date().getTimezoneOffset() / 60;
  const resp = await fetch('/api/subscribe', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      deviceId: getDeviceId(),
      subscription: sub,
      enabled: true,
      startHour, endHour, tzOffsetHours
    })
  });
  if (!resp.ok) throw new Error('Server rejected the reminder subscription.');
}

async function disablePushReminders() {
  try {
    await fetch('/api/subscribe', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ deviceId: getDeviceId(), enabled: false })
    });
  } catch { /* offline / not deployed — ignore */ }
}

document.getElementById('notif-save-btn').addEventListener('click', async () => {
  const enabled = document.getElementById('notif-enabled').checked;
  const startHour = parseInt(document.getElementById('notif-start').value, 10);
  const endHour = parseInt(document.getElementById('notif-end').value, 10);
  const status = document.getElementById('notif-status');
  await DB.setSetting('notifEnabled', enabled);
  await DB.setSetting('notifStartHour', startHour);
  await DB.setSetting('notifEndHour', endHour);

  if (enabled) {
    status.textContent = 'Setting up reminders…';
    try {
      await enablePushReminders(startHour, endHour);
      status.textContent = `Reminders on, ${pad2(startHour)}:00–${pad2(endHour)}:00 daily.`;
    } catch (err) {
      status.textContent = `Could not enable reminders: ${err.message}`;
    }
  } else {
    await disablePushReminders();
    status.textContent = 'Reminders are off.';
  }
});

// ---------------------------------------------------------------------------
// Utility
// ---------------------------------------------------------------------------
function escapeHtml(s) {
  return s.replace(/[&<>"']/g, c => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c]));
}

// ---------------------------------------------------------------------------
// Boot
// ---------------------------------------------------------------------------
async function boot() {
  populateHourSelects();
  tickClock();
  setInterval(tickClock, 15000);
  // Re-check pending hour roughly once a minute so the card updates as hours roll over.
  setInterval(() => { if (!state.editingHourKey) renderLogView(); }, 60000);

  await reloadAll();
  renderLogView();
  renderActionsManageList();
  renderTodosManageList();
  renderCalendar();
}
boot();
