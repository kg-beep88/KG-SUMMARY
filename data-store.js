import { supabaseConfig, appAccess } from './supabase-config.js';
import { uid } from './core.js';

const EMPTY_DATA = {
  settings: {},
  sites: {},
  items: {},
  prices: {},
  stockTransactions: {},
  deliveryOrders: {},
  manpower: {},
  jobs: {},
  jobActivities: {},
  workers: {},
  equipmentTransactions: {},
  siteClaims: {},
};

function clone(value) {
  return typeof structuredClone === 'function'
    ? structuredClone(value)
    : JSON.parse(JSON.stringify(value));
}

function normalizeData(value) {
  return {
    ...clone(EMPTY_DATA),
    ...(value || {}),
    settings: value?.settings || {},
    sites: value?.sites || {},
    items: value?.items || {},
    prices: value?.prices || {},
    stockTransactions: value?.stockTransactions || {},
    deliveryOrders: value?.deliveryOrders || {},
    manpower: value?.manpower || {},
    jobs: value?.jobs || {},
    jobActivities: value?.jobActivities || {},
    workers: value?.workers || {},
    equipmentTransactions: value?.equipmentTransactions || {},
    siteClaims: value?.siteClaims || {},
  };
}

class SetupRequiredStore {
  constructor() {
    this.mode = 'setup';
    this.user = null;
  }

  async init() { return this; }
  getUser() { return null; }
  isAllowed() { return false; }
  async signIn() { throw new Error('Supabase is not configured. Complete supabase-config.js first.'); }
  async signOut() {}
  subscribe(callback) { callback(normalizeData({})); return () => {}; }
  async save() { throw new Error('Supabase is not configured.'); }
  async remove() { throw new Error('Supabase is not configured.'); }
  async updateMany() { throw new Error('Supabase is not configured.'); }
  async replaceAll() { throw new Error('Supabase is not configured.'); }
}

class SupabaseStore {
  constructor(createClient) {
    this.mode = 'supabase';
    this.user = null;
    this.channel = null;
    this.reloadTimer = null;
    this.listeners = new Set();
    this.client = createClient(supabaseConfig.url, supabaseConfig.publishableKey, {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: true,
      },
    });
  }

  async init() {
    const { data, error } = await this.client.auth.getSession();
    if (error) throw error;
    this.user = data.session?.user || null;

    this.client.auth.onAuthStateChange((_event, session) => {
      this.user = session?.user || null;
    });
    return this;
  }

  getUser() { return this.user; }

  isAllowed(user) {
    const email = String(user?.email || '').trim().toLowerCase();
    return appAccess.allowedEmails
      .map((item) => String(item).trim().toLowerCase())
      .includes(email);
  }

  async signIn() {
    const redirectTo = `${window.location.origin}${window.location.pathname}`;
    const { error } = await this.client.auth.signInWithOAuth({
      provider: 'google',
      options: {
        redirectTo,
        queryParams: {
          prompt: 'select_account',
          access_type: 'offline',
        },
      },
    });
    if (error) throw error;
    return null;
  }

  async signOut() {
    const { error } = await this.client.auth.signOut();
    if (error) throw error;
    this.user = null;
    await this.stopRealtime();
  }

  requireUser() {
    if (!this.user) throw new Error('Please sign in first.');
    if (!this.isAllowed(this.user)) throw new Error('This Google account is not permitted.');
  }

  async fetchAllRows() {
    const pageSize = 1000;
    let from = 0;
    const rows = [];
    while (true) {
      const { data, error } = await this.client
        .from(appAccess.recordsTable)
        .select('collection,record_id,data')
        .order('collection', { ascending: true })
        .order('record_id', { ascending: true })
        .range(from, from + pageSize - 1);
      if (error) throw error;
      rows.push(...(data || []));
      if (!data || data.length < pageSize) break;
      from += pageSize;
    }
    return rows;
  }

  rowsToData(rows = []) {
    const result = normalizeData({});
    rows.forEach((row) => {
      result[row.collection] ||= {};
      result[row.collection][row.record_id] = row.data;
    });
    return normalizeData(result);
  }

  async emitLatest(onError) {
    try {
      const latest = this.rowsToData(await this.fetchAllRows());
      this.listeners.forEach((callback) => callback(latest));
    } catch (error) {
      onError?.(error);
    }
  }

  scheduleReload(onError) {
    window.clearTimeout(this.reloadTimer);
    this.reloadTimer = window.setTimeout(() => this.emitLatest(onError), 120);
  }

  subscribe(callback, onError) {
    if (!this.user) {
      callback(normalizeData({}));
      return () => {};
    }

    this.listeners.add(callback);
    this.emitLatest(onError);

    if (!this.channel) {
      this.channel = this.client
        .channel('kg-app-records-live')
        .on(
          'postgres_changes',
          { event: '*', schema: 'public', table: appAccess.recordsTable },
          () => this.scheduleReload(onError),
        )
        .subscribe((status) => {
          if (status === 'CHANNEL_ERROR') onError?.(new Error('Supabase live connection failed. Refresh the page.'));
        });
    }

    return () => {
      this.listeners.delete(callback);
      if (!this.listeners.size) this.stopRealtime();
    };
  }

  async stopRealtime() {
    window.clearTimeout(this.reloadTimer);
    this.reloadTimer = null;
    if (this.channel) {
      await this.client.removeChannel(this.channel);
      this.channel = null;
    }
  }

  async save(collection, id, value) {
    this.requireUser();
    const { error } = await this.client.rpc('apply_app_updates', {
      p_updates: { [`${collection}/${id}`]: value },
    });
    if (error) throw error;
  }

  async remove(collection, id) {
    this.requireUser();
    const { error } = await this.client.rpc('apply_app_updates', {
      p_updates: { [`${collection}/${id}`]: null },
    });
    if (error) throw error;
  }

  async updateMany(updates) {
    this.requireUser();
    const { error } = await this.client.rpc('apply_app_updates', { p_updates: updates });
    if (error) throw error;
  }

  async replaceAll(data) {
    this.requireUser();
    const { error } = await this.client.rpc('replace_all_app_data', {
      p_data: normalizeData(data),
    });
    if (error) throw error;
  }

}

export async function createStore() {
  const configured =
    /^https:\/\/[a-z0-9-]+\.supabase\.co\/?$/i.test(String(supabaseConfig.url || '').trim()) &&
    supabaseConfig.publishableKey &&
    !String(supabaseConfig.publishableKey).startsWith('PASTE_');

  if (!configured) return new SetupRequiredStore().init();

  const { createClient } = await import('https://esm.sh/@supabase/supabase-js@2');
  return new SupabaseStore(createClient).init();
}

export { EMPTY_DATA, appAccess, uid };
