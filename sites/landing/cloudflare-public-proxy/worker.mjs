const PRIMARY_HOST = 'awardgrid.dowhiz.com';
const ROOT_FILES = new Set([
  '/robots.txt', '/sitemap.xml', '/llms.txt',
  '/665e809ddf84f9e36cd81d6f8842eaf6.txt', '/favicon.ico', '/favicon.svg',
]);

function publicPath(url) {
  // Match the existing eleven Worker routes, including their query semantics.
  if (['/ios', '/privacy', '/support', '/_site/'].some((prefix) => url.pathname.startsWith(prefix))) return true;
  return !url.search && (url.pathname === '/' || ROOT_FILES.has(url.pathname));
}

function error(status, message, extra = {}) {
  return new Response(message, {
    status,
    headers: { 'Cache-Control': 'no-store', 'X-Robots-Tag': 'noindex', ...extra },
  });
}

export default {
  async fetch(request, env) {
    const incoming = new URL(request.url);
    if (!publicPath(incoming)) return error(404, 'Not found');
    if (!['GET', 'HEAD'].includes(request.method)) return error(405, 'Method not allowed', { Allow: 'GET, HEAD' });

    let origin;
    try { origin = new URL(env.PUBLIC_ORIGIN); } catch { return error(503, 'Public origin is not configured'); }
    if (origin.protocol !== 'https:' || !origin.hostname.endsWith('.vercel.app') || origin.username || origin.password || origin.port) {
      return error(503, 'Public origin is not configured');
    }
    const upstream = new URL(incoming.pathname + incoming.search, origin.origin);
    const headers = new Headers();
    // Public static files do not need cookies, authorization, or visitor IPs.
    for (const name of ['accept', 'accept-encoding', 'if-none-match', 'if-modified-since', 'range', 'if-range', 'user-agent']) {
      const value = request.headers.get(name);
      if (value !== null) headers.set(name, value);
    }

    let fetched;
    try {
      fetched = await fetch(new Request(upstream, { method: request.method, headers, redirect: 'manual' }));
    } catch { return error(502, 'Public site temporarily unavailable'); }

    // Copy the stream without reading or buffering it.
    const response = new Response(fetched.body, fetched);
    response.headers.delete('Set-Cookie');
    if (incoming.hostname === PRIMARY_HOST && response.status < 400) {
      // Vercel aliases are noindex; the canonical primary hostname is public.
      response.headers.delete('X-Robots-Tag');
    } else {
      response.headers.set('X-Robots-Tag', 'noindex');
    }
    const location = response.headers.get('Location');
    if (location) {
      const target = new URL(location, upstream);
      if (target.origin === origin.origin) {
        const pagePath = (path) => path.replace(/\/index\.html$/, '/').replace(/\/$/, '');
        // Low-level Vercel Location headers may omit the incoming query.
        // Preserve it only for normalization of the same public page.
        if (!target.search && incoming.search && pagePath(target.pathname) === pagePath(incoming.pathname)) {
          target.search = incoming.search;
        }
        response.headers.set('Location', incoming.origin + target.pathname + target.search + target.hash);
      }
    }
    response.headers.set('X-AwardGrid-Public-Origin', 'vercel');
    return response;
  },
};
