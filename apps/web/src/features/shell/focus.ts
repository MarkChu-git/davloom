/** How long a dialog or panel may take to leave before focus is no longer watched. */
const WATCH_MS = 1000;

/**
 * Moves focus to `find()` when the control that had it goes away, for example a row's menu button
 * after its row was deleted. A dialog keeps focus until its exit transition ends, then returns it
 * to its opener if the opener is still there. A table can also render its rows again as its width
 * changes, which replaces the element this focused. So this watches each frame for up to a second
 * and moves focus whenever it has fallen to the page body, until something else takes it.
 */
export const refocusIfLost = (find: () => HTMLElement | null | undefined): void => {
  const until = performance.now() + WATCH_MS;
  let placed: HTMLElement | undefined;
  const check = () => {
    const active = document.activeElement;
    if (active === null || active === document.body || !active.isConnected) {
      placed = find() ?? undefined;
      placed?.focus();
    } else if (placed !== undefined && active !== placed) {
      // Focus moved on after this placed it, for example because the person pressed Tab.
      return;
    }
    if (performance.now() < until) {
      requestAnimationFrame(check);
    }
  };
  requestAnimationFrame(check);
};

/** Astryx LayoutContent renders the main landmark as an element with this role, not as <main>. */
const MAIN = '[role="main"]';

/** The elements in the main landmark that match `selector`. */
export const inMain = <T extends HTMLElement = HTMLElement>(selector: string): T[] => [
  ...document.querySelectorAll<T>(`${MAIN} ${selector}`),
];

/** The in-app link in the main landmark whose `href` is exactly `href`. */
export const linkTo = (href: string): HTMLElement | undefined =>
  inMain<HTMLAnchorElement>("a[href]").find((link) => link.getAttribute("href") === href);

/** The button in the main landmark whose text is exactly `text`. */
export const buttonNamed = (text: string): HTMLElement | undefined =>
  inMain("button").find((button) => button.textContent === text);

/** The button in the main landmark whose `aria-label` is exactly `label`, such as an icon button. */
export const buttonLabelled = (label: string): HTMLElement | undefined =>
  inMain("button").find((button) => button.getAttribute("aria-label") === label);
