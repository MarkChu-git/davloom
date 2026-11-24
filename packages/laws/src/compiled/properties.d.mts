import type { Ctor } from "../bend";

export type BendQuery = Ctor<"QAllProp"> | Ctor<"QPropName"> | Ctor<"QPropDav"> | Ctor<"QPropOther">;
export type BendSource = Ctor<"FromQuota"> | Ctor<"FromLive"> | Ctor<"FromDead"> | Ctor<"NotFound">;

declare const module: {
  reads_dead(anyReadable: boolean, query: BendQuery): boolean;
  source(
    dav: boolean,
    quotaName: boolean,
    collection: boolean,
    quotaValue: boolean,
    liveValue: boolean,
    deadPresent: boolean,
  ): BendSource;
};
export default module;
