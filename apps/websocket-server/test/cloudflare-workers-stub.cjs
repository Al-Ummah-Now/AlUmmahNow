// Minimal stand-in for the `cloudflare:workers` module so the Durable Object can run under Node tests.
class DurableObject {
  constructor(ctx, env) {
    this.ctx = ctx;
    this.env = env;
  }
}
module.exports = { DurableObject };
