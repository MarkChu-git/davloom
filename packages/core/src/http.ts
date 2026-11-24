import { Cause, Effect, Exit, Layer, ManagedRuntime, Option } from "effect";

/** The HTTP status and machine-readable code a declared error maps to. */
export interface ErrorResponse {
  readonly status: number;
  readonly code: string;
}

interface TaggedError {
  readonly _tag: string;
}

/** One entry for every declared error, so adding an error without a mapping is a type error. */
export type ErrorResponses<E extends TaggedError> = {
  readonly [Tag in E["_tag"]]: ErrorResponse;
};

export interface ResponseOptions<E extends TaggedError> {
  readonly errors: ErrorResponses<E>;
  readonly successStatus?: number;
  /** Receives the full cause of a defect, which must never reach the client. */
  readonly onDefect?: (cause: Cause.Cause<unknown>) => void;
}

const INTERNAL_ERROR: ErrorResponse = { status: 500, code: "internal_error" };

const errorResponse = ({ status, code }: ErrorResponse, message?: string): Response =>
  Response.json({ error: message === undefined ? { code } : { code, message } }, { status });

/** The `reason` of an error that explains itself to the client, such as a rejected import. */
const reasonOf = (error: TaggedError): string | undefined =>
  "reason" in error && typeof error.reason === "string" ? error.reason : undefined;

/** Turns the result of a business program into the response the API sends. */
export const responseFromExit = <A, E extends TaggedError>(
  exit: Exit.Exit<A, E>,
  { errors, successStatus = 200, onDefect }: ResponseOptions<E>,
): Response => {
  if (Exit.isSuccess(exit)) {
    return exit.value instanceof Response
      ? exit.value
      : Response.json(exit.value, { status: successStatus });
  }

  const failure = Cause.findErrorOption(exit.cause);
  const declared = Option.isSome(failure)
    ? (errors as Record<string, ErrorResponse | undefined>)[failure.value._tag]
    : undefined;
  if (declared && Option.isSome(failure)) {
    return errorResponse(declared, reasonOf(failure.value));
  }

  onDefect?.(exit.cause);
  return errorResponse(INTERNAL_ERROR);
};

/**
 * Creates a function that runs programs against one lazily built runtime. Workers can only perform
 * I/O while handling a request, so the layer is built on the first run and then kept for the isolate.
 */
export const makeHttpRunner = <R, LayerError extends TaggedError = never>(
  layer: Layer.Layer<R, LayerError>,
) => {
  const runtime = ManagedRuntime.make(layer);
  return async <A, E extends TaggedError>(
    program: Effect.Effect<A, E, R>,
    options: ResponseOptions<E>,
  ): Promise<Response> => {
    const exit = await runtime.runPromiseExit(program);
    return responseFromExit(exit, options as ResponseOptions<E | LayerError>);
  };
};
