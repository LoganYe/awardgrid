/**
 * awardgrid-site-router: the Cloudflare Worker that serves the static site's pages on awardgrid.dowhiz.com.
 *
 * The web app owns awardgrid.dowhiz.com (`next start` on the owner's Mac, published through the Cloudflare Tunnel).
 * This Worker is bound only to the routes below, so those paths come from the Cloudflare Pages project instead and
 * stay up while the Mac sleeps; no other path ever reaches it (sites/landing/DEPLOY.md).
 *
 *   awardgrid.dowhiz.com/ios*      the iPhone app's page
 *   awardgrid.dowhiz.com/privacy*  the privacy policy (App Store Connect's Privacy Policy URL)
 *   awardgrid.dowhiz.com/support*  the support page (App Store Connect's Support URL)
 *   awardgrid.dowhiz.com/_site/*   the pages' shared stylesheet
 *
 * It asks the Pages project for the same path and query and nothing else: no cookie, no header of the visitor's (the
 * web app's session cookie is on this host and must not travel), only GET and HEAD. A redirect from Pages (it sends
 * /privacy to /privacy/) is pointed back at this host.
 */
const PAGES_ORIGIN = "https://awardgrid-site.pages.dev";

export default {
  async fetch(request) {
    if (request.method !== "GET" && request.method !== "HEAD") {
      return new Response("Method not allowed\n", { status: 405, headers: { allow: "GET, HEAD" } });
    }
    const url = new URL(request.url);
    const upstream = await fetch(PAGES_ORIGIN + url.pathname + url.search, { method: request.method, redirect: "manual" });
    const location = upstream.headers.get("location");
    if (location === null) return upstream;
    const headers = new Headers(upstream.headers);
    headers.set("location", new URL(location, PAGES_ORIGIN).href.replace(PAGES_ORIGIN, url.origin));
    return new Response(upstream.body, { status: upstream.status, headers });
  },
};
