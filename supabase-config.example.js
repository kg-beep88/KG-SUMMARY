// KG Stock & Internal Calendar — Supabase browser configuration
// Copy your values from Supabase Dashboard > Project Settings > API.
// This file is safe to use in a browser. NEVER put the service_role key here.

export const supabaseConfig = {
  url: 'PASTE_SUPABASE_PROJECT_URL',
  publishableKey: 'PASTE_SUPABASE_PUBLISHABLE_KEY',
};

export const appAccess = {
  ownerEmail: 'kgchesterlee@gmail.com',
  allowedEmails: [
    'kgchesterlee@gmail.com',
    'shaynec0112@gmail.com',
    'qiaoerkg@gmail.com',
    'john91547536@gmail.com',
    'weiyee9211@gmail.com',
    'amyszemee@gmail.com',
  ],
  recordsTable: 'app_records',
};
