# Fasti worker

Fasti's own Cloudflare Worker, adapted from Mycelium's (see `LICENSE`). It lets
the browser app reach git hosts and WebDAV servers, and sends encrypted Web
Push reminders while the app is closed. The worker never runs Remind and never
contacts Remind's sites.

Setup steps and the full API are in [docs/setup-worker.md](../docs/setup-worker.md).

- `src/index.ts`: origin check, git proxy, OAuth exchange, WebDAV relay.
- `src/push.ts`: push routes and the `PushQueue` Durable Object.
- `scripts/vapid-keys.mjs`: prints a new VAPID key pair.
- `wrangler.jsonc`: name `fasti-worker`, `ALLOWED_ORIGINS`, logging off.

Privacy and hardening, as built:

- Stateless apart from `PushQueue`, one Durable Object per push subscription.
  No KV, D1 or R2. Logging is off.
- Every request needs an `Origin` in `ALLOWED_ORIGINS`.
- Cookies and unlisted headers are dropped in both directions.
- OAuth codes and tokens, and WebDAV credentials, live in memory for one
  request and are never stored.
- The WebDAV relay refuses IP addresses and local host names, requires
  credentials, caps bodies at 20 MB and follows no redirects. The git proxy follows only same-host redirects.
- Push messages are encrypted on the device; the worker stores only the push
  address, times and sealed bytes.

Develop:

```sh
cd worker
npm ci
npm test          # vitest
npm run check     # tsc
npm run dev       # wrangler dev
```

The worker has no runtime dependencies beyond Cloudflare's runtime. `wrangler`,
`vitest` and `typescript` are development tools only.
