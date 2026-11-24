import { describe, expect, it } from "vitest";
import worker from "./entry.workers";

// The Worker's entry, with `cloudflare:workers` replaced by the stand-in of the unit tests. The
// production Worker itself runs in workerd (tests/integration/compat).
describe("the Workers entry", () => {
  it("answers through the app", async () => {
    const response = await worker.fetch(new Request("https://davloom.example/api/health"));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ status: "ok" });
  });
});
