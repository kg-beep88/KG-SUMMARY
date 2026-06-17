# KG Site Control — Supabase V3

This version uses:

- GitHub Pages for the website
- Supabase for approved-user login and live shared data
- An internal editable calendar stored in Supabase

It does not use Google Calendar, Edge Functions, service-account keys or Cron.

## Main address page

The default page is **Address Summary**. Select an address to see:

- Number of Delivery Orders
- Material quantities and historical DO cost
- Material marked consumed and current site balance
- Individual worker roles, pay types, rates and total cost
- Ladder count by type
- Scaffold count by type
- Partial equipment returns and remaining outstanding quantity
- Site claims and claim status
- Site open/closed status

## Important existing-project upgrade

Before uploading the website, run this once in Supabase SQL Editor:

`RUN-THIS-IN-SUPABASE-FIRST.sql`

It allows the existing `app_records` table to store the new collections:

- `workers`
- `equipmentTransactions`
- `siteClaims`

Then upload the Safe Upgrade files to GitHub and keep your existing `supabase-config.js`.

## Worker pay

Create workers under **Workers** and save each person’s normal role, pay type and rate. Manpower entries can be hourly, daily or fixed and may override the normal saved value.

## Equipment

Borrow equipment to an address, then return any quantity. For example, borrow 10 ladders, return 4 now and return 6 later. The address summary always shows the remaining balance.

## Claims and closing

Add one or more claims. A claim can be Draft, Submitted, Approved or Paid. Select **Close this site after saving the claim** to save the claim and close the site in one action. Closing does not remove history and equipment can still be returned later.
