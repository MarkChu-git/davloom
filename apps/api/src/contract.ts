import type { ROUTES, RouteName } from "@davloom/schema";
import type { Elysia } from "elysia";
import type { createApp } from "./app";

// The type of the management API that the Dashboard's Eden Treaty client (packages/client) is
// typed from. Elysia knows each route's path, method and parameters from createApp, but the routes
// read their bodies and encode their answers through the contracts of packages/schema themselves,
// so Elysia types every body as unknown and every answer as a Response. This type takes the
// routes of createApp and gives each /api route the body, query and answer of its contract, which
// the route decodes and encodes at run time. Nothing here runs: it only exists for the compiler.
// packages/client/src/contract.test.ts checks the answers against the real app.

/** The contract of the route `METHOD pattern`. */
type Contract<Name extends RouteName> = (typeof ROUTES)[Name];

/** What a schema of packages/schema reads and writes as JSON. */
type Encoded<S> = S extends { readonly Encoded: infer E } ? E : never;

/** One route of Elysia's route tree. */
interface Endpoint {
  body: unknown;
  params: unknown;
  query: unknown;
  headers: unknown;
  response: Record<number, unknown>;
}

/** A route with its contract's body, query and answer; a route without a contract stays as it is. */
type Typed<Route extends Endpoint, Name extends string> = Name extends RouteName
  ? Omit<Route, "body" | "query" | "response"> & {
      body: Contract<Name> extends { body: infer Body } ? Encoded<Body> : Route["body"];
      query: Contract<Name> extends { query: infer Query } ? Encoded<Query> : Route["query"];
      response: { [Status in Contract<Name>["status"]]: Encoded<Contract<Name>["response"]> };
    }
  : Route;

/** Elysia's route tree under `path`, its /api routes typed by their contracts. */
type WithContracts<Routes, Path extends string> = {
  [Key in keyof Routes]: Routes[Key] extends Endpoint
    ? Typed<Routes[Key], `${Uppercase<Key & string>} ${Path}`>
    : WithContracts<Routes[Key], `${Path}/${Key & string}`>;
};

/** The JSON answer of the route `METHOD pattern` on success. */
export type Answer<Name extends RouteName> = Encoded<Contract<Name>["response"]>;

type Built = ReturnType<typeof createApp>;

/** The app as Eden Treaty sees it: createApp's routes, typed by packages/schema's contracts. */
export type App =
  Built extends Elysia<
    infer BasePath,
    infer Singleton,
    infer Definitions,
    infer Metadata,
    infer Routes,
    infer Ephemeral,
    infer Volatile
  >
    ? Elysia<
        BasePath,
        Singleton,
        Definitions,
        Metadata,
        WithContracts<Routes, "">,
        Ephemeral,
        Volatile
      >
    : never;
