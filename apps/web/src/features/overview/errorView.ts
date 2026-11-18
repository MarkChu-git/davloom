import { Store, useStore } from "@tanstack/react-store";

/** The ways the Overview can show its recent operation errors. */
export type ErrorView = "list" | "timeline" | "tiles";

const VIEWS: readonly ErrorView[] = ["list", "timeline", "tiles"];

export const isErrorView = (value: string): value is ErrorView =>
  VIEWS.some((view) => view === value);

/** The view chosen, kept for the visit like every other choice the prototype makes. */
const errorViewStore = new Store<ErrorView>("list");

export const useErrorView = (): ErrorView => useStore(errorViewStore, (view) => view);

export const setErrorView = (view: ErrorView): void => errorViewStore.setState(() => view);
