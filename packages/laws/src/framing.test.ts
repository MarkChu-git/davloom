import { describe, expect, it } from "vitest";
import { fixesLength, planUrl, sendsMeasuredLength, type TargetForm } from "./framing";

const STATUSES = [100, 101, 103, 199, 200, 201, 204, 206, 207, 304, 404, 500];

describe("measured Content-Length (RFC 9110 §8.6)", () => {
  for (const status of STATUSES)
    for (const given of [false, true])
      for (const ended of [false, true]) {
        const expected = !given && ended && status >= 200 && status !== 204 && status !== 304;
        it(`status ${status}, given ${given}, ended ${ended}: ${expected}`, () => {
          expect(sendsMeasuredLength(given, ended, status)).toBe(expected);
        });
      }
});

describe("fixed-length WebDAV bodies", () => {
  const flags = [false, true];
  for (const hasBody of flags)
    for (const hasHeader of flags)
      for (const webdav of flags)
        for (const encoded of flags)
          for (const numeric of flags) {
            const expected = hasBody && hasHeader && webdav && !encoded && numeric;
            it(`body ${hasBody}, header ${hasHeader}, webdav ${webdav}, encoded ${encoded}, numeric ${numeric}`, () => {
              expect(fixesLength({ hasBody, hasHeader, webdav, encoded, numeric })).toBe(expected);
            });
          }
});

describe("request URLs (RFC 9112 §3.2)", () => {
  it.each([
    ["origin", true, { path: "target", host: "header" }],
    ["origin", false, { path: "target", host: "none" }],
    ["absolute", true, { path: "absolute", host: "header" }],
    ["absolute", false, { path: "absolute", host: "none" }],
    ["asterisk", true, { path: "slash", host: "none" }],
    ["asterisk", false, { path: "slash", host: "none" }],
    ["invalid", true, { path: "slash", host: "none" }],
    ["invalid", false, { path: "slash", host: "none" }],
  ] as const)("%s form, host ok %s", (form: TargetForm, hostOk, expected) => {
    expect(planUrl(form, hostOk)).toEqual(expected);
  });
});
