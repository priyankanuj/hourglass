// db.js — tiny IndexedDB wrapper. No external libraries.
const DB_NAME = 'hourglass-journal';
const DB_VERSION = 1;

function openDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains('actions')) {
        db.createObjectStore('actions', { keyPath: 'id' });
      }
      if (!db.objectStoreNames.contains('entries')) {
        // one record per hour-slot, keyPath = "YYYY-MM-DDTHH"
        db.createObjectStore('entries', { keyPath: 'hourKey' });
      }
      if (!db.objectStoreNames.contains('todos')) {
        db.createObjectStore('todos', { keyPath: 'id' });
      }
      if (!db.objectStoreNames.contains('settings')) {
        db.createObjectStore('settings', { keyPath: 'key' });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

let dbPromise = openDB();

async function tx(storeName, mode) {
  const db = await dbPromise;
  const t = db.transaction(storeName, mode);
  return { t, store: t.objectStore(storeName) };
}

function reqToPromise(req) {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export const DB = {
  // ---- generic ----
  async getAll(storeName) {
    const { store } = await tx(storeName, 'readonly');
    return reqToPromise(store.getAll());
  },
  async get(storeName, key) {
    const { store } = await tx(storeName, 'readonly');
    return reqToPromise(store.get(key));
  },
  async put(storeName, value) {
    const { store } = await tx(storeName, 'readwrite');
    return reqToPromise(store.put(value));
  },
  async delete(storeName, key) {
    const { store } = await tx(storeName, 'readwrite');
    return reqToPromise(store.delete(key));
  },

  // ---- actions ----
  async listActions() {
    const all = await DB.getAll('actions');
    return all.sort((a, b) => a.name.localeCompare(b.name));
  },
  async saveAction(action) {
    if (!action.id) action.id = 'act_' + Date.now() + '_' + Math.random().toString(36).slice(2, 7);
    return DB.put('actions', action);
  },
  async deleteAction(id) {
    return DB.delete('actions', id);
  },

  // ---- todos ----
  async listTodos() {
    const all = await DB.getAll('todos');
    return all.sort((a, b) => (a.done - b.done) || (b.createdAt - a.createdAt));
  },
  async saveTodo(todo) {
    if (!todo.id) todo.id = 'todo_' + Date.now() + '_' + Math.random().toString(36).slice(2, 7);
    return DB.put('todos', todo);
  },
  async deleteTodo(id) {
    return DB.delete('todos', id);
  },

  // ---- entries (one per hour) ----
  async getEntry(hourKey) {
    return DB.get('entries', hourKey);
  },
  async saveEntry(entry) {
    return DB.put('entries', entry);
  },
  async listEntries() {
    return DB.getAll('entries');
  },
  async listEntriesForDay(dayKey) {
    // dayKey = "YYYY-MM-DD"
    const all = await DB.getAll('entries');
    return all.filter(e => e.hourKey.startsWith(dayKey));
  },

  // ---- settings ----
  async getSetting(key, fallback) {
    const rec = await DB.get('settings', key);
    return rec ? rec.value : fallback;
  },
  async setSetting(key, value) {
    return DB.put('settings', { key, value });
  }
};
