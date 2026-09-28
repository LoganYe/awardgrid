# LEGAL

AwardGrid began as a private, invite-only web app for its developer and a small group of friends.
The iPhone app has been submitted to the App Store as a separate public release. The web app at
this address is private and invite-only; it is separate from the iPhone app. There is no paywall,
cost-sharing, subscription or advertising. Neither app has telemetry or analytics of its own; the pages on
awardgrid.dowhiz.com count visits with Cloudflare Web Analytics, which sets no cookies.

## Data sources and terms

- **seats.aero Partner API.** Award availability comes exclusively from the seats.aero
  Partner API (Cached Search, Bulk Availability, Get Trips, Get Routes). Every user supplies
  their **own seats.aero Pro API key**, stored encrypted (AES-256-GCM) and used only for that
  user's requests. awardgrid has **no server key and never routes one user's requests through
  another user's key**. Pro keys are limited to 1,000 calls per day and to non-commercial use;
  awardgrid enforces a per-user soft limit of 950 calls per day and caches results per user
  for 45 minutes to stay well inside that budget. **Live Search is never used** (it requires
  a commercial agreement). Every screen that shows award data carries the attribution
  **"Data: seats.aero"**. In the iOS app, every Ask answer that used seats.aero data carries the
  same attribution. Terms: <https://seats.aero/terms>.
- **No scraping.** awardgrid never automates, crawls or scrapes any airline, alliance,
  loyalty-program, bank or portal website. In the web app, links to a program's own award-search
  page are plain deep links the user opens and completes themselves.
- **travel-hacking-toolkit** (MIT License, © Michael Borohovski) is vendored as a git
  submodule and loaded into the web app's advisory "Ask" lane as a *pruned* plugin: every skill that
  uses Docker / Patchright browser automation, reads a username or password, performs
  browser automation, installs packages at runtime, or writes to the filesystem is excluded
  by `scripts/build-plugin.ts`. The original `LICENSE` is preserved in
  `vendor/travel-hacking-toolkit/LICENSE` and reproduced in the built plugin.
- **Claude (Anthropic).** In the web app, natural-language parsing and the Ask lane call the
  Claude API with the operator's own Anthropic key. No user API keys are sent to Anthropic; the
  seats.aero key is injected only into the isolated per-user Ask session environment so that the
  toolkit's `curl` calls can reach seats.aero.

  In the iOS app, Ask is optional and runs only on the user's own Anthropic API key, stored in
  the device Keychain and sent only to api.anthropic.com. A question sends Anthropic the
  question, today's date, the parameters of any search the user chose to include, and the
  seats.aero results of the searches and flight lookups the app makes for it, with how many
  seats.aero calls the question and the day have left. It also resends
  every earlier question in the same conversation that was answered, with everything that
  question sent and received. Each request also carries headers that name Anthropic's SDK and
  its version, and the Accept-Language header the app's native networking adds to every request
  it makes, which gives the app locale's language and region. The seats.aero key is never
  sent to Anthropic; the app makes every seats.aero call itself. Before the first question the
  app asks the user's permission to send this to Anthropic, and the user can withdraw it on the
  Anthropic key page in Settings. The conversation is stored on
  the device, in the app's Documents directory, until the user starts a new one; iOS device backups
  include that directory. Anthropic bills
  the user's own account.

  The iOS app's privacy policy says all of this for its users: `sites/landing/privacy/index.html`,
  built for <https://awardgrid.dowhiz.com/privacy/>.

## Trademarks and logos

No airline, alliance or loyalty-program logos, wordmarks or brand imagery are displayed.
Programs are referred to by their plain text names. All trademarks belong to their owners;
awardgrid is not affiliated with, endorsed by, or sponsored by seats.aero, any airline, or
any loyalty program.

## Credentials

awardgrid never accepts, stores, or transmits airline, bank or travel-portal usernames or
passwords. Only API keys the user generates in their own account settings are accepted:
seats.aero (both apps), Anthropic (iOS app), and Duffel and Ignav (web app). Only the last four
characters are ever displayed or logged.

## Disable on request

If seats.aero, any airline, program, or data provider asks for this tool to stop using their
data or linking to their site, that source will be switched off immediately. Contact the
repository owner.

## Accuracy

Cached award data can be stale and awards disappear. Always confirm availability on the
program's own site before transferring points. awardgrid is provided "as is" under the MIT
License (see `LICENSE`) with no warranty of any kind.
