import { createRouter } from "@tanstack/react-router";
import { routeTree } from "./routeTree.gen";

// Every search value the Dashboard uses is text, such as a file name. The router's default reads
// values as JSON, which would turn a file named "true" into a boolean and "1.10" into 1.1.
const parseSearch = (search: string): Record<string, string> =>
  Object.fromEntries(new URLSearchParams(search));

const stringifySearch = (search: Record<string, unknown>): string => {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(search)) {
    if (typeof value === "string") {
      params.set(key, value);
    }
  }
  const query = params.toString();
  return query === "" ? "" : `?${query}`;
};

export const getRouter = () =>
  createRouter({ routeTree, scrollRestoration: true, parseSearch, stringifySearch });
