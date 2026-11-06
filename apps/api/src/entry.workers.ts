import { CloudflareAdapter } from "elysia/adapter/cloudflare-worker";
import { createApp } from "./app";

// compile() has to run at global scope: Workers forbid generating code while handling a request.
export default createApp({ adapter: CloudflareAdapter }).compile();
