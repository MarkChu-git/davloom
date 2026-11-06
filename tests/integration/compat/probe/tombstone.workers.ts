// Deployed once at the end of a cloud run. Cloudflare deletes a Durable Object class and its data
// only when the class is gone from the code, so this entry exports nothing else.
export default {
  fetch: () => new Response(null, { status: 404 }),
};
