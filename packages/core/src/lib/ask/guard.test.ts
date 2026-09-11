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

  it.each([
    // Offers the design's list let through.
    "Would you like me to check again later?",
    "Do you want me to look again tomorrow?",
    "I will keep you posted.",
    "I'll keep you updated",
    "I'd be happy to monitor this route.",
    "Would you like me to monitor this route?",
    "I'll search again tomorrow and tell you what changed.",
    "I can check again in a few days.",
    "我稍后再帮你查",
  ])("catches the other ways a model offers it: %j", (text) => {
    expect(promisesFollowUp(text)).toBe(true);
  });
});

describe("searching again inside the conversation, and honest refusals, are not promises", () => {
  it.each([
    // The person can ask for these in the same conversation, so the note would be wrong under them.
    "Would you like me to search again with a wider date range?",
    "If you'd like me to search again, just ask another question.",
    "Let me know and I'll search again.",
    "I can look again at nearby airports such as EWR.",
    "No business seats on those dates. I'll search again with first class included.",
    "The app will search again only when you ask.",
    // Words the patterns contain, used for something else.
    "I'd be happy to track down the exact flight numbers.",
    "I'm glad to alert you to one caveat: these fees are estimates.",
    // Refusals with the negation a word before the verb.
    "我不会稍后再帮你查",
    "awardgrid 不会稍后再帮你查",
    "我没办法稍后再帮你查",
    "我无法在稍后再帮你查",
    "我不会通知你",
    "我不会持续关注这条航线",
  ])("allows %j", (text) => {
    expect(promisesFollowUp(text)).toBe(false);
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
    // Near the widened patterns, and still ordinary or honest.
    "Would you like me to look up the flights?",
    "I'd be happy to explain how Alaska's partner awards work.",
    "你可以稍后再查看航空公司官网",
    "awardgrid 无法稍后再帮你查",
  ])("also allows %j", (text) => {
    expect(promisesFollowUp(text)).toBe(false);
  });
});
