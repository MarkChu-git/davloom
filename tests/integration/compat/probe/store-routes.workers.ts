import type { Auth } from "@davloom/auth";
import { Elysia } from "elysia";
import { burnCpu } from "./burn";
import type { D1UsageCounter } from "./d1-usage.workers";
import { authenticate, unauthorized } from "./identity-routes";

export interface StoreRoutesOptions {
  readonly d1Usage: D1UsageCounter;
  readonly getAuth: () => Auth;
  readonly store: DurableObjectNamespace;
}

const OBJECT_ORIGIN = "https://store";
const STORE_PREFIX = "/api/__probe/store";
const OBJECT_PREFIX = "/api/__probe/object";
const QUOTA_PREFIX = "/api/__probe/quota/dav";

interface Listing {
  readonly children: readonly unknown[];
  readonly rowsRead: number;
  readonly rowsWritten: number;
}

/** The Cloud Free route chain: authenticate in the Worker, then do the storage work in the object. */
export const storeRoutes = ({ d1Usage, getAuth, store }: StoreRoutesOptions) => {
  const object = () => store.get(store.idFromName("probe"));

  /** Hands the request over untouched, body stream included, so the Worker spends no CPU on bytes. */
  const forward = async (request: Request, prefix: string): Promise<Response> => {
    const { pathname, search } = new URL(request.url);
    const target = `${OBJECT_ORIGIN}${pathname.slice(prefix.length)}${search}`;
    try {
      return await object().fetch(new Request(target, request));
    } catch (error) {
      // A limit hit inside the object arrives here, and its message is what the findings need.
      return Response.json({ error: String(error) }, { status: 502 });
    }
  };

  const forwardIfAuthenticated = async (request: Request): Promise<Response> =>
    (await authenticate(getAuth(), request)) ? forward(request, STORE_PREFIX) : unauthorized();

  /** Stands in for a directory PROPFIND: authenticate, list, and report what that used. */
  const listWithUsage = async (request: Request): Promise<Response> => {
    d1Usage.reset();
    if (!(await authenticate(getAuth(), request))) {
      return unauthorized();
    }
    const d1 = d1Usage.read();
    const parent = new URL(request.url).pathname.slice(QUOTA_PREFIX.length);
    const response = await object().fetch(
      `${OBJECT_ORIGIN}/directories?parent=${encodeURIComponent(parent)}`,
    );
    const { children, rowsRead, rowsWritten } = (await response.json()) as Listing;
    return Response.json({
      children: children.length,
      d1,
      durableObject: { rowsRead, rowsWritten },
    });
  };

  return new Elysia()
    .all("/api/__probe/store/*", ({ request }) => forwardIfAuthenticated(request), {
      parse: "none",
    })
    .all("/api/__probe/quota/dav/*", ({ request }) => listWithUsage(request), { parse: "none" })
    .all("/api/__probe/object/*", ({ request }) => forward(request, OBJECT_PREFIX), {
      parse: "none",
    })
    .post("/api/__probe/burn/:iterations", ({ params }) => ({
      value: burnCpu(Number(params.iterations)),
    }));
};
