import { createStore, uid } from './data-store.js';
import {
  asArray,
  calculateDOLines,
  calculateStockBalances,
  dateInRange,
  escapeHtml,
  firstDayOfMonthISO,
  generateDONumber,
  labelForItem,
  labelForSite,
  manpowerCost,
  money,
  number,
  resolvePrice,
  summarize,
  summarizeJob,
  latestIssuedDOForJob,
  normalizeTemplateLines,
  todayISO,
} from './core.js';
import { googleCalendarConfig } from './calendar-config.js';
import { displaySchedule, normalizeKey } from './calendar-core.js';

const VIEW_META = {
  dashboard: ['Dashboard', 'Live overview of stock, delivery orders and costs.'],
  jobs: ['Site Work', 'Save repeated work by site, then pause, resume and reuse it anytime.'],
  deliveryOrders: ['Delivery Orders', 'Create, print and share site delivery orders.'],
  stock: ['Stock', 'See current quantity at every warehouse and work site.'],
  prices: ['Price History', 'Keep dated prices so every DO uses the correct historical cost.'],
  manpower: ['Manpower', 'Record workers, hours and labour rates by site and date.'],
  master: ['Sites & Items', 'Maintain locations, stock items, units and warning levels.'],
  settings: ['Settings & Backup', 'Company settings, JSON export and restore.'],
};

let store;
let unsubscribeData = null;
let data = emptyData();
let currentView = 'dashboard';
let doDraftLines = [];
let jobDraftLines = [];
let jobStatusFilter = 'open';
let jobSiteFilter = '';
let jobSearch = '';
let priceSiteFilter = '';
let calendarSyncInProgress = false;
let dashboardFilters = { startDate: firstDayOfMonthISO(), endDate: todayISO(), siteId: '' };
let stockSiteFilter = '';
let doFilters = { startDate: firstDayOfMonthISO(), endDate: todayISO(), siteId: '' };
let toastTimer;

const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];

function emptyData() {
  return {
    settings: {}, sites: {}, items: {}, prices: {}, stockTransactions: {}, deliveryOrders: {}, manpower: {}, jobs: {}, jobActivities: {}, calendarSync: {},
  };
}

async function init() {
  bindStaticEvents();
  store = await createStore();
  updateStorageUI();

  if (store.mode === 'supabase' && store.getUser() && !store.isAllowed(store.getUser())) {
    await store.signOut();
    showToast('This signed-in Google account is not permitted.', true);
  }

  if (store.mode === 'setup') {
    data = emptyData();
    renderAll();
    showToast('Supabase configuration is required. This version has no demo database.', true);
  } else if (store.getUser()) connectData();
  else {
    data = emptyData();
    renderAll();
  }

  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('./sw.js').catch(() => {});
  }
}

function bindStaticEvents() {
  $$('.nav-button').forEach((button) => button.addEventListener('click', () => switchView(button.dataset.view)));
  $('#quickDOButton').addEventListener('click', () => openDODialog());
  $('#quickStockButton').addEventListener('click', openStockDialog);
  $('#authButton').addEventListener('click', handleAuth);

  $$('[data-close]').forEach((button) => button.addEventListener('click', () => closeDialog(button.dataset.close)));
  $('#addDOLineButton').addEventListener('click', () => {
    const firstItem = activeItems()[0];
    doDraftLines.push({ rowId: uid('line'), itemId: firstItem?.id || '', quantity: 1 });
    renderDOLines();
  });
  $('#doDate').addEventListener('change', renderDOLines);
  $('#doJob').addEventListener('change', () => applyJobToDO($('#doJob').value));
  $('#doToSite').addEventListener('change', () => { refreshDOJobOptions(); renderDOLines(); });
  $('#useLastDOButton').addEventListener('click', useLastDOItems);
  $('#doLinesBody').addEventListener('change', handleDOLineInput);
  $('#doLinesBody').addEventListener('click', handleDOLineClick);
  $('#doForm').addEventListener('submit', saveDeliveryOrder);

  $('#stockType').addEventListener('change', updateStockFormVisibility);
  $('#stockForm').addEventListener('submit', saveStockEntry);
  $('#priceForm').addEventListener('submit', savePrice);
  $('#manpowerForm').addEventListener('submit', saveManpower);
  $('#manpowerJob').addEventListener('change', () => applyJobToManpower($('#manpowerJob').value));
  ['#manpowerWorkers', '#manpowerHours', '#manpowerRate'].forEach((selector) => $(selector).addEventListener('input', updateManpowerCalculation));
  $('#jobForm').addEventListener('submit', saveJob);
  $('#addJobLineButton').addEventListener('click', () => {
    jobDraftLines.push({ rowId: uid('jobline'), itemId: activeItems()[0]?.id || '', quantity: 1 });
    renderJobLines();
  });
  $('#jobLinesBody').addEventListener('change', handleJobLineInput);
  $('#jobLinesBody').addEventListener('click', handleJobLineClick);
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
    (error) => showToast(error.message || 'Unable to read database.', true),
  );
}

async function handleAuth() {
  try {
    if (store.mode === 'setup') {
      showToast('Complete supabase-config.js and run the Supabase setup SQL first.', true);
      return;
    }
    if (store.getUser()) {
      await store.signOut();
      unsubscribeData?.();
      data = emptyData();
      updateStorageUI();
      renderAll();
      showToast('Signed out.');
    } else {
      await store.signIn();
      updateStorageUI();
      connectData();
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
  $('#quickDOButton').classList.toggle('hidden', view === 'settings');
  $('#quickStockButton').classList.toggle('hidden', view === 'settings');
}

function renderAll() {
  updateStorageUI();
  const companyName = data.settings?.companyName || 'KG Stock & Delivery Order';
  $('#brandName').textContent = companyName;
  document.title = companyName;
  renderDashboard();
  renderJobs();
  renderDeliveryOrders();
  renderStock();
  renderPrices();
  renderManpower();
  renderMaster();
  renderSettings();
  switchView(currentView);
}

function activeSites() {
  return asArray(data.sites).filter((row) => row.active !== false).sort((a, b) => a.name.localeCompare(b.name));
}

function activeItems() {
  return asArray(data.items).filter((row) => row.active !== false).sort((a, b) => a.name.localeCompare(b.name));
}

function siteOptions(selected = '', includeAll = false) {
  const first = includeAll ? '<option value="">All sites</option>' : '<option value="">Choose location</option>';
  return first + activeSites().map((site) => `<option value="${site.id}" ${site.id === selected ? 'selected' : ''}>${escapeHtml(site.name)}</option>`).join('');
}

function itemOptions(selected = '') {
  return '<option value="">Choose item</option>' + activeItems().map((item) => `<option value="${item.id}" ${item.id === selected ? 'selected' : ''}>${escapeHtml(item.sku ? `${item.sku} · ${item.name}` : item.name)}</option>`).join('');
}

function renderDashboard() {
  const summary = summarize(data, dashboardFilters);
  const balances = calculateStockBalances(data.stockTransactions, dashboardFilters.endDate);
  const lowRows = getLowStockRows(balances, dashboardFilters.siteId);
  const currency = data.settings?.currency || 'SGD';

  $('#dashboardView').innerHTML = `
    <div class="toolbar">
      <div class="toolbar-group">
        <label>From<input id="dashboardStart" type="date" value="${dashboardFilters.startDate}"></label>
        <label>To<input id="dashboardEnd" type="date" value="${dashboardFilters.endDate}"></label>
        <label>Site<select id="dashboardSite">${siteOptions(dashboardFilters.siteId, true)}</select></label>
      </div>
      <button class="button secondary" data-action="export-summary">Print summary</button>
    </div>
    <div class="cards">
      ${metricCard('Delivery orders', number(summary.deliveryOrderCount, 0), 'Issued during selected dates')}
      ${metricCard('Material cost', money(summary.materialCost, currency), 'Price snapshots from delivery orders')}
      ${metricCard('Manpower cost', money(summary.manpowerCost, currency), 'Workers × hours × hourly rate')}
      ${metricCard('Combined cost', money(summary.totalCost, currency), 'Material plus manpower')}
    </div>
    <div class="section-grid">
      <div class="card">
        <div class="section-heading"><div><h2>Recent delivery orders</h2><p>Latest DOs inside the selected period.</p></div><button class="link-button" data-view-link="deliveryOrders">View all</button></div>
        ${renderRecentDOs(summary.deliveryOrders.slice().sort(sortByDateDesc).slice(0, 8), currency)}
      </div>
      <div class="card">
        <div class="section-heading"><div><h2>Low-stock warnings</h2><p>Balance is at or below the item's warning level.</p></div><button class="link-button" data-view-link="stock">View stock</button></div>
        ${lowRows.length ? `<div class="list">${lowRows.slice(0, 10).map((row) => `
          <div class="list-row"><div><strong>${escapeHtml(row.itemName)}</strong><p>${escapeHtml(row.siteName)} · warning at ${number(row.lowStock)}</p></div><span class="low-stock">${number(row.balance)} ${escapeHtml(row.unit)}</span></div>
        `).join('')}</div>` : emptyState('No low-stock warning', 'Current balances are above warning levels.')}
      </div>
    </div>`;

  $('#dashboardStart').addEventListener('change', (event) => { dashboardFilters.startDate = event.target.value; renderDashboard(); });
  $('#dashboardEnd').addEventListener('change', (event) => { dashboardFilters.endDate = event.target.value; renderDashboard(); });
  $('#dashboardSite').addEventListener('change', (event) => { dashboardFilters.siteId = event.target.value; renderDashboard(); });
}

function metricCard(label, value, note) {
  return `<div class="card metric-card"><div class="metric-label">${escapeHtml(label)}</div><div class="metric-value">${escapeHtml(value)}</div><div class="metric-note">${escapeHtml(note)}</div></div>`;
}

function renderRecentDOs(rows, currency) {
  if (!rows.length) return emptyState('No delivery orders', 'Create a DO to begin tracking material cost.');
  return `<div class="table-wrap"><table><thead><tr><th>Date</th><th>DO</th><th>Deliver to</th><th>Material cost</th></tr></thead><tbody>${rows.map((row) => `
    <tr><td>${escapeHtml(row.date)}</td><td><button class="link-button" data-action="print-do" data-id="${row.id}">${escapeHtml(row.doNumber)}</button></td><td>${escapeHtml(labelForSite(data.sites, row.toSiteId))}</td><td class="strong">${money(row.materialCost, currency)}</td></tr>
  `).join('')}</tbody></table></div>`;
}

function jobOptions(selected = '', siteId = '') {
  const jobs = asArray(data.jobs)
    .filter((job) => job.calendarStatus !== 'cancelled')
    .filter((job) => !siteId || job.siteId === siteId)
    .sort((a, b) => String(b.startDate || '').localeCompare(String(a.startDate || '')) || String(a.name || '').localeCompare(String(b.name || '')));
  return '<option value="">No saved work selected</option>' + jobs.map((job) => {
    const site = labelForSite(data.sites, job.siteId);
    return `<option value="${job.id}" ${job.id === selected ? 'selected' : ''}>${escapeHtml(`${job.name} · ${site}`)}</option>`;
  }).join('');
}

function refreshDOJobOptions(preferredJobId = '') {
  const select = $('#doJob');
  if (!select) return;
  const selected = preferredJobId || select.value || '';
  select.innerHTML = jobOptions(selected, $('#doToSite')?.value || '');
  if (selected && [...select.options].some((option) => option.value === selected)) select.value = selected;
}

function jobStatusBadge(status = 'active') {
  const meta = {
    active: ['Active', 'success'],
    paused: ['Paused', 'warning'],
    completed: ['Completed', 'info'],
  }[status] || [status || 'Active', ''];
  return `<span class="badge ${meta[1]}">${escapeHtml(meta[0])}</span>`;
}

function renderJobs() {
  const currency = data.settings?.currency || 'SGD';
  const allJobs = asArray(data.jobs).sort((a, b) => String(b.startDate || '').localeCompare(String(a.startDate || '')) || String(b.createdAt || '').localeCompare(String(a.createdAt || '')));
  const jobs = allJobs
    .filter((job) => !jobSiteFilter || job.siteId === jobSiteFilter)
    .filter((job) => {
      if (!jobSearch.trim()) return true;
      const haystack = [job.name, job.address, job.pic, job.description, labelForSite(data.sites, job.siteId)]
        .join(' ')
        .toLowerCase();
      return haystack.includes(jobSearch.trim().toLowerCase());
    })
    .filter((job) => {
      if (jobStatusFilter === 'all') return true;
      if (jobStatusFilter === 'open') return job.status !== 'completed' && job.calendarStatus !== 'cancelled';
      if (jobStatusFilter === 'cancelled') return job.calendarStatus === 'cancelled';
      return job.status === jobStatusFilter;
    });
  const sync = data.calendarSync || {};
  const syncStatus = sync.status === 'error'
    ? `Sync error: ${sync.lastError || 'Check Edge Function logs'}`
    : `Background sync scheduled every ${Math.round(googleCalendarConfig.syncEveryMs / 1000)} seconds`;
  const lastSync = sync.lastSyncAt ? new Date(sync.lastSyncAt).toLocaleString('en-SG') : 'Not synced yet';

  $('#jobsView').innerHTML = `
    <div class="toolbar">
      <div class="toolbar-group">
        <label>Status<select id="jobStatusFilter">
          <option value="open" ${jobStatusFilter === 'open' ? 'selected' : ''}>Active + paused</option>
          <option value="active" ${jobStatusFilter === 'active' ? 'selected' : ''}>Active only</option>
          <option value="paused" ${jobStatusFilter === 'paused' ? 'selected' : ''}>Paused only</option>
          <option value="completed" ${jobStatusFilter === 'completed' ? 'selected' : ''}>Completed</option>
          <option value="cancelled" ${jobStatusFilter === 'cancelled' ? 'selected' : ''}>Calendar cancelled</option>
          <option value="all" ${jobStatusFilter === 'all' ? 'selected' : ''}>All work</option>
        </select></label>
        <label>Work site<select id="jobSiteFilter">${siteOptions(jobSiteFilter, true)}</select></label>
        <label>Find work<input id="jobSearch" type="search" value="${escapeHtml(jobSearch)}" placeholder="Type, then press Enter"></label>
      </div>
      <div class="actions">
        <button class="button secondary" data-action="sync-calendar">Sync now</button>
        <button class="button primary" data-action="copy-whole-calendar">Copy whole calendar</button>
        <button class="button primary" data-action="new-job">+ Manual site work</button>
      </div>
    </div>
    <div class="notice calendar-notice">
      <strong>Google Calendar:</strong> ${escapeHtml(syncStatus)} · Full-history import has no starting-date limit. Calendar ID ending ${escapeHtml(googleCalendarConfig.calendarId.slice(-28))}. Last sync: ${escapeHtml(lastSync)}.
      Supabase Cron runs the one-minute pull even when this website is closed. Imported start/end dates and the complete event snapshot are kept in Supabase.
    </div>
    <div class="card" style="margin-top:16px">
      <div class="section-heading"><div><h2>Site work register</h2><p>Pause, resume, reuse materials and continue the same worksite without losing previous dates.</p></div><span class="badge info">${jobs.length} shown</span></div>
      ${jobs.length ? `<div class="table-wrap"><table><thead><tr><th>Dates</th><th>Work / Address</th><th>PIC</th><th>Status</th><th>DO / Cost</th><th>Source</th><th>Actions</th></tr></thead><tbody>${jobs.map((job) => {
        const summary = summarizeJob(data, job.id);
        const site = data.sites?.[job.siteId];
        const address = job.address || site?.address || site?.name || '—';
        const pic = job.pic || site?.pic || '—';
        const source = job.source === 'google_calendar'
          ? `<span class="badge info">Calendar</span>${job.calendarStatus === 'cancelled' ? ' <span class="badge danger">Cancelled</span>' : ''}`
          : '<span class="badge">Manual</span>';
        const nextStatusAction = job.status === 'paused' ? 'resume-job' : 'pause-job';
        const nextStatusLabel = job.status === 'paused' ? 'Resume' : 'Pause';
        return `<tr>
          <td><strong>${escapeHtml(displaySchedule(job))}</strong>${job.source === 'google_calendar' && job.calendarHtmlLink ? `<p><a href="${escapeHtml(job.calendarHtmlLink)}" target="_blank" rel="noopener">Open calendar event</a></p>` : ''}</td>
          <td><strong>${escapeHtml(job.name || 'Untitled work')}</strong><p>${escapeHtml(address)}</p>${job.description ? `<p class="truncate">${escapeHtml(job.description)}</p>` : ''}</td>
          <td>${escapeHtml(pic)}</td>
          <td>${jobStatusBadge(job.status)}${summary.lastWorkedDate ? `<p>Last cost: ${escapeHtml(summary.lastWorkedDate)}</p>` : ''}</td>
          <td><strong>${summary.deliveryOrderCount} DO</strong><p>${money(summary.materialCost, currency)} material</p><p>${money(summary.manpowerCost, currency)} manpower</p></td>
          <td>${source}</td>
          <td><div class="actions">
            <button class="button primary small" data-action="job-do" data-id="${job.id}">New DO</button>
            <button class="button secondary small" data-action="job-manpower" data-id="${job.id}">Manpower</button>
            <button class="button secondary small" data-action="clone-job" data-id="${job.id}">Continue same work</button>
            <button class="button secondary small" data-action="edit-job" data-id="${job.id}">Edit</button>
            ${job.status !== 'completed' ? `<button class="button secondary small" data-action="${nextStatusAction}" data-id="${job.id}">${nextStatusLabel}</button><button class="button secondary small" data-action="complete-job" data-id="${job.id}">Complete</button>` : `<button class="button secondary small" data-action="resume-job" data-id="${job.id}">Reopen</button>`}
          </div></td>
        </tr>`;
      }).join('')}</tbody></table></div>` : emptyState('No site work found', 'Connect Google Calendar or add manual site work.')}
    </div>`;

  $('#jobStatusFilter').addEventListener('change', (event) => { jobStatusFilter = event.target.value; renderJobs(); });
  $('#jobSiteFilter').addEventListener('change', (event) => { jobSiteFilter = event.target.value; renderJobs(); });
  $('#jobSearch').addEventListener('change', (event) => { jobSearch = event.target.value; renderJobs(); });
}

async function syncGoogleCalendar(manual = false, forceFull = false) {
  if (calendarSyncInProgress) return;
  if (store.mode !== 'supabase' || !store.getUser()) {
    if (manual) showToast('Sign in to Supabase first.', true);
    return;
  }

  calendarSyncInProgress = true;
  renderJobs();
  try {
    const result = await store.invokeCalendarSync({ forceFull });
    if (result?.skipped) {
      showToast('A Calendar sync is already running.');
    } else {
      const prefix = forceFull || result?.fullSync ? 'Whole calendar copied' : 'Calendar changes synced';
      showToast(`${prefix}: ${Number(result?.importedJobs || 0)} new, ${Number(result?.updatedJobs || 0)} updated, ${Number(result?.cancelledEvents || 0)} cancelled.`);
    }
  } catch (error) {
    console.error(error);
    showToast(error.message || 'Calendar sync failed. Check the Supabase Edge Function setup.', true);
  } finally {
    calendarSyncInProgress = false;
    renderJobs();
  }
}

function openJobDialog(jobId = '', cloneFromId = '') {
  if (!requireReady(['sites'])) return;
  const existing = jobId ? data.jobs?.[jobId] : null;
  const source = cloneFromId ? data.jobs?.[cloneFromId] : existing;
  $('#jobForm').reset();
  $('#jobId').value = existing?.id || jobId || '';
  $('#jobForm').dataset.source = existing?.source || 'manual';
  $('#jobForm').dataset.continuedFromJobId = cloneFromId || existing?.continuedFromJobId || '';
  $('#jobDialogTitle').textContent = existing ? 'Edit Site Work' : cloneFromId ? 'Continue Same Work' : 'Add Site Work';
  $('#jobSite').innerHTML = siteOptions(source?.siteId || '');
  $('#jobFromSite').innerHTML = siteOptions(source?.fromSiteId || '');
  const warehouse = activeSites().find((site) => site.type === 'warehouse');
  if (!source?.fromSiteId && warehouse) $('#jobFromSite').value = warehouse.id;
  $('#jobName').value = source?.name || '';
  $('#jobStartDate').value = cloneFromId ? todayISO() : source?.startDate || todayISO();
  $('#jobEndDate').value = cloneFromId ? todayISO() : source?.endDate || source?.startDate || todayISO();
  $('#jobStartTime').value = cloneFromId ? '' : String(source?.startDateTime || '').slice(11, 16);
  $('#jobEndTime').value = cloneFromId ? '' : String(source?.endDateTime || '').slice(11, 16);
  $('#jobAddress').value = source?.address || data.sites?.[source?.siteId]?.address || '';
  $('#jobPic').value = source?.pic || data.sites?.[source?.siteId]?.pic || '';
  $('#jobStatus').value = cloneFromId ? 'active' : source?.status || 'active';
  $('#jobDescription').value = source?.description || '';
  $('#jobRole').value = source?.defaultManpower?.role || '';
  $('#jobWorkers').value = source?.defaultManpower?.workers ?? 1;
  $('#jobHours').value = source?.defaultManpower?.hoursPerWorker ?? 8;
  $('#jobRate').value = source?.defaultManpower?.ratePerHour ?? 0;
  $('#jobNotes').value = source?.workNotes || source?.notes || '';
  jobDraftLines = (source?.materialTemplate || []).map((line) => ({ rowId: uid('jobline'), itemId: line.itemId, quantity: line.quantity }));
  if (!jobDraftLines.length && activeItems()[0]) jobDraftLines.push({ rowId: uid('jobline'), itemId: activeItems()[0].id, quantity: 1 });
  renderJobLines();
  $('#jobDialog').showModal();
}

function renderJobLines() {
  $('#jobLinesBody').innerHTML = jobDraftLines.map((line) => {
    const item = data.items?.[line.itemId];
    return `<tr data-job-row-id="${line.rowId}"><td><select data-job-field="itemId">${itemOptions(line.itemId)}</select></td><td><input data-job-field="quantity" type="number" min="0.001" step="0.001" value="${escapeHtml(line.quantity)}"></td><td>${escapeHtml(item?.unit || '—')}</td><td><button type="button" class="icon-button" data-remove-job-line="${line.rowId}">×</button></td></tr>`;
  }).join('') || '<tr><td colspan="4" class="muted">No saved material. Add an item only when this work uses a repeated list.</td></tr>';
}

function handleJobLineInput(event) {
  const row = event.target.closest('tr[data-job-row-id]');
  const field = event.target.dataset.jobField;
  if (!row || !field) return;
  const draft = jobDraftLines.find((line) => line.rowId === row.dataset.jobRowId);
  if (!draft) return;
  draft[field] = field === 'quantity' ? Number(event.target.value) : event.target.value;
  renderJobLines();
}

function handleJobLineClick(event) {
  const id = event.target.dataset.removeJobLine;
  if (!id) return;
  jobDraftLines = jobDraftLines.filter((line) => line.rowId !== id);
  renderJobLines();
}

async function saveJob(event) {
  event.preventDefault();
  try {
    const id = $('#jobId').value || uid('job');
    const existing = data.jobs?.[id];
    const siteId = $('#jobSite').value;
    if (!siteId) throw new Error('Choose a work site.');
    const startDate = $('#jobStartDate').value;
    const endDate = $('#jobEndDate').value || startDate;
    if (endDate < startDate) throw new Error('End date cannot be before start date.');
    const startTime = $('#jobStartTime').value;
    const endTime = $('#jobEndTime').value;
    const timestamp = new Date().toISOString();
    const user = currentUserLabel();
    const address = $('#jobAddress').value.trim();
    const pic = $('#jobPic').value.trim();
    const status = $('#jobStatus').value;
    const record = {
      ...(existing || {}),
      name: $('#jobName').value.trim(),
      siteId,
      fromSiteId: $('#jobFromSite').value,
      status,
      address,
      addressKey: normalizeKey(address || labelForSite(data.sites, siteId)),
      pic,
      description: $('#jobDescription').value.trim(),
      startDate,
      endDate,
      startDateTime: startTime ? `${startDate}T${startTime}:00+08:00` : '',
      endDateTime: endTime ? `${endDate}T${endTime}:00+08:00` : '',
      allDay: !startTime,
      materialTemplate: normalizeTemplateLines(jobDraftLines),
      defaultManpower: {
        role: $('#jobRole').value.trim(),
        workers: Number($('#jobWorkers').value || 0),
        hoursPerWorker: Number($('#jobHours').value || 0),
        ratePerHour: Number($('#jobRate').value || 0),
      },
      workNotes: $('#jobNotes').value.trim(),
      source: existing?.source || $('#jobForm').dataset.source || 'manual',
      continuedFromJobId: $('#jobForm').dataset.continuedFromJobId || '',
      createdAt: existing?.createdAt || timestamp,
      createdBy: existing?.createdBy || user,
      updatedAt: timestamp,
      updatedBy: user,
    };
    const updates = { [`jobs/${id}`]: record };
    const site = data.sites?.[siteId];
    if (site && (address !== (site.address || '') || pic !== (site.pic || ''))) {
      updates[`sites/${siteId}`] = { ...site, address, pic, updatedAt: timestamp, updatedBy: user };
    }
    if (!existing || existing.status !== status) {
      const activityId = uid('activity');
      updates[`jobActivities/${activityId}`] = {
        jobId: id,
        type: existing ? status : 'created',
        date: todayISO(),
        dateTime: timestamp,
        notes: existing ? `Status changed to ${status}` : 'Site work created',
        createdBy: user,
      };
    }
    await store.updateMany(updates);
    closeDialog('jobDialog');
    showToast(existing ? 'Site work updated.' : 'Site work saved.');
  } catch (error) {
    showToast(error.message || 'Unable to save site work.', true);
  }
}

async function changeJobStatus(id, status) {
  const job = data.jobs?.[id];
  if (!job) return;
  try {
    const timestamp = new Date().toISOString();
    const user = currentUserLabel();
    const activityId = uid('activity');
    await store.updateMany({
      [`jobs/${id}`]: { ...job, status, updatedAt: timestamp, updatedBy: user },
      [`jobActivities/${activityId}`]: {
        jobId: id,
        type: status,
        date: todayISO(),
        dateTime: timestamp,
        notes: `Work ${status}`,
        createdBy: user,
      },
    });
    showToast(`Work marked ${status}.`);
  } catch (error) {
    showToast(error.message || 'Unable to change work status.', true);
  }
}

function applyJobToDO(jobId) {
  const job = data.jobs?.[jobId];
  if (!job) return;
  if (job.fromSiteId) $('#doFromSite').value = job.fromSiteId;
  if (job.siteId) $('#doToSite').value = job.siteId;
  refreshDOJobOptions(jobId);
  $('#doJob').value = jobId;
  $('#doReference').value = job.name || '';
  $('#doNotes').value = [job.pic ? `PIC: ${job.pic}` : '', job.address ? `Address: ${job.address}` : '', job.workNotes || ''].filter(Boolean).join(' · ');
  if (job.materialTemplate?.length) {
    doDraftLines = job.materialTemplate.map((line) => ({ rowId: uid('line'), itemId: line.itemId, quantity: line.quantity }));
  }
  renderDOLines();
}

function useLastDOItems() {
  const jobId = $('#doJob').value;
  let record = jobId ? latestIssuedDOForJob(data.deliveryOrders, jobId) : null;
  if (!record) {
    const toSiteId = $('#doToSite').value;
    record = asArray(data.deliveryOrders)
      .filter((row) => row.status !== 'cancelled' && (!toSiteId || row.toSiteId === toSiteId))
      .sort(sortByDateDesc)[0] || null;
  }
  if (!record) return showToast('No previous DO was found for this worksite.', true);
  doDraftLines = (record.lines || []).map((line) => ({ rowId: uid('line'), itemId: line.itemId, quantity: line.quantity }));
  renderDOLines();
  showToast(`Reused items from ${record.doNumber}.`);
}

function applyJobToManpower(jobId) {
  const job = data.jobs?.[jobId];
  if (!job) return;
  $('#manpowerJob').value = jobId;
  $('#manpowerSite').value = job.siteId || '';
  $('#manpowerRole').value = job.defaultManpower?.role || job.name || '';
  $('#manpowerWorkers').value = job.defaultManpower?.workers ?? 1;
  $('#manpowerHours').value = job.defaultManpower?.hoursPerWorker ?? 8;
  $('#manpowerRate').value = job.defaultManpower?.ratePerHour ?? 0;
  $('#manpowerNotes').value = job.workNotes || '';
  updateManpowerCalculation();
}


function renderDeliveryOrders() {
  const currency = data.settings?.currency || 'SGD';
  const rows = asArray(data.deliveryOrders)
    .filter((row) => dateInRange(row.date, doFilters.startDate, doFilters.endDate))
    .filter((row) => !doFilters.siteId || row.toSiteId === doFilters.siteId || row.fromSiteId === doFilters.siteId)
    .sort(sortByDateDesc);

  $('#deliveryOrdersView').innerHTML = `
    <div class="toolbar">
      <div class="toolbar-group">
        <label>From<input id="doFilterStart" type="date" value="${doFilters.startDate}"></label>
        <label>To<input id="doFilterEnd" type="date" value="${doFilters.endDate}"></label>
        <label>Site<select id="doFilterSite">${siteOptions(doFilters.siteId, true)}</select></label>
      </div>
      <button class="button primary" data-action="new-do">+ New delivery order</button>
    </div>
    <div class="card">
      <div class="section-heading"><div><h2>Delivery order register</h2><p>Old DO costs do not change when an item price is updated later.</p></div><span class="badge info">${rows.filter((row) => row.status !== 'cancelled').length} issued</span></div>
      ${rows.length ? `<div class="table-wrap"><table><thead><tr><th>Date</th><th>DO no.</th><th>From</th><th>Deliver to</th><th>Items</th><th>Material cost</th><th>Status</th><th>Actions</th></tr></thead><tbody>${rows.map((row) => `
        <tr>
          <td>${escapeHtml(row.date)}</td>
          <td class="strong">${escapeHtml(row.doNumber)}</td>
          <td>${escapeHtml(labelForSite(data.sites, row.fromSiteId))}</td>
          <td>${escapeHtml(labelForSite(data.sites, row.toSiteId))}</td>
          <td>${number(row.lines?.length || 0, 0)}</td>
          <td class="strong">${money(row.materialCost, currency)}</td>
          <td>${row.status === 'cancelled' ? '<span class="badge danger">Cancelled</span>' : '<span class="badge success">Issued</span>'}</td>
          <td><div class="actions">
            <button class="button secondary small" data-action="print-do" data-id="${row.id}">Print/PDF</button>
            ${row.status !== 'cancelled' ? `<button class="button secondary small" data-action="share-do" data-id="${row.id}">WhatsApp</button><button class="button danger small" data-action="cancel-do" data-id="${row.id}">Cancel</button>` : ''}
          </div></td>
        </tr>`).join('')}</tbody></table></div>` : emptyState('No DO in this period', 'Use New delivery order to issue materials to a work site.')}
    </div>`;

  $('#doFilterStart').addEventListener('change', (event) => { doFilters.startDate = event.target.value; renderDeliveryOrders(); });
  $('#doFilterEnd').addEventListener('change', (event) => { doFilters.endDate = event.target.value; renderDeliveryOrders(); });
  $('#doFilterSite').addEventListener('change', (event) => { doFilters.siteId = event.target.value; renderDeliveryOrders(); });
}

function renderStock() {
  const balances = calculateStockBalances(data.stockTransactions);
  const balanceRows = [];
  activeSites().forEach((site) => {
    if (stockSiteFilter && stockSiteFilter !== site.id) return;
    activeItems().forEach((item) => {
      const balance = Number(balances?.[site.id]?.[item.id] || 0);
      if (balance !== 0 || item.lowStock > 0) {
        balanceRows.push({ site, item, balance });
      }
    });
  });
  balanceRows.sort((a, b) => a.site.name.localeCompare(b.site.name) || a.item.name.localeCompare(b.item.name));
  const transactions = asArray(data.stockTransactions).sort(sortByDateDesc).slice(0, 40);

  $('#stockView').innerHTML = `
    <div class="toolbar"><div class="toolbar-group"><label>Location<select id="stockSiteFilter">${siteOptions(stockSiteFilter, true)}</select></label></div><button class="button primary" data-action="new-stock">+ New stock entry</button></div>
    <div class="card">
      <div class="section-heading"><div><h2>Current stock balance</h2><p>Calculated from every stock-in, stock-out, transfer and DO movement.</p></div></div>
      ${balanceRows.length ? `<div class="table-wrap"><table><thead><tr><th>Location</th><th>SKU</th><th>Item</th><th>Balance</th><th>Warning level</th><th>Status</th></tr></thead><tbody>${balanceRows.map(({ site, item, balance }) => {
        const low = Number(item.lowStock || 0) > 0 && balance <= Number(item.lowStock || 0);
        return `<tr><td>${escapeHtml(site.name)}</td><td>${escapeHtml(item.sku || '—')}</td><td class="strong">${escapeHtml(item.name)}</td><td class="${low ? 'low-stock' : 'strong'}">${number(balance)} ${escapeHtml(item.unit)}</td><td>${number(item.lowStock || 0)} ${escapeHtml(item.unit)}</td><td>${low ? '<span class="badge danger">Low stock</span>' : '<span class="badge success">OK</span>'}</td></tr>`;
      }).join('')}</tbody></table></div>` : emptyState('No stock balances', 'Add opening stock with a Stock in entry.')}
    </div>
    <div class="card" style="margin-top:16px">
      <div class="section-heading"><div><h2>Recent stock movements</h2><p>Delivery orders automatically create transfer movements.</p></div></div>
      ${transactions.length ? `<div class="table-wrap"><table><thead><tr><th>Date</th><th>Type</th><th>Item</th><th>Qty</th><th>From</th><th>To</th><th>Reference</th></tr></thead><tbody>${transactions.map((tx) => `
        <tr><td>${escapeHtml(tx.date)}</td><td>${stockTypeBadge(tx.type)}</td><td>${escapeHtml(labelForItem(data.items, tx.itemId))}</td><td class="strong">${number(tx.quantity)}</td><td>${escapeHtml(tx.fromSiteId ? labelForSite(data.sites, tx.fromSiteId) : '—')}</td><td>${escapeHtml(tx.toSiteId ? labelForSite(data.sites, tx.toSiteId) : '—')}</td><td>${escapeHtml(tx.doNumber || tx.notes || '—')}</td></tr>
      `).join('')}</tbody></table></div>` : emptyState('No stock movements', 'Your stock transaction history will appear here.')}
    </div>`;

  $('#stockSiteFilter').addEventListener('change', (event) => { stockSiteFilter = event.target.value; renderStock(); });
}

function stockTypeBadge(type) {
  const map = {
    stock_in: ['Stock in', 'success'],
    stock_out: ['Stock out', 'danger'],
    transfer: ['Transfer', 'info'],
    adjustment: ['Adjustment', 'warning'],
  };
  const [label, style] = map[type] || [type, ''];
  return `<span class="badge ${style}">${escapeHtml(label)}</span>`;
}

function renderPrices() {
  const currency = data.settings?.currency || 'SGD';
  const rows = asArray(data.prices).sort((a, b) => {
    const byDate = String(b.effectiveDate || '').localeCompare(String(a.effectiveDate || ''));
    if (byDate !== 0) return byDate;
    return String(labelForSite(data.sites, a.siteId)).localeCompare(String(labelForSite(data.sites, b.siteId)));
  });
  const currentPrices = activeItems().map((item) => ({
    item,
    price: resolvePrice(data.prices, item.id, todayISO(), priceSiteFilter),
  }));
  const priceSiteChoices = '<option value="">Default prices / all sites</option>'
    + activeSites()
      .filter((site) => site.type === 'worksite')
      .map((site) => `<option value="${site.id}" ${site.id === priceSiteFilter ? 'selected' : ''}>${escapeHtml(site.name)}</option>`)
      .join('');
  const currentScope = priceSiteFilter ? labelForSite(data.sites, priceSiteFilter) : 'Default prices';

  $('#pricesView').innerHTML = `
    <div class="toolbar">
      <div class="toolbar-group"><label>Show current prices for<select id="priceSiteFilter">${priceSiteChoices}</select></label></div>
      <button class="button primary" data-action="new-price">+ Add item price</button>
    </div>
    <div class="notice"><strong>Site price rule:</strong> a price saved for one worksite is used first. When no site price exists for that date, the app uses the default price.</div>
    <div class="section-grid" style="margin-top:16px">
      <div class="card">
        <div class="section-heading"><div><h2>Price history</h2><p>Each DO locks the selected worksite price based on its DO date.</p></div></div>
        ${rows.length ? `<div class="table-wrap"><table><thead><tr><th>Effective from</th><th>Site</th><th>SKU</th><th>Item</th><th>Unit price</th><th>Supplier</th><th>Notes</th></tr></thead><tbody>${rows.map((row) => `
          <tr><td>${escapeHtml(row.effectiveDate)}</td><td>${row.siteId ? escapeHtml(labelForSite(data.sites, row.siteId)) : '<span class="badge">Default / all sites</span>'}</td><td>${escapeHtml(data.items?.[row.itemId]?.sku || '—')}</td><td class="strong">${escapeHtml(labelForItem(data.items, row.itemId))}</td><td class="strong">${money(row.unitPrice, currency)}</td><td>${escapeHtml(row.supplier || '—')}</td><td>${escapeHtml(row.notes || '—')}</td></tr>
        `).join('')}</tbody></table></div>` : emptyState('No price records', 'Add a default price or a worksite-specific price before creating a delivery order.')}
      </div>
      <div class="card">
        <div class="section-heading"><div><h2>Current effective prices</h2><p>${escapeHtml(currentScope)} as at ${todayISO()}.</p></div></div>
        <div class="list">${currentPrices.map(({ item, price }) => `<div class="list-row"><div><strong>${escapeHtml(item.name)}</strong><p>${escapeHtml(item.sku || 'No SKU')} · per ${escapeHtml(item.unit)}${price?.siteId ? ' · site-specific' : ' · default'}</p></div><span class="strong">${price ? money(price.unitPrice, currency) : 'No price'}</span></div>`).join('') || emptyState('No items', 'Add stock items first.')}</div>
      </div>
    </div>`;

  $('#priceSiteFilter').addEventListener('change', (event) => {
    priceSiteFilter = event.target.value;
    renderPrices();
  });
}

function renderManpower() {
  const currency = data.settings?.currency || 'SGD';
  const rows = asArray(data.manpower).sort(sortByDateDesc);
  const total = rows.reduce((sum, row) => sum + manpowerCost(row), 0);

  $('#manpowerView').innerHTML = `
    <div class="toolbar"><div><span class="badge info">Total recorded: ${money(total, currency)}</span></div><button class="button primary" data-action="new-manpower">+ Add manpower</button></div>
    <div class="card">
      <div class="section-heading"><div><h2>Manpower cost register</h2><p>Each line is linked to saved site work when selected.</p></div></div>
      ${rows.length ? `<div class="table-wrap"><table><thead><tr><th>Date</th><th>Site work</th><th>Site</th><th>Trade / Work</th><th>Workers</th><th>Hours each</th><th>Rate/hour</th><th>Cost</th><th></th></tr></thead><tbody>${rows.map((row) => `
        <tr><td>${escapeHtml(row.date)}</td><td>${escapeHtml(data.jobs?.[row.jobId]?.name || '—')}</td><td>${escapeHtml(labelForSite(data.sites, row.siteId))}</td><td>${escapeHtml(row.role)}</td><td>${number(row.workers, 0)}</td><td>${number(row.hoursPerWorker)}</td><td>${money(row.ratePerHour, currency)}</td><td class="strong">${money(manpowerCost(row), currency)}</td><td><button class="button danger small" data-action="delete-manpower" data-id="${row.id}">Delete</button></td></tr>
      `).join('')}</tbody></table></div>` : emptyState('No manpower cost', 'Add the workers and hours used at each site.')}
    </div>`;
}

function renderMaster() {
  const sites = activeSites();
  const items = activeItems();
  $('#masterView').innerHTML = `
    <div class="section-grid">
      <div class="card">
        <div class="section-heading"><div><h2>Locations</h2><p>Warehouses, stores and work sites.</p></div><button class="button primary" data-action="new-site">+ Location</button></div>
        ${sites.length ? `<div class="list">${sites.map((site) => `<div class="list-row"><div><strong>${escapeHtml(site.name)}</strong><p>${site.type === 'warehouse' ? 'Warehouse / Store' : 'Work site'}${site.address ? ` · ${escapeHtml(site.address)}` : ''}${site.pic ? ` · PIC: ${escapeHtml(site.pic)}` : ''}</p></div><span class="badge ${site.type === 'warehouse' ? 'info' : 'success'}">${site.type === 'warehouse' ? 'Store' : 'Site'}</span></div>`).join('')}</div>` : emptyState('No locations', 'Add at least one warehouse and one work site.')}
      </div>
      <div class="card">
        <div class="section-heading"><div><h2>Stock items</h2><p>Item code, unit and low-stock warning.</p></div><button class="button primary" data-action="new-item">+ Item</button></div>
        ${items.length ? `<div class="list">${items.map((item) => `<div class="list-row"><div><strong>${escapeHtml(item.name)}</strong><p>${escapeHtml(item.sku || 'No SKU')} · ${escapeHtml(item.unit)} · warn at ${number(item.lowStock || 0)}</p></div><span class="badge">${escapeHtml(item.unit)}</span></div>`).join('')}</div>` : emptyState('No stock items', 'Add your material list before entering prices or stock.')}
      </div>
    </div>`;
}

function renderSettings() {
  const settings = data.settings || {};
  $('#settingsView').innerHTML = `
    <div class="section-grid">
      <div class="card">
        <div class="section-heading"><div><h2>Company settings</h2><p>Used on the dashboard and printed delivery orders.</p></div></div>
        <form id="settingsForm" class="form-grid two">
          <label class="span-2">Company / System name<input name="companyName" value="${escapeHtml(settings.companyName || 'KG Stock & Delivery Order')}" required></label>
          <label>Currency<select name="currency"><option value="SGD" ${(settings.currency || 'SGD') === 'SGD' ? 'selected' : ''}>SGD</option><option value="MYR" ${settings.currency === 'MYR' ? 'selected' : ''}>MYR</option><option value="USD" ${settings.currency === 'USD' ? 'selected' : ''}>USD</option></select></label>
          <label>DO prefix<input name="doPrefix" value="${escapeHtml(settings.doPrefix || 'DO')}" required></label>
          <label class="span-2">Company address<textarea name="companyAddress" rows="3">${escapeHtml(settings.companyAddress || '')}</textarea></label>
          <div class="span-2"><button class="button primary" type="submit">Save settings</button></div>
        </form>
      </div>
      <div class="card">
        <div class="section-heading"><div><h2>Backup and restore</h2><p>Download sites, Calendar work, items, prices, DOs, stock and manpower as JSON.</p></div></div>
        <div class="list">
          <div class="list-row"><div><strong>Export backup</strong><p>Keep a dated copy on your computer or cloud drive.</p></div><button class="button secondary" data-action="export-backup">Download</button></div>
          <div class="list-row"><div><strong>Restore backup</strong><p>Replaces the current database with a selected JSON backup.</p></div><button class="button secondary" data-action="import-backup">Choose file</button></div>
        </div>
        <div class="notice" style="margin-top:16px"><strong>${store.mode === 'supabase' ? 'Live system:' : 'Setup required:'}</strong> ${store.mode === 'supabase' ? 'Data is stored in Supabase PostgreSQL with live updates and Row Level Security. There is no browser-only demo database.' : 'Complete supabase-config.js and run supabase/sql/01-database-setup.sql before publishing.'}</div><div class="notice" style="margin-top:12px"><strong>Calendar source:</strong> ${escapeHtml(googleCalendarConfig.calendarId)}. The first/full copy imports all available Calendar history with no start-date filter. Supabase Cron can invoke the Edge Function every ${Math.round(googleCalendarConfig.syncEveryMs / 1000)} seconds even while the website is closed.</div>
      </div>
    </div>`;
  $('#settingsForm').addEventListener('submit', saveSettings);
}

function openDODialog(jobId = '') {
  if (!requireReady(['sites', 'items', 'prices'])) return;
  $('#doForm').reset();
  $('#doDate').value = todayISO();
  $('#doFromSite').innerHTML = siteOptions('', false);
  $('#doToSite').innerHTML = siteOptions('', false);
  const warehouse = activeSites().find((site) => site.type === 'warehouse');
  if (warehouse) $('#doFromSite').value = warehouse.id;
  const destination = activeSites().find((site) => site.type === 'worksite');
  if (destination) $('#doToSite').value = destination.id;
  refreshDOJobOptions(jobId);
  const firstItem = activeItems()[0];
  doDraftLines = [{ rowId: uid('line'), itemId: firstItem?.id || '', quantity: 1 }];
  if (jobId) applyJobToDO(jobId);
  else renderDOLines();
  $('#doDialog').showModal();
}

function renderDOLines() {
  const date = $('#doDate').value || todayISO();
  const siteId = $('#doToSite').value || '';
  const currency = data.settings?.currency || 'SGD';
  let missingPrice = false;
  const calculatedLines = doDraftLines.map((draft) => {
    const item = data.items?.[draft.itemId];
    const price = resolvePrice(data.prices, draft.itemId, date, siteId);
    if (draft.itemId && !price) missingPrice = true;
    return { ...draft, item, price, unitPrice: price?.unitPrice || 0, lineCost: Number(draft.quantity || 0) * Number(price?.unitPrice || 0) };
  });
  const total = calculateDOLines(calculatedLines).materialCost;

  $('#doLinesBody').innerHTML = calculatedLines.map((row) => `
    <tr data-row-id="${row.rowId}">
      <td><select data-field="itemId">${itemOptions(row.itemId)}</select></td>
      <td><input data-field="quantity" type="number" min="0.001" step="0.001" value="${escapeHtml(row.quantity)}"></td>
      <td>${escapeHtml(row.item?.unit || '—')}</td>
      <td>${row.price ? `${money(row.price.unitPrice, currency)} <span class="muted">from ${escapeHtml(row.price.effectiveDate)}</span> ${row.price.siteId ? '<span class="badge success">Site price</span>' : '<span class="badge">Default</span>'}` : '<span class="badge danger">No price</span>'}</td>
      <td class="strong">${money(row.lineCost, currency)}</td>
      <td><button type="button" class="icon-button" data-remove-line="${row.rowId}" aria-label="Remove line">×</button></td>
    </tr>`).join('');
  $('#doMaterialTotal').textContent = money(total, currency);
  $('#doPriceNotice').classList.toggle('hidden', !missingPrice);
  $('#doPriceNotice').textContent = missingPrice ? `At least one item has no price for ${labelForSite(data.sites, siteId)} effective on ${date}. Add a site price or a default dated price before saving this DO.` : '';
}

function handleDOLineInput(event) {
  const row = event.target.closest('tr[data-row-id]');
  if (!row || !event.target.dataset.field) return;
  const draft = doDraftLines.find((line) => line.rowId === row.dataset.rowId);
  if (!draft) return;
  draft[event.target.dataset.field] = event.target.dataset.field === 'quantity' ? Number(event.target.value) : event.target.value;
  renderDOLines();
}

function handleDOLineClick(event) {
  const id = event.target.dataset.removeLine;
  if (!id) return;
  doDraftLines = doDraftLines.filter((line) => line.rowId !== id);
  if (!doDraftLines.length) doDraftLines.push({ rowId: uid('line'), itemId: activeItems()[0]?.id || '', quantity: 1 });
  renderDOLines();
}

async function saveDeliveryOrder(event) {
  event.preventDefault();
  try {
    const date = $('#doDate').value;
    const fromSiteId = $('#doFromSite').value;
    const toSiteId = $('#doToSite').value;
    if (!fromSiteId || !toSiteId) throw new Error('Choose both the source and delivery site.');
    if (fromSiteId === toSiteId) throw new Error('Source and delivery site must be different.');

    const lines = doDraftLines.map((draft) => {
      const item = data.items?.[draft.itemId];
      const price = resolvePrice(data.prices, draft.itemId, date, toSiteId);
      if (!item) throw new Error('Choose an item for every line.');
      if (!price) throw new Error(`${item.name} has no price effective on ${date}.`);
      if (Number(draft.quantity) <= 0) throw new Error(`Enter a quantity above zero for ${item.name}.`);
      return {
        itemId: draft.itemId,
        sku: item.sku || '',
        itemName: item.name,
        unit: item.unit,
        quantity: Number(draft.quantity),
        priceId: price.id,
        priceEffectiveDate: price.effectiveDate,
        priceSiteId: price.siteId || '',
        unitPrice: Number(price.unitPrice),
      };
    });
    const calculated = calculateDOLines(lines);

    const requestedByItem = {};
    calculated.lines.forEach((line) => { requestedByItem[line.itemId] = (requestedByItem[line.itemId] || 0) + line.quantity; });
    const balancesAtDate = calculateStockBalances(data.stockTransactions, date);
    Object.entries(requestedByItem).forEach(([itemId, requested]) => {
      const available = Number(balancesAtDate?.[fromSiteId]?.[itemId] || 0);
      if (available < requested) throw new Error(`Not enough ${labelForItem(data.items, itemId)} at ${labelForSite(data.sites, fromSiteId)}. Available: ${number(available)}.`);
    });

    const doId = uid('do');
    const doNumber = generateDONumber(data.deliveryOrders, date, data.settings?.doPrefix || 'DO');
    const timestamp = new Date().toISOString();
    const user = currentUserLabel();
    const record = {
      doNumber,
      jobId: $('#doJob').value || '',
      date,
      fromSiteId,
      toSiteId,
      reference: $('#doReference').value.trim(),
      notes: $('#doNotes').value.trim(),
      lines: calculated.lines,
      materialCost: calculated.materialCost,
      status: 'issued',
      createdAt: timestamp,
      createdBy: user,
    };
    const updates = { [`deliveryOrders/${doId}`]: record };
    calculated.lines.forEach((line) => {
      const txId = uid('tx');
      updates[`stockTransactions/${txId}`] = {
        date,
        type: 'transfer',
        itemId: line.itemId,
        quantity: line.quantity,
        fromSiteId,
        toSiteId,
        doId,
        doNumber,
        notes: `Issued by ${doNumber}`,
        createdAt: timestamp,
        createdBy: user,
      };
    });
    await store.updateMany(updates);
    closeDialog('doDialog');
    showToast(`${doNumber} saved. Historical prices are locked into the DO.`);
  } catch (error) {
    showToast(error.message || 'Unable to save delivery order.', true);
  }
}

function openStockDialog() {
  if (!requireReady(['sites', 'items'])) return;
  $('#stockForm').reset();
  $('#stockDate').value = todayISO();
  $('#stockItem').innerHTML = itemOptions();
  $('#stockFromSite').innerHTML = siteOptions();
  $('#stockToSite').innerHTML = siteOptions();
  const warehouse = activeSites().find((site) => site.type === 'warehouse');
  if (warehouse) $('#stockToSite').value = warehouse.id;
  updateStockFormVisibility();
  $('#stockDialog').showModal();
}

function updateStockFormVisibility() {
  const type = $('#stockType').value;
  const showFrom = type === 'stock_out' || type === 'transfer';
  const showTo = type === 'stock_in' || type === 'transfer' || type === 'adjustment';
  $('#stockFromLabel').classList.toggle('hidden', !showFrom);
  $('#stockToLabel').classList.toggle('hidden', !showTo);
  $('#stockFromSite').required = showFrom;
  $('#stockToSite').required = showTo;
  $('#stockQuantity').min = type === 'adjustment' ? '' : '0.001';
}

async function saveStockEntry(event) {
  event.preventDefault();
  try {
    const type = $('#stockType').value;
    const quantity = Number($('#stockQuantity').value);
    const fromSiteId = $('#stockFromSite').value;
    const toSiteId = $('#stockToSite').value;
    if (type !== 'adjustment' && quantity <= 0) throw new Error('Quantity must be above zero.');
    if (type === 'adjustment' && quantity === 0) throw new Error('Adjustment cannot be zero.');
    if (type === 'transfer' && fromSiteId === toSiteId) throw new Error('Transfer locations must be different.');

    if (type === 'stock_out' || type === 'transfer') {
      const balances = calculateStockBalances(data.stockTransactions, $('#stockDate').value);
      const available = Number(balances?.[fromSiteId]?.[$('#stockItem').value] || 0);
      if (available < quantity) throw new Error(`Not enough stock. Available: ${number(available)}.`);
    }

    await store.save('stockTransactions', uid('tx'), {
      date: $('#stockDate').value,
      type,
      itemId: $('#stockItem').value,
      quantity,
      fromSiteId: (type === 'stock_out' || type === 'transfer') ? fromSiteId : '',
      toSiteId: (type === 'stock_in' || type === 'transfer' || type === 'adjustment') ? toSiteId : '',
      notes: $('#stockNotes').value.trim(),
      createdAt: new Date().toISOString(),
      createdBy: currentUserLabel(),
    });
    closeDialog('stockDialog');
    showToast('Stock entry saved.');
  } catch (error) {
    showToast(error.message || 'Unable to save stock entry.', true);
  }
}

function openPriceDialog() {
  if (!requireReady(['items'])) return;
  $('#priceForm').reset();
  $('#priceItem').innerHTML = itemOptions();
  $('#priceSite').innerHTML = '<option value="">All sites / default price</option>'
    + activeSites()
      .filter((site) => site.type === 'worksite')
      .map((site) => `<option value="${site.id}">${escapeHtml(site.name)}</option>`)
      .join('');
  $('#priceSite').value = priceSiteFilter || '';
  $('#priceDate').value = todayISO();
  $('#priceDialog').showModal();
}

async function savePrice(event) {
  event.preventDefault();
  try {
    const siteId = $('#priceSite').value || '';
    await store.save('prices', uid('price'), {
      itemId: $('#priceItem').value,
      siteId,
      effectiveDate: $('#priceDate').value,
      unitPrice: Number($('#unitPrice').value),
      supplier: $('#priceSupplier').value.trim(),
      notes: $('#priceNotes').value.trim(),
      createdAt: new Date().toISOString(),
      createdBy: currentUserLabel(),
    });
    priceSiteFilter = siteId;
    closeDialog('priceDialog');
    showToast(siteId ? 'Worksite-specific dated price saved.' : 'Default dated item price saved.');
  } catch (error) {
    showToast(error.message || 'Unable to save item price.', true);
  }
}

function openManpowerDialog(jobId = '') {
  if (!requireReady(['sites'])) return;
  $('#manpowerForm').reset();
  $('#manpowerDate').value = todayISO();
  $('#manpowerJob').innerHTML = jobOptions(jobId);
  $('#manpowerSite').innerHTML = siteOptions();
  $('#manpowerWorkers').value = 1;
  $('#manpowerHours').value = 8;
  $('#manpowerRate').value = 0;
  if (jobId) applyJobToManpower(jobId);
  else updateManpowerCalculation();
  $('#manpowerDialog').showModal();
}

function updateManpowerCalculation() {
  $('#manpowerCalculated').textContent = money(manpowerCost({
    workers: $('#manpowerWorkers').value,
    hoursPerWorker: $('#manpowerHours').value,
    ratePerHour: $('#manpowerRate').value,
  }), data.settings?.currency || 'SGD');
}

async function saveManpower(event) {
  event.preventDefault();
  try {
    await store.save('manpower', uid('mp'), {
      jobId: $('#manpowerJob').value || '',
      date: $('#manpowerDate').value,
      siteId: $('#manpowerSite').value,
      role: $('#manpowerRole').value.trim(),
      workers: Number($('#manpowerWorkers').value),
      hoursPerWorker: Number($('#manpowerHours').value),
      ratePerHour: Number($('#manpowerRate').value),
      notes: $('#manpowerNotes').value.trim(),
      createdAt: new Date().toISOString(),
      createdBy: currentUserLabel(),
    });
    closeDialog('manpowerDialog');
    showToast('Manpower cost saved.');
  } catch (error) {
    showToast(error.message || 'Unable to save manpower.', true);
  }
}

function openSiteDialog() {
  $('#siteForm').reset();
  $('#siteDialog').showModal();
}

async function saveSite(event) {
  event.preventDefault();
  try {
    await store.save('sites', uid('site'), {
      name: $('#siteName').value.trim(),
      type: $('#siteType').value,
      address: $('#siteAddress').value.trim(),
      pic: $('#sitePic').value.trim(),
      active: true,
      createdAt: new Date().toISOString(),
      createdBy: currentUserLabel(),
    });
    closeDialog('siteDialog');
    showToast('Location saved.');
  } catch (error) {
    showToast(error.message || 'Unable to save location.', true);
  }
}

function openItemDialog() {
  $('#itemForm').reset();
  $('#itemLowStock').value = 0;
  $('#itemDialog').showModal();
}

async function saveItem(event) {
  event.preventDefault();
  try {
    await store.save('items', uid('item'), {
      name: $('#itemName').value.trim(),
      sku: $('#itemSku').value.trim(),
      unit: $('#itemUnit').value.trim(),
      lowStock: Number($('#itemLowStock').value || 0),
      active: true,
      createdAt: new Date().toISOString(),
      createdBy: currentUserLabel(),
    });
    closeDialog('itemDialog');
    showToast('Stock item saved. Add its dated price next.');
  } catch (error) {
    showToast(error.message || 'Unable to save item.', true);
  }
}

async function saveSettings(event) {
  event.preventDefault();
  const form = new FormData(event.target);
  try {
    const settings = {
      companyName: String(form.get('companyName')).trim(),
      currency: String(form.get('currency')),
      doPrefix: String(form.get('doPrefix')).trim().toUpperCase(),
      companyAddress: String(form.get('companyAddress')).trim(),
      updatedAt: new Date().toISOString(),
      updatedBy: currentUserLabel(),
    };
    const nextData = structuredClone(data);
    nextData.settings = settings;
    await store.replaceAll(nextData);
    showToast('Settings saved.');
  } catch (error) {
    showToast(error.message || 'Unable to save settings.', true);
  }
}

function handleDynamicClick(event) {
  const viewLink = event.target.closest('[data-view-link]');
  if (viewLink) return switchView(viewLink.dataset.viewLink);
  const button = event.target.closest('[data-action]');
  if (!button) return;
  const { action, id } = button.dataset;
  const handlers = {
    'new-do': () => openDODialog(),
    'new-stock': openStockDialog,
    'new-price': openPriceDialog,
    'new-manpower': () => openManpowerDialog(),
    'new-job': () => openJobDialog(),
    'edit-job': () => openJobDialog(id),
    'clone-job': () => openJobDialog('', id),
    'pause-job': () => changeJobStatus(id, 'paused'),
    'resume-job': () => changeJobStatus(id, 'active'),
    'complete-job': () => changeJobStatus(id, 'completed'),
    'job-do': () => openDODialog(id),
    'job-manpower': () => openManpowerDialog(id),
    'sync-calendar': () => syncGoogleCalendar(true, false),
    'copy-whole-calendar': () => syncGoogleCalendar(true, true),
    'new-site': openSiteDialog,
    'new-item': openItemDialog,
    'print-do': () => printDeliveryOrder(id),
    'share-do': () => shareDeliveryOrder(id),
    'cancel-do': () => cancelDeliveryOrder(id),
    'delete-manpower': () => deleteManpower(id),
    'export-backup': exportBackup,
    'import-backup': () => $('#importFile').click(),
    'export-summary': printSummary,
  };
  handlers[action]?.();
}

async function cancelDeliveryOrder(id) {
  const record = data.deliveryOrders?.[id];
  if (!record || record.status === 'cancelled') return;
  if (!confirm(`Cancel ${record.doNumber}? Its stock transfer will be reversed by removing the related movements.`)) return;
  try {
    const updates = {
      [`deliveryOrders/${id}`]: {
        ...record,
        status: 'cancelled',
        cancelledAt: new Date().toISOString(),
        cancelledBy: currentUserLabel(),
      },
    };
    asArray(data.stockTransactions).filter((tx) => tx.doId === id).forEach((tx) => { updates[`stockTransactions/${tx.id}`] = null; });
    await store.updateMany(updates);
    showToast(`${record.doNumber} cancelled.`);
  } catch (error) {
    showToast(error.message || 'Unable to cancel DO.', true);
  }
}

async function deleteManpower(id) {
  if (!confirm('Delete this manpower record?')) return;
  try {
    await store.remove('manpower', id);
    showToast('Manpower record deleted.');
  } catch (error) {
    showToast(error.message || 'Unable to delete manpower record.', true);
  }
}

function printDeliveryOrder(id) {
  const record = data.deliveryOrders?.[id];
  if (!record) return;
  const currency = data.settings?.currency || 'SGD';
  const popup = window.open('', '_blank', 'width=950,height=800');
  if (!popup) return showToast('Allow pop-ups to print the delivery order.', true);
  popup.document.write(`<!doctype html><html><head><title>${escapeHtml(record.doNumber)}</title><style>
    body{font-family:Arial,sans-serif;color:#111;margin:34px}h1{margin:0;font-size:26px}.head{display:flex;justify-content:space-between;border-bottom:3px solid #111;padding-bottom:16px}.meta{display:grid;grid-template-columns:1fr 1fr;gap:10px;margin:24px 0}.box{border:1px solid #aaa;padding:10px}.label{font-size:11px;color:#666;text-transform:uppercase;font-weight:bold}table{width:100%;border-collapse:collapse;margin-top:20px}th,td{border:1px solid #999;padding:9px;text-align:left}th{background:#eee}.right{text-align:right}.sign{display:grid;grid-template-columns:1fr 1fr;gap:60px;margin-top:70px}.line{border-top:1px solid #111;padding-top:8px}@media print{button{display:none}}</style></head><body>
    <div class="head"><div><h1>${escapeHtml(data.settings?.companyName || 'KG Stock & Delivery Order')}</h1><div>${escapeHtml(data.settings?.companyAddress || '')}</div></div><div style="text-align:right"><h2>DELIVERY ORDER</h2><strong>${escapeHtml(record.doNumber)}</strong>${record.status === 'cancelled' ? '<div style="color:#b42318;font-weight:bold">CANCELLED</div>' : ''}</div></div>
    <div class="meta"><div class="box"><div class="label">Date</div>${escapeHtml(record.date)}</div><div class="box"><div class="label">Reference / Vehicle</div>${escapeHtml(record.reference || '—')}</div><div class="box"><div class="label">From</div>${escapeHtml(labelForSite(data.sites, record.fromSiteId))}</div><div class="box"><div class="label">Deliver to</div>${escapeHtml(labelForSite(data.sites, record.toSiteId))}</div></div>
    <table><thead><tr><th>No.</th><th>SKU</th><th>Description</th><th>Qty</th><th>Unit</th><th>Unit price</th><th>Cost</th></tr></thead><tbody>${record.lines.map((line, index) => `<tr><td>${index + 1}</td><td>${escapeHtml(line.sku || '')}</td><td>${escapeHtml(line.itemName)}</td><td>${number(line.quantity)}</td><td>${escapeHtml(line.unit)}</td><td>${money(line.unitPrice, currency)}</td><td>${money(line.lineCost, currency)}</td></tr>`).join('')}</tbody><tfoot><tr><td colspan="6" class="right"><strong>Material total</strong></td><td><strong>${money(record.materialCost, currency)}</strong></td></tr></tfoot></table>
    <p><strong>Remarks:</strong> ${escapeHtml(record.notes || '—')}</p><p style="font-size:11px;color:#666">Prices are historical snapshots effective on the DO date. Created by ${escapeHtml(record.createdBy || '—')}.</p>
    <div class="sign"><div class="line">Issued by / Date</div><div class="line">Received by / Date</div></div><button onclick="window.print()" style="margin-top:30px;padding:10px 18px">Print / Save PDF</button>
    </body></html>`);
  popup.document.close();
}

function shareDeliveryOrder(id) {
  const record = data.deliveryOrders?.[id];
  if (!record) return;
  const currency = data.settings?.currency || 'SGD';
  const lines = [
    `*${record.doNumber}*`,
    `Date: ${record.date}`,
    `From: ${labelForSite(data.sites, record.fromSiteId)}`,
    `Deliver to: ${labelForSite(data.sites, record.toSiteId)}`,
    '',
    ...record.lines.map((line, index) => `${index + 1}. ${line.itemName} — ${number(line.quantity)} ${line.unit} × ${money(line.unitPrice, currency)} = ${money(line.lineCost, currency)}`),
    '',
    `Material total: ${money(record.materialCost, currency)}`,
    record.notes ? `Remarks: ${record.notes}` : '',
  ].filter(Boolean).join('\n');
  window.open(`https://wa.me/?text=${encodeURIComponent(lines)}`, '_blank', 'noopener');
}

function printSummary() {
  const summary = summarize(data, dashboardFilters);
  const currency = data.settings?.currency || 'SGD';
  const popup = window.open('', '_blank', 'width=900,height=750');
  if (!popup) return showToast('Allow pop-ups to print the summary.', true);
  const siteName = dashboardFilters.siteId ? labelForSite(data.sites, dashboardFilters.siteId) : 'All sites';
  popup.document.write(`<!doctype html><html><head><title>Cost Summary</title><style>body{font-family:Arial,sans-serif;margin:35px;color:#111}.cards{display:grid;grid-template-columns:1fr 1fr;gap:12px}.card{border:1px solid #aaa;padding:16px}.value{font-size:25px;font-weight:bold;margin-top:8px}table{width:100%;border-collapse:collapse;margin-top:24px}th,td{border:1px solid #aaa;padding:8px;text-align:left}th{background:#eee}.right{text-align:right}@media print{button{display:none}}</style></head><body><h1>${escapeHtml(data.settings?.companyName || 'KG Stock & Delivery Order')}</h1><h2>Manpower & Material Cost Summary</h2><p>${escapeHtml(siteName)} · ${escapeHtml(dashboardFilters.startDate)} to ${escapeHtml(dashboardFilters.endDate)}</p><div class="cards"><div class="card">Delivery orders<div class="value">${summary.deliveryOrderCount}</div></div><div class="card">Material cost<div class="value">${money(summary.materialCost, currency)}</div></div><div class="card">Manpower cost<div class="value">${money(summary.manpowerCost, currency)}</div></div><div class="card">Combined cost<div class="value">${money(summary.totalCost, currency)}</div></div></div><table><thead><tr><th>Date</th><th>DO</th><th>Site</th><th class="right">Material cost</th></tr></thead><tbody>${summary.deliveryOrders.sort(sortByDateDesc).map((row) => `<tr><td>${escapeHtml(row.date)}</td><td>${escapeHtml(row.doNumber)}</td><td>${escapeHtml(labelForSite(data.sites, row.toSiteId))}</td><td class="right">${money(row.materialCost, currency)}</td></tr>`).join('')}</tbody></table><button onclick="window.print()" style="margin-top:25px;padding:10px 18px">Print / Save PDF</button></body></html>`);
  popup.document.close();
}

function exportBackup() {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `kg-stock-backup-${todayISO()}.json`;
  link.click();
  URL.revokeObjectURL(url);
  showToast('Backup downloaded.');
}

async function importBackup(event) {
  const file = event.target.files?.[0];
  event.target.value = '';
  if (!file) return;
  if (!confirm('Restore this backup? It will replace all current app data.')) return;
  try {
    const parsed = JSON.parse(await file.text());
    const required = ['sites', 'items', 'prices', 'stockTransactions', 'deliveryOrders', 'manpower'];
    if (!required.every((key) => parsed[key] && typeof parsed[key] === 'object')) throw new Error('This is not a valid KG Stock backup file.');
    await store.replaceAll(parsed);
    showToast('Backup restored.');
  } catch (error) {
    showToast(error.message || 'Unable to restore backup.', true);
  }
}

function getLowStockRows(balances, siteFilter = '') {
  const rows = [];
  activeSites().forEach((site) => {
    if (siteFilter && site.id !== siteFilter) return;
    activeItems().forEach((item) => {
      const lowStock = Number(item.lowStock || 0);
      if (lowStock <= 0) return;
      const balance = Number(balances?.[site.id]?.[item.id] || 0);
      if (balance <= lowStock) rows.push({ siteName: site.name, itemName: item.name, balance, lowStock, unit: item.unit });
    });
  });
  return rows.sort((a, b) => a.balance - b.balance);
}

function requireReady(collections) {
  if (store.mode === 'supabase' && !store.getUser()) {
    showToast('Sign in with Google first.', true);
    return false;
  }
  const labels = { sites: 'locations', items: 'stock items', prices: 'dated item prices' };
  for (const collection of collections) {
    if (!asArray(data[collection]).length) {
      showToast(`Add ${labels[collection]} first.`, true);
      switchView(collection === 'prices' ? 'prices' : 'master');
      return false;
    }
  }
  return true;
}

function currentUserLabel() {
  const user = store.getUser();
  return user?.email || user?.displayName || 'Unknown user';
}

function closeDialog(id) {
  const dialog = document.getElementById(id);
  if (dialog?.open) dialog.close();
}

function sortByDateDesc(a, b) {
  return String(b.date || '').localeCompare(String(a.date || '')) || String(b.createdAt || '').localeCompare(String(a.createdAt || ''));
}

function emptyState(title, message) {
  return `<div class="empty-state"><strong>${escapeHtml(title)}</strong>${escapeHtml(message)}</div>`;
}

function showToast(message, error = false) {
  const toast = $('#toast');
  toast.textContent = message;
  toast.classList.toggle('error', error);
  toast.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast.classList.remove('show'), 3800);
}

init().catch((error) => {
  console.error(error);
  showToast(error.message || 'The app could not start.', true);
});
