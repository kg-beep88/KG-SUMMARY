import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  resolvePrice,
  calculateDOLines,
  calculateStockBalances,
  generateDONumber,
  manpowerCost,
  summarize,
  normalizeTemplateLines,
} from './core.js';
import { eventToJob, displaySchedule } from './calendar-core.js';

const prices = {
  globalOld: { itemId: 'board', siteId: '', effectiveDate: '2026-01-01', unitPrice: 10 },
  globalNew: { itemId: 'board', siteId: '', effectiveDate: '2026-06-01', unitPrice: 12 },
  siteAOld: { itemId: 'board', siteId: 'siteA', effectiveDate: '2026-03-01', unitPrice: 14 },
  siteANew: { itemId: 'board', siteId: 'siteA', effectiveDate: '2026-06-10', unitPrice: 15 },
};
assert.equal(resolvePrice(prices, 'board', '2026-05-31').unitPrice, 10);
assert.equal(resolvePrice(prices, 'board', '2026-06-15').unitPrice, 12);
assert.equal(resolvePrice(prices, 'board', '2026-06-15', 'siteA').unitPrice, 15);
assert.equal(resolvePrice(prices, 'board', '2026-06-05', 'siteA').unitPrice, 14);
assert.equal(resolvePrice(prices, 'board', '2026-06-15', 'siteB').unitPrice, 12);
assert.equal(resolvePrice(prices, 'board', '2025-12-31', 'siteA'), null);

assert.deepEqual(calculateDOLines([{ quantity: 3, unitPrice: 12.5 }]), {
  lines: [{ quantity: 3, unitPrice: 12.5, lineCost: 37.5 }],
  materialCost: 37.5,
});

const balances = calculateStockBalances({
  a: { date: '2026-01-01', type: 'stock_in', itemId: 'board', quantity: 100, toSiteId: 'warehouse' },
  b: { date: '2026-01-02', type: 'transfer', itemId: 'board', quantity: 20, fromSiteId: 'warehouse', toSiteId: 'site1' },
  c: { date: '2026-01-03', type: 'stock_out', itemId: 'board', quantity: 5, fromSiteId: 'site1' },
});
assert.equal(balances.warehouse.board, 80);
assert.equal(balances.site1.board, 15);

assert.equal(generateDONumber({ a: { doNumber: 'DO-20260616-001' } }, '2026-06-16'), 'DO-20260616-002');
assert.equal(manpowerCost({ workers: 3, hoursPerWorker: 8, ratePerHour: 15 }), 360);
assert.deepEqual(normalizeTemplateLines([
  { itemId: 'board', quantity: 5 },
  { itemId: '', quantity: 2 },
  { itemId: 'screw', quantity: 0 },
]), [{ itemId: 'board', quantity: 5 }]);

const summary = summarize({
  deliveryOrders: { d: { date: '2026-06-16', status: 'issued', materialCost: 100, toSiteId: 'site1' } },
  manpower: { m: { date: '2026-06-16', siteId: 'site1', workers: 2, hoursPerWorker: 8, ratePerHour: 10 } },
}, { startDate: '2026-06-01', endDate: '2026-06-30', siteId: 'site1' });
assert.equal(summary.deliveryOrderCount, 1);
assert.equal(summary.materialCost, 100);
assert.equal(summary.manpowerCost, 160);
assert.equal(summary.totalCost, 260);

const calendarJob = eventToJob({
  id: 'event-123',
  summary: 'Ceiling work',
  location: '10 Woodlands Avenue 1',
  description: 'PIC: Ah Wei\nScope: Install ceiling',
  start: { date: '2026-06-20' },
  end: { date: '2026-06-23' },
  created: '2026-06-01T04:00:00Z',
  updated: '2026-06-16T04:00:00Z',
  creator: { email: 'creator@example.com', displayName: 'Creator' },
  organizer: { email: 'organizer@example.com', displayName: 'Organizer' },
  attendees: [{ email: 'one@example.com' }, { email: 'two@example.com' }],
  hangoutLink: 'https://meet.google.com/example',
});
assert.equal(calendarJob.address, '10 Woodlands Avenue 1');
assert.equal(calendarJob.pic, 'Ah Wei');
assert.equal(calendarJob.startDate, '2026-06-20');
assert.equal(calendarJob.endDate, '2026-06-22');
assert.equal(calendarJob.calendarCreatorEmail, 'creator@example.com');
assert.equal(calendarJob.calendarOrganizerEmail, 'organizer@example.com');
assert.equal(calendarJob.calendarAttendeeCount, 2);
assert.equal(calendarJob.calendarHangoutLink, 'https://meet.google.com/example');
assert.equal(displaySchedule(calendarJob), '2026-06-20 → 2026-06-22');

const nextLineLabels = eventToJob({
  id: 'event-456',
  summary: 'Wall work',
  description: `Address:
20 Admiralty Road
PIC:
John 9123 4567`,
  start: { dateTime: '2026-06-21T08:00:00+08:00' },
  end: { dateTime: '2026-06-21T17:00:00+08:00' },
});
assert.equal(nextLineLabels.address, '20 Admiralty Road');
assert.equal(nextLineLabels.pic, 'John 9123 4567');

const calendarConfigSource = readFileSync(new URL('./calendar-config.js', import.meta.url), 'utf8');
const storeSource = readFileSync(new URL('./data-store.js', import.meta.url), 'utf8');
const appSource = readFileSync(new URL('./app.js', import.meta.url), 'utf8');
const schemaSource = readFileSync(new URL('./supabase/sql/01-database-setup.sql', import.meta.url), 'utf8');
const cronSource = readFileSync(new URL('./supabase/sql/03-create-one-minute-cron.sql', import.meta.url), 'utf8');
const edgeSource = readFileSync(new URL('./supabase/functions/sync-google-calendar/index.ts', import.meta.url), 'utf8');
assert.match(calendarConfigSource, /importAllHistory:\s*true/);
assert.match(storeSource, /@supabase\/supabase-js@2/);
assert.match(storeSource, /apply_app_updates/);
assert.match(appSource, /Copy whole calendar/);
assert.match(appSource, /Supabase Cron runs the one-minute pull/);
assert.match(schemaSource, /enable row level security/i);
assert.match(schemaSource, /public\.is_app_user/);
assert.match(cronSource, /'\* \* \* \* \*'/);
assert.match(edgeSource, /calendarEventSnapshotJson:\s*JSON\.stringify\(event\)/);
assert.match(edgeSource, /syncToken/);
assert.doesNotMatch(edgeSource, /timeMin/);

console.log('All Supabase, full-calendar, site-price, stock and costing tests passed.');
