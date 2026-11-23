import { CloudflareAdapter } from "elysia/adapter/cloudflare-worker";
import { createApp } from "./app";
import { workersInstance } from "./instance.workers";

export { StorageObject } from "@davloom/storage/durable-object";

// compile() has to run at global scope: Workers forbid generating code while handling a request.
export default createApp({ adapter: CloudflareAdapter, instance: workersInstance }).compile();
