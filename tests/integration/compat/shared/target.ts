/** How a suite reaches the server under test, whichever runtime hosts it. */
export interface Target {
  fetch(path: string, init?: RequestInit): Promise<Response>;
}
