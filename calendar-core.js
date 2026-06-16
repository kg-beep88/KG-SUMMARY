export function normalizeKey(value = '') {
  return String(value)
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .replace(/[^a-z0-9\u00c0-\u024f\u4e00-\u9fff ]/g, '');
}

export function displaySchedule(job = {}) {
  const start = job.startDate || '';
  const end = job.endDate || start;
  if (!start) return 'No date';
  const datePart = start === end || !end ? start : `${start} → ${end}`;
  const startTime = String(job.startDateTime || '').slice(11, 16);
  const endTime = String(job.endDateTime || '').slice(11, 16);
  if (!startTime) return datePart;
  return `${datePart} ${startTime}${endTime ? `–${endTime}` : ''}`;
}

function dateFromISO(value = '') {
  const match = String(value).match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return null;
  return new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
}

function isoFromDate(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export function shiftMonth(monthISO, amount) {
  const base = dateFromISO(monthISO) || new Date();
  return isoFromDate(new Date(base.getFullYear(), base.getMonth() + amount, 1));
}

export function monthTitle(monthISO) {
  const base = dateFromISO(monthISO) || new Date();
  return new Intl.DateTimeFormat('en-SG', { month: 'long', year: 'numeric' }).format(base);
}

export function dateLabel(dateISO) {
  const base = dateFromISO(dateISO);
  if (!base) return dateISO || 'No date';
  return new Intl.DateTimeFormat('en-SG', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }).format(base);
}

export function monthGridDates(monthISO) {
  const base = dateFromISO(monthISO) || new Date();
  const first = new Date(base.getFullYear(), base.getMonth(), 1);
  const mondayOffset = (first.getDay() + 6) % 7;
  const start = new Date(first);
  start.setDate(first.getDate() - mondayOffset);
  return Array.from({ length: 42 }, (_, index) => {
    const date = new Date(start);
    date.setDate(start.getDate() + index);
    return {
      date: isoFromDate(date),
      day: date.getDate(),
      inMonth: date.getMonth() === first.getMonth(),
    };
  });
}

export function jobOccursOnDate(job = {}, dateISO = '') {
  const start = job.startDate || '';
  const end = job.endDate || start;
  return Boolean(start && dateISO && start <= dateISO && dateISO <= end);
}
