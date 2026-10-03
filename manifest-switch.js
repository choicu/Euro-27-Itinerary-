// Friends link keeps ?for=friends when added to the home screen (own manifest with that start_url).
// Separate file (not inline) so the Content Security Policy can forbid inline scripts.
(function () {
  if (new URLSearchParams(location.search).get('for') === 'friends') {
    document.getElementById('app-manifest').setAttribute('href', 'manifest-friends.webmanifest');
  }
})();
