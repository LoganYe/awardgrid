/**
 * The `test` every UI/UX v1 spec imports. It locks the browser context's network down before the test runs
 * (every non-loopback request is aborted and recorded) and fails the test afterwards if anything was attempted,
 * so a leak cannot pass just because no assertion happened to look at the right moment.
 */
import { expect, test as base } from "@playwright/test";
import { externalRequests, lockDownNetwork } from "./helpers";

export const test = base.extend<{ networkLockdown: void }>({
  networkLockdown: [
    async ({ context, page }, use) => {
      await lockDownNetwork(context);
      await use();
      expect(externalRequests(page), "requests to hosts other than the loopback fixture host").toEqual([]);
    },
    { auto: true },
  ],
});

export { expect };
