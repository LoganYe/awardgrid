# DECISIONS

Every non-trivial choice, one line each, newest at the bottom. Format:
`- **topic**: decision. _Why:_ rationale.` Fixed defaults from the kickoff prompt (§2, §4, §6, §12) are not repeated here unless a doc contradicted them.

## Phase 0

- **Project directory**: the kickoff said "from an empty directory", but Claude Code was started in `~/Desktop/workspace`, which already holds other projects. Built in `~/Desktop/workspace/awardgrid/` instead. _Why:_ never touch sibling projects; the repo root is what matters.
- **Node runtime on the dev Mac**: use the arm64 Node 22 at `~/.local/node-arm64` (with `corepack`-managed pnpm 12), not the default `/usr/local/bin/node`, which is an Intel binary under Rosetta. _Why:_ native modules (`better-sqlite3`, `argon2`) fail to build/load under the Rosetta node on this machine.
- **pnpm**: not preinstalled; enabled via `corepack enable pnpm` + `corepack prepare pnpm@latest --activate` (pnpm 12.3.4). Pinned in `package.json#packageManager`. _Why:_ the prompt fixes pnpm; corepack is the zero-install path.
- **Docker**: not installed on the host. Dockerfile + `docker-compose.yml` are written and reviewed but the compose smoke test is listed under "Needs human action". _Why:_ §0.3 — do the maximum possible, note the gap.
- **LICENSE copyright holder**: `Logan (LoganYe)` — `gh api user` returns name "Logan", login "LoganYe". _Why:_ prompt says "my name from gh api user"; login added so the holder is unambiguous.
- **Toolkit plugin root**: the vendored repo's *Claude Code* plugin is the repository root (`.claude-plugin/plugin.json`, name `travel-hacker`; `skills/`, `agents/`, `.mcp.json`). `plugins/travel-hacking-toolkit/` is the **Codex** plugin (`.codex-plugin/plugin.json`). `scripts/build-plugin.ts` therefore composes `build/plugin/` from the repo root, not from `plugins/travel-hacking-toolkit/`. _Why:_ docs/facts win over the prompt (§0.3); the prompt's path would load nothing in the Agent SDK.
- **Test key absent**: `SEATS_AERO_API_KEY_TEST` is not set in this environment → all seats.aero fixtures are built from the official docs' example payloads; 0 of the 40-call budget used. _Why:_ §0.4.
- **Telegram token absent**: `TELEGRAM_BOT_TOKEN_TEST` not set → mock transport with the same interface is the default in tests; real transport is selected by env at runtime. _Why:_ §6.
