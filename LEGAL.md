# LEGAL

awardgrid is a **personal, non-commercial** tool for its author and fewer than ten friends.
It is deployed privately (behind Tailscale / Cloudflare Access) with invite-only registration.
There is no paywall, cost-sharing, subscription, advertising, telemetry or analytics.

## Data sources and terms

- **seats.aero Partner API.** Award availability comes exclusively from the seats.aero
  Partner API (Cached Search, Bulk Availability, Get Trips, Get Routes). Every user supplies
  their **own seats.aero Pro API key**, stored encrypted (AES-256-GCM) and used only for that
  user's requests. awardgrid has **no server key and never routes one user's requests through
  another user's key**. Pro keys are limited to 1,000 calls per day and to non-commercial use;
  awardgrid enforces a per-user soft limit of 950 calls per day and caches results per user
  for 45 minutes to stay well inside that budget. **Live Search is never used** (it requires
  a commercial agreement). Every screen that shows award data carries the attribution
  **"Data: seats.aero"**. Terms: <https://seats.aero/terms>.
- **No scraping.** awardgrid never automates, crawls or scrapes any airline, alliance,
  loyalty-program, bank or portal website. Links to a program's own award-search page are
  plain deep links the user opens and completes themselves.
- **travel-hacking-toolkit** (MIT License, © Michael Borohovski) is vendored as a git
  submodule and loaded into the advisory "Ask" lane as a *pruned* plugin: every skill that
  uses Docker / Patchright browser automation, reads a username or password, performs
  browser automation, installs packages at runtime, or writes to the filesystem is excluded
  by `scripts/build-plugin.ts`. The original `LICENSE` is preserved in
  `vendor/travel-hacking-toolkit/LICENSE` and reproduced in the built plugin.
- **Claude (Anthropic).** Natural-language parsing and the Ask lane call the Claude API with
  the operator's own Anthropic key. No user API keys are sent to Anthropic; the seats.aero
  key is injected only into the isolated per-user Ask session environment so that the
  toolkit's `curl` calls can reach seats.aero.

## Trademarks and logos

No airline, alliance or loyalty-program logos, wordmarks or brand imagery are displayed.
Programs are referred to by their plain text names. All trademarks belong to their owners;
awardgrid is not affiliated with, endorsed by, or sponsored by seats.aero, any airline, or
any loyalty program.

## Credentials

awardgrid never accepts, stores, or transmits airline, bank or travel-portal usernames or
passwords. Only API keys the user generates in their own seats.aero / Duffel / Ignav
account settings are accepted, and only the last four characters are ever displayed or
logged.

## Disable on request

If seats.aero, any airline, program, or data provider asks for this tool to stop using their
data or linking to their site, that source will be switched off immediately. Contact the
repository owner.

## Accuracy

Cached award data can be stale and awards disappear. Always confirm availability on the
program's own site before transferring points. awardgrid is provided "as is" under the MIT
License (see `LICENSE`) with no warranty of any kind.
