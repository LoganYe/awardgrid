import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

export default defineConfig([
  ...nextVitals,
  ...nextTs,
  globalIgnores([".next/**", "out/**", "build/**", "vendor/**", "next-env.d.ts", "drizzle/**", "e2e-report/**", "test-results/**", "playwright/.cache/**", "spikes/**",
    // The shells' build output. `apps/ios/ios/**` holds the generated Xcode project plus a COPY
    // of dist/ that `cap sync` writes into App/public, and DerivedData holds another. Linting a
    // 650 KB bundle three times over made eslint itself crash with
    // "RangeError: Invalid string length" while formatting its report.
    "apps/*/dist/**", "apps/*/ios/**", "sites/*/dist/**"]),
  {
    rules: {
      "@typescript-eslint/no-unused-vars": ["error", { argsIgnorePattern: "^_", varsIgnorePattern: "^_" }],
    },
  },

  // ---------------------------------------------------------------------------
  // The packages/core boundary (docs/PIVOT.md §1-§2), enforced rather than trusted.
  //
  // PIVOT §1's whole premise is that the core has "zero server-only imports in production
  // code" — that is the measurement the pivot rests on. It was true when measured by hand, and
  // nothing stopped the next commit from quietly making it false. These two rules make the
  // boundary mechanical, in both directions.
  // ---------------------------------------------------------------------------
  {
    files: ["packages/core/**/*.ts", "packages/core/**/*.tsx"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: ["next", "next/*", "server-only", "client-only"],
              message:
                "packages/core must stay runtime-independent: it also runs in Capacitor/iOS, a desktop shell and an extension, none of which have Next. The one file that legitimately needs next/headers is src/lib/i18n/server.ts, which is why it stayed in the app.",
            },
            {
              group: ["@/*"],
              message:
                "Inside packages/core, use a relative import. The '@' alias resolves against the CONSUMING project, so an aliased import here silently resolves into the app's src/ and breaks `next build`. (The 25 moved *.test.ts files are the deliberate exception — they keep '@/lib/…' and are resolved by this package's own vitest/tsconfig alias, because rewriting a core test is forbidden.)",
            },
          ],
        },
      ],
    },
  },
  {
    // The deliberate exception, and the reason it is safe: these files were MOVED, not written,
    // and the kickoff rejects on sight any PR that edits a core test. They keep "@/lib/…",
    // resolved by this package's own vitest alias and tsconfig paths. `rows.ts` is in the same
    // corpus — a fixture the tests import, carried across untouched.
    files: ["packages/core/**/*.test.ts", "packages/core/test/**/*.ts"],
    rules: { "no-restricted-imports": "off" },
  },
  {
    // Nothing in the app may reach for the old in-tree paths. After the Phase 1 move these
    // resolve to nothing, so this is belt-and-braces against a half-reverted merge — the
    // failure it prevents is a stray `@/lib/grid/pivot` that typechecks green forever if
    // anyone ever adds a tsconfig fallback to "make it work".
    files: ["src/**/*.ts", "src/**/*.tsx", "scripts/**/*.ts", "test/**/*.ts", "e2e/**/*.ts"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          // Module ROOTS go in `paths` (exact match), not `patterns`. Glob groups use
          // gitignore semantics, where excluding "@/lib/i18n" also excludes everything under
          // it and a "!@/lib/i18n/server" negation cannot re-include it — which would ban the
          // one import that is still correct.
          paths: [
            "@/lib/seatsaero",
            "@/lib/query",
            "@/lib/grid",
            "@/lib/qr",
            "@/lib/notices",
            "@/lib/i18n",
          ].map((name) => ({
            name,
            message: `${name} moved to packages/core in Phase 1 (docs/PIVOT.md §6). Import "@awardgrid/core/${name.replace("@/lib/", "")}" instead.`,
          })),
          patterns: [
            {
              // Subpaths, minus i18n/server — which is deliberately not listed here, because
              // it is the single file of the six modules that stayed in the app (next/headers).
              group: [
                "@/lib/seatsaero/*",
                "@/lib/query/*",
                "@/lib/grid/*",
                "@/lib/qr/*",
                "@/lib/i18n/client",
                "@/lib/i18n/dictionaries/*",
              ],
              message:
                "These moved to packages/core in Phase 1 (docs/PIVOT.md §6). Import '@awardgrid/core/<module>/<file>' instead. '@/lib/i18n/server' is the one that stayed, and is still correct.",
            },
          ],
        },
      ],
    },
  },
]);
