// SPDX-License-Identifier: GPL-2.0-or-later
// Adapted from Mycelium (github.com/jackhale98/mycelium-web) under the owner's grant
// in THIRD_PARTY_NOTICES.md.
/// Fasti worker — no logging; stateless apart from opt-in reminders.
///
/// 1. Git proxy: browsers cannot call git hosts' smart-HTTP endpoints (no
///    CORS), so isomorphic-git sends them here as `/<host>/<repo path>`. Only
///    the three git endpoints, only allow-listed hosts, only from allow-listed
///    origins. Bodies are streamed straight through.
/// 2. OAuth: exchanges an authorization code (or refresh token) for tokens,
///    adding the client secret the browser must not hold, and returns the
///    provider's response unchanged.
/// 3. WebDAV relay: most WebDAV servers (Nextcloud…) don't allow cross-origin
///    requests, so `/dav/<host>/<path>` passes WebDAV file requests through.
///    Only WebDAV methods, only HTTPS host names (no IPs, no localhost), only
///    requests that carry credentials, no redirects followed. Nothing is
///    stored or logged; set DAV_HOSTS to allow only your own servers.
/// 4. Reminders (optional, see push.ts): the one stateful part. For each
///    browser push subscription, a short list of encrypted messages to send
///    at set times, so reminders arrive while the app is closed.

import { pushRoute, type PushEnv } from './push';
export { PushQueue } from './push';

export interface Env extends PushEnv {
	/** Comma-separated origins allowed to use the worker, e.g. `https://you.github.io`. */
	ALLOWED_ORIGINS: string;
	/** Optional comma-separated extra git hosts (self-hosted GitLab, Gitea, …). */
	EXTRA_GIT_HOSTS?: string;
	/** Optional comma-separated WebDAV hosts; when set, the relay serves only these. */
	DAV_HOSTS?: string;
	GITHUB_CLIENT_ID?: string;
	GITHUB_CLIENT_SECRET?: string;
	GITLAB_CLIENT_ID?: string;
	GITLAB_CLIENT_SECRET?: string;
	BITBUCKET_CLIENT_ID?: string;
	BITBUCKET_CLIENT_SECRET?: string;
}

const GIT_HOSTS = ['github.com', 'gitlab.com', 'bitbucket.org'];

/** Request headers git needs; everything else (cookies, …) is dropped. */
const FORWARD_REQUEST = [
	'accept',
	'authorization',
	'content-type',
	'content-encoding',
	'git-protocol'
];
const FORWARD_RESPONSE = ['content-type', 'content-encoding', 'www-authenticate'];
/** Redirects the git proxy follows itself, and only within the same host. */
const MAX_REDIRECTS = 3;

const OAUTH: Record<string, { token: string; basicAuth: boolean }> = {
	github: { token: 'https://github.com/login/oauth/access_token', basicAuth: false },
	gitlab: { token: 'https://gitlab.com/oauth/token', basicAuth: false },
	bitbucket: { token: 'https://bitbucket.org/site/oauth2/access_token', basicAuth: true }
};

function list(value: string | undefined): string[] {
	return (value ?? '')
		.split(',')
		.map((s) => s.trim())
		.filter(Boolean);
}

function cors(origin: string, extra: Record<string, string> = {}): Headers {
	return new Headers({
		'Access-Control-Allow-Origin': origin,
		'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, PROPFIND, MKCOL, OPTIONS',
		'Access-Control-Allow-Headers':
			'Authorization, Content-Type, Content-Encoding, Git-Protocol, Accept, Depth, If-Match, If-None-Match',
		'Access-Control-Expose-Headers': 'Content-Type, WWW-Authenticate, ETag, OC-ETag',
		'Access-Control-Max-Age': '86400',
		Vary: 'Origin',
		'Cache-Control': 'no-store',
		...extra
	});
}

const deny = (status: number, message: string, origin?: string) =>
	new Response(message, {
		status,
		headers: origin
			? cors(origin, { 'Content-Type': 'text/plain' })
			: { 'Content-Type': 'text/plain' }
	});

/** `true` for the three smart-HTTP endpoints git clients use. */
export function isGitRequest(method: string, path: string, search: URLSearchParams): boolean {
	if (method === 'GET' && path.endsWith('/info/refs')) {
		const service = search.get('service');
		return service === 'git-upload-pack' || service === 'git-receive-pack';
	}
	return (
		method === 'POST' && (path.endsWith('/git-upload-pack') || path.endsWith('/git-receive-pack'))
	);
}

export default {
	async fetch(request: Request, env: Env): Promise<Response> {
		const url = new URL(request.url);
		const origin = request.headers.get('Origin');
		if (!origin || !list(env.ALLOWED_ORIGINS).includes(origin))
			return deny(403, 'Origin not allowed');
		if (request.method === 'OPTIONS')
			return new Response(null, { status: 204, headers: cors(origin) });

		if (url.pathname.startsWith('/oauth/')) return oauth(request, env, url, origin);
		if (url.pathname.startsWith('/dav/')) return dav(request, env, url, origin);
		if (url.pathname.startsWith('/push/')) return pushRoute(request, env, url, () => cors(origin));

		// Git proxy: /<host>/<owner>/<repo>.git/<endpoint>
		const [, host, ...rest] = url.pathname.split('/');
		const hosts = [...GIT_HOSTS, ...list(env.EXTRA_GIT_HOSTS)];
		if (!host || !hosts.includes(host)) return deny(403, 'Git host not allowed', origin);
		const path = `/${rest.join('/')}`;
		if (path.includes('..') || !isGitRequest(request.method, path, url.searchParams))
			return deny(403, 'Only git smart-HTTP requests are proxied', origin);

		const headers = new Headers({ 'User-Agent': 'git/fasti-proxy' });
		for (const name of FORWARD_REQUEST) {
			const value = request.headers.get(name);
			if (value) headers.set(name, value);
		}
		// Redirects are followed by hand: only GET (a POST body can't be replayed), only
		// to the same host over https, so Authorization never goes to another host.
		let target = new URL(`https://${host}${path}${url.search}`);
		let upstream: Response;
		for (let hops = 0; ; hops++) {
			upstream = await fetch(target.href, {
				method: request.method,
				headers,
				body: request.method === 'POST' ? request.body : null,
				redirect: 'manual'
			});
			if (![301, 302, 303, 307, 308].includes(upstream.status)) break;
			const location = upstream.headers.get('location');
			let next: URL | null = null;
			try {
				next = location ? new URL(location, target) : null;
			} catch {
				// Not a URL: refused below.
			}
			if (
				request.method !== 'GET' ||
				hops >= MAX_REDIRECTS ||
				!next ||
				next.protocol !== 'https:' ||
				next.host !== target.host ||
				next.username ||
				next.password
			)
				return deny(502, 'The git host sent a redirect that is not followed', origin);
			target = next;
		}
		const out = cors(origin);
		for (const name of FORWARD_RESPONSE) {
			const value = upstream.headers.get(name);
			if (value) out.set(name, value);
		}
		return new Response(upstream.body, { status: upstream.status, headers: out });
	}
} satisfies { fetch(request: Request, env: Env): Promise<Response> };

/**
 * POST /oauth/<provider>/token   { code, code_verifier?, redirect_uri }
 * POST /oauth/<provider>/refresh { refresh_token }
 */
async function oauth(request: Request, env: Env, url: URL, origin: string): Promise<Response> {
	const [, , provider, action] = url.pathname.split('/');
	const config = provider ? OAUTH[provider] : undefined;
	if (!config || (action !== 'token' && action !== 'refresh') || request.method !== 'POST')
		return deny(404, 'Unknown OAuth endpoint', origin);
	const prefix = provider!.toUpperCase() as 'GITHUB' | 'GITLAB' | 'BITBUCKET';
	const clientId = env[`${prefix}_CLIENT_ID`];
	const secret = env[`${prefix}_CLIENT_SECRET`];
	// GitLab apps can be public (PKCE, no secret); GitHub and Bitbucket need one.
	if (!clientId || (!secret && provider !== 'gitlab')) {
		// Name what's missing (never the values) so a misplaced setting is easy to spot.
		const missing = [
			!clientId && `${prefix}_CLIENT_ID`,
			!secret && provider !== 'gitlab' && `${prefix}_CLIENT_SECRET`
		].filter(Boolean);
		return deny(
			501,
			`${provider} sign-in is not configured on this worker (missing at runtime: ${missing.join(', ')})`,
			origin
		);
	}

	let input: Record<string, unknown>;
	try {
		input = (await request.json()) as Record<string, unknown>;
	} catch {
		return deny(400, 'Expected a JSON body', origin);
	}
	const str = (k: string) => (typeof input[k] === 'string' ? (input[k] as string) : undefined);
	const form = new URLSearchParams();
	if (action === 'token') {
		const code = str('code');
		if (!code) return deny(400, 'Missing code', origin);
		form.set('grant_type', 'authorization_code');
		form.set('code', code);
		if (str('redirect_uri')) form.set('redirect_uri', str('redirect_uri')!);
		if (str('code_verifier')) form.set('code_verifier', str('code_verifier')!);
	} else {
		const refresh = str('refresh_token');
		if (!refresh) return deny(400, 'Missing refresh_token', origin);
		form.set('grant_type', 'refresh_token');
		form.set('refresh_token', refresh);
		if (str('redirect_uri')) form.set('redirect_uri', str('redirect_uri')!);
	}
	const headers: Record<string, string> = {
		Accept: 'application/json',
		'Content-Type': 'application/x-www-form-urlencoded'
	};
	if (config.basicAuth) headers['Authorization'] = `Basic ${btoa(`${clientId}:${secret}`)}`;
	else {
		form.set('client_id', clientId);
		if (secret) form.set('client_secret', secret);
	}
	const upstream = await fetch(config.token, { method: 'POST', headers, body: form });
	return new Response(upstream.body, {
		status: upstream.status,
		headers: cors(origin, {
			'Content-Type': upstream.headers.get('content-type') ?? 'application/json'
		})
	});
}

const DAV_METHODS = new Set(['PROPFIND', 'GET', 'PUT', 'DELETE', 'MKCOL']);
const DAV_REQUEST = ['authorization', 'content-type', 'depth', 'if-match', 'if-none-match'];
const DAV_RESPONSE = ['content-type', 'etag', 'oc-etag', 'dav'];
/** Notes are small; refuse anything that isn't. */
const DAV_MAX_BODY = 20 * 1024 * 1024;

/** A public host name: not an IP address, not localhost or an internal name. */
export function isPublicHost(host: string): boolean {
	return publicHost(host) !== null;
}

/**
 * The host as the URL parser reads it (so 0x7f.0.0.1, 2130706433 and
 * localhost. are seen for what they are), without a trailing dot; or null
 * when it is not a public host name.
 */
export function publicHost(host: string): string | null {
	if (!/^[A-Za-z0-9.:[\]%-]+$/.test(host)) return null;
	let url: URL;
	try {
		url = new URL(`https://${host}`);
	} catch {
		return null;
	}
	if (url.username || url.password || url.pathname !== '/' || url.search || url.hash) return null;
	const name = url.hostname.replace(/\.+$/, '');
	// IPv6 literals and (after normalising) IPv4 addresses.
	if (name.startsWith('[') || /^[\d.]+$/.test(name)) return null;
	if (!/^[a-z0-9.-]+$/.test(name) || !name.includes('.') || name.split('.').includes(''))
		return null;
	if (/(^|\.)(localhost|local|internal|lan|home\.arpa)$/.test(name)) return null;
	return url.port ? `${name}:${url.port}` : name;
}

const TOO_LARGE = Symbol('too large');

/** Read a body into memory, stopping as soon as it passes `max` bytes. */
export async function readCapped(
	stream: ReadableStream<Uint8Array> | null,
	max: number
): Promise<Uint8Array<ArrayBuffer> | null | typeof TOO_LARGE> {
	if (!stream) return null;
	const reader = stream.getReader();
	const chunks: Uint8Array[] = [];
	let size = 0;
	for (;;) {
		const { done, value } = await reader.read();
		if (done) break;
		size += value.byteLength;
		if (size > max) {
			await reader.cancel();
			return TOO_LARGE;
		}
		chunks.push(value);
	}
	const out = new Uint8Array(size);
	let at = 0;
	for (const c of chunks) {
		out.set(c, at);
		at += c.byteLength;
	}
	return out;
}

/** /dav/<host>/<path> → https://<host>/<path>, WebDAV methods only. */
async function dav(request: Request, env: Env, url: URL, origin: string): Promise<Response> {
	const [, , host, ...rest] = url.pathname.split('/');
	const target = host ? publicHost(host) : null;
	if (!target) return deny(403, 'WebDAV host not allowed', origin);
	const allowed = list(env.DAV_HOSTS).map((h) => h.toLowerCase());
	// Only the https port, unless the host:port is listed exactly (no port scanning).
	if (target.includes(':') && !allowed.includes(target))
		return deny(403, 'WebDAV host not allowed', origin);
	if (allowed.length && !allowed.includes(target))
		return deny(403, 'WebDAV host not allowed on this relay', origin);
	if (!DAV_METHODS.has(request.method)) return deny(405, 'Only WebDAV file requests', origin);
	if (!request.headers.get('authorization'))
		return deny(401, 'WebDAV requests need a user name and password', origin);
	const length = Number(request.headers.get('content-length') ?? 0);
	if (length > DAV_MAX_BODY) return deny(413, 'File too large', origin);
	const path = `/${rest.join('/')}`;
	if (path.split('/').includes('..')) return deny(403, 'Bad path', origin);

	const headers = new Headers({ 'User-Agent': 'fasti-dav-relay' });
	for (const name of DAV_REQUEST) {
		const value = request.headers.get(name);
		if (value) headers.set(name, value);
	}
	// Count what actually arrives: a body sent without Content-Length (chunked)
	// is held to the same limit.
	const hasBody = request.method === 'PUT' || request.method === 'PROPFIND';
	const body = hasBody ? await readCapped(request.body, DAV_MAX_BODY) : null;
	if (body === TOO_LARGE) return deny(413, 'File too large', origin);
	const upstream = await fetch(`https://${target}${path}`, {
		method: request.method,
		headers,
		body,
		// Never carry the password to wherever a redirect points.
		redirect: 'manual'
	});
	const out = cors(origin);
	for (const name of DAV_RESPONSE) {
		const value = upstream.headers.get(name);
		if (value) out.set(name, value);
	}
	return new Response(upstream.body, { status: upstream.status, headers: out });
}
