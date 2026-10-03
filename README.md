# Europe 2027 — Daily Guide

Phone-first offline trip guide for the 2027 Europe trip (30 Jun – 31 Jul). Plain HTML/CSS/JS, no build step, hosted on GitHub Pages as a PWA.

## How it works

- **Live data**: `app.js` fetches the published CSV of the `🗺️ Itinerary` tab of the Europe Budget and Itinerary v2 sheet (see `CSV_URL` in `data.js`). On success it's cached in `localStorage` for offline use.
- **Snapshot fallback**: `data/itinerary.snapshot.csv` is used on first-ever open with no signal, before anything is cached. It's a point-in-time copy, not auto-synced.
- **Offline**: `sw.js` is a service worker caching the app shell (cache-first) and sheet data (network-first with cache fallback).

## Refreshing the snapshot

The live fetch means the snapshot rarely matters after first use, but refresh it before departure so a brand-new install (e.g. a friend adding the app the week before) has the latest plan:

1. Open the published CSV URL (in `data.js`, `CSV_URL`) in a browser and save it.
2. Replace `data/itinerary.snapshot.csv` with the new file.
3. Commit and push.

## Updating Handy Info

`content/handy.json` is static reference content (emergency numbers, currency/plugs/tipping/phrases per country, transport links, Tomorrowland links, weather links). It's only edited on request — each item carries a `source` URL and `verified` date; when updating a fact, verify it again and update both fields.

## Bumping the app shell cache

Any change to `index.html`, `styles.css`, `app.js`, or `data.js` won't reach phones that already installed the app until the service worker cache version is bumped. Edit `CACHE_VERSION` in `sw.js` (e.g. `v1` → `v2`) whenever you ship a shell change.
