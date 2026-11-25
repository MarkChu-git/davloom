/**
 * Carries what a person typed into the prerendered frame over to the page that React renders in
 * its place (client.tsx). The frame paints a page's form before any of its code has run, and a
 * person, or a password manager, can type into it at once. React then renders the page afresh
 * and puts new elements where the frame's were, whose fields start from the page's own state. So
 * before React renders, this notes the frame's fields, and once the frame has gone it writes each
 * field the person changed into the page's field in its place, as typing would, so that the page's
 * state takes it, and puts the caret back where it was.
 *
 * A frame field and a page field are the same field when they are the n-th shown field of the same
 * kind (element, type, autocomplete purpose and name) on their page. The frame holds a copy of the
 * page for each language and window, of which the stylesheet shows one, so only shown fields count.
 */

type Field = HTMLInputElement | HTMLTextAreaElement;

/** The input types a person types text into. */
const TEXT_TYPES = new Set(["text", "search", "email", "password", "tel", "url"]);

/** How long the page may take to render the frame's fields once the frame has gone. */
const CARRY_MS = 10_000;

const isTextField = (element: Element): element is Field =>
  (element instanceof HTMLInputElement && TEXT_TYPES.has(element.type)) ||
  element instanceof HTMLTextAreaElement;

/** The fields a person can type into now: shown, enabled and not read-only. */
const typableFields = (root: ParentNode): Field[] =>
  [...root.querySelectorAll("input, textarea")]
    .filter(isTextField)
    .filter((field) => !field.disabled && !field.readOnly && field.getClientRects().length > 0);

/** What makes two fields the same field: their kind, and how many of that kind come before. */
const keyed = (fields: readonly Field[]): { key: string; field: Field }[] => {
  const seen = new Map<string, number>();
  return fields.map((field) => {
    const kind = [
      field.tagName,
      field.type,
      field.getAttribute("autocomplete") ?? "",
      field.name,
    ].join("|");
    const index = seen.get(kind) ?? 0;
    seen.set(kind, index + 1);
    return { key: `${kind}#${index}`, field };
  });
};

/** The selection of a field, or none for a type that has none. */
const selectionOf = (field: Field): [number, number, "forward" | "backward" | "none"] | undefined =>
  field.selectionStart === null || field.selectionEnd === null
    ? undefined
    : [field.selectionStart, field.selectionEnd, field.selectionDirection ?? "none"];

/**
 * Writes `value` into `field` as typing would: through the element's own value setter, which
 * React's controlled field does not watch, and then an input event, which makes React compare the
 * field with its state and call the field's onChange.
 */
const typeInto = (field: Field, value: string) => {
  const prototype =
    field instanceof HTMLInputElement ? HTMLInputElement.prototype : HTMLTextAreaElement.prototype;
  Object.getOwnPropertyDescriptor(prototype, "value")?.set?.call(field, value);
  field.dispatchEvent(new Event("input", { bubbles: true }));
};

interface Carried {
  readonly key: string;
  /** What the person typed, if they changed the field. */
  readonly value?: string;
  /** Where the caret was, if the field had focus. */
  readonly focus?: { selection?: ReturnType<typeof selectionOf> };
}

/** What the frame's fields hold that the page's fields would not: what was typed, and the caret. */
const carriedFrom = (fields: readonly Field[], focused: Field | undefined): Carried[] =>
  keyed(fields).flatMap(({ key, field }) => {
    // A field the person left alone holds the value it was prerendered with, or one the frame's
    // script wrote, which it writes as the default too (fill.ts).
    const isChanged = field.value !== field.defaultValue;
    const hasFocus = field === focused;
    if (!isChanged && !hasFocus) return [];
    return [
      {
        key,
        ...(isChanged ? { value: field.value } : {}),
        ...(hasFocus ? { focus: { selection: selectionOf(field) } } : {}),
      },
    ];
  });

/** Writes what was carried into the page's fields; returns what found no field yet. */
const writeInto = (page: readonly Field[], carried: readonly Carried[]): Carried[] => {
  const byKey = new Map(keyed(page).map(({ key, field }) => [key, field]));
  return carried.filter(({ key, value, focus }) => {
    const field = byKey.get(key);
    if (field === undefined) return true;
    if (value !== undefined && field.value !== value) typeInto(field, value);
    if (focus !== undefined) {
      field.focus({ preventScroll: true });
      // The page's field is of the frame field's type, so it has a selection when that had one.
      if (focus.selection !== undefined) field.setSelectionRange(...focus.selection);
    }
    return false;
  });
};

/**
 * Starts watching the frame's fields; call it before React renders the page over the frame. It
 * does nothing on a page whose frame has no field to type into. Returns a function that stops it.
 */
export const carryFrameInput = (root: Document = document, carryMs = CARRY_MS): (() => void) => {
  const frame = typableFields(root);
  if (frame.length === 0) return () => {};
  let focused = frame.find((field) => field === root.activeElement);
  // What the frame is made of. The page's own elements take focus as React puts them in, while the
  // frame is still there, and they are none of these.
  const frameParts = [...root.body.children];

  const onFocusIn = (event: FocusEvent) => {
    const { target } = event;
    if (!(target instanceof Node) || !frameParts.some((part) => part.contains(target))) return;
    focused = frame.find((field) => field === target);
  };
  const onFocusOut = (event: FocusEvent) => {
    const field = frame.find((candidate) => candidate === event.target);
    if (field === undefined) return;
    // A field that leaves the document as React replaces the frame may report losing focus, but
    // its caret is the one to carry; one that stays lost it to the page itself.
    queueMicrotask(() => {
      if (field.isConnected && focused === field) focused = undefined;
    });
  };

  let pending: Carried[] | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const observer = new MutationObserver(() => {
    if (pending === undefined) {
      // The frame's script also writes into the frame; the frame is still there.
      if (frame.some((field) => field.isConnected)) return;
      pending = carriedFrom(frame, focused);
      root.removeEventListener("focusin", onFocusIn, true);
      root.removeEventListener("focusout", onFocusOut, true);
      timer = setTimeout(stop, carryMs);
    }
    pending = writeInto(typableFields(root), pending);
    if (pending.length === 0) stop();
  });
  const stop = () => {
    observer.disconnect();
    clearTimeout(timer);
    root.removeEventListener("focusin", onFocusIn, true);
    root.removeEventListener("focusout", onFocusOut, true);
  };

  root.addEventListener("focusin", onFocusIn, true);
  root.addEventListener("focusout", onFocusOut, true);
  // Mutation callbacks run as microtasks right after React's commit, before the browser handles
  // another key or paints, so nothing is typed into the page before the frame's text is in it.
  observer.observe(root, { childList: true, subtree: true });
  return stop;
};
