/**
 * What the native bridge prints (capacitor.config.ts loggingBehavior): its log carries every plugin call and answer,
 * tokens and seats.aero's rows included, so only a Debug build of the native app may print it. Capacitor 8 reads the
 * setting in CAPInstanceConfiguration.m: "debug" logs only when the native build is Debug, "production" logs in every
 * build, "none" never.
 */
import { describe, expect, it } from "vitest";
import config from "../../capacitor.config";

describe("the bridge's console log", () => {
  it("is on in a Debug build at most: loggingBehavior is set, and never to 'production'", () => {
    expect(config.loggingBehavior).toBe("debug");
    expect(config.ios?.loggingBehavior).toBeUndefined();
  });
});
