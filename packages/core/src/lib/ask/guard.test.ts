/**
 * promisesFollowUp over the design's must-catch and must-allow lists (§8.2).
 *
 * A match adds a fixed note under the answer, so the two lists pin both costs: a promise the app cannot keep
 * must never pass unmarked, and an ordinary sentence about flights, or an honest one about what awardgrid
 * cannot do, must not collect a note it does not need.
 */
import { describe, expect, it } from "vitest";
import { promisesFollowUp } from "./guard";

describe("an answer that promises a follow-up is marked", () => {
  it.each([
    "I'll keep an eye on this route for you",
    "I can notify you when seats open",
    "Want me to check again tomorrow?",
    "I will let you know if prices drop",
    "We'll set up an alert",
    "我会持续关注这条航线",
    "有座位时我会通知你",
  ])("catches %j", (text) => {
    expect(promisesFollowUp(text)).toBe(true);
  });

  it.each([
    // Model output often uses the typographic apostrophe; the promise is the same.
    "I’ll keep an eye on this route for you",
    "We’ll let you know as soon as a seat opens",
    // Inside a longer answer, not only as a whole sentence.
    "Alaska has 2 seats on 2026-10-14 at 75,000 miles.\n\nIf you like, I can monitor this route and alert you when more open.",
    "Shall I check back tomorrow? Want me to look again later?",
    "It runs in the background.",
  ])("also catches %j", (text) => {
    expect(promisesFollowUp(text)).toBe(true);
  });
});

describe("an ordinary or honest answer is left alone", () => {
  it.each([
    "Qatar flies this route daily",
    "Let me know if you want the flights",
    "I'll look up the flights now",
    "awardgrid cannot notify you when a seat opens",
    "Use Watch this search, which checks when you open the app",
    "Check back on the program's site before transferring",
    "seats.aero updates cached availability often",
    "I checked three programs",
  ])("allows %j", (text) => {
    expect(promisesFollowUp(text)).toBe(false);
  });

  it.each([
    "awardgrid can’t notify you when a seat opens",
    "我无法通知你",
    "The cheapest business seats are on Alaska: 75,000 miles from SEA to NRT.",
    "",
  ])("also allows %j", (text) => {
    expect(promisesFollowUp(text)).toBe(false);
  });
});
