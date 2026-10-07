# awardgrid-auth: the OAuth token service (not deployed)

The Worker behind "Connect seats.aero" in the OAuth flavour of AwardGrid for iPhone (`VITE_AG_CONNECT=oauth`,
`apps/ios/src/app/flags.ts`). It holds AwardGrid's seats.aero OAuth client secret, so the secret never ships in the
app, and it does the two calls seats.aero wants made from a server: the code exchange and the token refresh.

**Status: not deployed.** Nothing in CI deploys it. It is deployed only when the release plan selects the OAuth build
(47F step 2), by the owner, under the owner's Cloudflare login.

## Shape

```
iPhone app ── ASWebAuthenticationSession ──► https://seats.aero/oauth2/consent?response_type=code&client_id=…
                                               &redirect_uri=https://awardgrid.dowhiz.com/oauth/seats/callback
                                               &state=…&scope=openid
seats.aero ── 302 ──► GET  awardgrid.dowhiz.com/oauth/seats/callback?code=…&state=…
Worker     ── 302 ──► com.dowhiz.awardgrid://oauth/seats?code=…&state=…   (caught by the authentication session)
iPhone app ── native HTTP ──► POST /oauth/seats/token   {code, state}       ──► seats.aero /oauth2/token
iPhone app ── native HTTP ──► POST /oauth/seats/refresh {refresh_token}     ──► seats.aero /oauth2/token
iPhone app ── native HTTP ──► https://seats.aero/partnerapi/… with "Partner-Authorization: Bearer seats:ota:…"
```

Searches never pass through the Worker: the device calls seats.aero directly with the access token, as it does with a
pasted key. The Worker sees tokens, never seats.aero data, and keeps neither.

| Path | Method | What it does |
| --- | --- | --- |
| `/oauth/seats/callback` | GET | Checks `code` and `state` for shape and redirects to the app's scheme; passes an `error` on as itself. With no parameters, a short static page. |
| `/oauth/seats/token` | POST | `{code, state}` → seats.aero `authorization_code` grant with the client ID and secret, the pinned redirect URI and `scope: openid`. |
| `/oauth/seats/refresh` | POST | `{refresh_token}` (must start `seats:otr:`) → seats.aero `refresh_token` grant. |

Answers are reduced to `access_token`, `token_type`, `expires_in` and `refresh_token`; seats.aero's error is passed on
as its OAuth error code only. Everything else is a JSON error with no detail.

## Hardening

- Redirect URI pinned in code; client ID and secret from Worker secrets only.
- Format checks on every value; JSON bodies of at most 2 KB with exactly the expected fields.
- Per-IP rate limit, 20 requests a minute (`ratelimits` binding `RATE_LIMITER`). Without the binding the Worker
  answers 503.
- No storage bindings, no `vars`, no console calls, observability and Logpush off, no `workers.dev` or preview address.
- No CORS headers; `Cache-Control: no-store`, `Referrer-Policy: no-referrer`, HSTS, `nosniff`; the static page has a
  `default-src 'none'` CSP.
- Never calls seats.aero's user-info endpoint.

`test/worker.test.ts` holds the code and `wrangler.jsonc` to all of this, with seats.aero faked (no network).

## Deploy (owner only, when 47F selects the OAuth build)

```bash
cd sites/auth
npx wrangler login                       # the owner's Cloudflare account
npx wrangler secret put SEATS_CLIENT_ID  # typed by the owner
npx wrangler secret put SEATS_CLIENT_SECRET
npx wrangler deploy
```

Then, before any build uses it:

1. **WAF check:** POST an invalid code through the Worker; the answer must be seats.aero's own OAuth error passed on
   (`{"error": "…"}` with status 400 or 401), not a Cloudflare challenge page.
2. `GET https://awardgrid.dowhiz.com/oauth/seats/callback` with no parameters shows the static page.
3. The app is built with the client ID (`VITE_AG_SEATS_CLIENT_ID=… VITE_AG_CONNECT=oauth npm run build:store`; the
   store build refuses an empty client ID). The client ID is not a secret; the client secret never leaves Cloudflare.

Local development uses `npx wrangler dev` with a `.dev.vars` file holding the two secrets; that file is git-ignored.
