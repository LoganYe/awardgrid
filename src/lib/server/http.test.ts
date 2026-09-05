import { describe, expect, it } from "vitest";
import { z } from "zod";
import { BodyError, hasJsonContentType, readJson } from "./http";

const Schema = z.object({ a: z.number() });

function req(body: string, contentType?: string): Request {
  return new Request("http://localhost/api/x", {
    method: "POST",
    headers: contentType ? { "content-type": contentType } : {},
    body,
  });
}

describe("readJson", () => {
  it("accepts application/json (with or without parameters)", async () => {
    expect(await readJson(req('{"a":1}', "application/json"), Schema)).toEqual({ a: 1 });
    expect(await readJson(req('{"a":2}', "Application/JSON; charset=utf-8"), Schema)).toEqual({ a: 2 });
  });

  it("rejects text/plain, form and missing content types even when the body parses", async () => {
    for (const ct of ["text/plain", "application/x-www-form-urlencoded", "multipart/form-data", "application/jsonx", undefined]) {
      await expect(readJson(req('{"a":1}', ct), Schema)).rejects.toBeInstanceOf(BodyError);
    }
    expect(hasJsonContentType(req("{}", "text/plain"))).toBe(false);
    expect(hasJsonContentType(req("{}", "application/json"))).toBe(true);
  });

  it("rejects malformed JSON and schema failures with BodyError", async () => {
    await expect(readJson(req("{nope", "application/json"), Schema)).rejects.toBeInstanceOf(BodyError);
    await expect(readJson(req('{"a":"x"}', "application/json"), Schema)).rejects.toBeInstanceOf(BodyError);
  });
});
