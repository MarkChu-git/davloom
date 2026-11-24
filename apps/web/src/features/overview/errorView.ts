import { Store, useStore } from "@tanstack/react-store";

/** The ways the Overview can show its recent operation errors. */
export type ErrorView = "list" | "timeline" | "tiles";

const VIEWS: readonly ErrorView[] = ["list", "timeline", "tiles"];

export const isErrorView = (value: string): value is ErrorView =>
  VIEWS.some((view) => view === value);

const STORAGE_KEY = "davloom.overview.errorView";

/** The view chosen last in this browser, or the list. */
const remembered = (): ErrorView => {
  try {
    const stored = globalThis.localStorage?.getItem(STORAGE_KEY) ?? "";
    return isErrorView(stored) ? stored : "list";
  } catch {
    return "list";
  }
};

const errorViewStore = new Store<ErrorView>(remembered());

export const useErrorView = (): ErrorView => useStore(errorViewStore, (view) => view);

export const setErrorView = (view: ErrorView): void => {
  errorViewStore.setState(() => view);
  try {
    globalThis.localStorage?.setItem(STORAGE_KEY, view);
  } catch {
    // A browser that keeps nothing still shows the view for the visit.
  }
};
