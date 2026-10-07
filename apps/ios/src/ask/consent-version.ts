/**
 * The wording a permission for Ask was given for (release decision D10): app/settings-store.ts keeps it with the
 * permission, and ./consent-copy.ts holds the wording itself. Raise it when what is sent changes: every earlier
 * permission then counts as none, and the consent sheet asks again.
 *
 * On its own so the settings store can read it without bringing the consent sheet's sentences along: the App Store
 * build (app/flags.ts STORE) has no Ask screen, and its bundle carries none of them (scripts/check-store-bundle.mjs).
 */
export const ANTHROPIC_CONSENT_VERSION = 1;
