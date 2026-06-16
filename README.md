# KG Stock, Site Work & Delivery Order — Supabase Edition

A GitHub Pages PWA backed by Supabase PostgreSQL, Auth, Realtime, Edge Functions and Cron.

## Main functions

- Shared multi-user stock across warehouses and worksites
- Delivery Orders with permanently locked historical prices
- Different dated material prices for different sites
- Manpower and combined material/manpower cost summaries
- Google Calendar events copied as site work with address, PIC and original dates
- Whole-calendar first import plus incremental one-minute background sync
- Pause, resume, complete and continue the same work later
- Reuse a site's saved material template or last DO
- JSON backup, restore and Firebase-to-Supabase migration
- Six approved Google accounts protected by Supabase Row Level Security

## Start

Read `START-HERE.txt` and run the files in `supabase/sql` in numerical order.

## Architecture

- GitHub Pages: static website and PWA
- Supabase Auth: staff Google sign-in
- Supabase PostgreSQL: app records
- Supabase Realtime: live updates between staff devices
- Supabase Edge Function: Google Calendar API synchronization
- Supabase Cron: invokes the Edge Function every minute
- Google service account: read-only access to the shared group calendar

## Important secrets

Only the Supabase Project URL and publishable key belong in `supabase-config.js`.
Keep `SUPABASE_SERVICE_ROLE_KEY`, `SYNC_SECRET`, and the Google service-account private key out of GitHub.
