// Runs before the page renders (separate file so the Content Security Policy can forbid inline scripts).
(function () {
  // Friends link keeps ?for=friends when added to the home screen (own manifest with that start_url).
  if (new URLSearchParams(location.search).get('for') === 'friends') {
    document.getElementById('app-manifest').setAttribute('href', 'manifest-friends.webmanifest');
  }
  // First visit (no saved copy): fetch the bundled itinerary in parallel with the app code.
  var saved = null;
  try { saved = localStorage.getItem('itinerary_csv_cache_v1'); } catch (e) { /* storage blocked */ }
  if (!saved) {
    var l = document.createElement('link');
    l.rel = 'preload'; l.as = 'fetch'; l.href = 'data/itinerary.snapshot.csv'; l.crossOrigin = 'anonymous';
    document.head.appendChild(l);
  }
})();
