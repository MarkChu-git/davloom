import { Dialog } from "@astryxdesign/core/Dialog";
import { useCallback, useRef, useState, type ReactNode } from "react";
import { refocusIfLost } from "./focus";

type Find = () => HTMLElement | null | undefined;

/** Whether the element is still drawn: a closed menu keeps its items, but hides them. */
const isOnScreen = (element: HTMLElement): boolean =>
  element.isConnected && element.getClientRects().length > 0;

/**
 * A form dialog that sends focus back to the control that opened it, however it closes: with one
 * of its own buttons, with Escape, or with the header's close button. Astryx Dialog takes as its
 * opener whatever has focus once its content has mounted, and a form's first field focuses itself
 * in that same commit, so the dialog's own return goes to that field inside the closed dialog and
 * focus falls to the page body.
 *
 * Each form passed to `show` needs a new `key`, because the dialog keeps its content while it
 * closes and the next form would otherwise start with what the last one held. Astryx names a dialog
 * after its DialogHeader only when the dialog first opens, so a later form would keep the first
 * one's name or none: `show` takes the form's title, which names the dialog.
 */
export const useFormDialog = (width: number) => {
  const [content, setContent] = useState<ReactNode>(null);
  const [label, setLabel] = useState("");
  const [isOpen, setIsOpen] = useState(false);
  const opener = useRef<Find>(() => undefined);

  /**
   * Opens the dialog, named `title`, the title of the form's header. `fallback` finds where focus
   * goes back to when the opener is no longer on screen, as with an item of a menu that has closed.
   */
  const show = useCallback((next: ReactNode, title: string, fallback?: Find) => {
    const active = document.activeElement;
    const control = active instanceof HTMLElement && active !== document.body ? active : undefined;
    opener.current = () => (control !== undefined && isOnScreen(control) ? control : fallback?.());
    setContent(next);
    setLabel(title);
    setIsOpen(true);
  }, []);

  /** Closes the dialog and moves focus to `returnTo`, or else back to the control that opened it. */
  const hide = useCallback((returnTo?: Find) => {
    setIsOpen(false);
    refocusIfLost(returnTo ?? opener.current);
  }, []);

  const element = (
    <Dialog
      isOpen={isOpen}
      onOpenChange={(isOpenNow) => {
        if (!isOpenNow) {
          hide();
        }
      }}
      purpose="form"
      width={width}
      aria-label={label}
    >
      {content}
    </Dialog>
  );
  return { show, hide, element };
};

let formCount = 0;

/** A key for a form passed to `show`, new on every call, so the form starts from its own values. */
export const nextFormKey = (): string => {
  formCount += 1;
  return `form-${formCount}`;
};
