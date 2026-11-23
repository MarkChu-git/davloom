// Shapes of values as Bend's JavaScript backend passes them: a constructor is `{ $: name, ...fields }`,
// Bool is a JavaScript boolean and Nat a non-negative integer number. Bend writes no TypeScript
// declarations (bendlang/bend#1144), so compiled/<module>.d.mts declares each module by hand, and
// the tests of each wrapper check those declarations against the compiled code.

export type Ctor<Name extends string, Fields = object> = { readonly $: Name } & Readonly<Fields>;

export type BendList<T> = Ctor<"Nil"> | Ctor<"Con", { head: T; tail: BendList<T> }>;

/** The largest Nat Bend accepts before it stops with an error (PRD §4). */
export const MAX_NAT = 2 ** 48 - 1;

export const toList = <T>(items: readonly T[]): BendList<T> =>
  items.reduceRight<BendList<T>>((tail, head) => ({ $: "Con", head, tail }), { $: "Nil" });

export const isNat = (value: number): boolean =>
  Number.isInteger(value) && value >= 0 && value <= MAX_NAT;
