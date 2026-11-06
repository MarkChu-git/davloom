/** Starts from `defaults` and lets each header in `init` replace them, whatever form `init` takes. */
export const mergeHeaders = (defaults: HeadersInit, init?: HeadersInit): Headers => {
  const headers = new Headers(defaults);
  new Headers(init).forEach((value, name) => {
    headers.set(name, value);
  });
  return headers;
};
