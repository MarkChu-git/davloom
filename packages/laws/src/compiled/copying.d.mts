import type { Ctor } from "../bend";

export type BendSource = Ctor<"SFile"> | Ctor<"SFolder">;
export type BendTarget = Ctor<"TAbsent"> | Ctor<"TSame"> | Ctor<"TDiffers"> | Ctor<"TFolder">;
export type BendAction = Ctor<"Create"> | Ctor<"Write"> | Ctor<"Skip"> | Ctor<"Conflict">;

declare const module: {
  decide(source: BendSource, target: BendTarget, overwrite: boolean): BendAction;
};
export default module;
