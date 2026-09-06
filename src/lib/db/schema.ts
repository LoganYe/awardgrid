/**
 * Drizzle schema — kickoff §3 shape, kept verbatim, plus the few tables the required
 * features need but §3 did not list (sessions, telegram link tokens, ask-lane cost usage,
 * cache coverage, routes catalog). Every addition is logged in DECISIONS.md.
 *
 * Conventions: ids are UUIDv4 text; timestamps are ISO-8601 UTC text; booleans are
 * integer({ mode: "boolean" }); money is integer minor units (cents).
 */
import { index, integer, primaryKey, sqliteTable, text } from "drizzle-orm/sqlite-core";

export const users = sqliteTable("users", {
  id: text("id").primaryKey(),
  username: text("username").notNull().unique(),
  passwordHash: text("password_hash").notNull(),
  createdAt: text("created_at").notNull(),
  telegramChatId: text("telegram_chat_id"),
  /** "HH:MM" local time; both null = no quiet hours. */
  quietHoursStart: text("quiet_hours_start"),
  quietHoursEnd: text("quiet_hours_end"),
  /** IANA zone for quiet hours, e.g. "Asia/Shanghai"; default UTC. */
  timezone: text("timezone").notNull().default("UTC"),
  /** UI language: "en" | "zh". */
  locale: text("locale").notNull().default("en"),
  /** UI theme: "system" | "light" | "dark" (Phase 6.1; the ag_theme cookie wins on the current device). */
  theme: text("theme", { enum: ["system", "light", "dark"] }).notNull().default("system"),
});

export const inviteCodes = sqliteTable("invite_codes", {
  code: text("code").primaryKey(),
  createdBy: text("created_by").notNull(),
  /** Optional hint of who the code was minted for (`pnpm admin invite --for alice`). */
  intendedFor: text("intended_for"),
  createdAt: text("created_at").notNull(),
  usedBy: text("used_by"),
  usedAt: text("used_at"),
});

/** httpOnly cookie sessions. `id` is the SHA-256 of the cookie token, never the token itself. */
export const sessions = sqliteTable(
  "sessions",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    createdAt: text("created_at").notNull(),
    expiresAt: text("expires_at").notNull(),
  },
  (t) => [index("sessions_user_idx").on(t.userId)],
);

export const KEY_PROVIDERS = ["seats_aero", "duffel", "ignav"] as const;
export type KeyProvider = (typeof KEY_PROVIDERS)[number];

/** AES-256-GCM encrypted API keys. Only `last4` is ever shown or logged. */
export const userKeys = sqliteTable(
  "user_keys",
  {
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    provider: text("provider", { enum: KEY_PROVIDERS }).notNull(),
    ciphertext: text("ciphertext").notNull(), // base64
    iv: text("iv").notNull(), // base64, 12 bytes
    tag: text("tag").notNull(), // base64, 16 bytes
    last4: text("last4").notNull(),
    createdAt: text("created_at").notNull(),
  },
  (t) => [primaryKey({ columns: [t.userId, t.provider] })],
);

/** seats.aero quota: 1,000 calls/day per Pro key; awardgrid stops at 950. */
export const apiUsage = sqliteTable(
  "api_usage",
  {
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    provider: text("provider").notNull(),
    day: text("day").notNull(), // YYYY-MM-DD (UTC)
    calls: integer("calls").notNull().default(0),
  },
  (t) => [primaryKey({ columns: [t.userId, t.provider, t.day] })],
);

/** Per-user cache (kickoff §0.2 #2) — the PK deliberately starts with user_id. */
export const availabilityCache = sqliteTable(
  "availability_cache",
  {
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    program: text("program").notNull(),
    origin: text("origin").notNull(),
    dest: text("dest").notNull(),
    date: text("date").notNull(),
    cabin: text("cabin", { enum: ["Y", "W", "J", "F"] }).notNull(),
    miles: integer("miles").notNull(),
    feesCents: integer("fees_cents"),
    currency: text("currency"),
    seatsLeft: integer("seats_left").notNull().default(0),
    direct: integer("direct", { mode: "boolean" }).notNull().default(false),
    /** JSON array of carrier codes, e.g. ["AA","B6"]. */
    airlines: text("airlines").notNull().default("[]"),
    computedLastSeen: text("computed_last_seen").notNull(),
    sourceId: text("source_id").notNull(),
    bookingUrl: text("booking_url"),
    fetchedAt: text("fetched_at").notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.userId, t.program, t.origin, t.dest, t.date, t.cabin] }),
    index("availability_cache_lookup_idx").on(t.userId, t.origin, t.dest, t.date),
  ],
);

/**
 * What has been fetched for a user and when, so a fresh *empty* result is also served from
 * cache within the TTL instead of re-spending quota.
 */
export const cacheCoverage = sqliteTable(
  "cache_coverage",
  {
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    origin: text("origin").notNull(),
    dest: text("dest").notNull(),
    date: text("date").notNull(),
    cabin: text("cabin", { enum: ["Y", "W", "J", "F"] }).notNull(),
    /** "*" for all programs, else a sorted comma-joined list. */
    programsKey: text("programs_key").notNull(),
    fetchedAt: text("fetched_at").notNull(),
  },
  (t) => [primaryKey({ columns: [t.userId, t.origin, t.dest, t.date, t.cabin, t.programsKey] })],
);

/** Get Routes results per user and program (7-day TTL). */
export const routesCache = sqliteTable(
  "routes_cache",
  {
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    source: text("source").notNull(),
    /** JSON array of {origin, dest}. */
    routesJson: text("routes_json").notNull(),
    fetchedAt: text("fetched_at").notNull(),
  },
  (t) => [primaryKey({ columns: [t.userId, t.source] })],
);

export const NOTIFY_ON = ["new_cells", "price_drop", "both"] as const;
export type NotifyOn = (typeof NOTIFY_ON)[number];

export const savedQueries = sqliteTable(
  "saved_queries",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    /** Serialized QueryObject. */
    queryJson: text("query_json").notNull(),
    /** Default every 3 hours (kickoff §12). */
    scheduleCron: text("schedule_cron").notNull().default("0 */3 * * *"),
    notifyOn: text("notify_on", { enum: NOTIFY_ON }).notNull().default("both"),
    dropThresholdPct: integer("drop_threshold_pct").notNull().default(10),
    enabled: integer("enabled", { mode: "boolean" }).notNull().default(true),
    createdAt: text("created_at").notNull(),
    lastRunAt: text("last_run_at"),
  },
  (t) => [index("saved_queries_user_idx").on(t.userId)],
);

export const queryRuns = sqliteTable(
  "query_runs",
  {
    id: text("id").primaryKey(),
    savedQueryId: text("saved_query_id")
      .notNull()
      .references(() => savedQueries.id, { onDelete: "cascade" }),
    ranAt: text("ran_at").notNull(),
    /** Stable hash of the (program, origin, dest, date, cabin, miles) set — diff basis. */
    cellsHash: text("cells_hash").notNull(),
    /** JSON snapshot of the cell set used for the next diff. */
    cellsJson: text("cells_json").notNull().default("[]"),
    newCells: integer("new_cells").notNull().default(0),
    droppedCells: integer("dropped_cells").notNull().default(0),
    notified: integer("notified", { mode: "boolean" }).notNull().default(false),
    skippedReason: text("skipped_reason"),
    /**
     * seats.aero calls this run spent. Nullable, and null means "not recorded" rather than zero:
     * every row written before this column existed is null, and so is a run whose fetch threw —
     * the facade may have spent calls before it failed and does not report how many. Recording 0
     * there would understate the quota the run actually consumed.
     */
    callsUsed: integer("calls_used"),
  },
  (t) => [index("query_runs_saved_query_idx").on(t.savedQueryId, t.ranAt)],
);

/** One-time tokens for the Telegram deep link (`https://t.me/<bot>?start=<token>`). */
export const telegramLinkTokens = sqliteTable("telegram_link_tokens", {
  token: text("token").primaryKey(),
  userId: text("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  createdAt: text("created_at").notNull(),
  expiresAt: text("expires_at").notNull(),
  usedAt: text("used_at"),
});

/** Ask-lane spend per user per day (kickoff §12: $2/day cap). Stored in micro-dollars to avoid floats. */
export const askUsage = sqliteTable(
  "ask_usage",
  {
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    day: text("day").notNull(),
    costMicroUsd: integer("cost_micro_usd").notNull().default(0),
    requests: integer("requests").notNull().default(0),
  },
  (t) => [primaryKey({ columns: [t.userId, t.day] })],
);

export type User = typeof users.$inferSelect;
export type NewUser = typeof users.$inferInsert;
export type UserKey = typeof userKeys.$inferSelect;
export type SavedQuery = typeof savedQueries.$inferSelect;
export type QueryRun = typeof queryRuns.$inferSelect;
export type AvailabilityCacheRow = typeof availabilityCache.$inferSelect;
