export const DEFAULT_CURRENCY = 'SGD';

export function uid(prefix = 'id') {
  if (globalThis.crypto?.randomUUID) return `${prefix}_${globalThis.crypto.randomUUID()}`;
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
}

export function todayISO(date = new Date()) {
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60000);
  return local.toISOString().slice(0, 10);
}

export function firstDayOfMonthISO(date = new Date()) {
  const d = new Date(date.getFullYear(), date.getMonth(), 1);
  return todayISO(d);
}

export function money(value, currency = DEFAULT_CURRENCY) {
  return new Intl.NumberFormat('en-SG', {
    style: 'currency',
    currency,
    minimumFractionDigits: 2,
  }).format(Number(value || 0));
}

export function number(value, decimals = 2) {
  return new Intl.NumberFormat('en-SG', {
    maximumFractionDigits: decimals,
  }).format(Number(value || 0));
}

export function dateInRange(date, start, end) {
  if (!date) return false;
  return (!start || date >= start) && (!end || date <= end);
}

export function asArray(record = {}) {
  return Object.entries(record || {}).map(([id, value]) => ({ id, ...(value || {}) }));
}

export function resolvePrice(pricesRecord, itemId, effectiveDate, siteId = '') {
  const sortNewest = (a, b) => {
    const byDate = String(b.effectiveDate || '').localeCompare(String(a.effectiveDate || ''));
    if (byDate !== 0) return byDate;
    return String(b.createdAt || '').localeCompare(String(a.createdAt || ''));
  };

  const candidates = asArray(pricesRecord)
    .filter((price) => price.itemId === itemId && price.effectiveDate <= effectiveDate);

  // A price saved for the selected worksite always wins. Older records without
  // siteId remain the default price, which keeps existing historical data valid.
  const sitePrices = siteId
    ? candidates.filter((price) => price.siteId === siteId).sort(sortNewest)
    : [];
  if (sitePrices.length) return sitePrices[0];

  return candidates
    .filter((price) => !price.siteId)
    .sort(sortNewest)[0] || null;
}

export function calculateDOLines(lines = []) {
  const cleanLines = lines.map((line) => {
    const quantity = Number(line.quantity || 0);
    const unitPrice = Number(line.unitPrice || 0);
    return {
      ...line,
      quantity,
      unitPrice,
      lineCost: roundMoney(quantity * unitPrice),
    };
  });
  return {
    lines: cleanLines,
    materialCost: roundMoney(cleanLines.reduce((sum, line) => sum + line.lineCost, 0)),
  };
}

export function manpowerCost(entry = {}) {
  return roundMoney(
    Number(entry.workers || 0) *
      Number(entry.hoursPerWorker || 0) *
      Number(entry.ratePerHour || 0),
  );
}

export function generateDONumber(existingDOsRecord, date, prefix = 'DO') {
  const compactDate = String(date || '').replaceAll('-', '');
  const start = `${prefix}-${compactDate}-`;
  const sequence = asArray(existingDOsRecord)
    .map((row) => row.doNumber || '')
    .filter((value) => value.startsWith(start))
    .map((value) => Number(value.slice(start.length)))
    .filter(Number.isFinite)
    .reduce((max, value) => Math.max(max, value), 0) + 1;
  return `${start}${String(sequence).padStart(3, '0')}`;
}

export function calculateStockBalances(transactionsRecord = {}, cutoffDate = '') {
  const balances = {};
  const add = (siteId, itemId, quantity) => {
    if (!siteId || !itemId) return;
    balances[siteId] ||= {};
    balances[siteId][itemId] = roundQuantity((balances[siteId][itemId] || 0) + quantity);
  };

  asArray(transactionsRecord)
    .filter((tx) => !cutoffDate || tx.date <= cutoffDate)
    .sort((a, b) => String(a.date).localeCompare(String(b.date)))
    .forEach((tx) => {
      const qty = Number(tx.quantity || 0);
      switch (tx.type) {
        case 'stock_in':
          add(tx.toSiteId, tx.itemId, qty);
          break;
        case 'stock_out':
          add(tx.fromSiteId, tx.itemId, -qty);
          break;
        case 'transfer':
          add(tx.fromSiteId, tx.itemId, -qty);
          add(tx.toSiteId, tx.itemId, qty);
          break;
        case 'adjustment':
          add(tx.toSiteId || tx.fromSiteId, tx.itemId, qty);
          break;
        default:
          break;
      }
    });
  return balances;
}

export function summarize(data, { startDate = '', endDate = '', siteId = '' } = {}) {
  const deliveryOrders = asArray(data.deliveryOrders)
    .filter((row) => row.status !== 'cancelled')
    .filter((row) => dateInRange(row.date, startDate, endDate))
    .filter((row) => !siteId || row.toSiteId === siteId || row.fromSiteId === siteId);

  const manpower = asArray(data.manpower)
    .filter((row) => dateInRange(row.date, startDate, endDate))
    .filter((row) => !siteId || row.siteId === siteId);

  const materialCost = roundMoney(
    deliveryOrders.reduce((sum, row) => sum + Number(row.materialCost || 0), 0),
  );
  const labourCost = roundMoney(manpower.reduce((sum, row) => sum + manpowerCost(row), 0));

  return {
    deliveryOrderCount: deliveryOrders.length,
    materialCost,
    manpowerCost: labourCost,
    totalCost: roundMoney(materialCost + labourCost),
    deliveryOrders,
    manpower,
  };
}

export function roundMoney(value) {
  return Math.round((Number(value || 0) + Number.EPSILON) * 100) / 100;
}

export function roundQuantity(value) {
  return Math.round((Number(value || 0) + Number.EPSILON) * 1000) / 1000;
}

export function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

export function labelForSite(sitesRecord, id) {
  return sitesRecord?.[id]?.name || 'Unknown location';
}

export function labelForItem(itemsRecord, id) {
  return itemsRecord?.[id]?.name || 'Unknown item';
}

export function summarizeJob(data, jobId) {
  const deliveryOrders = asArray(data.deliveryOrders)
    .filter((row) => row.jobId === jobId && row.status !== 'cancelled');
  const manpower = asArray(data.manpower)
    .filter((row) => row.jobId === jobId);
  const materialCost = roundMoney(deliveryOrders.reduce((sum, row) => sum + Number(row.materialCost || 0), 0));
  const labourCost = roundMoney(manpower.reduce((sum, row) => sum + manpowerCost(row), 0));
  const dates = [
    ...deliveryOrders.map((row) => row.date),
    ...manpower.map((row) => row.date),
  ].filter(Boolean).sort();
  return {
    deliveryOrderCount: deliveryOrders.length,
    materialCost,
    manpowerCost: labourCost,
    totalCost: roundMoney(materialCost + labourCost),
    lastWorkedDate: dates.at(-1) || '',
  };
}

export function latestIssuedDOForJob(deliveryOrdersRecord, jobId) {
  return asArray(deliveryOrdersRecord)
    .filter((row) => row.jobId === jobId && row.status !== 'cancelled')
    .sort((a, b) => String(b.date || '').localeCompare(String(a.date || '')) || String(b.createdAt || '').localeCompare(String(a.createdAt || '')))[0] || null;
}

export function normalizeTemplateLines(lines = []) {
  return lines
    .map((line) => ({ itemId: String(line.itemId || ''), quantity: roundQuantity(line.quantity) }))
    .filter((line) => line.itemId && line.quantity > 0);
}
