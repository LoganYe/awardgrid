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

  The iOS app's App Store build has no Ask and sends nothing to Anthropic: Ask is compiled out of
  it (`VITE_AG_STORE=1`, `apps/ios/src/app/flags.ts`), together with its routes, entry points and copy.
  Ask is in the iOS app's test builds only: development, the probes and e2e, and the internal
  TestFlight builds 1.0 (1)-(3). In a test build, Ask is optional and runs only on the user's own
  Anthropic API key, stored in
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
- **Sample data (iOS app).** Without a seats.aero account, the iOS app shows sample data: invented
  numbers under real program names, generated on the device for any route between the airports the
  app recognises, labelled "Sample data" on every screen that shows it, with no booking or program
  links and no "Data: seats.aero" attribution, because it is not seats.aero data. While it is on,
  the app sends nothing to seats.aero or anyone else; it keeps its own files apart from the
  account's, and never reads or writes the user's seats.aero key or the day's count of seats.aero
  calls.

## Trademarks and logos

No airline, alliance or loyalty-program logos, wordmarks or brand imagery are displayed.
Programs are referred to by their plain text names. All trademarks belong to their owners;
awardgrid is not affiliated with, endorsed by, or sponsored by seats.aero, any airline, or
any loyalty program.

## Credentials

awardgrid never accepts, stores, or transmits airline, bank or travel-portal usernames or
passwords. Only API keys the user generates in their own account settings are accepted:
seats.aero (both apps), Anthropic (the iOS app's test builds, for Ask; the App Store build asks for
none), and Duffel and Ignav (web app). Only the last four characters are ever displayed or logged.

## Disable on request

If seats.aero, any airline, program, or data provider asks for this tool to stop using their
data or linking to their site, that source will be switched off immediately in the web app. For
the iOS app, the app will be removed from sale immediately and the source disabled in the next
build. Contact the repository owner.

## Accuracy

Cached award data can be stale and awards disappear. Always confirm availability on the
program's own site before transferring points. awardgrid is provided "as is" under the MIT
License (see `LICENSE`) with no warranty of any kind.
