import * as fc from "fast-check";
import { describe, expect, it } from "vitest";
import {
  propertySource,
  readsDeadProperties,
  type PropertyFacts,
  type PropertySource,
  type PropfindQuery,
} from "./properties";

const QUERIES: readonly PropfindQuery[] = ["allprop", "propname", "prop-dav", "prop-other"];

// RFC 4918 §9.1 and RFC 4331, written as the handler did before the decision moved to Bend, with
// dead properties outside DAV: only.
const oracle = (f: PropertyFacts): PropertySource => {
  if (f.dav && f.quotaName && f.collection && f.quotaValue) return "quota";
  if (f.dav && f.liveValue) return "live";
  if (!f.dav && f.deadPresent) return "dead";
  return "not-found";
};

const facts = fc.record({
  dav: fc.boolean(),
  quotaName: fc.boolean(),
  collection: fc.boolean(),
  quotaValue: fc.boolean(),
  liveValue: fc.boolean(),
  deadPresent: fc.boolean(),
});

describe("PROPFIND reads of dead properties", () => {
  const rows: [boolean, PropfindQuery, boolean][] = [
    [true, "allprop", true],
    [true, "propname", true],
    [true, "prop-dav", false],
    [true, "prop-other", true],
  ];
  for (const q of QUERIES) rows.push([false, q, false]);
  it.each(rows)("readable %s, %s: %s", (readable, q, expected) => {
    expect(readsDeadProperties(readable, q)).toBe(expected);
  });
});

describe("property sources", () => {
  it.each([
    [
      "quota-available-bytes on a collection",
      {
        dav: true,
        quotaName: true,
        collection: true,
        quotaValue: true,
        liveValue: false,
        deadPresent: false,
      },
      "quota",
    ],
    [
      "a quota name on a file",
      {
        dav: true,
        quotaName: true,
        collection: false,
        quotaValue: false,
        liveValue: false,
        deadPresent: false,
      },
      "not-found",
    ],
    [
      "a quota the backend does not give",
      {
        dav: true,
        quotaName: true,
        collection: true,
        quotaValue: false,
        liveValue: false,
        deadPresent: false,
      },
      "not-found",
    ],
    [
      "a quota name outside DAV:",
      {
        dav: false,
        quotaName: true,
        collection: true,
        quotaValue: true,
        liveValue: false,
        deadPresent: true,
      },
      "dead",
    ],
    [
      "getetag",
      {
        dav: true,
        quotaName: false,
        collection: false,
        quotaValue: false,
        liveValue: true,
        deadPresent: false,
      },
      "live",
    ],
    [
      "getcontentlength on a collection",
      {
        dav: true,
        quotaName: false,
        collection: true,
        quotaValue: false,
        liveValue: false,
        deadPresent: false,
      },
      "not-found",
    ],
    [
      "a live name outside DAV:",
      {
        dav: false,
        quotaName: false,
        collection: false,
        quotaValue: false,
        liveValue: true,
        deadPresent: false,
      },
      "not-found",
    ],
    [
      "a dead property",
      {
        dav: false,
        quotaName: false,
        collection: false,
        quotaValue: false,
        liveValue: false,
        deadPresent: true,
      },
      "dead",
    ],
    [
      "a DAV: name stored as dead",
      {
        dav: true,
        quotaName: false,
        collection: false,
        quotaValue: false,
        liveValue: false,
        deadPresent: true,
      },
      "not-found",
    ],
    [
      "an unknown property",
      {
        dav: false,
        quotaName: false,
        collection: false,
        quotaValue: false,
        liveValue: false,
        deadPresent: false,
      },
      "not-found",
    ],
  ] as [string, PropertyFacts, PropertySource][])("%s: %s", (_, f, expected) => {
    expect(propertySource(f)).toBe(expected);
  });

  it("agrees with the oracle for all 64 sets of facts", () => {
    fc.assert(
      fc.property(facts, (f) => {
        expect(propertySource(f)).toBe(oracle(f));
      }),
      {
        numRuns: 500,
      },
    );
  });

  it("answers a DAV: property the same whatever the store holds", () => {
    fc.assert(
      fc.property(facts, (f) => {
        expect(propertySource({ ...f, dav: true, deadPresent: true })).toBe(
          propertySource({ ...f, dav: true, deadPresent: false }),
        );
      }),
    );
  });
});
