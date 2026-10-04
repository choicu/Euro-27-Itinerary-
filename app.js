import { loadLocalCSV, fetchLiveCSV, parseItinerary } from './data.js';
import { icon } from './icons.js';

const TRIP_START = new Date(2027, 5, 30); // 30 Jun 2027
const TRIP_END = new Date(2027, 6, 31);   // 31 Jul 2027

let STATE = { days: [], places: [], meta: null, currentDayIdx: 0 };

/*
 * Friends' views. One shared link (?for=friends) asks "Who are you?" once and
 * remembers the answer on that phone. Ranges are fixed DATES (inclusive), not day
 * numbers or sheet notes, so they survive rewording notes or inserting days.
 * Edit here if plans change.
 */
const GROUPS = {
  'chants-alan': { label: 'Chants & Alan', from: new Date(2027, 6, 6), to: new Date(2027, 6, 28) },  // Day 7–29
  'tiff-petez':  { label: 'Tiff & Petez',  from: new Date(2027, 6, 11), to: new Date(2027, 6, 20) }, // Day 12–21
};
const GROUP_KEY = 'europe2027_group_v1';
const URL_FOR = new URLSearchParams(window.location.search).get('for');
const FRIENDS_LINK = URL_FOR === 'friends';

function loadSavedGroup() {
  try {
    const id = localStorage.getItem(GROUP_KEY);
    return id && GROUPS[id] ? id : null;
  } catch (_) { return null; }
}
function saveGroup(id) {
  try { id ? localStorage.setItem(GROUP_KEY, id) : localStorage.removeItem(GROUP_KEY); } catch (_) { /* not fatal */ }
}

// Jason's reset link (?for=all): clears any couple saved on this phone and shows the full trip.
if (URL_FOR === 'all') saveGroup(null);

let groupId = URL_FOR === 'all' ? null : loadSavedGroup(); // remembered couple (applies even if ?for= is lost)
const currentGroup = () => (groupId ? GROUPS[groupId] : null);

/*
 * Friends mode: opened via the friends link, or a couple is saved on this phone.
 * In friends mode ONLY that couple's days are ever shown — no full-trip option.
 */
const isFriendsMode = () => Boolean(FRIENDS_LINK || currentGroup());

/** Indices of STATE.days currently viewable. Friends: just their dates (empty until they pick). */
function visibleIdx() {
  const all = STATE.days.map((_, i) => i);
  if (!isFriendsMode()) return all;
  const g = currentGroup();
  if (!g) return [];
  return all.filter((i) => {
    const d = STATE.days[i].date;
    return d && d >= g.from && d <= g.to;
  });
}

/** True when a couple is chosen but none of their dates are in the plan. */
function groupDatesMissing() {
  const g = currentGroup();
  if (!g) return false;
  return !STATE.days.some((d) => d.date && d.date >= g.from && d.date <= g.to);
}

function fmtTime(d) {
  return d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
}

const MON = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
/** "6 Jul" */
function shortDate(d) { return d ? `${d.getDate()} ${MON[d.getMonth()]}` : ''; }
/** "6–28 Jul" or "30 Jun–1 Jul" */
function shortRange(a, b) {
  if (!a || !b) return '';
  if (sameDate(a, b)) return shortDate(a);
  return a.getMonth() === b.getMonth() ? `${a.getDate()}–${shortDate(b)}` : `${shortDate(a)}–${shortDate(b)}`;
}
/** "Day 7–29 · 6–28 Jul" for a list of day objects */
function dayRangeLabel(days) {
  if (!days.length) return '';
  const f = days[0], l = days[days.length - 1];
  const dayPart = f.day === l.day ? `Day ${f.day}` : `Day ${f.day}–${l.day}`;
  const datePart = shortRange(f.date, l.date);
  return datePart ? `${dayPart} · ${datePart}` : dayPart;
}

/**
 * Only allow real web/phone links into href attributes. Anything else (e.g. a sheet
 * cell containing quotes or a "javascript:" link) becomes null and no link is drawn.
 */
function safeUrl(u) {
  try {
    const url = new URL(String(u ?? ''));
    return ['https:', 'http:', 'tel:'].includes(url.protocol) ? escapeHtml(url.href) : null;
  } catch (_) { return null; }
}
/** <a> for an external link, or '' if the URL isn't safe. */
function extLink(url, cls, inner) {
  const href = safeUrl(url);
  return href ? `<a class="${cls}" href="${href}" target="_blank" rel="noopener noreferrer">${inner}</a>` : '';
}

function escapeHtml(s) {
  return (s ?? '').replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));
}

function pickInitialDayIndex(days) {
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const vis = visibleIdx();
  if (!vis.length) return 0;
  const first = vis[0], last = vis[vis.length - 1];
  const idx = days.findIndex((d) => d.date && sameDate(d.date, today));
  if (idx !== -1 && vis.includes(idx)) return idx;
  if (days[last].date && today > days[last].date) return last;
  return first;
}

function sameDate(a, b) {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}

/** Index of today's day during the trip, else -1. */
function todayDayIndex() {
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  if (today < TRIP_START || today > TRIP_END) return -1;
  const idx = STATE.days.findIndex((d) => d.date && sameDate(d.date, today));
  return visibleIdx().includes(idx) ? idx : -1;
}

/** Change day: re-render and start at the top of the new day. */
function goToDay(idx) {
  if (!visibleIdx().includes(idx)) return;
  STATE.currentDayIdx = idx;
  renderToday();
  window.scrollTo(0, 0);
}

function stepDay(delta) {
  const vis = visibleIdx();
  const pos = vis.indexOf(STATE.currentDayIdx);
  if (pos !== -1) goToDay(vis[pos + delta]);
}

function daysUntil(date) {
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  return Math.ceil((date - today) / (1000 * 60 * 60 * 24));
}

/* ---------------- Rendering: Today screen ---------------- */

function renderCountdownBanner() {
  const el = document.getElementById('countdown-banner');
  const g = currentGroup();
  const inGroupView = g && !groupDatesMissing();
  const n = daysUntil(inGroupView ? g.from : TRIP_START);
  if (n > 0) {
    const what = inGroupView ? 'until you join us' : 'until Europe';
    el.innerHTML = `<div class="countdown-banner"><span class="cd-num">${n}</span><span class="cd-txt">day${n === 1 ? '' : 's'} ${what}</span></div>`;
  } else {
    el.innerHTML = '';
  }
}

function renderDayStrip() {
  const strip = document.getElementById('day-strip');
  const todayIdx = todayDayIndex();
  strip.innerHTML = visibleIdx().map((i) => {
    const d = STATE.days[i];
    const active = i === STATE.currentDayIdx ? ' active' : '';
    const today = i === todayIdx ? ' is-today' : '';
    const loc = escapeHtml(d.endLocation || d.locations[0] || '');
    return `<button class="day-chip${active}${today}" data-idx="${i}" aria-label="Day ${d.day}, ${shortDate(d.date)}, ${loc}${today ? ', today' : ''}">
      <span class="dt">${shortDate(d.date)}</span><span class="n">${d.day}</span><span class="loc">${loc}</span>
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
  const vis = visibleIdx();
  document.getElementById('day-prev').disabled = !vis.length || STATE.currentDayIdx === vis[0];
  document.getElementById('day-next').disabled = !vis.length || STATE.currentDayIdx === vis[vis.length - 1];
  const ti = todayDayIndex();
  document.getElementById('day-today').hidden = ti === -1 || ti === STATE.currentDayIdx;
}

function dayDateLabel(d) {
  if (!d.date) return '';
  return d.date.toLocaleDateString('en-AU', { weekday: 'short', day: 'numeric', month: 'short' });
}

/** Group names in the sheet's day notes (shown with a people icon, text unchanged). */
const PEOPLE_RE = /chants|alan|tiff|pete/i;

function renderDayHeader(d) {
  const header = document.getElementById('day-header');
  const chips = [...d.labelChips, ...d.noteChips];
  const people = chips.filter((c) => PEOPLE_RE.test(c));
  const meta = chips.filter((c) => !PEOPLE_RE.test(c));
  header.innerHTML = `
    <div class="title-row">
      <p class="date-line">Day ${d.day} · ${escapeHtml(dayDateLabel(d))}</p>
      <button type="button" class="share-btn" id="share-day">${icon('share')}<span>Share</span></button>
    </div>
    <h2 class="place-title">${d.locations.map(escapeHtml).join(' <span class="to">→</span> ') || '—'}</h2>
    ${meta.length ? `<p class="meta-line">${meta.map(escapeHtml).join(', ')}</p>` : ''}
    ${people.length ? `<p class="people-line">${icon('users')}<span>${people.map(escapeHtml).join(', ')}</span></p>` : ''}
    ${d.stay ? `<button type="button" class="stay-line" id="stay-btn">
        ${icon('bed', 'stay-ic')}
        <span class="stay-text"><span class="stay-label">Tonight</span><strong>${escapeHtml(d.stay.name)}</strong></span>
        <span class="stay-more">Address${icon('chevRight')}</span>
      </button>` : ''}
  `;
  const btn = document.getElementById('stay-btn');
  if (btn) btn.addEventListener('click', () => showStayPanel(d.stay));
  document.getElementById('share-day').addEventListener('click', (e) => shareDay(d, e.currentTarget));
}

/** Plain-text summary of one day, built only from what's on screen (sheet data). */
function dayShareText(d) {
  const lines = [`📅 Day ${d.day} · ${dayDateLabel(d)} — ${d.locations.join(' → ')}`];
  if (d.stay) lines.push(`🛏️ Tonight: ${d.stay.name}${d.stay.address ? ` (${d.stay.address})` : ''}`);
  for (const slot of ['Morning', 'Afternoon', 'Evening', 'Plans']) {
    const cards = d.slots[slot];
    if (!cards.length) continue;
    lines.push('', slot === 'Plans' ? 'Plans' : slot);
    for (const c of cards) {
      lines.push(`• ${c.title}`.trimEnd());
      if (c.notes) lines.push(`   ${c.notes}`);
      if (c.logistics) lines.push(`   🧭 ${c.logistics}`);
    }
  }
  if (d.empty) lines.push('', 'Nothing planned yet');
  return lines.join('\n');
}

/** Phone share menu if available; otherwise copy to clipboard. */
async function shareDay(d, btn) {
  const text = dayShareText(d);
  const label = btn.innerHTML;
  try {
    if (navigator.share) {
      await navigator.share({ title: `Day ${d.day} plan`, text });
      return;
    }
    await navigator.clipboard.writeText(text);
    btn.textContent = 'Copied ✓';
  } catch (err) {
    if (err && err.name === 'AbortError') return; // user closed the share sheet
    try { await navigator.clipboard.writeText(text); btn.textContent = 'Copied ✓'; }
    catch (_) { btn.textContent = 'Couldn\'t share'; }
  }
  setTimeout(() => { btn.innerHTML = label; }, 1800);
}

/** Tap "Tonight" → big, copyable address for taxis/Uber, plus Maps. Never guesses an address. */
function showStayPanel(stay) {
  const el = document.getElementById('group-picker');
  const mapsUrl = stay.address
    ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(stay.address)}`
    : stay.url;
  el.innerHTML = `<div class="picker-card" role="dialog" aria-label="Tonight's stay">
    <p class="picker-title">${escapeHtml(stay.name)}</p>
    <p class="picker-sub">Tonight's stay</p>
    ${stay.address
      ? `<p class="stay-address" id="stay-address">${escapeHtml(stay.address)}</p>
         <button type="button" class="picker-btn" id="stay-copy"><span>Copy address</span><span class="picker-range">for Uber / taxi</span></button>`
      : `<p class="picker-sub">No address in the sheet yet.</p>`}
    ${mapsUrl ? extLink(mapsUrl, 'picker-btn alt stay-maps', `<span>Open in Maps</span>${icon('pin')}`) : ''}
    <button type="button" class="picker-skip" id="stay-close">Close</button>
  </div>`;
  el.hidden = false;
  stayPanelOpen = true;
  document.getElementById('stay-close').addEventListener('click', closeStayPanel);
  const copy = document.getElementById('stay-copy');
  if (copy) copy.addEventListener('click', async () => {
    let ok = false;
    try { await navigator.clipboard.writeText(stay.address); ok = true; } catch (_) { /* fall back below */ }
    if (!ok) {
      // Fallback: select the text so a long-press "Copy" works.
      const r = document.createRange(); r.selectNodeContents(document.getElementById('stay-address'));
      const s = window.getSelection(); s.removeAllRanges(); s.addRange(r);
    }
    copy.querySelector('span').textContent = ok ? 'Copied ✓' : 'Selected — tap Copy';
  });
}
let stayPanelOpen = false;
function closeStayPanel() { stayPanelOpen = false; closeOverlay(); }

const CATEGORY_ICON = {
  Dining: 'food', Sightseeing: 'camera', Activity: 'star', Entertainment: 'music', Accomodation: 'bed', Transit: 'route',
};

function rowIcon(card) {
  if (card.isCheckOut) return 'door';
  if (card.isCheckIn) return 'bed';
  return CATEGORY_ICON[card.category] || 'dot';
}

function mapBtn(card) {
  return card.hasLink ? extLink(card.url, 'map-btn', `${icon('pin')}<span class="sr">Map for ${escapeHtml(card.title)}</span>`) : '';
}

/** Ordinary activity: a light row on the day's line. */
function rowHtml(card) {
  const cls = card.isCheckIn ? ' is-checkin' : card.isCheckOut ? ' is-checkout' : '';
  return `
    <li class="act${cls}">
      <span class="act-ic">${icon(rowIcon(card))}</span>
      <div class="act-body">
        <p class="act-title">${escapeHtml(card.title)}</p>
        ${card.notes ? `<p class="act-notes">${escapeHtml(card.notes)}</p>` : ''}
        ${card.logistics ? `<p class="act-logi">${icon('clock')}<span>${escapeHtml(card.logistics)}</span></p>` : ''}
      </div>
      ${mapBtn(card)}
    </li>`;
}

/** Consecutive travel legs drawn as one connected route. */
function routeHtml(legs) {
  return `
    <li class="route">
      <ol class="legs">
        ${legs.map((c) => `
          <li class="leg">
            <span class="leg-node">${icon(c.mode === 'route' ? 'route' : c.mode)}</span>
            <div class="leg-body">
              <p class="leg-title">${escapeHtml(c.title)}</p>
              ${c.logistics ? `<p class="leg-time">${escapeHtml(c.logistics)}</p>` : ''}
              ${c.notes ? `<p class="leg-notes">${escapeHtml(c.notes)}</p>` : ''}
            </div>
            ${mapBtn(c)}
          </li>`).join('')}
      </ol>
    </li>`;
}

/** Rows for one slot: runs of travel legs become a route block, everything else a row. */
function slotHtml(cards) {
  const out = [];
  let run = [];
  const flush = () => { if (run.length) { out.push(routeHtml(run)); run = []; } };
  for (const c of cards) {
    if (c.mode) { run.push(c); continue; }
    flush();
    out.push(rowHtml(c));
  }
  flush();
  return out.join('');
}

function renderTimeline(d) {
  const timeline = document.getElementById('timeline');
  if (d.empty) {
    timeline.innerHTML = '<p class="empty-day">Nothing planned yet. Add rows for this day in the sheet and they\'ll show here.</p>';
    return;
  }
  const order = ['Morning', 'Afternoon', 'Evening', 'Plans'];
  timeline.innerHTML = order
    .filter((slot) => d.slots[slot].length > 0)
    .map((slot) => `
      <section class="slot-section">
        <h3 class="slot-title">${slot === 'Plans' ? 'Any time' : slot}</h3>
        <ul class="acts">${slotHtml(d.slots[slot])}</ul>
      </section>
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

/* ---------------- Friends: picker + view bar ---------------- */

/** "Who are you?" picker. Must be answered the first time; after that it can be closed. */
function showGroupPicker() {
  stayPanelOpen = false;
  const el = document.getElementById('group-picker');
  el.innerHTML = `<div class="picker-card" role="dialog" aria-label="Who are you?">
    <p class="picker-title">Who are you?</p>
    <p class="picker-sub">We'll show your days of the trip. You only need to pick once.</p>
    ${Object.entries(GROUPS).map(([id, g]) => {
      const range = dayRangeLabel(STATE.days.filter((d) => d.date && d.date >= g.from && d.date <= g.to));
      const on = id === groupId ? ' aria-pressed="true"' : '';
      return `<button type="button" class="picker-btn" data-id="${id}"${on}>
        <span>${escapeHtml(g.label)}</span><span class="picker-range">${range}</span></button>`;
    }).join('')}
  </div>`;
  el.hidden = false;
  el.querySelectorAll('button[data-id]').forEach((btn) => btn.addEventListener('click', () => chooseGroup(btn.dataset.id)));
}

document.getElementById('group-picker').addEventListener('click', (e) => {
  // Tap outside the card closes it once a couple is chosen; the first pick needs an answer.
  if (e.target.id === 'group-picker' && (currentGroup() || stayPanelOpen)) closeStayPanel();
});
document.getElementById('group-chip').addEventListener('click', showGroupPicker);

function chooseGroup(id) {
  if (!GROUPS[id]) return;
  groupId = id;
  saveGroup(id);
  closeOverlay();
  STATE.currentDayIdx = pickInitialDayIndex(STATE.days);
  renderCurrentScreen();
  window.scrollTo(0, 0);
}

/** Close the picker overlay. */
function closeOverlay() { document.getElementById('group-picker').hidden = true; }

/*
 * Couple chip lives in the pinned header (never scrolls away). Shown on Today and
 * Overview in place of the title; tapping it lets them switch couple.
 */
function renderGroupBar() {
  const chip = document.getElementById('group-chip');
  const title = document.getElementById('topbar-title');
  const g = currentGroup();
  const show = isFriendsMode() && (currentScreen === 'today' || currentScreen === 'overview');
  chip.hidden = !show;
  title.hidden = Boolean(show);
  if (!show) return;
  if (!g) {
    chip.innerHTML = `<span class="gc-name">${icon('users')}Who are you?</span><span class="gc-range">Pick your days${icon('chevDown')}</span>`;
    return;
  }
  chip.innerHTML = `<span class="gc-name">${icon('users')}${escapeHtml(g.label)}</span><span class="gc-range">${escapeHtml(shortRange(g.from, g.to))}${icon('chevDown')}</span>`;
}

function renderToday() {
  renderGroupBar();
  renderCountdownBanner();
  renderDayStrip();
  if (!visibleIdx().includes(STATE.currentDayIdx)) {
    // Friends mode with no couple picked yet, or their dates aren't in the plan: show no days.
    const g = currentGroup();
    document.getElementById('day-header').innerHTML = g
      ? `<p class="title">No days to show</p><p class="locations">Couldn't find ${escapeHtml(g.label)}'s dates in the plan yet.</p>`
      : `<p class="title">Who are you?</p><p class="locations">Tap the button at the top to pick your days.</p>`;
    document.getElementById('timeline').innerHTML = '';
    return;
  }
  const d = STATE.days[STATE.currentDayIdx];
  renderDayHeader(d);
  renderTimeline(d);
}

/* ---------------- Rendering: Overview screen ---------------- */

/** Trip strip: consecutive days grouped by where each day finishes. */
function computeBlocks(days) {
  const blocks = [];
  let cur = null;
  for (const d of days) {
    const key = d.endLocation || d.locations[d.locations.length - 1] || '—';
    if (!cur || cur.key !== key) {
      cur = { key, startDay: d.day, days: [d] };
      blocks.push(cur);
    } else {
      cur.days.push(d);
    }
  }
  return blocks;
}

function renderOverview() {
  const list = document.getElementById('overview-list');
  renderGroupBar();
  const todayIdx = todayDayIndex();
  const todayDay = todayIdx === -1 ? null : STATE.days[todayIdx].day;
  const blocks = computeBlocks(visibleIdx().map((i) => STATE.days[i]));
  list.innerHTML = `<ol class="trip-strip">${blocks.map((b) => {
    const first = b.days[0], last = b.days[b.days.length - 1];
    const n = b.days.length;
    const isNow = todayDay != null && b.days.some((d) => d.day === todayDay);
    return `<li class="stop${isNow ? ' is-now' : ''}">
      <button type="button" class="stop-btn" data-start="${b.startDay}">
        <span class="stop-dot"></span>
        <span class="stop-body">
          <span class="stop-place">${escapeHtml(b.key)}</span>
          <span class="stop-when"><strong>${escapeHtml(shortRange(first.date, last.date))}</strong><span class="stop-days">Day ${first.day === last.day ? first.day : `${first.day}–${last.day}`}, ${n} day${n === 1 ? '' : 's'}</span></span>
        </span>
        ${isNow ? '<span class="now-tag">Today</span>' : icon('chevRight')}
      </button>
    </li>`;
  }).join('')}</ol>`;
  list.querySelectorAll('.stop-btn').forEach((el) => {
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
  const cities = Array.from(new Set(STATE.places.map((p) => p.area).filter(Boolean)));
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
  const items = placesFilter === 'All' ? STATE.places : STATE.places.filter((p) => p.area === placesFilter);
  list.innerHTML = `<ul class="place-list">${items.map((p) => `
    <li class="place-card">
      <div class="place-body">
        <p class="name">${escapeHtml(p.name)}</p>
        <p class="meta">${[p.category, p.area].filter(Boolean).map(escapeHtml).join(' in ')}</p>
        ${p.notes ? `<p class="notes">${escapeHtml(p.notes)}</p>` : ''}
      </div>
      ${extLink(p.url, 'map-btn', `${icon('pin')}<span class="sr">Map for ${escapeHtml(p.name)}</span>`)}
    </li>
  `).join('')}</ul>`;
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
  return extLink(item.source, 'source-link', `source, verified ${escapeHtml(item.verified || '')}`);
}

/* Which Handy country each itinerary Location belongs to. Edit if new locations are added. */
const LOCATION_COUNTRY = {
  Rome: 'Italy', Tuscany: 'Italy', Sorrento: 'Italy', Positano: 'Italy', Capri: 'Italy',
  Mykonos: 'Greece', Paros: 'Greece', Milos: 'Greece', Athens: 'Greece',
  Brussels: 'Belgium', Tomorrowland: 'Belgium', Antwerp: 'Belgium', Boom: 'Belgium',
  Amsterdam: 'Netherlands',
};

/** Country for today's date (where you end up that day), or null outside the trip / unknown. */
function currentCountry() {
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const d = STATE.days.find((x) => x.date && sameDate(x.date, today));
  if (!d || !d.locations.length) return null;
  return LOCATION_COUNTRY[d.locations[d.locations.length - 1]] || null;
}

/** Emergency order when in a country: 112 first, then that country's embassy, then the rest. */
function rankEmergency(e, country) {
  if (/\b112\b/.test(e.value)) return 0;
  if (e.label.includes(`(${country})`)) return 1;
  return 2;
}

function renderHandy() {
  const el = document.getElementById('handy-list');
  if (!HANDY) {
    el.innerHTML = '<p class="muted-note">Handy Info couldn\'t be loaded.</p>';
    return;
  }

  // Today's country (during the trip only) goes first: its embassy right after 112, its section above the others.
  const here = currentCountry();
  const emergency = here
    ? [...HANDY.emergency].sort((a, b) => rankEmergency(a, here) - rankEmergency(b, here))
    : HANDY.emergency;
  const countries = Object.entries(HANDY.countries)
    .sort(([a], [b]) => (a === here ? -1 : b === here ? 1 : 0));

  const emergencyHtml = `
    <section class="handy-section">
      <h2>${icon('alert')}Emergency</h2>
      ${emergency.map((e) => `
        <div class="handy-item">
          <div class="handy-label">${escapeHtml(e.label)}</div>
          <div class="handy-value">${linkifyPhones(e.value)}</div>
          ${sourceLine(e)}
        </div>
      `).join('')}
    </section>
  `;

  const countryHtml = countries.map(([name, c]) => `
    <section class="handy-section">
      <h2>${icon('globe')}${escapeHtml(name)}${name === here ? ' <span class="here-badge">You\'re here</span>' : ''}</h2>
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
      <h2>${icon('train')}Transport</h2>
      ${HANDY.transport.map((t) => `
        <div class="handy-item">
          ${extLink(t.url, 'handy-value link', escapeHtml(t.name))}
          <div class="handy-notes">${escapeHtml(t.note)}</div>
        </div>
      `).join('')}
    </section>
  `;

  const tomorrowlandHtml = `
    <section class="handy-section">
      <h2>${icon('music')}Tomorrowland</h2>
      ${HANDY.tomorrowland.map((t) => `
        <div class="handy-item">
          ${extLink(t.url, 'handy-value link', escapeHtml(t.label))}
        </div>
      `).join('')}
    </section>
  `;

  const weatherHtml = `
    <section class="handy-section">
      <h2>${icon('sun')}Weather</h2>
      <div class="weather-grid">
        ${HANDY.weather.map((w) => extLink(w.url, 'weather-chip', escapeHtml(w.city))).join('')}
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
  const titles = { today: 'Europe 2027', overview: 'The route', places: 'Places to try', handy: 'Handy info' };
  document.getElementById('topbar-title').textContent = titles[name];
  renderGroupBar();
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

document.getElementById('day-prev').addEventListener('click', () => stepDay(-1));
document.getElementById('day-next').addEventListener('click', () => stepDay(1));
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
  stepDay(dx < 0 ? 1 : -1);
}, { passive: true });

/* ---------------- Data load + refresh ---------------- */

let refreshing = false;
let lastRefreshAttempt = 0;

function applyData({ csvText, source, fetchedAt }) {
  const { days, places, meta } = parseItinerary(csvText);
  const keepDay = STATE.days.length ? STATE.days[STATE.currentDayIdx]?.day : null;
  STATE = { days, places, meta, source, fetchedAt, currentDayIdx: 0 };
  const idx = keepDay != null ? days.findIndex((d) => d.day === keepDay) : -1;
  STATE.currentDayIdx = idx !== -1 && visibleIdx().includes(idx) ? idx : pickInitialDayIndex(days);
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
  if (isFriendsMode() && !currentGroup()) showGroupPicker();

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
