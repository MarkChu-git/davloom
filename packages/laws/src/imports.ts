import { toList } from "./bend";
import bend, { type BendCount, type BendEntry } from "./compiled/imports.mjs";

/**
 * One entry of an import: the keys it defines, such as `backend:<id>` and `backend-name:<name>`,
 * and the keys it needs another entry or the target to define. A key names its kind, so keys of
 * two kinds never collide.
 */
export interface ImportEntry {
  readonly defines: readonly string[];
  readonly needs: readonly string[];
}

/**
 * Whether an import into a target that holds the keys `known` applies every entry, in order, or
 * none (PRD §4, Phase 6, the law import_all_or_nothing): it applies them when each entry needs only
 * keys that the target or an earlier entry defines, and defines only keys that nothing defined
 * before it.
 */
export const planImport = (
  entries: readonly ImportEntry[],
  known: readonly string[],
): "apply" | "reject" => {
  // Bend compares Nats, so each distinct key becomes the next number.
  const numbers = new Map<string, number>();
  const numberOf = (key: string): number => {
    let n = numbers.get(key);
    if (n === undefined) {
      n = numbers.size;
      numbers.set(key, n);
    }
    return n;
  };
  const list = toList(
    entries.map((entry): BendEntry => ({
      $: "Entry",
      defines: toList(entry.defines.map(numberOf)),
      needs: toList(entry.needs.map(numberOf)),
    })),
  );
  return bend.plan(list, toList(known.map(numberOf))).$ === "Apply" ? "apply" : "reject";
};

const countOf = (n: number): BendCount => ({ $: n <= 0 ? "CNone" : n === 1 ? "COne" : "CMany" });

/**
 * Whether an export can start an instance (the laws import_needs_one_owner and
 * import_refuses_ownerless): it holds exactly one user, and that user has at least one login with
 * a password, so the import makes them the owner and closes registration.
 */
export const exportHasOwner = (users: number, ownerLogins: number): boolean =>
  bend.owned(countOf(users), countOf(ownerLogins));
