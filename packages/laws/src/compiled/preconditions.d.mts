import type { Ctor } from "../bend";

export type BendCheck = Ctor<"Unset"> | Ctor<"Holds"> | Ctor<"Fails">;
export type BendVerdict = Ctor<"Pass"> | Ctor<"Failed"> | Ctor<"NotModified">;

declare const module: {
  evaluate(
    read: boolean,
    ifMatch: BendCheck,
    ifUnmodified: BendCheck,
    ifNoneMatch: BendCheck,
    ifModified: BendCheck,
  ): BendVerdict;
};
export default module;
