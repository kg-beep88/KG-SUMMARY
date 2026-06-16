# KG Stock & Internal Calendar — Supabase V2

This version uses only:

- GitHub Pages for the website
- Supabase for login, shared records and live updates
- An internal editable month calendar built into the website

It does **not** use Google Calendar, Google Calendar API, service-account JSON keys, Supabase Edge Functions or Cron.

## Main functions

- Click a date to create site work
- Click a calendar task to edit it
- Multi-day work appears on every date
- Pause, resume, complete or continue the same work
- Reuse the same material list for the same worksite
- Delivery Orders, stock, site-specific dated prices and manpower costing
- Shared Supabase data for the six approved users
- JSON backup and restore

## Existing Supabase user

Upload the files from `SAFE-UPGRADE` to GitHub but keep your existing `supabase-config.js`. Your current sites, stock, prices, DOs, manpower and site work remain in Supabase.

The old deployed Google Calendar Edge Function can remain; this website never calls it. You may delete it later from Supabase Dashboard > Edge Functions.
