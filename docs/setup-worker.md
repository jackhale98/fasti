# Setting up Fasti's worker

Fasti's worker (`worker/`) is a small Cloudflare Worker. Fasti needs it for
reminders while the app is closed (encrypted Web Push). It also carries the git
proxy, OAuth code exchange and WebDAV relay that sync uses later. The free
plan is plenty. Nothing here is needed to use Fasti without notifications.

## Steps (you, once)

1. **Cloudflare account.** Sign up at cloudflare.com (free). Durable Objects
   with SQLite storage are available on the free plan.
2. **API token.** Dashboard, My Profile, API Tokens, Create Token, template
   "Edit Cloudflare Workers". Note your Account ID too (Workers & Pages page).
3. **Repo secrets** (GitHub, Settings, Secrets and variables, Actions):
   `CLOUDFLARE_API_TOKEN`, and `CLOUDFLARE_ACCOUNT_ID` if the token can see more
   than one account.
4. **VAPID keys.** On a machine with Node 22:
   ```sh
   node worker/scripts/vapid-keys.mjs
   ```
   It prints `VAPID_PUBLIC_KEY=...` and `VAPID_PRIVATE_KEY=...`. Keep them:
   replacing the pair invalidates every existing subscription.
5. **Deploy once** so the worker exists (Actions, "Worker", Run
   workflow, tick "deploy"; or `cd worker && npm ci && npx wrangler login && npx wrangler deploy`).
   Wrangler prints the address, `https://fasti-worker.<you>.workers.dev`.
6. **Secrets on the worker** (from `worker/`):
   ```sh
   npx wrangler secret put VAPID_PUBLIC_KEY
   npx wrangler secret put VAPID_PRIVATE_KEY
   ```
   Later, for sign-in with a git host: `GITHUB_CLIENT_ID`,
   `GITHUB_CLIENT_SECRET` (likewise `GITLAB_*`, `BITBUCKET_*`; GitLab needs only
   the id if its app is public). Secrets are never put in `wrangler.jsonc`.
7. **Variables** (optional; set in `worker/wrangler.jsonc` `vars`, or in the
   Cloudflare dashboard, which deploys keep):
   - `ALLOWED_ORIGINS`: ships as `https://jackhale98.github.io,http://localhost:4173,http://localhost:5173`.
     Origins only (no path). `https://jackhale98.github.io` covers every GitHub Pages
     project of that user, so once Fasti has a custom domain, replace it with that
     one origin.
   - `VAPID_SUBJECT`: `mailto:you@example.com` or an https URL, the contact push
     services see.
   - `EXTRA_GIT_HOSTS`: self-hosted git hosts to proxy. `DAV_HOSTS`: if set, the
     WebDAV relay serves only these hosts.
8. **Tell the app.** Set the repo variable `PUBLIC_WORKER_URL` (Settings,
   Secrets and variables, Actions, Variables) to the worker address, no trailing
   slash, then re-run "Deploy to GitHub Pages". The app needs nothing else for
   push: it fetches the VAPID public key from the worker's `GET /push/key`
   endpoint, so there is no `PUBLIC_VAPID_*` variable.
9. Optional hardening. Rate limit for `PUT /push/reminders` per client IP: uncomment
   the `ratelimits` block in `worker/wrangler.jsonc` (30 a minute) and deploy;
   over the limit the worker answers 429. Without the `PUSH_RATE_LIMIT` binding
   there is no limit. A Cloudflare rate-limiting rule on the whole route also works.

Check it: `curl -H 'Origin: https://jackhale98.github.io' <worker>/push/key`
should answer `{"key":"..."}`. A 501 means the VAPID secrets or Durable Object
are missing; a 403 means the origin isn't in `ALLOWED_ORIGINS`.

## API

Every request needs an `Origin` header listed in `ALLOWED_ORIGINS`, else 403.
`OPTIONS` answers 204 with CORS headers. Replies carry `Cache-Control: no-store`
and `Access-Control-Allow-Origin` set to the caller's origin; the worker forces
`Cache-Control: no-store` and never passes on a git host's caching headers. Cookies are never
forwarded. The app calls `${PUBLIC_WORKER_URL}<path>`.

### Push

Answers 501 (`Reminders are not set up on this worker`) until the Durable Object
binding and both VAPID secrets exist.

`GET /push/key` -> 200 `application/json` `{"key": "<base64url P-256 public key, uncompressed point>"}`.
The app passes it (decoded) as `applicationServerKey` to `pushManager.subscribe`.

`PUT /push/reminders` replaces the whole schedule for one subscription.
Body (JSON, under 3 MiB):

```json
{ "endpoint": "<PushSubscription.endpoint>", "reminders": [{ "at": 1793000000000, "payload": "<base64url>" }] }
```

- `endpoint`: https, no port, at most 1024 chars, host `fcm.googleapis.com`,
  `updates.push.services.mozilla.com`, `push.services.mozilla.com`,
  `web.push.apple.com` or `notify.windows.com` (or a subdomain). Else 400.
- `reminders`: at most 512. Each `at` is a finite number, epoch milliseconds, at
  most 32 days after the worker's clock (else 400). Entries more than 60 s in the
  past are dropped silently. The list is stored sorted by `at`.
- `payload`: base64url (`A-Za-z0-9_-`, no padding) of the finished RFC 8291
  `aes128gcm` body, encrypted on the device for that subscription
  (`src/lib/push/encrypt.ts`); at most 5462 characters (4 KB of bytes). The worker
  never decrypts it.
- Success: 204, no body. Failures: 400 with a plain-text reason, 413 if
  `Content-Length` or the body is over 3 MiB, 405 for other methods.

`DELETE /push/reminders` body `{"endpoint": "..."}` -> 204; deletes the schedule.

Delivery (per subscription, by a Durable Object alarm): each reminder is POSTed
to `endpoint` at its `at` (up to 30 s early) with `Authorization: vapid t=<JWT>, k=<public key>`
(ES256, 12 h expiry), `Content-Encoding: aes128gcm`, `Content-Type: application/octet-stream`,
`TTL: 10800` (3 h; a late reminder beats none), `Urgency: high`, and the decoded payload as the body. The schedule
is deleted when the push service answers 400, 403, 404 or 410, and 40 days after
its last `PUT`. After a 429, a 5xx or a network error the message is retried
1, 5, 15 and 60 minutes after the first failure, while still within 3 hours of its
`at`, then dropped. Storage is one Durable Object key per reminder
(`r:<time>:<n>`) plus a `meta` key.
The Durable Object stores the push `endpoint` as well as the times and sealed
messages (the endpoint is a capability to push to that browser); it cannot read
the messages.
A browser that exceeds the rate limit gets 429 on `PUT`. The app re-sends the schedule on every open or sync.

A wrong `VAPID_SUBJECT` or key makes Apple answer 403, which deletes the list;
each device re-uploads on its next open.

### Git proxy

`GET /<host>/<owner>/<repo>.git/info/refs?service=git-upload-pack|git-receive-pack`,
`POST /<host>/<owner>/<repo>.git/git-upload-pack|git-receive-pack`. `host` is
`github.com`, `gitlab.com`, `bitbucket.org` or in `EXTRA_GIT_HOSTS`. Anything else
is 403. Only `Accept`, `Authorization`, `Content-Type`, `Content-Encoding` and
`Git-Protocol` are forwarded; bodies stream through. Redirects are followed by
the worker, at most 3, for GET only and only to the same host over https, so
`Authorization` never reaches another host; any other redirect is a 502.

### OAuth

`POST /oauth/<github|gitlab|bitbucket>/token` with JSON
`{ "code", "code_verifier"?, "redirect_uri"? }` and
`POST /oauth/<provider>/refresh` with `{ "refresh_token", "redirect_uri"? }`.
The worker adds the client id and secret and returns the provider's response
unchanged. 501 names the missing secret. Tokens are held for that one request.

### WebDAV relay

`PROPFIND|GET|PUT|DELETE|MKCOL /dav/<host>/<path>` forwards to `https://<host>/<path>`.
`Authorization` is required (else 401). Refused with 403: IP addresses,
any port other than 443 unless that exact `host:port` is in `DAV_HOSTS`,
single-label names, `localhost`, `.local`, `.internal`, `.lan`, `.home.arpa`,
hosts outside `DAV_HOSTS` when it is set, and `..` in the path. Bodies over 20 MB
are 413 (counted even when chunked). Redirects are not followed. Forwarded
request headers: `Authorization`, `Content-Type`, `Depth`, `If-Match`,
`If-None-Match`.

## Checks

```sh
cd worker && npm ci && npm test && npm run check
```

CI runs these on every push (the `worker` job in `ci.yml`), and
`.github/workflows/worker.yml` runs them again on pushes that change `worker/`.
