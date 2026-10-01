(function (window) {
  'use strict';
  const protectedMutations = new Set([
    '/api/backup',
    '/api/paper-trade',
    '/api/ma-watchlist',
    '/api/analyze',
    '/api/rebalance-ai',
    '/api/research',
    '/api/summarize',
  ]);
  const originalFetch = window.fetch.bind(window);

  window.fetch = function (input, init) {
    init = init || {};
    let url;
    try {
      url = new URL(typeof input === 'string' ? input : input.url, window.location.href);
    } catch {
      return originalFetch(input, init);
    }
    const requestMethod = (init.method || (typeof input !== 'string' && input.method) || 'GET').toUpperCase();
    if (url.origin !== window.location.origin || !protectedMutations.has(url.pathname) ||
        !['POST', 'PUT', 'DELETE', 'PATCH'].includes(requestMethod)) {
      return originalFetch(input, init);
    }

    const headers = new Headers(typeof input !== 'string' && input.headers ? input.headers : undefined);
    new Headers(init.headers || {}).forEach((value, key) => headers.set(key, value));
    const token = window.localStorage.getItem('gh_token') || '';
    if (token && !headers.has('Authorization')) headers.set('Authorization', 'Bearer ' + token);
    return originalFetch(input, { ...init, headers });
  };
})(window);
