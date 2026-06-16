export function normalizeKey(value = '') {
  return String(value)
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .replace(/[^a-z0-9\u00c0-\u024f\u4e00-\u9fff ]/g, '');
}

export function safeRecordKey(value = '') {
  return String(value || '')
    .replace(/[.#$\[\]\/]/g, '_')
    .replace(/[^A-Za-z0-9_-]/g, '_')
    .slice(0, 700);
}

export function extractLabel(description = '', labels = []) {
  const lines = String(description || '').split(/\r?\n/);
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    for (const label of labels) {
      const escaped = label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const match = line.match(new RegExp(`^\\s*${escaped}\\s*[:：-]?\\s*(.*)$`, 'i'));
      if (!match) continue;
      if (match[1]?.trim()) return match[1].trim();
      const nextLine = lines.slice(index + 1).find((value) => value.trim());
      if (nextLine) return nextLine.trim();
    }
  }
  return '';
}

export function subtractOneDay(dateString = '') {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateString)) return dateString;
  const date = new Date(`${dateString}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() - 1);
  return date.toISOString().slice(0, 10);
}

export function eventToJob(event = {}) {
  const description = String(event.description || '');
  const summary = String(event.summary || 'Untitled work').trim() || 'Untitled work';
  const address = String(event.location || '').trim()
    || extractLabel(description, ['Address', 'Site', 'Location'])
    || summary;
  const pic = extractLabel(description, ['PIC', 'P.I.C.', 'Contact', 'Person in charge', 'Foreman']);
  const startDateTime = event.start?.dateTime || '';
  const endDateTime = event.end?.dateTime || '';
  const allDay = Boolean(event.start?.date);
  const startDate = event.start?.date || startDateTime.slice(0, 10);
  const rawEndDate = event.end?.date || endDateTime.slice(0, 10) || startDate;
  const endDate = allDay ? subtractOneDay(rawEndDate) : rawEndDate;
  const sourceUpdatedAt = event.updated || new Date().toISOString();

  return {
    source: 'google_calendar',
    calendarEventId: String(event.id || ''),
    calendarICalUID: String(event.iCalUID || ''),
    calendarHtmlLink: String(event.htmlLink || ''),
    calendarStatus: String(event.status || 'confirmed'),
    calendarCreatedAt: String(event.created || ''),
    calendarUpdatedAt: sourceUpdatedAt,
    calendarColorId: String(event.colorId || ''),
    calendarVisibility: String(event.visibility || ''),
    calendarTransparency: String(event.transparency || ''),
    calendarCreatorEmail: String(event.creator?.email || ''),
    calendarCreatorName: String(event.creator?.displayName || ''),
    calendarOrganizerEmail: String(event.organizer?.email || ''),
    calendarOrganizerName: String(event.organizer?.displayName || ''),
    calendarAttendeeCount: Array.isArray(event.attendees) ? event.attendees.length : 0,
    calendarHangoutLink: String(event.hangoutLink || ''),
    name: summary,
    address,
    addressKey: normalizeKey(address),
    pic,
    description,
    startDate,
    endDate: endDate || startDate,
    rawCalendarEndDate: rawEndDate,
    startDateTime,
    endDateTime,
    allDay,
    timeZone: event.start?.timeZone || event.end?.timeZone || 'Asia/Singapore',
    recurringEventId: String(event.recurringEventId || ''),
    originalStartTime: event.originalStartTime || null,
  };
}

export function displaySchedule(job = {}) {
  const start = job.startDate || '';
  const end = job.endDate || start;
  if (!start) return 'No date';
  const datePart = start === end || !end ? start : `${start} → ${end}`;
  if (job.allDay || !job.startDateTime) return datePart;
  const startTime = String(job.startDateTime).slice(11, 16);
  const endTime = String(job.endDateTime || '').slice(11, 16);
  return `${datePart} ${startTime}${endTime ? `–${endTime}` : ''}`;
}
