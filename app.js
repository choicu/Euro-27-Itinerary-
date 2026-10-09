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

const WEEKDAY = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
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

document.getElementById('day-strip').addEventListener('click', (e) => {
  const btn = e.target.closest('.day-chip');
  if (btn) goToDay(parseInt(btn.dataset.idx, 10));
});

function renderDayStrip() {
  const strip = document.getElementById('day-strip');
  const todayIdx = todayDayIndex();
  const key = `${visibleIdx().join(',')}|${todayIdx}`;
  if (key === stripKey) {
    // Same days on the strip: just move the highlight (cheap, keeps scrolling smooth).
    strip.querySelector('.day-chip.active')?.classList.remove('active');
    strip.querySelector(`.day-chip[data-idx="${STATE.currentDayIdx}"]`)?.classList.add('active');
    finishDayStrip(strip);
    return;
  }
  stripKey = key;
  strip.innerHTML = visibleIdx().map((i) => {
    const d = STATE.days[i];
    const active = i === STATE.currentDayIdx ? ' active' : '';
    const today = i === todayIdx ? ' is-today' : '';
    const loc = escapeHtml(d.endLocation || d.locations[0] || '');
    return `<button class="day-chip${active}${today}" data-idx="${i}" aria-label="Day ${d.day}, ${shortDate(d.date)}, ${loc}${today ? ', today' : ''}">
      <span class="dt">${shortDate(d.date)}</span><span class="n">${d.date ? WEEKDAY[d.date.getDay()] : d.day}</span><span class="loc">${loc}</span>
    </button>`;
  }).join('');
  finishDayStrip(strip);
}

let stripKey = null;
/** Centre the active day and update the arrows / Today button. */
function finishDayStrip(strip) {
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
    <div id="next-up" aria-live="polite"></div>
    ${metaChipsHtml(meta, d)}
    <p class="wx-line" id="wx-line" hidden></p>
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

/**
 * Day labels from the sheet as small chips. Text is shown exactly as in the sheet; two labels
 * are skipped only because the title already says them: "Travel Day" (the → does) and
 * "Travel to X" when X is where the day ends.
 */
function metaChipsHtml(meta, d) {
  const end = (d.locations[d.locations.length - 1] || '').trim().toLowerCase();
  const shown = meta.filter((c) => {
    const t = c.trim();
    if (/^travel day$/i.test(t)) return false;
    const m = t.match(/^travel to (.+)$/i);
    return !(m && m[1].trim().toLowerCase() === end);
  });
  if (!shown.length) return '';
  return `<p class="meta-chips">${shown.map((c) => {
    const transit = /^transit time\b/i.test(c.trim());
    return `<span class="meta-chip${transit ? ' transit' : ''}">${transit ? icon('clock') : ''}${escapeHtml(c.trim())}</span>`;
  }).join('')}</p>`;
}

/** Top of a dismissable panel: grabber (swipe down) and a round close button. */
function sheetTop(closeId) {
  return `<div class="sheet-top"><span class="grabber" aria-hidden="true"></span>
    <button type="button" class="sheet-close" id="${closeId}" aria-label="Close">${icon('close')}</button></div>`;
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
    ${sheetTop('stay-close')}
    <p class="picker-title">${escapeHtml(stay.name)}</p>
    <p class="picker-sub">Tonight's stay</p>
    ${stay.address
      ? `<p class="stay-address" id="stay-address">${escapeHtml(stay.address)}</p>
         <button type="button" class="picker-btn" id="stay-copy"><span>Copy address</span><span class="picker-range">for Uber / taxi</span></button>`
      : `<p class="picker-sub">No address in the sheet yet.</p>`}
    ${mapsUrl ? extLink(mapsUrl, 'picker-btn alt stay-maps', `<span>Open in Maps</span>${icon('pin')}`) : ''}
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

/* Cards on screen, so a tapped row can open its detail panel. */
let CARD_REFS = [];
function ref(card) { CARD_REFS.push(card); return CARD_REFS.length - 1; }

/** Small "Hours" hint on rows that have opening hours. */
function hoursHint(card) {
  return card.hours ? `<span class="hours-hint">${icon('clock')}Hours</span>` : '';
}

/** Ordinary activity: a light row on the day's line. Tap the text for details. */
function rowHtml(card) {
  const cls = card.isCheckIn ? ' is-checkin' : card.isCheckOut ? ' is-checkout' : '';
  return `
    <li class="act${cls}">
      <span class="act-ic">${icon(rowIcon(card))}</span>
      <button type="button" class="act-body" data-card="${ref(card)}">
        <p class="act-title">${escapeHtml(card.title)}${hoursHint(card)}</p>
        ${card.notes ? `<p class="act-notes">${escapeHtml(card.notes)}</p>` : ''}
        ${card.logistics ? `<p class="act-logi">${icon('route')}<span>${escapeHtml(card.logistics)}</span></p>` : ''}
      </button>
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
            <button type="button" class="leg-body" data-card="${ref(c)}">
              <p class="leg-title">${escapeHtml(c.title)}${hoursHint(c)}</p>
              ${c.logistics ? `<p class="leg-time">${escapeHtml(c.logistics)}</p>` : ''}
              ${c.notes ? `<p class="leg-notes">${escapeHtml(c.notes)}</p>` : ''}
            </button>
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
  CARD_REFS = [];
  timeline.innerHTML = order
    .filter((slot) => d.slots[slot].length > 0)
    .map((slot) => `
      <section class="slot-section">
        <h3 class="slot-title">${slot === 'Plans' ? 'Any time' : slot}</h3>
        <ul class="acts">${slotHtml(d.slots[slot])}</ul>
      </section>
    `).join('');
  timeline.querySelectorAll('[data-card]').forEach((el) => {
    el.addEventListener('click', () => {
      const c = CARD_REFS[parseInt(el.dataset.card, 10)];
      showDetailPanel({
        title: c.title, hours: c.hours, notes: c.notes, logistics: c.logistics,
        address: c.address, url: c.hasLink ? c.url : null,
      });
    });
  });
}

/**
 * Tap a place → slide-up panel: opening hours (from the sheet), notes, travel info,
 * address (copyable) and Maps. Shows only what the sheet has; never guesses.
 */
function showDetailPanel(item) {
  const el = document.getElementById('group-picker');
  const mapsUrl = item.address
    ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(item.address)}`
    : item.url;
  el.innerHTML = `<div class="picker-card detail-card" role="dialog" aria-label="${escapeHtml(item.title)}">
    ${sheetTop('detail-close')}
    <p class="picker-title">${escapeHtml(item.title)}</p>
    ${item.sub ? `<p class="picker-sub">${escapeHtml(item.sub)}</p>` : '<div class="detail-gap"></div>'}
    ${item.hours ? `<div class="detail-row">
      ${icon('clock')}
      <div>
        <p class="detail-label">Opening hours</p>
        <p class="detail-value">${escapeHtml(item.hours)}</p>
        <p class="detail-note">From Google Maps / official sites, Oct 2026. Check before you go.</p>
      </div>
    </div>` : ''}
    ${item.notes ? `<div class="detail-row">${icon('info')}<div><p class="detail-label">Notes</p><p class="detail-value">${escapeHtml(item.notes)}</p></div></div>` : ''}
    ${item.logistics ? `<div class="detail-row">${icon('route')}<div><p class="detail-label">Getting there</p><p class="detail-value">${escapeHtml(item.logistics)}</p></div></div>` : ''}
    ${item.address ? `<div class="detail-row">${icon('pin')}<div><p class="detail-label">Address</p><p class="detail-value" id="detail-address">${escapeHtml(item.address)}</p></div></div>
      <button type="button" class="picker-btn" id="detail-copy"><span>Copy address</span><span class="picker-range">for Uber / taxi</span></button>` : ''}
    ${mapsUrl ? extLink(mapsUrl, 'picker-btn alt', `<span>Open in Maps</span>${icon('pin')}`) : ''}
  </div>`;
  el.hidden = false;
  stayPanelOpen = true;
  document.getElementById('detail-close').addEventListener('click', closeStayPanel);
  const copy = document.getElementById('detail-copy');
  if (copy) copy.addEventListener('click', async () => {
    let ok = false;
    try { await navigator.clipboard.writeText(item.address); ok = true; } catch (_) { /* fall back */ }
    if (!ok) {
      const r = document.createRange(); r.selectNodeContents(document.getElementById('detail-address'));
      const s = window.getSelection(); s.removeAllRanges(); s.addRange(r);
    }
    copy.querySelector('span').textContent = ok ? 'Copied ✓' : 'Selected — tap Copy';
  });
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
    ${currentGroup() ? sheetTop('group-close') : ''}
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
  document.getElementById('group-close')?.addEventListener('click', closeStayPanel);
  el.querySelectorAll('button[data-id]').forEach((btn) => btn.addEventListener('click', () => chooseGroup(btn.dataset.id)));
}

document.getElementById('group-picker').addEventListener('click', (e) => {
  // Tap outside the card closes it once a couple is chosen; the first pick needs an answer.
  if (e.target.id === 'group-picker' && (currentGroup() || stayPanelOpen)) closeStayPanel();
});
document.getElementById('group-chip').addEventListener('click', showGroupPicker);

/** A panel can be dismissed once it isn't the first-time "Who are you?" question. */
function panelDismissable() { return stayPanelOpen || Boolean(currentGroup()); }

/* Swipe a panel down to close it (only from its top, so scrolling inside still works). */
(() => {
  const overlay = document.getElementById('group-picker');
  let y0 = null, dy = 0, card = null;
  overlay.addEventListener('touchstart', (e) => {
    card = e.target.closest('.picker-card');
    if (!card || !panelDismissable() || card.scrollTop > 0) { y0 = null; return; }
    y0 = e.touches[0].clientY; dy = 0;
  }, { passive: true });
  overlay.addEventListener('touchmove', (e) => {
    if (y0 === null) return;
    dy = Math.max(0, e.touches[0].clientY - y0);
    card.style.transform = dy ? `translateY(${dy}px)` : '';
  }, { passive: true });
  overlay.addEventListener('touchend', () => {
    if (y0 === null) return;
    y0 = null;
    if (dy > 90) closeStayPanel();
    card.style.transform = '';
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !overlay.hidden && panelDismissable()) closeStayPanel();
  });
})();

/* Swipe left/right on the Today screen to change day (ignores screen-edge swipes and scrolls). */
(() => {
  const screen = document.getElementById('screen-today');
  let x0 = null, y0 = 0;
  screen.addEventListener('touchstart', (e) => {
    const t = e.touches[0];
    x0 = (e.touches.length > 1 || t.clientX < 24 || t.clientX > window.innerWidth - 24) ? null : t.clientX;
    y0 = t.clientY;
  }, { passive: true });
  screen.addEventListener('touchend', (e) => {
    if (x0 === null) return;
    const t = e.changedTouches[0];
    const dx = t.clientX - x0, dy = t.clientY - y0;
    x0 = null;
    if (Math.abs(dx) < 60 || Math.abs(dx) < 2 * Math.abs(dy)) return; // clearly sideways only
    const before = STATE.currentDayIdx;
    stepDay(dx < 0 ? 1 : -1);
    if (STATE.currentDayIdx === before) return;
    const cls = dx < 0 ? 'enter-from-right' : 'enter-from-left';
    for (const id of ['day-header', 'timeline']) {
      const el = document.getElementById(id);
      el.classList.remove('enter-from-right', 'enter-from-left');
      void el.offsetWidth; // restart the animation
      el.classList.add(cls);
    }
  }, { passive: true });
})();

function chooseGroup(id) {
  if (!GROUPS[id]) return;
  groupId = id;
  saveGroup(id);
  closeOverlay();
  STATE.currentDayIdx = pickInitialDayIndex(STATE.days);
  renderCurrentScreen();
  window.scrollTo(0, 0);
  setTimeout(maybeShowInstallTip, 1200);
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
  renderNextUp(d);
  renderWeather(d);
}

/* ---------------- Next up (travel days, on the day itself) ---------------- */

const DONE_KEY = 'europe2027_done_v1';
function loadDone() { try { return JSON.parse(localStorage.getItem(DONE_KEY)) || {}; } catch (_) { return {}; } }
function saveDone(v) { try { localStorage.setItem(DONE_KEY, JSON.stringify(v)); } catch (_) { /* not fatal */ } }
const legKey = (d, c, i) => `${d.day}|${i}|${c.title}`;
let lastDoneKey = null;

/** Travel legs of a day, in the sheet's order. */
function dayLegs(d) {
  const out = [];
  for (const slot of ['Morning', 'Afternoon', 'Evening', 'Plans']) out.push(...d.slots[slot].filter((c) => c.mode));
  return out;
}

/** Only on the actual day: the first leg not marked done, with a Done button (saved on this phone). */
function renderNextUp(d) {
  const el = document.getElementById('next-up');
  const legs = dayLegs(d);
  if (STATE.currentDayIdx !== todayDayIndex() || !legs.length) { el.innerHTML = ''; return; }
  const done = loadDone();
  const keys = legs.map((c, i) => legKey(d, c, i));
  // Dim finished legs in the day list.
  document.querySelectorAll('#timeline .leg').forEach((li) => {
    const c = CARD_REFS[parseInt(li.querySelector('[data-card]')?.dataset.card, 10)];
    const i = legs.indexOf(c);
    const isDone = i !== -1 && Boolean(done[keys[i]]);
    li.classList.toggle('done', isDone);
    const node = li.querySelector('.leg-node');
    if (node && c) node.innerHTML = icon(isDone ? 'check' : (c.mode === 'route' ? 'route' : c.mode));
  });
  const n = keys.findIndex((k) => !done[k]);
  // Undo always reverses the latest leg marked done today (also after closing the app).
  if (!(lastDoneKey && done[lastDoneKey] && keys.includes(lastDoneKey))) lastDoneKey = [...keys].reverse().find((k) => done[k]) || null;
  const undo = lastDoneKey ? '<button type="button" class="nu-undo" id="nu-undo">Undo</button>' : '';
  if (n === -1) {
    el.innerHTML = `<div class="next-up all-done">${icon('check')}<p class="nu-title">All travel done for today</p>${undo}</div>`;
  } else {
    const c = legs[n];
    el.innerHTML = `<div class="next-up">
      <p class="nu-label">Next up · ${n + 1} of ${legs.length}</p>
      <div class="nu-row">
        <span class="nu-ic">${icon(c.mode === 'route' ? 'route' : c.mode)}</span>
        <div class="nu-body">
          <p class="nu-title">${escapeHtml(c.title)}</p>
          ${c.logistics ? `<p class="nu-time">${escapeHtml(c.logistics)}</p>` : ''}
          ${c.notes ? `<p class="nu-notes">${escapeHtml(c.notes)}</p>` : ''}
        </div>
      </div>
      <div class="nu-actions">${undo}<button type="button" class="nu-done" id="nu-done">${icon('check')}Done</button></div>
    </div>`;
    document.getElementById('nu-done').addEventListener('click', () => {
      const v = loadDone(); v[keys[n]] = true; saveDone(v); lastDoneKey = keys[n]; renderNextUp(d);
      (document.getElementById('nu-done') || document.getElementById('nu-undo'))?.focus();
    });
  }
  document.getElementById('nu-undo')?.addEventListener('click', () => {
    const v = loadDone(); delete v[lastDoneKey]; saveDone(v); lastDoneKey = null; renderNextUp(d);
    document.getElementById('nu-done')?.focus();
  });
}

/* ---------------- Weather (Open-Meteo, free, no key) ---------------- */

/* Approximate town-centre coordinates for each itinerary Location. Add new locations here. */
const WX_PLACES = {
  Rome: [41.89, 12.49], Tuscany: [43.27, 11.99], Cortona: [43.27, 11.99], Sorrento: [40.63, 14.38],
  Positano: [40.63, 14.48], Capri: [40.55, 14.24], Naples: [40.85, 14.27], Mykonos: [37.45, 25.33],
  Paros: [37.12, 25.24], Milos: [36.73, 24.45], Athens: [37.98, 23.73], Brussels: [50.85, 4.35],
  Tomorrowland: [51.09, 4.38], Boom: [51.09, 4.38], Antwerp: [51.22, 4.40], Amsterdam: [52.37, 4.90],
};
const WX_KEY = 'europe2027_wx_v1';
const WX_MAX_AGE = 3 * 60 * 60 * 1000; // refetch after 3 hours
const WX_DAYS_AHEAD = 7;               // forecasts further out aren't worth showing

function wxLabel(code) {
  if (code === 0) return ['sun', 'Clear'];
  if (code <= 2) return ['cloudSun', 'Partly cloudy'];
  if (code === 3) return ['cloud', 'Cloudy'];
  if (code === 45 || code === 48) return ['fog', 'Fog'];
  if (code >= 51 && code <= 57) return ['rain', 'Drizzle'];
  if (code >= 61 && code <= 67) return ['rain', 'Rain'];
  if (code >= 71 && code <= 77) return ['cloud', 'Snow'];
  if (code >= 80 && code <= 82) return ['rain', 'Showers'];
  if (code === 85 || code === 86) return ['cloud', 'Snow showers'];
  if (code >= 95) return ['storm', 'Thunderstorms'];
  return ['cloud', ''];
}
const isoDate = (dt) => `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(dt.getDate()).padStart(2, '0')}`;
function loadWx() { try { return JSON.parse(localStorage.getItem(WX_KEY)) || {}; } catch (_) { return {}; } }
function saveWx(v) { try { localStorage.setItem(WX_KEY, JSON.stringify(v)); } catch (_) { /* not fatal */ } }

async function fetchWx(place) {
  const [lat, lon] = WX_PLACES[place];
  const url = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}`
    + '&daily=weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max,uv_index_max'
    + '&timezone=auto&forecast_days=16';
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), 8000);
  try {
    const r = await fetch(url, { signal: ctl.signal, referrerPolicy: 'no-referrer' });
    if (!r.ok) return null;
    const j = await r.json();
    if (!j || !j.daily || !Array.isArray(j.daily.time)) return null;
    const all = loadWx(); all[place] = { at: Date.now(), daily: j.daily }; saveWx(all);
    return all[place];
  } catch (_) { return null; } finally { clearTimeout(t); }
}

/** Forecast line for where the day ends up, once the day is within a week. Hidden otherwise. */
async function renderWeather(d) {
  const el = document.getElementById('wx-line');
  if (!el || !d.date) return;
  const place = d.endLocation || d.locations[d.locations.length - 1];
  const ahead = daysUntil(d.date);
  if (!WX_PLACES[place] || ahead < 0 || ahead > WX_DAYS_AHEAD) return;
  const dayIdx = STATE.currentDayIdx;
  const show = (entry) => {
    if (!entry || STATE.currentDayIdx !== dayIdx || !document.getElementById('wx-line')) return false;
    const i = entry.daily.time.indexOf(isoDate(d.date));
    if (i === -1) return false;
    const v = (k) => entry.daily[k] ? entry.daily[k][i] : null;
    const [ic, label] = wxLabel(v('weather_code'));
    const hi = v('temperature_2m_max'), lo = v('temperature_2m_min');
    const rain = v('precipitation_probability_max'), uv = v('uv_index_max');
    const parts = [];
    if (hi != null && lo != null) parts.push(`<strong>${Math.round(hi)}°</strong> / ${Math.round(lo)}°`);
    if (label) parts.push(escapeHtml(label));
    if (rain != null) parts.push(`Rain ${Math.round(rain)}%`);
    if (uv != null) {
      const u = Math.round(uv);
      parts.push(`UV ${u}${u >= 8 ? ' (limit midday sun)' : u >= 3 ? ' (sun protection)' : ''}`);
    }
    const when = new Date(entry.at).toLocaleString('en-AU', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' });
    const elNow = document.getElementById('wx-line');
    elNow.innerHTML = `${icon(ic)}<span class="wx-main">${escapeHtml(place)} · ${parts.join(' · ')}</span>
      <span class="wx-src">Forecast ${escapeHtml(when)} · ${extLink('https://open-meteo.com/', 'wx-credit', 'Weather data by Open-Meteo.com')}</span>`;
    elNow.hidden = false;
    return true;
  };
  const cached = loadWx()[place];
  const shown = show(cached);
  if (!cached || Date.now() - cached.at > WX_MAX_AGE || !shown) show(await fetchWx(place));
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
      <button type="button" class="place-body" data-place="${STATE.places.indexOf(p)}">
        <p class="name">${escapeHtml(p.name)}${p.hours ? `<span class="hours-hint">${icon('clock')}Hours</span>` : ''}</p>
        <p class="meta">${[p.category, p.area].filter(Boolean).map(escapeHtml).join(' in ')}</p>
        ${p.notes ? `<p class="notes">${escapeHtml(p.notes)}</p>` : ''}
      </button>
      ${extLink(p.url, 'map-btn', `${icon('pin')}<span class="sr">Map for ${escapeHtml(p.name)}</span>`)}
    </li>
  `).join('')}</ul>`;
  list.querySelectorAll('[data-place]').forEach((el) => {
    el.addEventListener('click', () => {
      const p = STATE.places[parseInt(el.dataset.place, 10)];
      showDetailPanel({
        title: p.name, sub: [p.category, p.area].filter(Boolean).join(' in '),
        hours: p.hours, notes: p.notes, url: p.url,
      });
    });
  });
}

/* ---------------- "Add to Home Screen" tip (friends link) ---------------- */

const INSTALL_KEY = 'europe2027_install_tip_v1';
let deferredInstall = null; // Android/Chrome install prompt, if offered

window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault(); // we show our own tip instead of the browser's mini-bar
  deferredInstall = e;
});
window.addEventListener('appinstalled', () => { rememberInstallTip('installed'); hideInstallTip(); });

function isInstalled() {
  return window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone === true;
}
function rememberInstallTip(v) { try { localStorage.setItem(INSTALL_KEY, v); } catch (_) { /* ignore */ } }
function installTipSeen() { try { return Boolean(localStorage.getItem(INSTALL_KEY)); } catch (_) { return true; } }
function isIOS() {
  const ua = navigator.userAgent;
  return /iPhone|iPad|iPod/.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1);
}
function hideInstallTip() { document.getElementById('install-tip').hidden = true; }

/** One-time tip: friends link only, after they've picked their days, never if installed or dismissed. */
function maybeShowInstallTip() {
  if (!FRIENDS_LINK || !currentGroup() || isInstalled() || installTipSeen()) return;
  if (!document.getElementById('group-picker').hidden) return; // don't stack on another panel
  const el = document.getElementById('install-tip');
  const steps = isIOS()
    ? `<ol class="tip-steps">
         <li>Tap the <strong>Share</strong> button ${icon('share')} in your browser's toolbar</li>
         <li>Scroll down and tap <strong>Add to Home Screen</strong></li>
         <li>Tap <strong>Add</strong></li>
       </ol>`
    : deferredInstall
      ? ''
      : `<ol class="tip-steps">
           <li>Tap the browser menu <strong>⋮</strong> (top right)</li>
           <li>Tap <strong>Install app</strong> or <strong>Add to Home screen</strong></li>
         </ol>`;
  el.innerHTML = `
    <p class="tip-title">Keep this guide on your phone</p>
    <p class="tip-sub">Add it to your home screen to open it like an app and use it offline.</p>
    ${steps}
    <div class="tip-actions">
      ${deferredInstall ? '<button type="button" class="tip-primary" id="tip-install">Install</button>' : ''}
      <button type="button" class="tip-later" id="tip-dismiss">${deferredInstall ? 'Not now' : 'Got it'}</button>
    </div>`;
  el.hidden = false;
  document.getElementById('tip-dismiss').addEventListener('click', () => { rememberInstallTip('dismissed'); hideInstallTip(); });
  const inst = document.getElementById('tip-install');
  if (inst) inst.addEventListener('click', async () => {
    const ev = deferredInstall; deferredInstall = null;
    hideInstallTip();
    try {
      ev.prompt();
      const choice = await ev.userChoice;
      rememberInstallTip(choice && choice.outcome === 'accepted' ? 'installed' : 'dismissed');
    } catch (_) { rememberInstallTip('dismissed'); }
  });
}

/* ---------------- Search ---------------- */

/** Lower-case and strip accents so "caffe" matches "Caffè". */
function fold(s) {
  return String(s ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
}

/** Escape text and wrap the first match of q in <mark> (accent-insensitive). */
function markMatch(text, q) {
  const raw = String(text ?? '');
  const i = fold(raw).indexOf(q);
  if (!q || i === -1) return escapeHtml(raw);
  // fold() keeps length for these scripts (one base char per accented char after stripping marks)
  return `${escapeHtml(raw.slice(0, i))}<mark>${escapeHtml(raw.slice(i, i + q.length))}</mark>${escapeHtml(raw.slice(i + q.length))}`;
}

/** Search index: activities on viewable days + Places to try. Rebuilt when data/view changes. */
function searchItems() {
  const items = [];
  for (const i of visibleIdx()) {
    const d = STATE.days[i];
    for (const slot of ['Morning', 'Afternoon', 'Evening', 'Plans']) {
      for (const c of d.slots[slot]) {
        items.push({
          kind: 'act', dayIdx: i, card: c,
          title: c.title, sub: `Day ${d.day} · ${dayDateLabel(d)} · ${c.location || d.endLocation || ''}`,
          hay: fold([c.title, c.notes, c.logistics, c.location, c.hours, c.linkLabel].join(' ')),
        });
      }
    }
  }
  STATE.places.forEach((p, pi) => {
    items.push({
      kind: 'place', placeIdx: pi,
      title: p.name, sub: ['Place to try', p.category, p.area].filter(Boolean).join(' · '),
      hay: fold([p.name, p.area, p.category, p.notes, p.hours].join(' ')),
    });
  });
  return items;
}

function renderSearch() {
  const input = document.getElementById('search-input');
  const out = document.getElementById('search-results');
  const q = fold(input.value.trim());
  if (q.length < 2) {
    out.innerHTML = '<p class="search-empty">Type at least 2 letters, e.g. ferry, gelato, Colosseum.</p>';
    return;
  }
  const hits = searchItems().filter((it) => it.hay.includes(q)).slice(0, 60);
  if (!hits.length) {
    out.innerHTML = `<p class="search-empty">No matches for "${escapeHtml(input.value.trim())}".</p>`;
    return;
  }
  SEARCH_HITS = hits;
  out.innerHTML = `<p class="search-count">${hits.length} result${hits.length === 1 ? '' : 's'}</p>
    <ul class="search-list">${hits.map((h, i) => `
      <li><button type="button" class="search-hit" data-hit="${i}">
        ${icon(h.kind === 'place' ? 'pin' : h.card.mode ? (h.card.mode === 'route' ? 'route' : h.card.mode) : rowIcon(h.card))}
        <span class="hit-body">
          <span class="hit-title">${markMatch(h.title, q)}</span>
          <span class="hit-sub">${escapeHtml(h.sub)}</span>
          ${matchedOutsideTitle(h, q)}
        </span>
      </button></li>`).join('')}</ul>`;
}

/** If the match is in notes/travel/hours (not the title), show that snippet so it's clear why it matched. */
function matchedOutsideTitle(h, q) {
  if (fold(h.title).includes(q)) return '';
  const src = h.kind === 'place' ? STATE.places[h.placeIdx] : h.card;
  for (const f of [src.notes, src.logistics, src.hours]) {
    if (f && fold(f).includes(q)) return `<span class="hit-snip">${markMatch(f, q)}</span>`;
  }
  return '';
}

let SEARCH_HITS = [];
document.getElementById('search-input').addEventListener('input', renderSearch);
document.getElementById('search-input').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') e.currentTarget.blur(); // hide keyboard to show results
});
document.getElementById('search-results').addEventListener('click', (e) => {
  const btn = e.target.closest('.search-hit');
  if (!btn) return;
  const h = SEARCH_HITS[parseInt(btn.dataset.hit, 10)];
  if (h.kind === 'place') {
    const p = STATE.places[h.placeIdx];
    showDetailPanel({ title: p.name, sub: [p.category, p.area].filter(Boolean).join(' in '), hours: p.hours, notes: p.notes, url: p.url });
    return;
  }
  // Jump to the day, then bring the matching row into view and flash it.
  showScreen('today');
  goToDay(h.dayIdx);
  const ri = CARD_REFS.indexOf(h.card);
  const row = ri === -1 ? null : document.querySelector(`[data-card="${ri}"]`);
  if (row) {
    const li = row.closest('li');
    li.scrollIntoView({ block: 'center' });
    li.classList.add('flash');
    setTimeout(() => li.classList.remove('flash'), 1600);
  }
});

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
    return `<a class="tel-link" href="tel:${dial}">${icon('phone')}${m}</a>`;
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

let handyKey = null;
function renderHandy() {
  const el = document.getElementById('handy-list');
  const key = `${HANDY ? 'ok' : 'none'}|${currentCountry() || ''}`;
  if (key === handyKey) return; // already rendered for this country
  handyKey = key;
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
  const titles = { today: 'Europe 2027', overview: 'The route', places: 'Places to try', search: 'Search', handy: 'Handy info' };
  document.getElementById('topbar-title').textContent = titles[name];
  renderGroupBar();
  // Day strip + day controls belong to the Today screen only.
  document.body.classList.toggle('on-today', name === 'today');
  // Let pinned elements (search box) sit exactly under the top bar, whatever its height.
  document.documentElement.style.setProperty('--topbar-h', `${document.querySelector('.topbar').offsetHeight}px`);
  window.scrollTo(0, 0);
}

function renderCurrentScreen() {
  if (currentScreen === 'today') renderToday();
  if (currentScreen === 'overview') renderOverview();
  if (currentScreen === 'places') { renderPlacesFilter(); renderPlacesList(); }
  if (currentScreen === 'handy') renderHandy();
  if (currentScreen === 'search') renderSearch();
}

document.querySelectorAll('.bottom-nav button').forEach((btn) => {
  btn.addEventListener('click', () => {
    showScreen(btn.dataset.screen);
    renderCurrentScreen();
    if (btn.dataset.screen === 'search') document.getElementById('search-input').focus();
  });
});

document.getElementById('day-prev').addEventListener('click', () => stepDay(-1));
document.getElementById('day-next').addEventListener('click', () => stepDay(1));
document.getElementById('day-today').addEventListener('click', () => goToDay(todayDayIndex()));

/* ---------------- Data load + refresh ---------------- */

let refreshing = false;
let lastRefreshAttempt = 0;

let lastCsvText = null;

function applyData({ csvText, source, fetchedAt }) {
  lastCsvText = csvText;
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
    const live = await fetchLiveCSV();
    if (live.csvText === lastCsvText) {
      // Nothing changed in the sheet: just update the "Updated…" time, no re-render (no flicker/jank).
      STATE.source = live.source;
      STATE.fetchedAt = live.fetchedAt;
    } else {
      applyData(live);
      stripKey = null; // day list may have changed
      handyKey = null;
      renderCurrentScreen();
    }
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
  document.body.classList.remove('ready');
  // 1. Show the saved copy instantly (works with no signal).
  applyData(await loadLocalCSV());
  renderToday();
  renderSyncFooter();
  document.body.classList.add('ready');
  if (isFriendsMode() && !currentGroup()) showGroupPicker();
  else setTimeout(maybeShowInstallTip, 1500);

  // 2. Then check the sheet in the background (8s timeout).
  refreshFromSheet();

  try {
    const res = await fetch('content/handy.json');
    HANDY = await res.json();
  } catch (_) { HANDY = null; }

  if ('serviceWorker' in navigator) {
    // After a site update, reload once so the new version is used straight away.
    // After a site update: reload straight away only if the app was just opened; otherwise wait
    // until it's next brought back to the screen, so it never reloads while someone is reading.
    const hadController = Boolean(navigator.serviceWorker.controller);
    const openedAt = Date.now();
    let reloaded = false;
    const reload = () => { if (!reloaded) { reloaded = true; window.location.reload(); } };
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      if (!hadController) return;
      if (Date.now() - openedAt < 4000) { reload(); return; }
      document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible') reload();
      }, { once: true });
    });
    navigator.serviceWorker.register('sw.js').catch(() => {});
  }
}

boot();
