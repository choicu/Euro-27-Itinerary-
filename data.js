// Fetch, parse and normalise the Itinerary sheet. No build step, no deps.

const CSV_URL = 'https://docs.google.com/spreadsheets/d/e/2PACX-1vTGbyb898_TCc-mfNbF0Aj03hFdM0TCeZZqq-DtfOMdndszz9unX3nSL98AI-VRwpcoDrmqgKcuLd24/pub?gid=1587793838&single=true&output=csv';
const SNAPSHOT_URL = 'data/itinerary.snapshot.csv';
const CACHE_KEY = 'itinerary_csv_cache_v1';
const CACHE_TIME_KEY = 'itinerary_csv_cache_time_v1';

const MONTHS = { Jan: 0, Feb: 1, Mar: 2, Apr: 3, May: 4, Jun: 5, Jul: 6, Aug: 7, Sep: 8, Oct: 9, Nov: 10, Dec: 11 };
const DATE_RE = /^[A-Za-z]{3} (\d{1,2}) ([A-Za-z]{3}) (\d{2})$/;

const CATEGORY_ICON = {
  Transit: '🚆',
  Accomodation: '🛏️',
  Dining: '🍝',
  Sightseeing: '📍',
  Activity: '⭐',
  Entertainment: '🎶',
};

const STAY_TITLE_PREFIXES = ['check in', 'check into', 'check out'];

/** Minimal RFC4180 CSV parser: handles quoted fields, embedded commas/quotes/newlines. */
function parseCSV(text) {
  const rows = [];
  let row = [];
  let field = '';
  let inQuotes = false;
  let i = 0;
  const n = text.length;
  while (i < n) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i += 2; continue; }
        inQuotes = false; i++; continue;
      }
      field += c; i++; continue;
    }
    if (c === '"') { inQuotes = true; i++; continue; }
    if (c === ',') { row.push(field); field = ''; i++; continue; }
    if (c === '\r') { i++; continue; }
    if (c === '\n') { row.push(field); rows.push(row); row = []; field = ''; i++; continue; }
    field += c; i++;
  }
  if (field.length > 0 || row.length > 0) { row.push(field); rows.push(row); }
  return rows;
}

function norm(s) { return (s ?? '').trim(); }

function findHeaderIndex(headerRow, matcher) {
  for (let i = 0; i < headerRow.length; i++) {
    if (matcher(norm(headerRow[i]))) return i;
  }
  return -1;
}

function parseDayDate(cellValue) {
  const m = DATE_RE.exec(norm(cellValue));
  if (!m) return null;
  const day = parseInt(m[1], 10);
  const month = MONTHS[m[2]];
  if (month === undefined) return null;
  // Spec: year is always 2027 for this trip.
  return new Date(2027, month, day);
}

function toISODate(d) {
  if (!d) return null;
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function iconFor(category) {
  return CATEGORY_ICON[category] || '';
}

function isStayCard(category, title) {
  if (category === 'Accomodation') return true;
  const t = norm(title).toLowerCase();
  return STAY_TITLE_PREFIXES.some((p) => t.startsWith(p));
}

/**
 * Parses the full itinerary CSV into { days, places, meta }.
 * Finds headers/markers by content, never by hard-coded row numbers (sheet rows shift).
 */
export function parseItinerary(csvText) {
  const rows = parseCSV(csvText).filter((r) => r.length > 0 && r.some((c) => norm(c) !== ''));

  const headerRowIdx = rows.findIndex((r) =>
    r.some((c) => norm(c) === 'Day') && r.some((c) => norm(c) === 'Date')
  );
  if (headerRowIdx === -1) {
    throw new Error('STOP: itinerary header row (Day/Date/...) not found — sheet layout may have changed.');
  }
  const header = rows[headerRowIdx];

  const col = {
    dayNum: 0, // column A, unlabelled, always first
    dayLabel: findHeaderIndex(header, (h) => h === 'Day'),
    date: findHeaderIndex(header, (h) => h === 'Date'),
    location: findHeaderIndex(header, (h) => h === 'Location'),
    slot: findHeaderIndex(header, (h) => h === 'Time Slot'),
    title: findHeaderIndex(header, (h) => h === 'Activity / Place Name'),
    category: findHeaderIndex(header, (h) => h === 'Category'),
    link: findHeaderIndex(header, (h) => h === 'Link'),
    notes: findHeaderIndex(header, (h) => h === 'Notes'),
    logistics: findHeaderIndex(header, (h) => h === 'Logistics'),
    url: findHeaderIndex(header, (h) => h === 'URL'), // optional, per checkpoint (a)
  };
  for (const k of ['dayLabel', 'date', 'location', 'slot', 'title', 'category', 'link', 'notes', 'logistics']) {
    if (col[k] === -1) {
      throw new Error(`STOP: itinerary header "${k}" not found — sheet layout may have changed.`);
    }
  }

  const markerIdx = rows.findIndex((r) => norm(r[0]) === 'PLACES TO TRY');
  const itinEnd = markerIdx === -1 ? rows.length : markerIdx;

  const dataRows = rows.slice(headerRowIdx + 1, itinEnd);

  const days = new Map();
  const unplaced = [];
  let currentDay = null;
  let currentDate = null;

  for (const r of dataRows) {
    const get = (idx) => (idx >= 0 && idx < r.length ? norm(r[idx]) : '');

    let dayNumRaw = get(col.dayNum);
    let dayNum = dayNumRaw ? parseInt(dayNumRaw, 10) : null;
    if (dayNum === null || Number.isNaN(dayNum)) {
      dayNum = currentDay; // inherit (blank day-number rows, e.g. trailing rows of a day)
    }
    if (dayNum === null) { unplaced.push(r); continue; }
    currentDay = dayNum;

    if (!days.has(dayNum)) {
      days.set(dayNum, {
        day: dayNum,
        date: null,
        dateDisplay: null,
        labelChips: [],
        noteChips: [],
        locations: [],
        slots: { Morning: [], Afternoon: [], Evening: [], Plans: [] },
      });
    }
    const d = days.get(dayNum);

    const bVal = get(col.dayLabel);
    if (bVal && !/^Day \d+$/.test(bVal) && !d.labelChips.includes(bVal)) {
      d.labelChips.push(bVal);
    }

    const cVal = get(col.date);
    const parsedDate = parseDayDate(cVal);
    if (parsedDate) {
      if (!d.date) { d.date = parsedDate; d.dateDisplay = cVal; currentDate = parsedDate; }
    } else if (cVal && !d.noteChips.includes(cVal)) {
      d.noteChips.push(cVal);
    }

    const locVal = get(col.location);
    if (locVal && !d.locations.includes(locVal)) d.locations.push(locVal);

    const title = get(col.title);
    const link = get(col.link);
    const notes = get(col.notes);
    const logistics = get(col.logistics);
    // Skip row: placeholder slot with nothing to show (3.3 "Skip row" rule).
    if (!title && !link && !notes && !logistics) continue;

    const category = get(col.category);
    const urlCol = col.url >= 0 ? get(col.url) : '';
    let url = null;
    if (urlCol) {
      url = urlCol;
    } else if (/^https?:\/\//i.test(link)) {
      url = link;
    } else {
      const q = encodeURIComponent([link || title, locVal].filter(Boolean).join(', '));
      url = `https://www.google.com/maps/search/?api=1&query=${q}`;
    }

    const card = {
      title, category, icon: iconFor(category),
      notes, logistics, linkLabel: link || null, url,
      hasLink: Boolean(urlCol || link), // Map button only shown when the sheet's Link/URL is filled
      isStay: isStayCard(category, title),
      isCheckIn: /^check[ -]?in/i.test(title) || /^take taxi and check in/i.test(title) || (category === 'Accomodation' && !/^check[ -]?out/i.test(title)),
      isCheckOut: /^check[ -]?out/i.test(title),
    };

    const slotKey = get(col.slot);
    const bucket = ['Morning', 'Afternoon', 'Evening'].includes(slotKey) ? slotKey : 'Plans';
    d.slots[bucket].push(card);
  }

  // Places to Try
  const places = [];
  if (markerIdx !== -1) {
    const placesHeaderRow = rows[markerIdx + 1] || [];
    const pcol = {
      country: findHeaderIndex(placesHeaderRow, (h) => h === 'Country'),
      city: findHeaderIndex(placesHeaderRow, (h) => h === 'City'),
      category: findHeaderIndex(placesHeaderRow, (h) => h.startsWith('Category')),
      location: findHeaderIndex(placesHeaderRow, (h) => h === 'Location'),
      time: findHeaderIndex(placesHeaderRow, (h) => h === 'Time'),
      name: findHeaderIndex(placesHeaderRow, (h) => h === 'Name of Place'),
      booking: findHeaderIndex(placesHeaderRow, (h) => h === 'Booking Status'),
      address: findHeaderIndex(placesHeaderRow, (h) => h.startsWith('Address')),
      notes: findHeaderIndex(placesHeaderRow, (h) => h === 'Notes'),
      // Budget Estimate deliberately not read — never rendered (hard rule).
    };
    const placeRows = rows.slice(markerIdx + 2);
    for (const r of placeRows) {
      const get = (idx) => (idx >= 0 && idx < r.length ? norm(r[idx]) : '');
      const name = get(pcol.name);
      if (!name) continue; // blank placeholder row
      const addr = get(pcol.address);
      const city = get(pcol.city);
      const location = get(pcol.location); // column D: the place's town (used for filter, label, map search)
      const area = location || city;       // fall back to City only if Location is blank
      const url = /^https?:\/\//i.test(addr)
        ? addr
        : `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent([name, area].filter(Boolean).join(', '))}`;
      places.push({
        country: get(pcol.country) || null,
        city: city || null,
        category: get(pcol.category) || null,
        location: location || null,
        area: area || null,
        time: get(pcol.time) || null,
        name,
        bookingStatus: get(pcol.booking) || null,
        addressLabel: addr || null,
        notes: get(pcol.notes) || null,
        url,
      });
    }
  }

  const dayList = Array.from(days.values()).sort((a, b) => a.day - b.day);

  /*
   * Tonight's stay. The sheet only lists accommodation on check-in days, so:
   *  - a day with a check-in row  -> stay = the last check-in that day
   *  - a day with only a check-out -> no stay shown (moving on, not yet in the plan)
   *  - any other day               -> carry the previous night's stay forward
   * Name shown = the Link label (usually the hotel name), else the row's text as written.
   */
  let carry = null;
  for (const d of dayList) {
    const cards = [...d.slots.Morning, ...d.slots.Afternoon, ...d.slots.Evening, ...d.slots.Plans];
    const checkIns = cards.filter((c) => c.isCheckIn);
    const hasCheckOut = cards.some((c) => c.isCheckOut);
    if (checkIns.length) {
      const c = checkIns[checkIns.length - 1];
      // Prefer the Link label (hotel name); otherwise drop the leading "Check into" so
      // "Check into Mykonos Hotel" reads as "Mykonos Hotel". Nothing else is reworded.
      const fromTitle = c.title.replace(/^(take taxi and )?check[ -]?in(to)?\s*(to\s+)?(-\s*)?/i, '').trim();
      carry = { name: c.linkLabel || fromTitle || c.title, url: c.hasLink ? c.url : null };
    } else if (hasCheckOut) {
      carry = null;
    }
    d.stay = carry;
  }
  for (const d of dayList) {
    d.dateISO = toISODate(d.date);
    if (d.slots.Morning.length === 0 && d.slots.Afternoon.length === 0 &&
        d.slots.Evening.length === 0 && d.slots.Plans.length === 0) {
      d.empty = true;
    }
  }

  return {
    days: dayList,
    places,
    meta: {
      rawDataRowCount: dataRows.length,
      unplacedRowCount: unplaced.length,
      dayCount: dayList.length,
      cardCount: dayList.reduce((sum, d) =>
        sum + d.slots.Morning.length + d.slots.Afternoon.length + d.slots.Evening.length + d.slots.Plans.length, 0),
      placesCount: places.length,
      distinctNoteChips: Array.from(new Set(dayList.flatMap((d) => d.noteChips))),
      distinctCategories: Array.from(new Set(
        dayList.flatMap((d) => [...d.slots.Morning, ...d.slots.Afternoon, ...d.slots.Evening, ...d.slots.Plans])
          .map((c) => c.category).filter((c) => c !== '')
      )),
    },
  };
}

/** Instant local copy: last saved sheet data, else the bundled snapshot. Never waits on the network for the sheet. */
export async function loadLocalCSV() {
  try {
    const cached = localStorage.getItem(CACHE_KEY);
    const cachedAt = localStorage.getItem(CACHE_TIME_KEY);
    if (cached) return { csvText: cached, source: 'cache', fetchedAt: cachedAt };
  } catch (_) { /* storage may be unavailable */ }
  const res = await fetch(SNAPSHOT_URL);
  return { csvText: await res.text(), source: 'snapshot', fetchedAt: null };
}

/** Live sheet fetch with a timeout so weak signal never hangs the app. Throws on failure. */
export async function fetchLiveCSV(timeoutMs = 8000) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(CSV_URL, { cache: 'no-store', signal: ctrl.signal });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const text = await res.text();
    const now = new Date().toISOString();
    try {
      localStorage.setItem(CACHE_KEY, text);
      localStorage.setItem(CACHE_TIME_KEY, now);
    } catch (_) { /* storage may be unavailable; not fatal */ }
    return { csvText: text, source: 'live', fetchedAt: now };
  } finally {
    clearTimeout(timer);
  }
}

export { parseCSV, toISODate };
