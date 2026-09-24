// TEST-ONLY (plan 04 T18): the UI/UX Web server runs on the fixture's clock (scenarios.json "now"), as the iOS
// fixture host does, so the synthetic rows' dates and times read the same on both surfaces. Loaded only by
// e2e/uiux/start-web.sh through NODE_OPTIONS; time still moves, from that starting point.
const target = Date.parse(process.env.UIUX_WEB_NOW ?? "");
if (Number.isFinite(target)) {
  const RealDate = Date;
  const offset = target - RealDate.now();
  // A plain function, not a subclass: every static (parse, UTC, now) is set explicitly, and instances are real Dates.
  function FixtureDate(...args) {
    if (!new.target) return new RealDate(RealDate.now() + offset).toString();
    return args.length === 0 ? new RealDate(RealDate.now() + offset) : new RealDate(...args);
  }
  FixtureDate.prototype = RealDate.prototype;
  FixtureDate.now = () => RealDate.now() + offset;
  FixtureDate.parse = RealDate.parse;
  FixtureDate.UTC = RealDate.UTC;
  globalThis.Date = FixtureDate;
}
