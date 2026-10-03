import { loadItineraryCSV, parseItinerary } from './data.js';

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
    btn.addEventListener('click', () => {
      STATE.currentDayIdx = parseInt(btn.dataset.idx, 10);
      renderToday();
    });
  });
  const activeChip = strip.querySelector('.day-chip.active');
  if (activeChip) activeChip.scrollIntoView({ inline: 'center', block: 'nearest' });
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
      <a class="map-btn" href="${card.url}" target="_blank" rel="noopener">📍 ${card.linkLabel ? 'Map' : 'Search map'}</a>
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
  if (source === 'live') {
    el.textContent = `Updated ${new Date(fetchedAt).toLocaleString('en-AU', { dateStyle: 'medium', timeStyle: 'short' })} from sheet`;
  } else if (source === 'cache') {
    el.textContent = `Offline — showing saved copy from ${fetchedAt ? new Date(fetchedAt).toLocaleString('en-AU', { dateStyle: 'medium', timeStyle: 'short' }) : 'earlier'}`;
  } else {
    el.textContent = 'Offline — showing bundled starting copy';
  }
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
      STATE.currentDayIdx = STATE.days.findIndex((d) => d.day === day);
      showScreen('today');
      renderToday();
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
          <div class="handy-value">${escapeHtml(e.value)}</div>
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

function showScreen(name) {
  document.querySelectorAll('.screen').forEach((s) => s.classList.remove('active'));
  document.getElementById(`screen-${name}`).classList.add('active');
  document.querySelectorAll('.bottom-nav button').forEach((b) => b.classList.toggle('active', b.dataset.screen === name));
  const titles = { today: 'Europe 2027', overview: 'Trip Overview', places: 'Places to Try', handy: 'Handy Info' };
  document.getElementById('topbar-title').textContent = titles[name];
}

document.querySelectorAll('.bottom-nav button').forEach((btn) => {
  btn.addEventListener('click', () => {
    const name = btn.dataset.screen;
    showScreen(name);
    if (name === 'overview') renderOverview();
    if (name === 'places') { renderPlacesFilter(); renderPlacesList(); }
    if (name === 'handy') renderHandy();
  });
});

document.getElementById('day-prev').addEventListener('click', () => {
  if (STATE.currentDayIdx > 0) { STATE.currentDayIdx--; renderToday(); }
});
document.getElementById('day-next').addEventListener('click', () => {
  if (STATE.currentDayIdx < STATE.days.length - 1) { STATE.currentDayIdx++; renderToday(); }
});

let touchStartX = null;
document.getElementById('screen-today').addEventListener('touchstart', (e) => { touchStartX = e.touches[0].clientX; });
document.getElementById('screen-today').addEventListener('touchend', (e) => {
  if (touchStartX === null) return;
  const dx = e.changedTouches[0].clientX - touchStartX;
  if (Math.abs(dx) > 50) {
    if (dx < 0 && STATE.currentDayIdx < STATE.days.length - 1) { STATE.currentDayIdx++; renderToday(); }
    if (dx > 0 && STATE.currentDayIdx > 0) { STATE.currentDayIdx--; renderToday(); }
  }
  touchStartX = null;
});

/* ---------------- Boot ---------------- */

async function boot() {
  const { csvText, source, fetchedAt } = await loadItineraryCSV();
  const { days, places, meta } = parseItinerary(csvText);
  STATE = { days, places, meta, source, fetchedAt, currentDayIdx: pickInitialDayIndex(days) };
  renderToday();
  renderSyncFooter();

  try {
    const res = await fetch('content/handy.json');
    HANDY = await res.json();
  } catch (_) { HANDY = null; }

  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  }
}

boot();
