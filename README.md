# KG Address Shift Calendar — Supabase V5.1

This version keeps the calendar simple and uses the address as the first line.
It uses GitHub Pages for the website and the existing Supabase project for live shared data.

## Site-work form

There is no Work Name, start/end time, hours, hourly rate, default stock source, or saved-material section.

Choose:

- Address
- Start and end date
- Site status: Active, Pause, Claim, or Complete
- Work or Work cannot be done
- Optional note and equipment needed
- Add Worker, Foreman, Subcon, or All

Every manpower row contains:

- Type
- Person or company name
- Role
- Pay for one shift

One person counts as one shift for every calendar date covered by that entry.

## Calendar display

The first line of every calendar record is the site address.
The second line shows worker, foreman and subcon shift counts plus the site status.

## Delivery Order

A delivery only asks for the delivery address, date, reference and materials.
There is no “From location” field. The delivery is recorded as stock received directly at the selected site.

## Cost summary

The summary cards show:

1. Number of Delivery Orders
2. Material cost
3. Manpower cost
4. Total cost

When an address is selected, the cards show all records for that address. With no address selected, they show the selected date.

## Upgrade an existing website

Use the SAFE-UPGRADE ZIP. It does not contain `supabase-config.js`.

1. Extract the ZIP.
2. Upload all files to the root of the existing GitHub repository.
3. Replace the old files.
4. Keep the existing `supabase-config.js`.
5. Commit the changes.
6. Open the website and press Ctrl + F5.

No new Supabase SQL is required if the current Supabase app already works.
