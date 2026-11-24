import { fireEvent, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { vi } from "vitest";

// happy-dom lays nothing out, so every element measures 0 px wide and the pages that size
// themselves with useNarrowerThan always take their narrow layout. These set the width every
// element reports, so a test can render the wide layout too.

export const WIDE = 1600;
export const NARROW = 320;

// oxlint-disable-next-line typescript/unbound-method -- called below with the animation as `this`
const cancelAnimation = Animation.prototype.cancel;

const ignore = (): void => undefined;

/** Animation.cancel, with the rejection of `finished` that it causes marked as handled. */
function cancelHandled(this: Animation): void {
  this.finished.catch(ignore);
  cancelAnimation.call(this);
}

/**
 * A canceled animation's `finished` promise rejects, and browsers mark that rejection as handled
 * (Web Animations, "cancel an animation"); happy-dom leaves it unhandled, which fails the run when
 * Astryx List cancels the animations of a row that left. This marks it handled, as browsers do.
 */
export const handleCanceledAnimations = (): void => {
  Animation.prototype.cancel = cancelHandled;
};

/** Makes every element report `width` px, until the test's mocks are restored. */
export const layOutAt = (width: number): void => {
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue(
    DOMRect.fromRect({ x: 0, y: 0, width, height: 600 }),
  );
};

/**
 * Opens the Astryx menu whose button is named `menu` and chooses `item`. The menu's popover is
 * never shown in happy-dom, and a simulated pointer press closes it before its click, so the item
 * gets a plain click.
 */
export const chooseFromMenu = async (menu: string, item: string): Promise<void> => {
  await userEvent.click(await screen.findByRole("button", { name: menu }));
  const list = screen.getByRole("menu", { name: menu, hidden: true });
  fireEvent.click(within(list).getByRole("menuitem", { name: item, hidden: true }));
};

/**
 * Enters `text` into a field at once, as a paste does, rather than key by key: typing takes a timer
 * per character. A trailing "{Enter}" then presses Enter.
 */
export const fill = async (field: HTMLElement, text: string): Promise<void> => {
  const isSubmit = text.endsWith("{Enter}");
  await userEvent.click(field);
  await userEvent.paste(isSubmit ? text.slice(0, -"{Enter}".length) : text);
  if (isSubmit) {
    await userEvent.keyboard("{Enter}");
  }
};

/** Opens the Astryx Selector named `field` and picks `option`, as `chooseFromMenu` picks an item. */
export const chooseOption = async (field: string, option: string | RegExp): Promise<void> => {
  await userEvent.click(screen.getByRole("combobox", { name: field }));
  fireEvent.click(await screen.findByRole("option", { name: option, hidden: true }));
};
