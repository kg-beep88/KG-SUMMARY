import { createStore, uid } from './data-store.js';
import {
  asArray,
  calculateDOLines,
  escapeHtml,
  generateDONumber,
  labelForItem,
  labelForSite,
  money,
  number,
  manpowerCost,
  roundMoney,
  resolvePrice,
  todayISO,
  equipmentOutstanding,
} from './core.js';
import { dateLabel, datesInRange, jobOccursOnDate, monthGridDates, monthTitle, shiftMonth } from './calendar-core.js';

const VIEW_META = {
  calendar: ['Calendar', 'Address first, one shift per person, with material and manpower totals.'],
  master: ['Addresses & Items', 'Maintain worksite addresses, store locations and materials.'],
  settings: ['Settings & Backup', 'Company name, currency and full Supabase data backup.'],
};

const STATUS_META = {
  active: { label: 'Active', className: 'success' },
  paused: { label: 'Pause', className: 'warning' },
  claim: { label: 'Claim', className: 'claim' },
  completed: { label: 'Complete', className: 'info' },
};

const PEOPLE_META = {
  worker: 'Worker',
  foreman: 'Foreman',
  subcon: 'Subcon',
  all: 'All',
};

let store;
let unsubscribeData = null;
let data = emptyData();
let currentView = 'calendar';
let calendarMonth = `${todayISO().slice(0, 7)}-01`;
let calendarSelectedDate = todayISO();
let calendarSiteFilter = '';
let calendarStatusFilter = 'all';
let doDraftLines = [];
let entryShiftRows = [];
let toastTimer;

const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];

function emptyData() {
  return {
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
}

async function init() {
  bindStaticEvents();
  store = await createStore();
  updateStorageUI();

  if (store.mode === 'supabase' && store.getUser() && !store.isAllowed(store.getUser())) {
    await store.signOut();
    showToast('This Google account is not permitted.', true);
  }

  if (store.mode === 'setup') {
    renderAll();
    showToast('Complete supabase-config.js and the Supabase setup first.', true);
  } else if (store.getUser()) {
    connectData();
  } else {
    renderAll();
  }

  if ('serviceWorker' in navigator) navigator.serviceWorker.register('./sw.js').catch(() => {});
}

function bindStaticEvents() {
  $$('.nav-button').forEach((button) => button.addEventListener('click', () => switchView(button.dataset.view)));
  $$('[data-close]').forEach((button) => button.addEventListener('click', () => closeDialog(button.dataset.close)));

  $('#authButton').addEventListener('click', handleAuth);
  $('#quickEntryButton').addEventListener('click', () => openEntryDialog('', calendarSelectedDate));
  $('#quickDOButton').addEventListener('click', () => openDODialog(preferredSiteForDate(), calendarSelectedDate));
  $('#quickReturnButton').addEventListener('click', () => openReturnDialog(preferredSiteForDate(), calendarSelectedDate));
  $('#quickEquipmentButton').addEventListener('click', () => openEquipmentDialog(preferredSiteForDate(), calendarSelectedDate));

  $('#entryForm').addEventListener('submit', saveEntry);
  $('#entryOutcome').addEventListener('change', updateOutcomeVisibility);
  $('#entrySite').addEventListener('change', applySiteStatusToEntry);
  $('#entryShiftRowsBody').addEventListener('input', handleShiftRowInput);
  $('#entryShiftRowsBody').addEventListener('change', handleShiftRowInput);
  $('#entryShiftRowsBody').addEventListener('click', handleShiftRowClick);
  $$('[data-add-shift]').forEach((button) => button.addEventListener('click', () => addShiftPreset(button.dataset.addShift)));
  $('#deleteEntryButton').addEventListener('click', deleteCurrentEntry);

  $('#addDOLineButton').addEventListener('click', addDOLine);
  $('#doDate').addEventListener('change', refreshDOLinePrices);
  $('#doToSite').addEventListener('change', refreshDOLinePrices);
  $('#doLinesBody').addEventListener('change', handleDOLineChange);
  $('#doLinesBody').addEventListener('input', handleDOLineChange);
  $('#doLinesBody').addEventListener('click', handleDOLineClick);
  $('#doForm').addEventListener('submit', saveDeliveryOrder);

  $('#returnForm').addEventListener('submit', saveStockReturn);

  $('#equipmentForm').addEventListener('submit', saveEquipmentTransaction);
  ['#equipmentAction', '#equipmentSite', '#equipmentCategory', '#equipmentType'].forEach((selector) => {
    $(selector).addEventListener(selector === '#equipmentType' ? 'input' : 'change', updateEquipmentAvailability);
  });

  $('#siteForm').addEventListener('submit', saveSite);
  $('#itemForm').addEventListener('submit', saveItem);
  $('#importFile').addEventListener('change', importBackup);

  document.addEventListener('click', handleDynamicClick);
}

function connectData() {
  unsubscribeData?.();
  unsubscribeData = store.subscribe(
    (newData) => {
      data = newData;
      renderAll();
    },
    (error) => showToast(error.message || 'Unable to read Supabase.', true),
  );
}

async function handleAuth() {
  try {
    if (store.mode === 'setup') return showToast('Set up supabase-config.js first.', true);
    if (store.getUser()) {
      await store.signOut();
      unsubscribeData?.();
      data = emptyData();
      renderAll();
      showToast('Signed out.');
    } else {
      await store.signIn();
      showToast('Opening Google sign-in…');
    }
  } catch (error) {
    showToast(error.message || 'Sign-in failed.', true);
  }
}

function updateStorageUI() {
  const user = store?.getUser();
  $('#modeBadge').textContent = store?.mode === 'supabase' ? 'Live Supabase data' : 'Supabase setup required';
  $('#authButton').textContent = store?.mode === 'supabase' ? (user ? 'Sign out' : 'Sign in with Google') : 'Set up Supabase';
  $('#userLabel').textContent = user?.email || 'Not signed in';
}

function switchView(view) {
  currentView = view;
  $$('.nav-button').forEach((button) => button.classList.toggle('active', button.dataset.view === view));
  $$('.view').forEach((element) => element.classList.toggle('active', element.id === `${view}View`));
  const [title, subtitle] = VIEW_META[view];
  $('#pageTitle').textContent = title;
  $('#pageSubtitle').textContent = subtitle;
  $('.topbar-actions').classList.toggle('hidden', view !== 'calendar');
}

function renderAll() {
  updateStorageUI();
  const companyName = data.settings?.companyName || 'KG Shift Site Calendar';
  $('#brandName').textContent = companyName;
  document.title = companyName;
  renderCalendar();
  renderMaster();
  renderSettings();
  switchView(currentView);
}

function currentUserLabel() {
  return store?.getUser()?.email || 'unknown';
}

function activeSites() {
  return asArray(data.sites).filter((row) => row.active !== false).sort((a, b) => siteDisplay(a).localeCompare(siteDisplay(b)));
}

function worksites() {
  return activeSites().filter((site) => site.type === 'worksite');
}

function warehouses() {
  return activeSites().filter((site) => site.type === 'warehouse');
}

function activeItems() {
  return asArray(data.items).filter((row) => row.active !== false).sort((a, b) => String(a.name || '').localeCompare(String(b.name || '')));
}

function siteDisplay(site) {
  if (!site) return 'Unknown address';
  if (site.type === 'worksite') return site.address || site.name || 'Unnamed worksite';
  return site.name || site.address || 'Store';
}

function siteOptions(selected = '', { worksiteOnly = false, warehouseOnly = false, includeAll = false } = {}) {
  let rows = activeSites();
  if (worksiteOnly) rows = rows.filter((site) => site.type === 'worksite');
  if (warehouseOnly) rows = rows.filter((site) => site.type === 'warehouse');
  const first = includeAll ? '<option value="">All addresses</option>' : '<option value="">Choose address</option>';
  return first + rows.map((site) => {
    const status = site.status || (site.closed ? 'completed' : 'active');
    const suffix = site.type === 'warehouse' ? ' · Store' : ` · ${STATUS_META[status]?.label || 'Active'}`;
    return `<option value="${site.id}" ${site.id === selected ? 'selected' : ''}>${escapeHtml(`${siteDisplay(site)}${suffix}`)}</option>`;
  }).join('');
}

function itemOptions(selected = '') {
  return '<option value="">Choose material</option>' + activeItems().map((item) => `<option value="${item.id}" ${item.id === selected ? 'selected' : ''}>${escapeHtml(item.name || 'Unnamed material')}</option>`).join('');
}

function statusBadge(status = 'active') {
  const meta = STATUS_META[status] || STATUS_META.active;
  return `<span class="badge ${meta.className}">${escapeHtml(meta.label)}</span>`;
}

function peopleLabel(value = 'worker') {
  return PEOPLE_META[value] || 'Worker';
}

const SHIFT_TYPES = {
  worker: 'Worker',
  foreman: 'Foreman',
  subcon: 'Subcon',
};

function cleanShiftAssignment(row = {}) {
  const type = SHIFT_TYPES[row.type] ? row.type : 'worker';
  return {
    id: row.id || uid('shift'),
    type,
    name: String(row.name || row.personName || '').trim(),
    role: String(row.role || '').trim(),
    shiftRate: Math.max(0, Number(row.shiftRate ?? row.rate ?? 0)),
  };
}

function shiftAssignmentsForJob(job = {}) {
  if (Array.isArray(job.shiftAssignments) && job.shiftAssignments.length) {
    return job.shiftAssignments.map(cleanShiftAssignment);
  }

  const legacyType = job.peopleType || 'worker';
  const legacyName = String(job.peopleNotes || '').trim();
  if (legacyType === 'all') {
    return ['worker', 'foreman', 'subcon'].map((type) => cleanShiftAssignment({ type, name: legacyName }));
  }
  if (SHIFT_TYPES[legacyType] || legacyName) {
    return [cleanShiftAssignment({ type: SHIFT_TYPES[legacyType] ? legacyType : 'worker', name: legacyName })];
  }
  return [];
}

function shiftCounts(assignments = []) {
  return assignments.reduce((counts, row) => {
    counts[row.type] = (counts[row.type] || 0) + 1;
    return counts;
  }, { worker: 0, foreman: 0, subcon: 0 });
}

function shiftCountLabel(assignments = []) {
  const counts = shiftCounts(assignments);
  const parts = [];
  if (counts.worker) parts.push(`${counts.worker}W`);
  if (counts.foreman) parts.push(`${counts.foreman}F`);
  if (counts.subcon) parts.push(`${counts.subcon}S`);
  return parts.join(' · ') || 'No manpower';
}

function dailyShiftCost(assignments = []) {
  return roundMoney(assignments.reduce((sum, row) => sum + Number(row.shiftRate || 0), 0));
}

function addShiftRow(type = 'worker') {
  entryShiftRows.push(cleanShiftAssignment({ type }));
}

function addShiftPreset(type = 'worker') {
  if (type === 'all') {
    addShiftRow('worker');
    addShiftRow('foreman');
    addShiftRow('subcon');
  } else {
    addShiftRow(type);
  }
  renderEntryShiftRows();
}

function renderEntryShiftRows() {
  const currency = data.settings?.currency || 'SGD';
  $('#entryShiftRowsBody').innerHTML = entryShiftRows.map((row) => `<tr data-shift-id="${escapeHtml(row.id)}">
    <td><select data-shift-field="type">${Object.entries(SHIFT_TYPES).map(([value, label]) => `<option value="${value}" ${row.type === value ? 'selected' : ''}>${label}</option>`).join('')}</select></td>
    <td><input data-shift-field="name" value="${escapeHtml(row.name)}" placeholder="Name or company" /></td>
    <td><input data-shift-field="role" value="${escapeHtml(row.role)}" placeholder="e.g. Installer" /></td>
    <td><input data-shift-field="shiftRate" type="number" min="0" step="0.01" value="${escapeHtml(Number(row.shiftRate || 0).toFixed(2))}" /></td>
    <td><button type="button" class="icon-button" data-remove-shift="${escapeHtml(row.id)}" title="Remove">×</button></td>
  </tr>`).join('');
  $('#entryNoShifts').classList.toggle('hidden', entryShiftRows.length > 0);
  $('#entryDailyManpowerTotal').textContent = money(dailyShiftCost(entryShiftRows), currency);
}

function handleShiftRowInput(event) {
  const rowElement = event.target.closest('[data-shift-id]');
  const field = event.target.dataset.shiftField;
  if (!rowElement || !field) return;
  const row = entryShiftRows.find((item) => item.id === rowElement.dataset.shiftId);
  if (!row) return;
  row[field] = field === 'shiftRate' ? Math.max(0, Number(event.target.value || 0)) : event.target.value;
  $('#entryDailyManpowerTotal').textContent = money(dailyShiftCost(entryShiftRows), data.settings?.currency || 'SGD');
}

function handleShiftRowClick(event) {
  const id = event.target.dataset.removeShift;
  if (!id) return;
  entryShiftRows = entryShiftRows.filter((row) => row.id !== id);
  renderEntryShiftRows();
}

function manpowerRecordId(jobId, assignmentId, date) {
  return `mp_${String(jobId).replaceAll('/', '_')}_${String(assignmentId).replaceAll('/', '_')}_${String(date).replaceAll('-', '')}`;
}

function calendarCostSummary() {
  const deliveryOrders = asArray(data.deliveryOrders)
    .filter((row) => row.status !== 'cancelled')
    .filter((row) => calendarSiteFilter ? row.toSiteId === calendarSiteFilter : row.date === calendarSelectedDate);
  const manpowerRows = asArray(data.manpower)
    .filter((row) => calendarSiteFilter ? row.siteId === calendarSiteFilter : row.date === calendarSelectedDate);
  const materialCost = roundMoney(deliveryOrders.reduce((sum, row) => sum + Number(row.materialCost || 0), 0));
  const labourCost = roundMoney(manpowerRows.reduce((sum, row) => sum + manpowerCost(row), 0));
  return {
    scope: calendarSiteFilter
      ? `All records for ${siteDisplay(data.sites?.[calendarSiteFilter])}`
      : dateLabel(calendarSelectedDate),
    deliveryOrderCount: deliveryOrders.length,
    materialCost,
    manpowerCost: labourCost,
    totalCost: roundMoney(materialCost + labourCost),
  };
}

function preferredSiteForDate() {
  if (calendarSiteFilter && data.sites?.[calendarSiteFilter]?.type === 'worksite') return calendarSiteFilter;
  const job = jobsForDate(calendarSelectedDate)[0];
  return job?.siteId || worksites()[0]?.id || '';
}

function jobsForDate(date) {
  return asArray(data.jobs)
    .filter((job) => jobOccursOnDate(job, date))
    .filter((job) => !calendarSiteFilter || job.siteId === calendarSiteFilter)
    .filter((job) => calendarStatusFilter === 'all' || (calendarStatusFilter === 'cannot_work' ? job.outcome === 'cannot_work' : job.status === calendarStatusFilter))
    .sort((a, b) => siteDisplay(data.sites?.[a.siteId]).localeCompare(siteDisplay(data.sites?.[b.siteId])));
}

function deliveriesForDate(date) {
  if (calendarStatusFilter !== 'all') return [];
  return asArray(data.deliveryOrders)
    .filter((row) => row.date === date && row.status !== 'cancelled')
    .filter((row) => !calendarSiteFilter || row.toSiteId === calendarSiteFilter)
    .sort((a, b) => String(a.doNumber || '').localeCompare(String(b.doNumber || '')));
}

function stockReturnsForDate(date) {
  if (calendarStatusFilter !== 'all') return [];
  return asArray(data.stockTransactions)
    .filter((row) => row.date === date && row.type === 'transfer' && !row.doId)
    .filter((row) => data.sites?.[row.fromSiteId]?.type === 'worksite')
    .filter((row) => !calendarSiteFilter || row.fromSiteId === calendarSiteFilter)
    .sort((a, b) => siteDisplay(data.sites?.[a.fromSiteId]).localeCompare(siteDisplay(data.sites?.[b.fromSiteId])));
}

function equipmentForDate(date) {
  if (calendarStatusFilter !== 'all') return [];
  return asArray(data.equipmentTransactions)
    .filter((row) => row.date === date)
    .filter((row) => !calendarSiteFilter || row.siteId === calendarSiteFilter)
    .sort((a, b) => siteDisplay(data.sites?.[a.siteId]).localeCompare(siteDisplay(data.sites?.[b.siteId])));
}

function dayEventCount(date) {
  return jobsForDate(date).length + deliveriesForDate(date).length + stockReturnsForDate(date).length + equipmentForDate(date).length;
}

function eventChipsForDate(date) {
  const chips = [];
  jobsForDate(date).forEach((job) => {
    const address = siteDisplay(data.sites?.[job.siteId]);
    const assignments = shiftAssignmentsForJob(job);
    const className = job.outcome === 'cannot_work' ? 'cannot' : (job.status || 'active');
    const detail = `${shiftCountLabel(assignments)} · ${STATUS_META[job.status]?.label || 'Active'}${job.outcome === 'cannot_work' ? ' · Cannot work' : ''}`;
    chips.push(`<button class="calendar-event ${className}" data-action="edit-entry" data-id="${job.id}" title="${escapeHtml(`${address} · ${detail}`)}"><strong class="address-line">${escapeHtml(address)}</strong><small>${escapeHtml(detail)}</small></button>`);
  });
  deliveriesForDate(date).forEach((row) => {
    const address = siteDisplay(data.sites?.[row.toSiteId]);
    chips.push(`<button class="calendar-event delivery" data-action="delivery-site" data-site="${row.toSiteId}" data-date="${date}" title="${escapeHtml(`${address} · ${row.doNumber || 'Delivery'}`)}"><strong class="address-line">${escapeHtml(address)}</strong><small>Delivery · ${escapeHtml(row.doNumber || 'DO')}</small></button>`);
  });
  stockReturnsForDate(date).forEach((row) => {
    const address = siteDisplay(data.sites?.[row.fromSiteId]);
    chips.push(`<button class="calendar-event stock-return" data-action="return-site" data-site="${row.fromSiteId}" data-date="${date}"><strong class="address-line">${escapeHtml(address)}</strong><small>Stock return</small></button>`);
  });
  equipmentForDate(date).forEach((row) => {
    const address = siteDisplay(data.sites?.[row.siteId]);
    chips.push(`<button class="calendar-event equipment" data-action="equipment-site" data-site="${row.siteId}" data-date="${date}"><strong class="address-line">${escapeHtml(address)}</strong><small>${row.action === 'return' ? 'Equipment return' : 'Equipment out'}</small></button>`);
  });
  return chips;
}

function renderCalendar() {
  const cells = monthGridDates(calendarMonth);
  const today = todayISO();
  const selectedJobs = jobsForDate(calendarSelectedDate);
  const selectedDeliveries = deliveriesForDate(calendarSelectedDate);
  const selectedReturns = stockReturnsForDate(calendarSelectedDate);
  const selectedEquipment = equipmentForDate(calendarSelectedDate);
  const selectedCount = selectedJobs.length + selectedDeliveries.length + selectedReturns.length + selectedEquipment.length;
  const costSummary = calendarCostSummary();
  const currency = data.settings?.currency || 'SGD';

  $('#calendarView').innerHTML = `
    <div class="toolbar calendar-toolbar">
      <div class="actions">
        <button class="button secondary" data-action="calendar-prev">← Previous</button>
        <button class="button secondary" data-action="calendar-today">Today</button>
        <button class="button secondary" data-action="calendar-next">Next →</button>
      </div>
      <div class="calendar-month-title">${escapeHtml(monthTitle(calendarMonth))}</div>
      <div class="actions filters">
        <label>Address<select id="calendarSiteFilter">${siteOptions(calendarSiteFilter, { worksiteOnly: true, includeAll: true })}</select></label>
        <label>Status<select id="calendarStatusFilter">
          <option value="all" ${calendarStatusFilter === 'all' ? 'selected' : ''}>All</option>
          <option value="active" ${calendarStatusFilter === 'active' ? 'selected' : ''}>Active</option>
          <option value="paused" ${calendarStatusFilter === 'paused' ? 'selected' : ''}>Pause</option>
          <option value="claim" ${calendarStatusFilter === 'claim' ? 'selected' : ''}>Claim</option>
          <option value="completed" ${calendarStatusFilter === 'completed' ? 'selected' : ''}>Complete</option>
          <option value="cannot_work" ${calendarStatusFilter === 'cannot_work' ? 'selected' : ''}>Cannot work</option>
        </select></label>
      </div>
    </div>

    <div class="quick-strip">
      <button class="quick-card primary-card" data-action="new-entry" data-date="${calendarSelectedDate}"><span>＋</span><strong>Site entry</strong><small>Each person counts as one shift</small></button>
      <button class="quick-card" data-action="delivery-site" data-site="${preferredSiteForDate()}" data-date="${calendarSelectedDate}"><span>🚚</span><strong>Delivery</strong><small>Material sent to site</small></button>
      <button class="quick-card" data-action="return-site" data-site="${preferredSiteForDate()}" data-date="${calendarSelectedDate}"><span>↩</span><strong>Stock return</strong><small>Material returned from site</small></button>
      <button class="quick-card" data-action="equipment-site" data-site="${preferredSiteForDate()}" data-date="${calendarSelectedDate}"><span>🪜</span><strong>Ladder / equipment</strong><small>Borrow or partly return</small></button>
    </div>

    <div class="summary-heading"><strong>${escapeHtml(costSummary.scope)}</strong><span>${calendarSiteFilter ? 'Address summary' : 'Selected-day summary'}</span></div>
    <div class="cost-summary-strip">
      <div class="cost-summary-card"><small>DO made</small><strong>${number(costSummary.deliveryOrderCount, 0)}</strong></div>
      <div class="cost-summary-card"><small>Material cost</small><strong>${money(costSummary.materialCost, currency)}</strong></div>
      <div class="cost-summary-card"><small>Manpower cost</small><strong>${money(costSummary.manpowerCost, currency)}</strong></div>
      <div class="cost-summary-card total"><small>Total cost</small><strong>${money(costSummary.totalCost, currency)}</strong></div>
    </div>

    <div class="card calendar-card">
      <div class="calendar-weekdays">${['Mon','Tue','Wed','Thu','Fri','Sat','Sun'].map((day) => `<div>${day}</div>`).join('')}</div>
      <div class="calendar-grid">${cells.map((cell) => {
        const chips = eventChipsForDate(cell.date);
        const classes = ['calendar-day', cell.inMonth ? '' : 'outside-month', cell.date === today ? 'today' : '', cell.date === calendarSelectedDate ? 'selected' : ''].filter(Boolean).join(' ');
        return `<div class="${classes}">
          <button class="calendar-day-number" data-action="select-calendar-day" data-date="${cell.date}">${cell.day}</button>
          <div class="calendar-events">${chips.slice(0, 4).join('')}${chips.length > 4 ? `<button class="calendar-more" data-action="select-calendar-day" data-date="${cell.date}">+${chips.length - 4} more</button>` : ''}</div>
        </div>`;
      }).join('')}</div>
    </div>

    <div class="card day-panel">
      <div class="section-heading">
        <div><h2>${escapeHtml(dateLabel(calendarSelectedDate))}</h2><p>${selectedCount} calendar record${selectedCount === 1 ? '' : 's'}. Click an entry to edit.</p></div>
        <button class="button primary" data-action="new-entry" data-date="${calendarSelectedDate}">+ Site entry</button>
      </div>
      ${selectedCount ? renderSelectedDay(selectedJobs, selectedDeliveries, selectedReturns, selectedEquipment) : emptyState('Nothing recorded on this date', 'Add a site entry, delivery, stock return or equipment movement.')}
    </div>`;

  $('#calendarSiteFilter').addEventListener('change', (event) => { calendarSiteFilter = event.target.value; renderCalendar(); });
  $('#calendarStatusFilter').addEventListener('change', (event) => { calendarStatusFilter = event.target.value; renderCalendar(); });
}

function renderSelectedDay(jobs, deliveries, returns, equipmentRows) {
  const currency = data.settings?.currency || 'SGD';
  const blocks = [];

  jobs.forEach((job) => {
    const site = data.sites?.[job.siteId];
    const assignments = shiftAssignmentsForJob(job);
    const dailyCost = dailyShiftCost(assignments);
    const equipmentNeeds = job.equipmentNeeds || {};
    const needParts = [];
    if (Number(equipmentNeeds.ladderQty || 0) > 0) needParts.push(`${number(equipmentNeeds.ladderQty, 0)} ladder${equipmentNeeds.ladderType ? ` (${equipmentNeeds.ladderType})` : ''}`);
    if (Number(equipmentNeeds.scaffoldQty || 0) > 0) needParts.push(`${number(equipmentNeeds.scaffoldQty, 0)} scaffold${equipmentNeeds.scaffoldType ? ` (${equipmentNeeds.scaffoldType})` : ''}`);
    if (equipmentNeeds.other) needParts.push(equipmentNeeds.other);
    const outstanding = equipmentOutstanding(data.equipmentTransactions, job.siteId).filter((row) => row.outstanding > 0);
    const assignmentDetails = assignments.map((row) => `${SHIFT_TYPES[row.type]}: ${row.name || row.role || 'Unnamed'}${row.role && row.name ? ` (${row.role})` : ''} · ${money(row.shiftRate, currency)}`).join(' · ');
    blocks.push(`<article class="day-record site-record ${job.outcome === 'cannot_work' ? 'cannot-record' : ''}">
      <div class="record-main">
        <div class="record-title-row"><h3>${escapeHtml(siteDisplay(site))}</h3>${statusBadge(job.status)}</div>
        <div class="record-tags"><span>${escapeHtml(shiftCountLabel(assignments))}</span><span>1 shift each</span>${job.outcome === 'cannot_work' ? '<span class="danger-tag">Work cannot be done</span>' : '<span>Work</span>'}</div>
        ${assignmentDetails ? `<p><strong>Manpower:</strong> ${escapeHtml(assignmentDetails)}</p>` : '<p><strong>Manpower:</strong> None recorded</p>'}
        <p><strong>Manpower cost today:</strong> ${money(dailyCost, currency)}</p>
        ${job.notes ? `<p>${escapeHtml(job.notes)}</p>` : ''}
        ${job.outcome === 'cannot_work' && job.cannotWorkReason ? `<p class="danger-text"><strong>Reason:</strong> ${escapeHtml(job.cannotWorkReason)}</p>` : ''}
        ${needParts.length ? `<p><strong>Needed:</strong> ${escapeHtml(needParts.join(' · '))}</p>` : ''}
        ${outstanding.length ? `<p><strong>Still at site:</strong> ${escapeHtml(outstanding.map((row) => `${number(row.outstanding)} ${row.equipmentType}`).join(' · '))}</p>` : ''}
      </div>
      <div class="record-actions">
        <button class="button secondary small" data-action="edit-entry" data-id="${job.id}">Edit</button>
        <button class="button secondary small" data-action="delivery-site" data-site="${job.siteId}" data-date="${calendarSelectedDate}">Delivery</button>
        <button class="button secondary small" data-action="return-site" data-site="${job.siteId}" data-date="${calendarSelectedDate}">Stock return</button>
        <button class="button secondary small" data-action="equipment-site" data-site="${job.siteId}" data-date="${calendarSelectedDate}">Equipment</button>
      </div>
    </article>`);
  });

  deliveries.forEach((row) => {
    blocks.push(`<article class="day-record delivery-record"><div class="record-main"><div class="record-title-row"><h3>Delivery · ${escapeHtml(siteDisplay(data.sites?.[row.toSiteId]))}</h3><span class="badge delivery-badge">${escapeHtml(row.doNumber || 'DO')}</span></div><p>${(row.lines || []).map((line) => `${escapeHtml(line.itemName)} ${number(line.quantity)} ${escapeHtml(line.unit)}`).join(' · ') || 'No item details'}</p><p><strong>Material cost:</strong> ${money(row.materialCost, currency)}${row.reference ? ` · ${escapeHtml(row.reference)}` : ''}</p></div><div class="record-actions"><button class="button secondary small" data-action="delivery-site" data-site="${row.toSiteId}" data-date="${row.date}">New delivery</button></div></article>`);
  });

  returns.forEach((row) => {
    blocks.push(`<article class="day-record return-record"><div class="record-main"><div class="record-title-row"><h3>Stock return · ${escapeHtml(siteDisplay(data.sites?.[row.fromSiteId]))}</h3><span class="badge return-badge">Returned</span></div><p>${escapeHtml(labelForItem(data.items, row.itemId))} · ${number(row.quantity)}${row.notes ? ` · ${escapeHtml(row.notes)}` : ''}</p></div><div class="record-actions"><button class="button secondary small" data-action="return-site" data-site="${row.fromSiteId}" data-date="${row.date}">Return more</button></div></article>`);
  });

  equipmentRows.forEach((row) => {
    blocks.push(`<article class="day-record equipment-record"><div class="record-main"><div class="record-title-row"><h3>${row.action === 'return' ? 'Equipment return' : 'Equipment borrowed'} · ${escapeHtml(siteDisplay(data.sites?.[row.siteId]))}</h3><span class="badge equipment-badge">${escapeHtml(row.category || 'equipment')}</span></div><p>${number(row.quantity)} × ${escapeHtml(row.equipmentType)}${row.notes ? ` · ${escapeHtml(row.notes)}` : ''}</p></div><div class="record-actions"><button class="button secondary small" data-action="equipment-site" data-site="${row.siteId}" data-date="${row.date}" data-equipment-action="${row.action === 'borrow' ? 'return' : 'borrow'}" data-category="${escapeHtml(row.category)}" data-type="${escapeHtml(row.equipmentType)}">${row.action === 'borrow' ? 'Return some' : 'Borrow'}</button></div></article>`);
  });

  return `<div class="day-records">${blocks.join('')}</div>`;
}

function openEntryDialog(id = '', selectedDate = '', siteId = '') {
  if (!requireReady(['sites'])) return;
  if (!worksites().length) { switchView('master'); return showToast('Add a worksite address first.', true); }
  const record = id ? data.jobs?.[id] : null;
  $('#entryForm').reset();
  $('#entryId').value = id;
  $('#entryDialogTitle').textContent = record ? 'Edit Site Work' : 'Add Site Work';
  $('#entrySite').innerHTML = siteOptions(record?.siteId || siteId || '', { worksiteOnly: true });
  $('#entrySite').value = record?.siteId || siteId || worksites()[0]?.id || '';
  const date = selectedDate || calendarSelectedDate || todayISO();
  $('#entryStartDate').value = record?.startDate || date;
  $('#entryEndDate').value = record?.endDate || record?.startDate || date;
  $('#entryStatus').value = record?.status || data.sites?.[$('#entrySite').value]?.status || 'active';
  $('#entryOutcome').value = record?.outcome || 'work';
  $('#entryCannotWorkReason').value = record?.cannotWorkReason || '';
  $('#entryNotes').value = record?.notes || record?.workNotes || '';
  $('#entryLadderType').value = record?.equipmentNeeds?.ladderType || '';
  $('#entryLadderQty').value = Number(record?.equipmentNeeds?.ladderQty || 0);
  $('#entryScaffoldType').value = record?.equipmentNeeds?.scaffoldType || '';
  $('#entryScaffoldQty').value = Number(record?.equipmentNeeds?.scaffoldQty || 0);
  $('#entryOtherEquipment').value = record?.equipmentNeeds?.other || '';
  entryShiftRows = record ? shiftAssignmentsForJob(record) : [];
  renderEntryShiftRows();
  $('#deleteEntryButton').classList.toggle('hidden', !record);
  updateOutcomeVisibility();
  $('#entryDialog').showModal();
}

function updateOutcomeVisibility() {
  const cannot = $('#entryOutcome').value === 'cannot_work';
  $('#cannotWorkReasonLabel').classList.toggle('hidden', !cannot);
  $('#entryCannotWorkReason').required = cannot;
}

function applySiteStatusToEntry() {
  const site = data.sites?.[$('#entrySite').value];
  if (site?.status && !$('#entryId').value) $('#entryStatus').value = site.status;
}

async function saveEntry(event) {
  event.preventDefault();
  try {
    const id = $('#entryId').value || uid('job');
    const existing = data.jobs?.[id];
    const siteId = $('#entrySite').value;
    const startDate = $('#entryStartDate').value;
    const endDate = $('#entryEndDate').value || startDate;
    if (!siteId) throw new Error('Choose an address.');
    if (endDate < startDate) throw new Error('End date cannot be before start date.');
    const outcome = $('#entryOutcome').value;
    const reason = $('#entryCannotWorkReason').value.trim();
    if (outcome === 'cannot_work' && !reason) throw new Error('Enter why work cannot be done.');
    const status = $('#entryStatus').value;
    const timestamp = new Date().toISOString();
    const site = data.sites?.[siteId];
    const notes = $('#entryNotes').value.trim();
    const assignments = entryShiftRows.map(cleanShiftAssignment);
    const categories = new Set(assignments.map((row) => row.type));
    const peopleType = categories.size > 1 ? 'all' : (assignments[0]?.type || 'worker');
    const record = {
      ...(existing || {}),
      name: siteDisplay(site),
      siteId,
      address: site?.address || site?.name || '',
      status,
      peopleType,
      peopleNotes: assignments.map((row) => row.name).filter(Boolean).join(', '),
      shiftAssignments: assignments,
      dailyManpowerCost: dailyShiftCost(assignments),
      outcome,
      cannotWorkReason: outcome === 'cannot_work' ? reason : '',
      notes,
      startDate,
      endDate,
      allDay: true,
      equipmentNeeds: {
        ladderType: $('#entryLadderType').value.trim(),
        ladderQty: Number($('#entryLadderQty').value || 0),
        scaffoldType: $('#entryScaffoldType').value.trim(),
        scaffoldQty: Number($('#entryScaffoldQty').value || 0),
        other: $('#entryOtherEquipment').value.trim(),
      },
      source: 'shift_internal_calendar',
      createdAt: existing?.createdAt || timestamp,
      createdBy: existing?.createdBy || currentUserLabel(),
      updatedAt: timestamp,
      updatedBy: currentUserLabel(),
    };
    const updates = {
      [`jobs/${id}`]: record,
      [`sites/${siteId}`]: {
        ...site,
        status,
        closed: status === 'completed',
        updatedAt: timestamp,
        updatedBy: currentUserLabel(),
      },
    };

    // Replace this work entry's manpower records so edits never double count.
    asArray(data.manpower)
      .filter((row) => row.jobId === id)
      .forEach((row) => { updates[`manpower/${row.id}`] = null; });

    datesInRange(startDate, endDate).forEach((date) => {
      assignments.forEach((assignment) => {
        const manpowerId = manpowerRecordId(id, assignment.id, date);
        updates[`manpower/${manpowerId}`] = {
          jobId: id,
          siteId,
          date,
          personName: assignment.name,
          workerName: assignment.name,
          workerType: assignment.type,
          category: assignment.type,
          role: assignment.role,
          payType: 'daily',
          units: 1,
          shifts: 1,
          rate: Number(assignment.shiftRate || 0),
          cost: Number(assignment.shiftRate || 0),
          notes: `1 ${SHIFT_TYPES[assignment.type]} shift`,
          createdAt: timestamp,
          createdBy: currentUserLabel(),
        };
      });
    });

    if (!existing || existing.status !== status || existing.outcome !== outcome) {
      const activityId = uid('activity');
      updates[`jobActivities/${activityId}`] = {
        jobId: id,
        type: outcome === 'cannot_work' ? 'cannot_work' : status,
        date: startDate,
        dateTime: timestamp,
        notes: outcome === 'cannot_work' ? reason : `Site status: ${STATUS_META[status]?.label || status}`,
        createdBy: currentUserLabel(),
      };
    }
    await store.updateMany(updates);
    calendarSelectedDate = startDate;
    calendarMonth = `${startDate.slice(0, 7)}-01`;
    closeDialog('entryDialog');
    showToast(existing ? 'Site work updated.' : 'Site work saved.');
  } catch (error) {
    showToast(error.message || 'Unable to save site work.', true);
  }
}

async function deleteCurrentEntry() {
  const id = $('#entryId').value;
  if (!id || !data.jobs?.[id]) return;
  if (!confirm('Delete this calendar entry and its manpower shifts?')) return;
  try {
    const updates = { [`jobs/${id}`]: null };
    asArray(data.manpower)
      .filter((row) => row.jobId === id)
      .forEach((row) => { updates[`manpower/${row.id}`] = null; });
    await store.updateMany(updates);
    closeDialog('entryDialog');
    showToast('Calendar entry deleted.');
  } catch (error) {
    showToast(error.message || 'Unable to delete entry.', true);
  }
}

function addDOLine() {
  const item = activeItems()[0];
  doDraftLines.push({ rowId: uid('line'), itemId: item?.id || '', quantity: 1, unitPrice: 0, priceTouched: false });
  refreshDOLinePrices();
}

function openDODialog(siteId = '', selectedDate = '') {
  if (!requireReady(['sites', 'items'])) return;
  if (!worksites().length) { switchView('master'); return showToast('Add at least one worksite address first.', true); }
  $('#doForm').reset();
  $('#doDate').value = selectedDate || calendarSelectedDate || todayISO();
  $('#doToSite').innerHTML = siteOptions(siteId, { worksiteOnly: true });
  $('#doToSite').value = siteId || worksites()[0]?.id || '';
  doDraftLines = [];
  addDOLine();
  $('#doDialog').showModal();
}

function refreshDOLinePrices() {
  const date = $('#doDate').value || todayISO();
  const siteId = $('#doToSite').value;
  doDraftLines.forEach((line) => {
    if (!line.priceTouched) line.unitPrice = Number(resolvePrice(data.prices, line.itemId, date, siteId)?.unitPrice || 0);
  });
  renderDOLines();
}

function renderDOLines() {
  const currency = data.settings?.currency || 'SGD';
  let total = 0;
  $('#doLinesBody').innerHTML = doDraftLines.map((line) => {
    const item = data.items?.[line.itemId];
    const cost = Number(line.quantity || 0) * Number(line.unitPrice || 0);
    total += cost;
    return `<tr data-row-id="${line.rowId}">
      <td><select data-do-field="itemId">${itemOptions(line.itemId)}</select></td>
      <td><input data-do-field="quantity" type="number" min="0.001" step="0.001" value="${escapeHtml(line.quantity)}" /></td>
      <td>${escapeHtml(item?.unit || '—')}</td>
      <td><input data-do-field="unitPrice" type="number" min="0" step="0.01" value="${escapeHtml(Number(line.unitPrice || 0).toFixed(2))}" /></td>
      <td><strong>${money(cost, currency)}</strong></td>
      <td><button type="button" class="icon-button" data-remove-line="${line.rowId}">×</button></td>
    </tr>`;
  }).join('');
  $('#doMaterialTotal').textContent = money(total, currency);
}

function handleDOLineChange(event) {
  const row = event.target.closest('[data-row-id]');
  const field = event.target.dataset.doField;
  if (!row || !field) return;
  const line = doDraftLines.find((item) => item.rowId === row.dataset.rowId);
  if (!line) return;
  if (field === 'itemId') {
    line.itemId = event.target.value;
    line.priceTouched = false;
    line.unitPrice = Number(resolvePrice(data.prices, line.itemId, $('#doDate').value, $('#doToSite').value)?.unitPrice || 0);
  } else if (field === 'quantity') {
    line.quantity = Number(event.target.value || 0);
  } else if (field === 'unitPrice') {
    line.unitPrice = Number(event.target.value || 0);
    line.priceTouched = true;
  }
  renderDOLines();
}

function handleDOLineClick(event) {
  const id = event.target.dataset.removeLine;
  if (!id) return;
  doDraftLines = doDraftLines.filter((line) => line.rowId !== id);
  if (!doDraftLines.length) addDOLine();
  else renderDOLines();
}

async function saveDeliveryOrder(event) {
  event.preventDefault();
  try {
    const date = $('#doDate').value;
    const fromSiteId = '';
    const toSiteId = $('#doToSite').value;
    if (!toSiteId) throw new Error('Choose the delivery address.');
    if (!doDraftLines.length) throw new Error('Add at least one material.');

    const lines = doDraftLines.map((draft) => {
      const item = data.items?.[draft.itemId];
      if (!item) throw new Error('Choose a material for every line.');
      if (Number(draft.quantity) <= 0) throw new Error(`Enter a quantity for ${item.name}.`);
      if (Number(draft.unitPrice) < 0) throw new Error(`Enter a valid price for ${item.name}.`);
      return {
        itemId: draft.itemId,
        sku: item.sku || '',
        itemName: item.name,
        unit: item.unit,
        quantity: Number(draft.quantity),
        unitPrice: Number(draft.unitPrice),
      };
    });
    const calculated = calculateDOLines(lines);
    const timestamp = new Date().toISOString();
    const doId = uid('do');
    const doNumber = generateDONumber(data.deliveryOrders, date, data.settings?.doPrefix || 'DO');
    const updates = {
      [`deliveryOrders/${doId}`]: {
        doNumber,
        date,
        fromSiteId,
        toSiteId,
        reference: $('#doReference').value.trim(),
        notes: $('#doNotes').value.trim(),
        lines: calculated.lines,
        materialCost: calculated.materialCost,
        status: 'issued',
        createdAt: timestamp,
        createdBy: currentUserLabel(),
      },
    };

    calculated.lines.forEach((line) => {
      const txId = uid('tx');
      updates[`stockTransactions/${txId}`] = {
        date,
        type: 'stock_in',
        movementKind: 'delivery_to_site',
        itemId: line.itemId,
        quantity: line.quantity,
        fromSiteId,
        toSiteId,
        doId,
        doNumber,
        notes: `Delivery ${doNumber}`,
        createdAt: timestamp,
        createdBy: currentUserLabel(),
      };
      const current = resolvePrice(data.prices, line.itemId, date, toSiteId);
      if (!current || Math.abs(Number(current.unitPrice) - Number(line.unitPrice)) > 0.0001) {
        const priceId = uid('price');
        updates[`prices/${priceId}`] = {
          itemId: line.itemId,
          siteId: toSiteId,
          effectiveDate: date,
          unitPrice: line.unitPrice,
          supplier: '',
          notes: `Saved from ${doNumber}`,
          createdAt: timestamp,
          createdBy: currentUserLabel(),
        };
      }
    });

    await store.updateMany(updates);
    calendarSelectedDate = date;
    calendarMonth = `${date.slice(0, 7)}-01`;
    closeDialog('doDialog');
    showToast(`${doNumber} delivery saved.`);
  } catch (error) {
    showToast(error.message || 'Unable to save delivery.', true);
  }
}

function openReturnDialog(siteId = '', selectedDate = '') {
  if (!requireReady(['sites', 'items'])) return;
  if (!worksites().length || !warehouses().length) { switchView('master'); return showToast('Add at least one worksite and one store first.', true); }
  $('#returnForm').reset();
  $('#returnDate').value = selectedDate || calendarSelectedDate || todayISO();
  $('#returnFromSite').innerHTML = siteOptions(siteId, { worksiteOnly: true });
  $('#returnToSite').innerHTML = siteOptions('', { warehouseOnly: true });
  $('#returnItem').innerHTML = itemOptions();
  $('#returnFromSite').value = siteId || worksites()[0]?.id || '';
  $('#returnToSite').value = warehouses()[0]?.id || '';
  $('#returnQuantity').value = 1;
  $('#returnDialog').showModal();
}

async function saveStockReturn(event) {
  event.preventDefault();
  try {
    const date = $('#returnDate').value;
    const fromSiteId = $('#returnFromSite').value;
    const toSiteId = $('#returnToSite').value;
    const itemId = $('#returnItem').value;
    const quantity = Number($('#returnQuantity').value);
    if (!fromSiteId || !toSiteId || !itemId) throw new Error('Choose the address, store and material.');
    if (quantity <= 0) throw new Error('Return quantity must be above zero.');
    await store.save('stockTransactions', uid('tx'), {
      date,
      type: 'transfer',
      movementKind: 'site_return',
      itemId,
      quantity,
      fromSiteId,
      toSiteId,
      notes: $('#returnNotes').value.trim(),
      createdAt: new Date().toISOString(),
      createdBy: currentUserLabel(),
    });
    calendarSelectedDate = date;
    calendarMonth = `${date.slice(0, 7)}-01`;
    closeDialog('returnDialog');
    showToast('Stock return saved. More can be returned later.');
  } catch (error) {
    showToast(error.message || 'Unable to save stock return.', true);
  }
}

function openEquipmentDialog(siteId = '', selectedDate = '', action = 'borrow', category = 'ladder', equipmentType = '') {
  if (!requireReady(['sites'])) return;
  if (!worksites().length) { switchView('master'); return showToast('Add a worksite address first.', true); }
  $('#equipmentForm').reset();
  $('#equipmentDate').value = selectedDate || calendarSelectedDate || todayISO();
  $('#equipmentSite').innerHTML = siteOptions(siteId, { worksiteOnly: true });
  $('#equipmentSite').value = siteId || worksites()[0]?.id || '';
  $('#equipmentAction').value = action;
  $('#equipmentCategory').value = category || 'ladder';
  $('#equipmentType').value = equipmentType || '';
  $('#equipmentQuantity').value = 1;
  updateEquipmentAvailability();
  $('#equipmentDialog').showModal();
}

function updateEquipmentAvailability() {
  const isReturn = $('#equipmentAction').value === 'return';
  $('#equipmentDialogTitle').textContent = isReturn ? 'Return Equipment' : 'Borrow Equipment';
  const notice = $('#equipmentAvailableNotice');
  if (!isReturn) {
    notice.classList.add('hidden');
    return;
  }
  const siteId = $('#equipmentSite').value;
  const category = $('#equipmentCategory').value;
  const type = $('#equipmentType').value.trim().toLowerCase();
  const row = equipmentOutstanding(data.equipmentTransactions, siteId).find((item) => item.category === category && item.equipmentType.toLowerCase() === type);
  notice.classList.remove('hidden');
  notice.textContent = row ? `${number(row.outstanding)} ${row.equipmentType} is still at this address. Return some now and the rest later.` : 'No matching equipment is currently outstanding at this address.';
}

async function saveEquipmentTransaction(event) {
  event.preventDefault();
  try {
    const action = $('#equipmentAction').value;
    const siteId = $('#equipmentSite').value;
    const category = $('#equipmentCategory').value;
    const equipmentType = $('#equipmentType').value.trim();
    const quantity = Number($('#equipmentQuantity').value);
    if (!siteId || !equipmentType) throw new Error('Choose an address and enter the equipment type.');
    if (quantity <= 0) throw new Error('Quantity must be above zero.');
    if (action === 'return') {
      const row = equipmentOutstanding(data.equipmentTransactions, siteId).find((item) => item.category === category && item.equipmentType.toLowerCase() === equipmentType.toLowerCase());
      const available = Number(row?.outstanding || 0);
      if (quantity > available) throw new Error(`Only ${number(available)} ${equipmentType} is still at this address.`);
    }
    const date = $('#equipmentDate').value;
    await store.save('equipmentTransactions', uid('equipment'), {
      date,
      action,
      siteId,
      category,
      equipmentType,
      quantity,
      notes: $('#equipmentNotes').value.trim(),
      createdAt: new Date().toISOString(),
      createdBy: currentUserLabel(),
    });
    calendarSelectedDate = date;
    calendarMonth = `${date.slice(0, 7)}-01`;
    closeDialog('equipmentDialog');
    showToast(action === 'return' ? 'Equipment return saved. Remaining balance stays open.' : 'Equipment borrowed to site.');
  } catch (error) {
    showToast(error.message || 'Unable to save equipment.', true);
  }
}

function renderMaster() {
  const sites = activeSites();
  const items = activeItems();
  $('#masterView').innerHTML = `
    <div class="master-grid">
      <div class="card">
        <div class="section-heading"><div><h2>Addresses</h2><p>Add worksites and at least one store.</p></div><button class="button primary" data-action="new-site">+ Address</button></div>
        ${sites.length ? `<div class="table-wrap"><table><thead><tr><th>Name / Address</th><th>Type</th><th>Status</th><th></th></tr></thead><tbody>${sites.map((site) => `<tr><td><strong>${escapeHtml(siteDisplay(site))}</strong>${site.name && site.address ? `<p>${escapeHtml(site.name)}</p>` : ''}${site.pic ? `<p>PIC: ${escapeHtml(site.pic)}</p>` : ''}</td><td>${site.type === 'warehouse' ? 'Store' : 'Worksite'}</td><td>${site.type === 'warehouse' ? '<span class="badge info">Store</span>' : statusBadge(site.status || (site.closed ? 'completed' : 'active'))}</td><td><button class="button secondary small" data-action="edit-site" data-id="${site.id}">Edit</button></td></tr>`).join('')}</tbody></table></div>` : emptyState('No addresses', 'Add the store and first worksite address.')}
      </div>
      <div class="card">
        <div class="section-heading"><div><h2>Materials</h2><p>Used for delivery and stock-return entries.</p></div><button class="button primary" data-action="new-item">+ Material</button></div>
        ${items.length ? `<div class="table-wrap"><table><thead><tr><th>Material</th><th>Unit</th><th>SKU</th><th></th></tr></thead><tbody>${items.map((item) => `<tr><td><strong>${escapeHtml(item.name)}</strong></td><td>${escapeHtml(item.unit || '')}</td><td>${escapeHtml(item.sku || '—')}</td><td><button class="button secondary small" data-action="edit-item" data-id="${item.id}">Edit</button></td></tr>`).join('')}</tbody></table></div>` : emptyState('No materials', 'Add the first material used for deliveries.')}
      </div>
    </div>`;
}

function openSiteDialog(id = '') {
  const record = id ? data.sites?.[id] : null;
  $('#siteForm').reset();
  $('#siteId').value = id;
  $('#siteDialogTitle').textContent = record ? 'Edit Address' : 'Add Address';
  $('#siteName').value = record?.name || '';
  $('#siteType').value = record?.type || 'worksite';
  $('#siteAddress').value = record?.address || '';
  $('#sitePic').value = record?.pic || '';
  $('#siteStatus').value = record?.status || (record?.closed ? 'completed' : 'active');
  $('#siteDialog').showModal();
}

async function saveSite(event) {
  event.preventDefault();
  try {
    const id = $('#siteId').value || uid('site');
    const existing = data.sites?.[id];
    const status = $('#siteStatus').value;
    await store.save('sites', id, {
      ...(existing || {}),
      name: $('#siteName').value.trim(),
      type: $('#siteType').value,
      address: $('#siteAddress').value.trim(),
      pic: $('#sitePic').value.trim(),
      status,
      closed: status === 'completed',
      active: true,
      createdAt: existing?.createdAt || new Date().toISOString(),
      createdBy: existing?.createdBy || currentUserLabel(),
      updatedAt: new Date().toISOString(),
      updatedBy: currentUserLabel(),
    });
    closeDialog('siteDialog');
    showToast(existing ? 'Address updated.' : 'Address saved.');
  } catch (error) {
    showToast(error.message || 'Unable to save address.', true);
  }
}

function openItemDialog(id = '') {
  const record = id ? data.items?.[id] : null;
  $('#itemForm').reset();
  $('#itemId').value = id;
  $('#itemDialogTitle').textContent = record ? 'Edit Material' : 'Add Material';
  $('#itemName').value = record?.name || '';
  $('#itemUnit').value = record?.unit || '';
  $('#itemSku').value = record?.sku || '';
  $('#itemLowStock').value = Number(record?.lowStock || 0);
  $('#itemDialog').showModal();
}

async function saveItem(event) {
  event.preventDefault();
  try {
    const id = $('#itemId').value || uid('item');
    const existing = data.items?.[id];
    await store.save('items', id, {
      ...(existing || {}),
      name: $('#itemName').value.trim(),
      unit: $('#itemUnit').value.trim(),
      sku: $('#itemSku').value.trim(),
      lowStock: Number($('#itemLowStock').value || 0),
      active: true,
      createdAt: existing?.createdAt || new Date().toISOString(),
      createdBy: existing?.createdBy || currentUserLabel(),
      updatedAt: new Date().toISOString(),
      updatedBy: currentUserLabel(),
    });
    closeDialog('itemDialog');
    showToast(existing ? 'Material updated.' : 'Material saved.');
  } catch (error) {
    showToast(error.message || 'Unable to save material.', true);
  }
}

function renderSettings() {
  $('#settingsView').innerHTML = `
    <div class="settings-grid">
      <form id="settingsForm" class="card">
        <div class="section-heading"><div><h2>Company settings</h2><p>Used for the app name and money display.</p></div></div>
        <div class="form-grid two">
          <label>Company / app name<input name="companyName" value="${escapeHtml(data.settings?.companyName || 'KG Shift Site Calendar')}" required /></label>
          <label>Currency<select name="currency"><option value="SGD" ${(data.settings?.currency || 'SGD') === 'SGD' ? 'selected' : ''}>SGD</option><option value="MYR" ${data.settings?.currency === 'MYR' ? 'selected' : ''}>MYR</option></select></label>
          <label>DO prefix<input name="doPrefix" value="${escapeHtml(data.settings?.doPrefix || 'DO')}" /></label>
          <label>Company address<input name="companyAddress" value="${escapeHtml(data.settings?.companyAddress || '')}" /></label>
        </div>
        <div class="modal-actions"><button class="button primary" type="submit">Save settings</button></div>
      </form>
      <div class="card">
        <div class="section-heading"><div><h2>Backup and restore</h2><p>Download all addresses, calendar entries, deliveries, returns and equipment as one JSON file.</p></div></div>
        <div class="actions"><button class="button primary" data-action="export-backup">Export backup</button><button class="button secondary" data-action="import-backup">Import backup</button></div>
        <div class="notice"><strong>Simple version:</strong> No Google Calendar, Edge Function, service account or Cron is used. All records are stored in Supabase.</div>
      </div>
    </div>`;
  $('#settingsForm').addEventListener('submit', saveSettings);
}

async function saveSettings(event) {
  event.preventDefault();
  const form = new FormData(event.target);
  try {
    const timestamp = new Date().toISOString();
    await store.updateMany({
      'settings/companyName': String(form.get('companyName') || '').trim(),
      'settings/currency': String(form.get('currency') || 'SGD'),
      'settings/doPrefix': String(form.get('doPrefix') || 'DO').trim().toUpperCase(),
      'settings/companyAddress': String(form.get('companyAddress') || '').trim(),
      'settings/updatedAt': timestamp,
      'settings/updatedBy': currentUserLabel(),
    });
    showToast('Settings saved.');
  } catch (error) {
    showToast(error.message || 'Unable to save settings.', true);
  }
}

function exportBackup() {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const link = document.createElement('a');
  link.href = URL.createObjectURL(blob);
  link.download = `kg-site-calendar-backup-${todayISO()}.json`;
  link.click();
  URL.revokeObjectURL(link.href);
  showToast('Backup downloaded.');
}

async function importBackup(event) {
  const file = event.target.files?.[0];
  event.target.value = '';
  if (!file) return;
  if (!confirm('Importing replaces all current Supabase app records. Continue?')) return;
  try {
    const parsed = JSON.parse(await file.text());
    await store.replaceAll(parsed);
    showToast('Backup imported.');
  } catch (error) {
    showToast(error.message || 'Backup import failed.', true);
  }
}

function handleDynamicClick(event) {
  const viewLink = event.target.closest('[data-view-link]');
  if (viewLink) return switchView(viewLink.dataset.viewLink);
  const button = event.target.closest('[data-action]');
  if (!button) return;
  const action = button.dataset.action;
  const id = button.dataset.id || '';
  const siteId = button.dataset.site || '';
  const date = button.dataset.date || calendarSelectedDate;
  const handlers = {
    'calendar-prev': () => { calendarMonth = shiftMonth(calendarMonth, -1); calendarSelectedDate = calendarMonth; renderCalendar(); },
    'calendar-next': () => { calendarMonth = shiftMonth(calendarMonth, 1); calendarSelectedDate = calendarMonth; renderCalendar(); },
    'calendar-today': () => { calendarSelectedDate = todayISO(); calendarMonth = `${calendarSelectedDate.slice(0, 7)}-01`; renderCalendar(); },
    'select-calendar-day': () => { calendarSelectedDate = date; calendarMonth = `${date.slice(0, 7)}-01`; renderCalendar(); },
    'new-entry': () => openEntryDialog('', date, siteId),
    'edit-entry': () => openEntryDialog(id),
    'delivery-site': () => openDODialog(siteId, date),
    'return-site': () => openReturnDialog(siteId, date),
    'equipment-site': () => openEquipmentDialog(siteId, date, button.dataset.equipmentAction || 'borrow', button.dataset.category || 'ladder', button.dataset.type || ''),
    'new-site': () => openSiteDialog(),
    'edit-site': () => openSiteDialog(id),
    'new-item': () => openItemDialog(),
    'edit-item': () => openItemDialog(id),
    'export-backup': exportBackup,
    'import-backup': () => $('#importFile').click(),
  };
  handlers[action]?.();
}

function requireReady(collections = []) {
  if (store?.mode !== 'supabase') {
    showToast('Set up Supabase first.', true);
    return false;
  }
  if (!store.getUser()) {
    showToast('Sign in first.', true);
    return false;
  }
  for (const collection of collections) {
    const count = collection === 'sites' ? activeSites().length : collection === 'items' ? activeItems().length : asArray(data[collection]).length;
    if (!count) {
      showToast(collection === 'sites' ? 'Add an address first.' : 'Add a material first.', true);
      switchView('master');
      return false;
    }
  }
  return true;
}

function emptyState(title, detail) {
  return `<div class="empty-state"><strong>${escapeHtml(title)}</strong><p>${escapeHtml(detail)}</p></div>`;
}

function closeDialog(id) {
  const dialog = document.getElementById(id);
  if (dialog?.open) dialog.close();
}

function showToast(message, error = false) {
  const toast = $('#toast');
  window.clearTimeout(toastTimer);
  toast.textContent = message;
  toast.classList.toggle('error', error);
  toast.classList.add('show');
  toastTimer = window.setTimeout(() => toast.classList.remove('show'), 3500);
}

init().catch((error) => {
  console.error(error);
  showToast(error.message || 'The app could not start.', true);
});
