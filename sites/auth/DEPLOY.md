# awardgrid-auth: the token service for Login with Seats.aero (owner runbook)

## 中文摘要

App Store 版 AwardGrid 只通过 seats.aero 自己的登录（Login with Seats.aero）连接账户，这个 Worker 替 App 交换和续期登录令牌。以下步骤只能由 owner 完成：

1. 在 seats.aero › Settings › Developer Tools › Apps › New App 创建 OAuth 应用。回调地址填 `https://awardgrid.dowhiz.com/oauth/seats/callback`，scope 填 `openid`。创建即接受 seats.aero 的 OAuth Addendum。记下 Client ID（不是秘密）；Client Secret 只粘贴进 Cloudflare，绝不放进 git、聊天或任何文件。
2. 部署 Worker `awardgrid-auth`（推荐 `wrangler deploy`：`wrangler.jsonc` 已写好路由、限流绑定和关闭日志；用 Cloudflare 后台时必须手动添加 `RATE_LIMITER` 限流绑定，否则 Worker 一律返回 503，并关闭 Workers Logs 和 traces），把 `SEATS_CLIENT_ID` 和 `SEATS_CLIENT_SECRET` 设为 Worker secret。
3. 添加路由 `awardgrid.dowhiz.com/oauth/*`。现有的 Worker `awardgrid-vercel-public` 只占用网站的 11 个路由，不含 `/oauth/*`，不会冲突（添加前再看一眼）。
4. 做 WAF 检查：用无效的 code 调用 `/oauth/seats/token`，必须得到 seats.aero 的 JSON 错误（如 `{"error":"invalid_grant"}`），而不是 Cloudflare 的验证页面。如果得到 502 的 `{"error":"upstream_blocked"}`（旧版 Worker 是 403 或 429 的 `{"error":"rejected"}`），多半是 seats.aero 自己的 Cloudflare 拦下了 Worker 的请求：这要请 seats.aero 放行，dowhiz.com 这边改不了（见第 4 节）。
5. 用 `VITE_AG_SEATS_CLIENT_ID=<Client ID> npm run build:store` 构建 App；build 号由 owner 决定。
6. 问 seats.aero 想怎么测试（TestFlight 公开链接，需先通过 Beta App Review；或者屏幕录像）。他们测试过之后才会取消 10 个用户的限制。
7. 网页版（私有 web app）也用同一个 OAuth 应用和同一个回调地址：Worker 把以 `web_` 开头的 state 转到 `https://awardgrid.dowhiz.com/api/seats/oauth/callback`。不需要在 seats.aero 改任何设置，只需要重新 `wrangler deploy` 这个 Worker（见第 7 节），并且要在网页版部署之前完成。

## What it is

The Worker behind "Connect seats.aero", for the iPhone app and, since the web app moved to Login with Seats.aero, for
the private web app as well (section 7). It is the only way the App Store build of AwardGrid for iPhone connects a seats.aero
account (`npm run build:store` builds the OAuth flavour, `VITE_AG_CONNECT=oauth`, `apps/ios/src/app/flags.ts`). It
holds AwardGrid's seats.aero OAuth client secret, so the secret never ships in the app, and it makes the two calls
seats.aero wants made from a server: the code exchange and the token refresh.

**Status: deployed on 2026-10-07, after the owner registered the OAuth client with seats.aero; the client ID and
secret are Worker secrets.** Nothing in CI deploys it. Everything below is the owner's, under the owner's seats.aero
and Cloudflare logins. An agent never types a secret, never creates the client and never deploys.

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

Searches never pass through the Worker: the device calls seats.aero directly with the access token. The Worker sees
tokens, never seats.aero data, and keeps neither.

| Path | Method | What it does |
| --- | --- | --- |
| `/oauth/seats/callback` | GET | Checks `code` and `state` for shape and redirects to the app's scheme, or, for a web state (`web_` and 43 base64url characters), to the web app's `https://awardgrid.dowhiz.com/api/seats/oauth/callback`; passes an `error` on as itself. With no parameters, a short static page. |
| `/oauth/seats/token` | POST | `{code, state}` → seats.aero `authorization_code` grant with the client ID and secret, the pinned redirect URI and `scope: openid`. |
| `/oauth/seats/refresh` | POST | `{refresh_token}` (must start `seats:otr:`) → seats.aero `refresh_token` grant. |

Answers are reduced to `access_token`, `token_type`, `expires_in` and `refresh_token`; seats.aero's error is passed on
as its OAuth error code only. Its own errors are JSON with no detail: `not_configured` (500, a secret is missing),
`rate_limiter_missing` (503, the binding is missing), `rate_limited` (429), `invalid_request` (400).

Hardening (each rule is in `src/index.ts` and held by `test/worker.test.ts`, with seats.aero faked, no network):

- Redirect URI pinned in code; client ID and secret from Worker secrets only.
- Format checks on every value; JSON bodies of at most 2 KB with exactly the expected fields.
- Per-IP rate limit, 20 requests a minute (`ratelimits` binding `RATE_LIMITER`). Without the binding the Worker
  answers 503 and serves nothing.
- No storage bindings, no `vars`, no console calls, observability and Logpush off, no `workers.dev` or preview address.
- No CORS headers; `Cache-Control: no-store`, `Referrer-Policy: no-referrer`, HSTS, `nosniff`; the static page has a
  `default-src 'none'` CSP.
- Never calls seats.aero's user-info endpoint.

## 1. Create the OAuth app in seats.aero

1. Sign in to seats.aero with the account that will own the app. Open **Settings › Developer Tools › Apps › New App**.
2. Fill in:
   - **Name:** AwardGrid.
   - **Redirect URI:** `https://awardgrid.dowhiz.com/oauth/seats/callback`, exactly (https, no trailing slash). The
     Worker and the app pin the same value; any difference makes seats.aero refuse the sign-in.
   - **Scope:** `openid`, the only one AwardGrid asks for.
   - If the form asks for them: homepage `https://awardgrid.dowhiz.com/ios/`, privacy policy
     `https://awardgrid.dowhiz.com/privacy/`, support `https://awardgrid.dowhiz.com/support/`.
3. Create it. **Creating the app accepts seats.aero's OAuth Addendum** (the version of 2025-08-14 was read on
   2026-10-06). What the code already does for it: results are kept on the device for 24 hours at most and purged
   automatically (`apps/ios/src/retention/short-term.ts`); AwardGrid's server stores nothing; Disconnect and a revoked
   grant purge everything; "Data: seats.aero" with a link to https://seats.aero beside the data; a public landing page,
   privacy policy and support contact; per-user tokens; the secret only on the server.
4. Note the **Client ID**. It is not a secret: it goes into the app at build time (section 5) and may be given to
   whoever builds the app.
5. Copy the **Client Secret** only into Cloudflare (section 2). Never into git, a chat, an e-mail, a ticket, a note,
   a `.env` file in the repository, or the app. If it is ever exposed, rotate it in seats.aero and set the new one in
   Cloudflare.
6. The app starts limited to 10 users. seats.aero lifts the limit after testing the integration themselves
   (section 6).

## 2. Deploy the Worker and set its secrets

Choose one way. Either way the Worker is named `awardgrid-auth`, and its two secrets are Worker secrets, typed or
pasted by the owner.

**A. wrangler (recommended: it applies `wrangler.jsonc` exactly, rate limit, route and logging switches included).**
wrangler is not installed in this repository; `npx wrangler` fetches it (the owner's call). From a worktree of this
branch, never from the checkout production serves:

```bash
cd sites/auth
npx wrangler login                           # an OAuth grant on the owner's Cloudflare account
npx wrangler deploy                          # uploads src/index.ts, the route and the RATE_LIMITER binding
npx wrangler secret put SEATS_CLIENT_ID      # paste the Client ID when asked
npx wrangler secret put SEATS_CLIENT_SECRET  # paste the Client Secret when asked; it is never shown again
```

Until both secrets are set, `/oauth/seats/token` and `/refresh` answer 500 `not_configured`; the callback page
works.

**B. Cloudflare dashboard.**

1. Compile the Worker to one JavaScript file (no network; it has no imports):
   `pnpm exec tsc -p sites/auth --noEmit false --declaration false --outDir sites/auth/dist`, then open
   `sites/auth/dist/src/index.js` (git-ignored).
2. Workers & Pages › Create › Worker › name `awardgrid-auth` › Deploy, then Edit code › replace everything with that
   file › Deploy.
3. The Worker › Settings:
   - **Variables and Secrets › Add:** type **Secret**, name `SEATS_CLIENT_ID`, value the Client ID; again for
     `SEATS_CLIENT_SECRET` with the Client Secret. Never type **Text** for either.
   - **Bindings › Add › Rate Limiting:** name `RATE_LIMITER`, 20 requests per 60 seconds (the namespace as in
     `wrangler.jsonc`). If the dashboard offers no Rate Limiting binding, use A: without it the Worker answers 503,
     by design.
   - **Domains & Routes:** turn off the `workers.dev` address and Preview URLs.
   - **Observability:** Workers Logs and traces off; no Logpush job.
   - **Compatibility date:** `2026-10-01`.

## 3. Add the route

The route is `awardgrid.dowhiz.com/oauth/*` on the zone `dowhiz.com`, to the Worker `awardgrid-auth`. With A,
`wrangler deploy` adds it from `wrangler.jsonc`; with B: the Worker › Settings › Domains & Routes › Add › Route.

Before adding it, look at dowhiz.com › Workers Routes:

- Since 2026-10-07 the Worker `awardgrid-vercel-public` holds the site's 11 routes and proxies them to Vercel.
  `/oauth/*` is not one of them, so the new route does not collide with it. Check that this is still so.
- No other route may match `/oauth/*` (for example a catch-all `awardgrid.dowhiz.com/*`). If one exists, the more
  specific `/oauth/*` route wins, which is the intent; still look at what else that catch-all serves.
- The private web app behind the tunnel and the static site never use `/oauth/`, so nothing they serve moves.

## 4. Check it, including the WAF

From any computer, once the route exists (the first answer may take a minute):

```bash
# The callback with no parameters: the short static page, 200, no-store.
curl -s -i https://awardgrid.dowhiz.com/oauth/seats/callback | head -20

# WAF check: an invalid code must reach seats.aero and come back as seats.aero's own OAuth error, as JSON
# (400 or 401, for example {"error":"invalid_grant"}), not a Cloudflare challenge page.
curl -s -i -X POST https://awardgrid.dowhiz.com/oauth/seats/token \
  -H 'content-type: application/json' \
  --data '{"code":"invalid-code-for-the-waf-check","state":"wafcheckwafcheckwafcheckwafcheckwafcheck123"}'

# The same for the refresh path.
curl -s -i -X POST https://awardgrid.dowhiz.com/oauth/seats/refresh \
  -H 'content-type: application/json' --data '{"refresh_token":"seats:otr:invalid-refresh-token"}'
```

There are two Cloudflare zones on the way, and either can challenge: dowhiz.com's, in front of the Worker, and
seats.aero's own, in front of `https://seats.aero/oauth2/token`, which the Worker calls. They answer differently:

- **A challenge from dowhiz.com** (HTML such as "Just a moment…", a `cf-mitigated: challenge` header, a 403 page from
  Cloudflare, or a redirect to a `cloudflareaccess.com` sign-in): the request never reached the Worker, whose every
  answer is JSON. The app's native requests would get the same and could never connect. In dowhiz.com › Security ›
  Events, find what challenged it, and exempt the path: a WAF custom rule with the action **Skip** for `URI Path
  starts with /oauth/seats/`, or, for a feature a rule cannot skip (Bot Fight Mode), turn it off; an Access
  application covering the host needs a bypass policy for `/oauth/seats/`. Repeat the check.
- **502 `upstream_blocked`** (an older deployment answers 403 or 429 `{"error":"rejected"}` instead): the Worker
  reached seats.aero, and seats.aero's side refused the call without an OAuth error. The Worker passes on no HTML, so
  this is what a challenge from seats.aero's own Cloudflare looks like (a plain request to seats.aero has been seen
  blocked before). It is a 502 so the app treats it as an outage and keeps the connection; a 401 or 403 could read as
  the person revoking AwardGrid. Nothing in dowhiz.com changes it: ask seats.aero to let POSTs to
  `https://seats.aero/oauth2/token` from the Worker `awardgrid-auth` (Cloudflare Workers) through, and repeat the
  check.
- **502 `upstream_unreachable`, `upstream_unavailable` or `upstream_invalid`:** seats.aero did not answer in 10
  seconds, answered with a server error, or answered 2xx with something other than tokens. Repeat later; if it stays,
  ask seats.aero.
- **500 `not_configured`:** a secret is missing or misnamed. **503 `rate_limiter_missing`:** the binding is missing.
- **`invalid_client`:** the Client ID or secret in Cloudflare is not the app's. Set them again.
- More than 20 requests a minute from one address answer 429 `rate_limited`: the limit working.

## 5. Give the Client ID to the build

The Client ID is a build-time value of the iPhone app, `VITE_AG_SEATS_CLIENT_ID`; `npm run build:store` refuses to
build without it:

```bash
export PATH="$HOME/.local/node-arm64/bin:$PATH"
cd apps/ios
env -u VITE_AG_PROBES -u VITE_AG_STORE -u VITE_AG_CONNECT VITE_AG_SEATS_CLIENT_ID=<client id> npm run build:store
npx cap copy ios && node scripts/check-store-bundle.mjs ios/App/App/public
```

Pass it on the command line, and record it in the release record (`docs/release/IOS_1.0_RELEASE.md`) if useful. It is
not a secret, but it does not go into the source: a development build keeps saying it was "made without a seats.aero
client ID". The build number (`CURRENT_PROJECT_VERSION`; 5 for the first OAuth build) is the owner's decision; the
archive and upload then follow `apps/ios/README.md` › Release.

The end-to-end check on a device comes next (release plan 47F step 4): connect on the owner's own account, search,
leave the app for more than an hour and search again (the refresh), Disconnect, connect again, then remove AwardGrid
in the seats.aero settings and search again (the app must purge and ask to connect again).

## 6. What seats.aero needs to test it

seats.aero lifts the 10-user limit once they have tested the integration themselves and seen how it was done. Ask them
which they prefer:

- **A TestFlight public link.** In App Store Connect › TestFlight, add an external testing group, add the OAuth build to
  it, and submit it for Beta App Review (about a day for the first external build). Once it is approved, turn on the
  group's public link and send it. Their tester probably counts as one of the 10 users until the limit is lifted.
- **A screen recording**, if they would rather not install anything: the owner's own account, Connect seats.aero,
  seats.aero's page, back in the app, a search with "Data: seats.aero", Disconnect. Show no password, no account e-mail
  and no notification. The same recording can be the App Review attachment
  (`docs/release/appreview/review-notes-1.0-5.md`).

Either way, tell them the redirect URI, the scope (`openid`), that the refresh happens on the server
(`/oauth/seats/refresh`), that results are kept on the device for 24 hours at most and purged on Disconnect or
revocation, and where the code is (this repository).

## 7. The web app

The private web app (the tunnel on awardgrid.dowhiz.com, `docs/DEPLOYMENT.md`) connects each user's seats.aero account
through the same OAuth client and the same registered redirect URI. Nothing changes in seats.aero's settings: there is
still one redirect URI, this Worker's callback.

```
browser  ── POST /api/seats/connect ──► web app: a state "web_" + 32 random bytes (base64url), bound to the account
browser  ── seats.aero consent (redirect_uri = https://awardgrid.dowhiz.com/oauth/seats/callback, state=web_…) ──►
seats.aero ── 302 ──► GET awardgrid.dowhiz.com/oauth/seats/callback?code=…&state=web_…
Worker     ── 302 ──► https://awardgrid.dowhiz.com/api/seats/oauth/callback?code=…&state=web_…   (WEB_CALLBACK)
web app    ── checks the state for this account, then POST /oauth/seats/token {code, state} from its server
web app    ── POST /oauth/seats/refresh {refresh_token} from its server, about once an hour per connected account
```

How the Worker tells the two apart: the iPhone app's states are always 43 base64url characters with no prefix
(`apps/ios/src/oauth/connect.ts randomState`); the web app's are `web_` and 43 characters, 47 in all (`WEB_STATE_RE`).
Every other state keeps going to the app's scheme, exactly as before. Both destinations are constants in the code;
nothing in the request can name one, so the callback is not an open redirect. A forged callback to the web app with a
web-shaped state is refused there: the state must be one the signed-in account started in the last ten minutes, and it
is used once (`src/lib/seats-oauth/state.ts`).

The web server's own requests to `/token` and `/refresh` come from the Mac's public address, and count against the
same per-IP limit (20 a minute) as any device there. With the 10-user cap this leaves plenty of room; if the web app
grows, raise the limit or key it differently.

**Owner steps (the web app's release):**

1. Redeploy this Worker from a worktree of the branch with this change, before deploying the web app:
   `cd sites/auth && npx wrangler deploy`. The secrets and the route stay as they are.
2. Check that a web state now reaches the web app's address (no code is exchanged; the state is made up):

   ```bash
   curl -s -o /dev/null -w '%{http_code} %{redirect_url}\n' \
     'https://awardgrid.dowhiz.com/oauth/seats/callback?code=check&state=web_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'
   # 302 https://awardgrid.dowhiz.com/api/seats/oauth/callback?code=check&state=web_aaaa…
   curl -s -o /dev/null -w '%{http_code} %{redirect_url}\n' \
     'https://awardgrid.dowhiz.com/oauth/seats/callback?code=check&state=s1a2b3c4d5e6f7g8h9i0j1k2l3m4n5o6p7q8r9s0t1u'
   # 302 com.dowhiz.awardgrid://oauth/seats?code=check&state=s1a2…   (the iPhone app's path, unchanged)
   ```

3. From the Mac that runs the web app, run section 4's WAF check once more: the web server calls `/token` and
   `/refresh` from there, and a dowhiz.com challenge would stop it the way it would stop a device.
4. Then deploy the web app (`docs/DEPLOYMENT.md`, "Login with Seats.aero").

The alternative, a second redirect URI registered in seats.aero for the web app, would have needed a change in
seats.aero's settings and a second pinned redirect URI in `/token`; routing by the state's shape needs neither.

## Turning it off

Remove the route or delete the Worker (`npx wrangler delete` from `sites/auth`): connecting can then no longer finish
(the paths fall through to whatever else serves the host, so the sign-in sheet stops on a page that is not the app's
and has to be closed, or the app says the token service could not finish connecting), and a connected device keeps
its access token until it expires (about an hour), after which its searches are refused and say to connect again. Rotating the Client Secret in seats.aero and setting the new one in Cloudflare keeps the app
working. Deleting the OAuth app in seats.aero ends every connection: searches then say to connect again.

## Local development

`npx wrangler dev` from `sites/auth`, with a `.dev.vars` file holding the two secrets; that file and `.wrangler/` are
git-ignored. The tests need neither: `pnpm --filter @awardgrid/auth test`.
