# KG Simple Site Calendar — Supabase V4

This version is intentionally simple. It uses only GitHub Pages and the existing Supabase project.

## Main calendar entry

Choose:

- Address
- Date or date range
- Worker, Foreman, Subcon, or All
- Site status: Active, Pause, Claim, or Complete
- Work planned/done or Work cannot be done
- Reason work cannot be done
- Ladder, scaffold, and other equipment needed

## Calendar actions

- Delivery to site: creates a Delivery Order and material movement
- Stock return from site: returns one material now; more can be returned later
- Ladder / equipment: borrow or partly return equipment
- Calendar entries and all actions update live through Supabase

## Upgrade an existing website

Use the SAFE-UPGRADE ZIP. It does not contain `supabase-config.js`.

1. Extract the ZIP.
2. Upload all files to the root of the existing GitHub repository.
3. Replace the old files.
4. Keep the existing `supabase-config.js`.
5. Commit the changes.
6. Open the website and press Ctrl + F5.

No new Supabase SQL migration is required if the previous Supabase app already works.

## First-time Supabase setup

Run `supabase/sql/01-database-setup.sql` once, then copy `supabase-config.example.js` to `supabase-config.js` and enter the project URL and publishable key.

## Important

This version does not use Google Calendar, service accounts, Edge Functions, secrets, or Cron.
