/**
 * Language detection for the query parser (kickoff §4.1 `language`).
 *
 * Rule: any CJK ideograph → "zh"; otherwise "en". Mixed text ("from HKG to 西雅图") counts as
 * "zh" because the Chinese part is the one that needed the seed to resolve, and the UI uses
 * the value only to pick chip labels.
 */
const CJK_RE = /[㐀-䶿一-鿿豈-﫿]/;

export type QueryLanguage = "zh" | "en";

export function hasCJK(text: string): boolean {
  return CJK_RE.test(text);
}

export function detectLanguage(text: string): QueryLanguage {
  return hasCJK(text) ? "zh" : "en";
}
