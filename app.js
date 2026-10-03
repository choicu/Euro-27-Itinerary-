import { loadLocalCSV, fetchLiveCSV, parseItinerary } from './data.js';

const TRIP_START = new Date(2027, 5, 30); // 30 Jun 2027
const TRIP_END = new Date(2027, 6, 31);   // 31 Jul 2027

let STATE = { days: [], places: [], meta: null, currentDayIdx: 0 };

function fmtTime(d) {
  return d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
}

function escapeHtml(s) {
  return (s ?? '').replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));
}

function pickInitialDayIndex(days) {
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  if (today < TRIP_START) return 0;
  if (today > TRIP_END) return days.length - 1;
  const idx = days.findIndex((d) => d.date && sameDate(d.date, today));
  return idx === -1 ? 0 : idx;
}

function sameDate(a, b) {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}

/** Index of today's day during the trip, else -1. */
function todayDayIndex() {
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  if (today < TRIP_START || today > TRIP_END) return -1;
  return STATE.days.findIndex((d) => d.date && sameDate(d.date, today));
}

/** Change day: re-render and start at the top of the new day. */
function goToDay(idx) {
  if (idx < 0 || idx >= STATE.days.length) return;
  STATE.currentDayIdx = idx;
  renderToday();
  window.scrollTo(0, 0);
}

function daysUntilTrip() {
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const ms = TRIP_START - today;
  return Math.ceil(ms / (1000 * 60 * 60 * 24));
}

/* ---------------- Rendering: Today screen ---------------- */

function renderCountdownBanner() {
  const el = document.getElementById('countdown-banner');
  const n = daysUntilTrip();
  if (n > 0) {
    el.innerHTML = `<div class="countdown-banner">${n} day${n === 1 ? '' : 's'} to go — Europe 2027! ✈️</div>`;
  } else {
    el.innerHTML = '';
  }
}

function renderDayStrip() {
  const strip = document.getElementById('day-strip');
  strip.innerHTML = STATE.days.map((d, i) => {
    const active = i === STATE.currentDayIdx ? ' active' : '';
    const loc = escapeHtml(d.locations[0] || '');
    return `<button class="day-chip${active}" data-idx="${i}">
      <span class="n">D${d.day}</span><span class="loc">${loc}</span>
    </button>`;
  }).join('');
  strip.querySelectorAll('.day-chip').forEach((btn) => {
    btn.addEventListener('click', () => goToDay(parseInt(btn.dataset.idx, 10)));
  });
  // Centre the active chip horizontally only (never scrolls the page vertically).
  const activeChip = strip.querySelector('.day-chip.active');
  if (activeChip) {
    strip.scrollTo({ left: activeChip.offsetLeft - (strip.clientWidth - activeChip.offsetWidth) / 2 });
  }
  document.getElementById('day-prev').disabled = STATE.currentDayIdx === 0;
  document.getElementById('day-next').disabled = STATE.currentDayIdx === STATE.days.length - 1;
  const ti = todayDayIndex();
  document.getElementById('day-today').hidden = ti === -1 || ti === STATE.currentDayIdx;
}

function dayDateLabel(d) {
  if (!d.date) return '';
  return d.date.toLocaleDateString('en-AU', { weekday: 'short', day: 'numeric', month: 'short' });
}

function renderDayHeader(d) {
  const header = document.getElementById('day-header');
  const chips = [...d.labelChips, ...d.noteChips];
  header.innerHTML = `
    <p class="title">Day ${d.day} · ${escapeHtml(dayDateLabel(d))}</p>
    <p class="locations">${d.locations.map(escapeHtml).join(' → ') || '—'}</p>
    ${chips.length ? `<div class="chips">${chips.map((c) => `<span class="chip">${escapeHtml(c)}</span>`).join('')}</div>` : ''}
  `;
}

function cardHtml(card) {
  const stayClass = card.isStay ? ' stay' : '';
  return `
    <div class="card${stayClass}">
      <div class="row1">
        ${card.icon ? `<span class="icon">${card.icon}</span>` : ''}
        <span class="title">${escapeHtml(card.title)}</span>
      </div>
      ${card.notes ? `<div class="notes">${escapeHtml(card.notes)}</div>` : ''}
      ${card.logistics ? `<div class="logistics">🧭 ${escapeHtml(card.logistics)}</div>` : ''}
      ${card.hasLink ? `<a class="map-btn" href="${card.url}" target="_blank" rel="noopener">📍 Map</a>` : ''}
    </div>
  `;
}

function renderTimeline(d) {
  const timeline = document.getElementById('timeline');
  if (d.empty) {
    timeline.innerHTML = '<div class="empty-day">Nothing planned yet</div>';
    return;
  }
  const order = ['Morning', 'Afternoon', 'Evening', 'Plans'];
  timeline.innerHTML = order
    .filter((slot) => d.slots[slot].length > 0)
    .map((slot) => `
      <div class="slot-section">
        <h2>${slot}</h2>
        ${d.slots[slot].map(cardHtml).join('')}
      </div>
    `).join('');
}

function renderSyncFooter() {
  const el = document.getElementById('sync-footer');
  const { source, fetchedAt } = STATE;
  const when = fetchedAt ? new Date(fetchedAt).toLocaleString('en-AU', { dateStyle: 'medium', timeStyle: 'short' }) : null;
  let text;
  if (refreshing) text = 'Checking sheet for updates…';
  else if (source === 'live') text = `Updated ${when} from sheet`;
  else if (source === 'cache') text = `Offline — showing saved copy from ${when || 'earlier'}`;
  else text = 'Offline — showing bundled starting copy';
  el.textContent = refreshing ? text : `${text} · ↻ Tap to refresh`;
  el.disabled = refreshing;
}

function renderToday() {
  renderCountdownBanner();
  renderDayStrip();
  const d = STATE.days[STATE.currentDayIdx];
  renderDayHeader(d);
  renderTimeline(d);
}

/* ---------------- Rendering: Overview screen ---------------- */

function computeBlocks(days) {
  const blocks = [];
  let cur = null;
  for (const d of days) {
    const key = d.locations.join(' + ') || '—';
    if (!cur || cur.key !== key) {
      cur = { key, startDay: d.day, endDay: d.day, locations: d.locations };
      blocks.push(cur);
    } else {
      cur.endDay = d.day;
    }
  }
  return blocks;
}

function renderOverview() {
  const list = document.getElementById('overview-list');
  const blocks = computeBlocks(STATE.days);
  list.innerHTML = blocks.map((b) => {
    const range = b.startDay === b.endDay ? `Day ${b.startDay}` : `Day ${b.startDay}–${b.endDay}`;
    return `<div class="overview-block" data-start="${b.startDay}">
      <div class="range">${range}</div>
      <p class="place">${escapeHtml(b.locations.join(' + ') || '—')}</p>
    </div>`;
  }).join('');
  list.querySelectorAll('.overview-block').forEach((el) => {
    el.addEventListener('click', () => {
      const day = parseInt(el.dataset.start, 10);
      showScreen('today');
      goToDay(STATE.days.findIndex((d) => d.day === day));
    });
  });
}

/* ---------------- Rendering: Places screen ---------------- */

let placesFilter = 'All';

function renderPlacesFilter() {
  const cities = Array.from(new Set(STATE.places.map((p) => p.city).filter(Boolean)));
  const filterEl = document.getElementById('places-filter');
  const opts = ['All', ...cities];
  filterEl.innerHTML = opts.map((c) =>
    `<button class="filter-chip${c === placesFilter ? ' active' : ''}" data-city="${escapeHtml(c)}">${escapeHtml(c)}</button>`
  ).join('');
  filterEl.querySelectorAll('.filter-chip').forEach((btn) => {
    btn.addEventListener('click', () => {
      placesFilter = btn.dataset.city;
      renderPlacesFilter();
      renderPlacesList();
    });
  });
}

function renderPlacesList() {
  const list = document.getElementById('places-list');
  const items = placesFilter === 'All' ? STATE.places : STATE.places.filter((p) => p.city === placesFilter);
  list.innerHTML = items.map((p) => `
    <div class="place-card">
      <div class="name">${escapeHtml(p.name)}</div>
      <div class="meta">${[p.city, p.category].filter(Boolean).map(escapeHtml).join(' · ')}</div>
      ${p.notes ? `<div class="notes">${escapeHtml(p.notes)}</div>` : ''}
      <a class="map-btn" href="${p.url}" target="_blank" rel="noopener">📍 Map</a>
    </div>
  `).join('');
}

/* ---------------- Rendering: Handy screen ---------------- */

let HANDY = null;

/**
 * Escape text, then turn phone numbers into tap-to-call links. Display text is unchanged.
 * Matches: 112, Australian 1300 numbers, and international +NN numbers.
 * The "(0)" trunk prefix is dropped from the dialled number only (+32 (0)2 → +322).
 */
const PHONE_RE = /(\+\d[\d ()]{6,}\d|\b1300 \d{3} \d{3}\b|\b112\b)/g;
function linkifyPhones(text) {
  return escapeHtml(text).replace(PHONE_RE, (m) => {
    const dial = m.replace(/\(0\)/g, '').replace(/[^\d+]/g, '');
    return `<a class="tel-link" href="tel:${dial}">${m}</a>`;
  });
}

function sourceLine(item) {
  if (!item || !item.source) return '';
  return `<a class="source-link" href="${item.source}" target="_blank" rel="noopener">source, verified ${escapeHtml(item.verified || '')}</a>`;
}

function renderHandy() {
  const el = document.getElementById('handy-list');
  if (!HANDY) {
    el.innerHTML = '<p style="color:var(--text-soft);font-size:14px;">Handy Info couldn\'t be loaded.</p>';
    return;
  }

  const emergencyHtml = `
    <section class="handy-section">
      <h2>🚨 Emergency</h2>
      ${HANDY.emergency.map((e) => `
        <div class="handy-item">
          <div class="handy-label">${escapeHtml(e.label)}</div>
          <div class="handy-value">${linkifyPhones(e.value)}</div>
          ${sourceLine(e)}
        </div>
      `).join('')}
    </section>
  `;

  const countryHtml = Object.entries(HANDY.countries).map(([name, c]) => `
    <section class="handy-section">
      <h2>🌍 ${escapeHtml(name)}</h2>
      <div class="handy-item">
        <div class="handy-label">Currency</div>
        <div class="handy-value">${escapeHtml(c.currency.value)}</div>
        ${sourceLine(c.currency)}
      </div>
      <div class="handy-item">
        <div class="handy-label">Plug type</div>
        <div class="handy-value">${escapeHtml(c.plug.value)}</div>
        ${sourceLine(c.plug)}
      </div>
      <div class="handy-item">
        <div class="handy-label">Tipping</div>
        <div class="handy-value">${escapeHtml(c.tipping.value)}</div>
        ${sourceLine(c.tipping)}
      </div>
      <div class="handy-item">
        <div class="handy-label">Key phrases</div>
        <table class="phrase-table">
          ${c.phrases.map((p) => `<tr><td>${escapeHtml(p.en)}</td><td>${escapeHtml(p.local)}</td></tr>`).join('')}
        </table>
      </div>
    </section>
  `).join('');

  const transportHtml = `
    <section class="handy-section">
      <h2>🚆 Transport</h2>
      ${HANDY.transport.map((t) => `
        <div class="handy-item">
          <a class="handy-value link" href="${t.url}" target="_blank" rel="noopener">${escapeHtml(t.name)}</a>
          <div class="handy-notes">${escapeHtml(t.note)}</div>
        </div>
      `).join('')}
    </section>
  `;

  const tomorrowlandHtml = `
    <section class="handy-section">
      <h2>🎶 Tomorrowland</h2>
      ${HANDY.tomorrowland.map((t) => `
        <div class="handy-item">
          <a class="handy-value link" href="${t.url}" target="_blank" rel="noopener">${escapeHtml(t.label)}</a>
        </div>
      `).join('')}
    </section>
  `;

  const weatherHtml = `
    <section class="handy-section">
      <h2>☀️ Weather</h2>
      <div class="weather-grid">
        ${HANDY.weather.map((w) => `<a class="weather-chip" href="${w.url}" target="_blank" rel="noopener">${escapeHtml(w.city)}</a>`).join('')}
      </div>
    </section>
  `;

  el.innerHTML = emergencyHtml + countryHtml + transportHtml + tomorrowlandHtml + weatherHtml;
}

/* ---------------- Navigation ---------------- */

let currentScreen = 'today';

function showScreen(name) {
  currentScreen = name;
  document.querySelectorAll('.screen').forEach((s) => s.classList.remove('active'));
  document.getElementById(`screen-${name}`).classList.add('active');
  document.querySelectorAll('.bottom-nav button').forEach((b) => b.classList.toggle('active', b.dataset.screen === name));
  const titles = { today: 'Europe 2027', overview: 'Trip Overview', places: 'Places to Try', handy: 'Handy Info' };
  document.getElementById('topbar-title').textContent = titles[name];
  // Day strip + day controls belong to the Today screen only.
  document.body.classList.toggle('on-today', name === 'today');
  window.scrollTo(0, 0);
}

function renderCurrentScreen() {
  if (currentScreen === 'today') renderToday();
  if (currentScreen === 'overview') renderOverview();
  if (currentScreen === 'places') { renderPlacesFilter(); renderPlacesList(); }
  if (currentScreen === 'handy') renderHandy();
}

document.querySelectorAll('.bottom-nav button').forEach((btn) => {
  btn.addEventListener('click', () => {
    showScreen(btn.dataset.screen);
    renderCurrentScreen();
  });
});

document.getElementById('day-prev').addEventListener('click', () => goToDay(STATE.currentDayIdx - 1));
document.getElementById('day-next').addEventListener('click', () => goToDay(STATE.currentDayIdx + 1));
document.getElementById('day-today').addEventListener('click', () => goToDay(todayDayIndex()));

// Swipe between days: only clearly horizontal swipes count, so scrolling down a
// long day (with a little sideways drift) never flips the day by accident.
let touchStart = null;
const todayScreen = document.getElementById('screen-today');
todayScreen.addEventListener('touchstart', (e) => {
  touchStart = { x: e.touches[0].clientX, y: e.touches[0].clientY };
}, { passive: true });
todayScreen.addEventListener('touchend', (e) => {
  if (!touchStart) return;
  const dx = e.changedTouches[0].clientX - touchStart.x;
  const dy = e.changedTouches[0].clientY - touchStart.y;
  touchStart = null;
  if (Math.abs(dx) < 60 || Math.abs(dx) < 2 * Math.abs(dy)) return;
  goToDay(STATE.currentDayIdx + (dx < 0 ? 1 : -1));
}, { passive: true });

/* ---------------- Data load + refresh ---------------- */

let refreshing = false;
let lastRefreshAttempt = 0;

function applyData({ csvText, source, fetchedAt }) {
  const { days, places, meta } = parseItinerary(csvText);
  const keepDay = STATE.days.length ? STATE.days[STATE.currentDayIdx]?.day : null;
  let idx = keepDay != null ? days.findIndex((d) => d.day === keepDay) : -1;
  if (idx === -1) idx = pickInitialDayIndex(days);
  STATE = { days, places, meta, source, fetchedAt, currentDayIdx: idx };
}

/** Check the sheet in the background. The saved copy stays on screen meanwhile. */
async function refreshFromSheet() {
  if (refreshing) return;
  refreshing = true;
  lastRefreshAttempt = Date.now();
  renderSyncFooter();
  try {
    applyData(await fetchLiveCSV());
    renderCurrentScreen();
  } catch (_) {
    /* no/weak signal: keep showing the saved copy */
  } finally {
    refreshing = false;
    renderSyncFooter();
  }
}

document.getElementById('sync-footer').addEventListener('click', refreshFromSheet);

// Home-screen apps resume instead of reloading, so re-check when the app comes back.
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible' && Date.now() - lastRefreshAttempt > 2 * 60 * 1000) {
    refreshFromSheet();
  }
});

/* ---------------- Boot ---------------- */

async function boot() {
  document.body.classList.add('on-today');
  // 1. Show the saved copy instantly (works with no signal).
  applyData(await loadLocalCSV());
  renderToday();
  renderSyncFooter();

  // 2. Then check the sheet in the background (8s timeout).
  refreshFromSheet();

  try {
    const res = await fetch('content/handy.json');
    HANDY = await res.json();
  } catch (_) { HANDY = null; }

  if ('serviceWorker' in navigator) {
    // After a site update, reload once so the new version is used straight away.
    const hadController = Boolean(navigator.serviceWorker.controller);
    let reloaded = false;
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      if (hadController && !reloaded) { reloaded = true; window.location.reload(); }
    });
    navigator.serviceWorker.register('sw.js').catch(() => {});
  }
}

boot();
