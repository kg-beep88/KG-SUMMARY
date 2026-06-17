import assert from 'node:assert/strict';
import { calculateDOLines, equipmentOutstanding, manpowerCost, resolvePrice, summarize } from './core.js';
import { datesInRange, jobOccursOnDate, monthGridDates } from './calendar-core.js';

const prices = {
  p1: { id: 'p1', itemId: 'board', siteId: '', effectiveDate: '2026-01-01', unitPrice: 10 },
  p2: { id: 'p2', itemId: 'board', siteId: 'site-a', effectiveDate: '2026-06-01', unitPrice: 12.5 },
};
assert.equal(resolvePrice(prices, 'board', '2026-06-17', 'site-a').unitPrice, 12.5);
assert.equal(resolvePrice(prices, 'board', '2026-06-17', 'site-b').unitPrice, 10);

const calculated = calculateDOLines([
  { itemId: 'board', quantity: 4, unitPrice: 12.5 },
  { itemId: 'screw', quantity: 2, unitPrice: 5 },
]);
assert.equal(calculated.materialCost, 60);

const equipment = equipmentOutstanding({
  a: { siteId: 'site-a', category: 'ladder', equipmentType: 'A-frame 8ft', action: 'borrow', quantity: 10, date: '2026-06-01' },
  b: { siteId: 'site-a', category: 'ladder', equipmentType: 'A-frame 8ft', action: 'return', quantity: 4, date: '2026-06-02' },
  c: { siteId: 'site-a', category: 'ladder', equipmentType: 'A-frame 8ft', action: 'return', quantity: 3, date: '2026-06-03' },
}, 'site-a');
assert.equal(equipment[0].outstanding, 3);

const job = { startDate: '2026-06-10', endDate: '2026-06-12' };
assert.equal(jobOccursOnDate(job, '2026-06-11'), true);
assert.equal(jobOccursOnDate(job, '2026-06-13'), false);
assert.equal(monthGridDates('2026-06-01').length, 42);
assert.deepEqual(datesInRange('2026-06-17', '2026-06-19'), ['2026-06-17', '2026-06-18', '2026-06-19']);
assert.equal(manpowerCost({ payType: 'daily', units: 1, rate: 180 }), 180);

const summary = summarize({
  deliveryOrders: { d1: { date: '2026-06-17', toSiteId: 'site-a', status: 'issued', materialCost: 500 } },
  manpower: {
    m1: { date: '2026-06-17', siteId: 'site-a', payType: 'daily', units: 1, rate: 180 },
    m2: { date: '2026-06-17', siteId: 'site-a', payType: 'daily', units: 1, rate: 250 },
  },
}, { startDate: '2026-06-17', endDate: '2026-06-17', siteId: 'site-a' });
assert.equal(summary.materialCost, 500);
assert.equal(summary.manpowerCost, 430);
assert.equal(summary.totalCost, 930);

assert.equal(summary.deliveryOrders[0].toSiteId, 'site-a');
console.log('All address shift calendar tests passed.');
