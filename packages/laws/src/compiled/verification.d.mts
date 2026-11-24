import type { Ctor } from "../bend";

export type BendEffect = Ctor<
  "EffRead" | "EffChange" | "EffEndSelf" | "EffDestroy" | "EffCredential" | "EffDisclose"
>;
export type BendLevel = Ctor<"LNone" | "LConfirm" | "LStepUp">;

declare const module: {
  level(effect: BendEffect): BendLevel;
  allows(level: BendLevel, fresh: boolean): boolean;
  permits(effect: BendEffect, fresh: boolean): boolean;
};
export default module;
