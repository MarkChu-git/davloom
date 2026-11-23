import type { Ctor } from "../bend";

export type BendSpec =
  | Ctor<"FromTo", { first: number; last: number }>
  | Ctor<"From", { first: number }>
  | Ctor<"Suffix", { length: number }>;
export type BendResolved = Ctor<"Span", { start: number; stop: number }> | Ctor<"Unsatisfiable">;

declare const module: { resolve(spec: BendSpec, size: number): BendResolved };
export default module;
