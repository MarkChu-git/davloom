import bend, { type BendQuery, type BendSource } from "./compiled/properties.mjs";

/** A PROPFIND body: allprop, propname, or prop naming only DAV: properties or some others. */
export type PropfindQuery = "allprop" | "propname" | "prop-dav" | "prop-other";

export type PropertySource = "quota" | "live" | "dead" | "not-found";

/** The facts about one property named in a prop query, for one entry. */
export interface PropertyFacts {
  /** The name is in the DAV: namespace. */
  readonly dav: boolean;
  /** The local name is a quota property's. */
  readonly quotaName: boolean;
  readonly collection: boolean;
  /** The backend gave the quota of this entry. */
  readonly quotaValue: boolean;
  /** A live property of this local name has a value for the entry. */
  readonly liveValue: boolean;
  /** The entry holds a dead property of exactly this name. */
  readonly deadPresent: boolean;
}

const QUERIES: Record<PropfindQuery, BendQuery> = {
  allprop: { $: "QAllProp" },
  propname: { $: "QPropName" },
  "prop-dav": { $: "QPropDav" },
  "prop-other": { $: "QPropOther" },
};
const SOURCES: Record<BendSource["$"], PropertySource> = {
  FromQuota: "quota",
  FromLive: "live",
  FromDead: "dead",
  NotFound: "not-found",
};

/** Whether a PROPFIND reads dead properties (law propfind_reads_dead_exact). */
export const readsDeadProperties = (anyReadable: boolean, query: PropfindQuery): boolean =>
  bend.reads_dead(anyReadable, QUERIES[query]);

/** Where a property named in a prop query comes from (law property_source_exact). */
export const propertySource = (facts: PropertyFacts): PropertySource =>
  SOURCES[
    bend.source(
      facts.dav,
      facts.quotaName,
      facts.collection,
      facts.quotaValue,
      facts.liveValue,
      facts.deadPresent,
    ).$
  ];
