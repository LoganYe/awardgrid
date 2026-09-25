/**
 * Which links may leave the app from an option's details (UI/UX v1 T10; docs/03 §4; acceptance A18). Only an
 * https:// link to a named host, as seats.aero or a program builder gave it; never a script, data or local URL, and
 * never one with credentials or characters that change where it resolves. No link → the details offer to copy the
 * search instead.
 */
import { describe, expect, it } from "vitest";
import type { AvailabilityRow } from "../types";
import { detailLink, trustedExternalLink } from "./trusted";

describe("trustedExternalLink", () => {
  it("keeps an https link to a named host, exactly as given, with its host", () => {
    expect(trustedExternalLink("https://www.aircanada.com/aeroplan/redeem?x=1")).toEqual({ url: "https://www.aircanada.com/aeroplan/redeem?x=1", host: "www.aircanada.com" });
  });

  it.each([
    ["javascript:alert(1)"],
    ["JavaScript:alert(1)"],
    ["data:text/html,<script>alert(1)</script>"],
    ["http://www.aircanada.com/"],
    ["//www.aircanada.com/"],
    ["https://user:pass@www.aircanada.com/"],
    ["https://localhost/book"],
    ["https://127.0.0.1/book"],
    ["https://[::1]/book"],
    ["https://intranet/book"],
    ["https://localhost./x"],
    ["https://foo.localhost./x"],
    ["https://intranet./book"],
    ["https://com./"],
    ["https://-bad.example/"],
    ["https://www.aircanada.com/\\@evil.invalid"],
    ["https://www.aircanada.com/ book"],
    ['https://www.aircanada.com/"onmouseover'],
    ["capacitor://localhost/"],
    [""],
    [null],
    [undefined],
  ])("refuses %s", (raw) => {
    expect(trustedExternalLink(raw as string | null | undefined)).toBeNull();
  });
});

const row = (over: Partial<AvailabilityRow> = {}): AvailabilityRow =>
  ({ origin: "JFK", dest: "LHR", date: "2026-10-18", cabin: "J", program: "aeroplan", miles: 70000, booking_url: null, ...over }) as AvailabilityRow;

describe("detailLink", () => {
  it("seats.aero's primary booking link (the first when none is flagged), else the row's own", () => {
    const links = [
      { label: "Book via United", link: "https://www.united.example/other", primary: false },
      { label: "Book on Aeroplan", link: "https://www.aircanada.com/primary", primary: true },
    ];
    expect(detailLink(row(), links)?.url).toBe("https://www.aircanada.com/primary");
    expect(detailLink(row(), [{ label: "Only", link: "https://www.aircanada.com/only", primary: false }])?.url).toBe("https://www.aircanada.com/only");
    expect(detailLink(row({ booking_url: "https://www.aircanada.com/row" }), [])?.url).toBe("https://www.aircanada.com/row");
  });

  it("never another program's link: an unsafe primary falls through to the row's own link, not to 'Book via …'", () => {
    const links = [
      { label: "bad", link: "javascript:alert(1)", primary: true },
      { label: "Book via United", link: "https://www.united.example/other", primary: false },
    ];
    expect(detailLink(row(), links)).toBeNull();
    expect(detailLink(row({ booking_url: "https://www.aircanada.com/row" }), links)?.url).toBe("https://www.aircanada.com/row");
  });

  it("an American row with no booking link uses the program's own search page; otherwise there is no link", () => {
    expect(detailLink(row({ program: "american" }), [])?.host).toBe("www.aa.com");
    expect(detailLink(row(), [{ label: "bad", link: "data:text/html,x", primary: true }])).toBeNull();
  });
});
