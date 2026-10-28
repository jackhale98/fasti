// SPDX-License-Identifier: GPL-2.0-or-later
// Adapted from Mycelium (github.com/jackhale98/mycelium-web) under the owner's grant
// in THIRD_PARTY_NOTICES.md.
import { afterEach, describe, expect, it, vi } from 'vitest';
import worker, { isGitRequest, isPublicHost, type Env } from './index';

const env: Env = {
	ALLOWED_ORIGINS: 'https://app.example, http://localhost:4321',
	GITHUB_CLIENT_ID: 'id',
	GITHUB_CLIENT_SECRET: 'shh'
};
const ORIGIN = 'https://app.example';
const call = (path: string, init: RequestInit & { origin?: string | null } = {}) => {
	const headers = new Headers(init.headers);
	if (init.origin !== null) headers.set('Origin', init.origin ?? ORIGIN);
	return worker.fetch(new Request(`https://proxy.example${path}`, { ...init, headers }), env);
};

afterEach(() => vi.unstubAllGlobals());

describe('git proxy', () => {
	it('recognises only smart-HTTP endpoints', () => {
		const q = (s: string) => new URLSearchParams(s);
		expect(isGitRequest('GET', '/a/b.git/info/refs', q('service=git-upload-pack'))).toBe(true);
		expect(isGitRequest('GET', '/a/b.git/info/refs', q('service=evil'))).toBe(false);
		expect(isGitRequest('POST', '/a/b.git/git-receive-pack', q(''))).toBe(true);
		expect(isGitRequest('GET', '/a/b.git/git-receive-pack', q(''))).toBe(false);
		expect(isGitRequest('GET', '/login', q(''))).toBe(false);
	});

	it('rejects unknown origins, hosts and paths', async () => {
		expect(
			(await call('/github.com/a/b.git/info/refs?service=git-upload-pack', { origin: null })).status
		).toBe(403);
		expect(
			(
				await call('/github.com/a/b.git/info/refs?service=git-upload-pack', {
					origin: 'https://evil.example'
				})
			).status
		).toBe(403);
		expect((await call('/example.com/a/b.git/info/refs?service=git-upload-pack')).status).toBe(403);
		expect((await call('/github.com/settings/profile')).status).toBe(403);
		expect((await call('/github.com/a/../../b.git/info/refs?service=git-upload-pack')).status).toBe(
			403
		);
	});

	it('answers preflight with CORS headers', async () => {
		const res = await call('/github.com/a/b.git/git-upload-pack', { method: 'OPTIONS' });
		expect(res.status).toBe(204);
		expect(res.headers.get('Access-Control-Allow-Origin')).toBe(ORIGIN);
		expect(res.headers.get('Access-Control-Allow-Headers')).toContain('Authorization');
	});

	it('follows redirects only on the same host, and never sends credentials elsewhere', async () => {
		const path = '/github.com/a/b.git/info/refs?service=git-upload-pack';
		const headers = { Authorization: 'Bearer t' };
		const fetch = vi
			.fn()
			.mockResolvedValueOnce(
				new Response(null, {
					status: 301,
					headers: { Location: '/a/b/info/refs?service=git-upload-pack' }
				})
			)
			.mockResolvedValueOnce(
				new Response('ok', { status: 200, headers: { 'Cache-Control': 'max-age=99' } })
			);
		vi.stubGlobal('fetch', fetch);
		const res = await call(path, { headers });
		expect(res.status).toBe(200);
		expect(res.headers.get('Cache-Control')).toBe('no-store');
		const calls = fetch.mock.calls as unknown as [string, RequestInit][];
		expect(calls[0]![1].redirect).toBe('manual');
		expect(calls[1]![0]).toBe('https://github.com/a/b/info/refs?service=git-upload-pack');

		const elsewhere = vi
			.fn()
			.mockResolvedValue(
				new Response(null, { status: 302, headers: { Location: 'https://evil.example/x' } })
			);
		vi.stubGlobal('fetch', elsewhere);
		expect((await call(path, { headers })).status).toBe(502);
		expect(elsewhere).toHaveBeenCalledTimes(1);

		const post = vi
			.fn()
			.mockResolvedValue(new Response(null, { status: 307, headers: { Location: '/x' } }));
		vi.stubGlobal('fetch', post);
		const sent = await call('/github.com/a/b.git/git-upload-pack', {
			method: 'POST',
			body: 'x',
			headers
		});
		expect(sent.status).toBe(502);
		expect(post).toHaveBeenCalledTimes(1);
	});

	it('forwards only git headers and streams the response back', async () => {
		const upstream = vi.fn(
			async () =>
				new Response('pack', {
					status: 200,
					headers: { 'Content-Type': 'application/x-git-upload-pack-result', 'Set-Cookie': 'x=1' }
				})
		);
		vi.stubGlobal('fetch', upstream);
		const res = await call('/github.com/a/b.git/git-upload-pack', {
			method: 'POST',
			body: 'want',
			headers: {
				Authorization: 'Basic abc',
				Cookie: 'session=1',
				'Content-Type': 'application/x-git-upload-pack-request'
			}
		});
		expect(await res.text()).toBe('pack');
		expect(res.headers.get('Access-Control-Allow-Origin')).toBe(ORIGIN);
		expect(res.headers.get('Set-Cookie')).toBeNull();
		const [target, init] = upstream.mock.calls[0] as unknown as [string, RequestInit];
		expect(target).toBe('https://github.com/a/b.git/git-upload-pack');
		const sent = new Headers(init.headers);
		expect(sent.get('authorization')).toBe('Basic abc');
		expect(sent.get('cookie')).toBeNull();
	});
});

describe('oauth', () => {
	it('adds the client secret and relays the token response', async () => {
		const upstream = vi.fn(
			async () =>
				new Response('{"access_token":"t"}', { headers: { 'Content-Type': 'application/json' } })
		);
		vi.stubGlobal('fetch', upstream);
		const res = await call('/oauth/github/token', {
			method: 'POST',
			body: JSON.stringify({
				code: 'c',
				code_verifier: 'v',
				redirect_uri: 'https://app.example/cb'
			})
		});
		expect(await res.json()).toEqual({ access_token: 't' });
		const [target, init] = upstream.mock.calls[0] as unknown as [string, RequestInit];
		expect(target).toBe('https://github.com/login/oauth/access_token');
		const body = new URLSearchParams(String(init.body));
		expect(Object.fromEntries(body)).toEqual({
			grant_type: 'authorization_code',
			code: 'c',
			code_verifier: 'v',
			redirect_uri: 'https://app.example/cb',
			client_id: 'id',
			client_secret: 'shh'
		});
	});

	it('exchanges codes for public GitLab apps without a secret', async () => {
		const upstream = vi.fn(async () => new Response('{"access_token":"g"}'));
		vi.stubGlobal('fetch', upstream);
		const res = await worker.fetch(
			new Request('https://proxy.example/oauth/gitlab/refresh', {
				method: 'POST',
				headers: { Origin: ORIGIN },
				body: JSON.stringify({ refresh_token: 'r', redirect_uri: 'https://app.example/cb' })
			}),
			{ ...env, GITLAB_CLIENT_ID: 'gl' }
		);
		expect(res.status).toBe(200);
		const [target, init] = upstream.mock.calls[0] as unknown as [string, RequestInit];
		expect(target).toBe('https://gitlab.com/oauth/token');
		expect(Object.fromEntries(new URLSearchParams(String(init.body)))).toEqual({
			grant_type: 'refresh_token',
			refresh_token: 'r',
			redirect_uri: 'https://app.example/cb',
			client_id: 'gl'
		});
	});

	it('reports unconfigured providers', async () => {
		expect(
			(await call('/oauth/gitlab/token', { method: 'POST', body: '{"code":"c"}' })).status
		).toBe(501);
		expect(
			(await call('/oauth/bitbucket/token', { method: 'POST', body: '{"code":"c"}' })).status
		).toBe(501);
		expect((await call('/oauth/nope/token', { method: 'POST', body: '{}' })).status).toBe(404);
	});
});

describe('WebDAV relay', () => {
	const auth = { Authorization: 'Basic YWRhOnB3' };

	it('only relays to public HTTPS host names', () => {
		expect(isPublicHost('cloud.example.com')).toBe(true);
		expect(isPublicHost('cloud.example.com:8443')).toBe(true);
		for (const bad of [
			'localhost',
			'127.0.0.1',
			'10.0.0.1',
			'nas',
			'nas.local',
			'box.internal',
			'a@b.com',
			'[::1]'
		])
			expect(isPublicHost(bad), bad).toBe(false);
	});

	it('sees through alternative spellings of private addresses', async () => {
		for (const bad of [
			'0x7f.0.0.1',
			'0xa9.0xfe.0xa9.0xfe',
			'2130706433',
			'127.1',
			'017700000001',
			'localhost.',
			'metadata.google.internal.',
			'[::1]',
			'[fe80::1]',
			'[::ffff:127.0.0.1]',
			'127.0.0.1.'
		])
			expect(isPublicHost(bad), bad).toBe(false);
		expect(isPublicHost('cloud.example.com.')).toBe(true);
		// Refused by the route too, before anything is fetched.
		const fetch = vi.fn();
		vi.stubGlobal('fetch', fetch);
		for (const bad of ['0x7f.0.0.1', '0xa9.0xfe.0xa9.0xfe', 'localhost.'])
			expect((await call(`/dav/${bad}/x`, { method: 'GET', headers: auth })).status, bad).toBe(403);
		expect(fetch).not.toHaveBeenCalled();
	});

	it('passes WebDAV requests through with their conditions, and exposes ETags', async () => {
		const fetch = vi.fn(
			async () =>
				new Response('<multistatus/>', {
					status: 207,
					headers: { ETag: '"e1"', 'Set-Cookie': 'x=y', 'Content-Type': 'application/xml' }
				})
		);
		vi.stubGlobal('fetch', fetch);
		const res = await call('/dav/cloud.example.com/remote.php/dav/files/ada/Notes/', {
			method: 'PROPFIND',
			headers: { ...auth, Depth: '1', Cookie: 'session=1', 'If-Match': '"e0"' },
			body: '<propfind/>'
		});
		expect(res.status).toBe(207);
		expect(res.headers.get('ETag')).toBe('"e1"');
		expect(res.headers.get('Set-Cookie')).toBeNull();
		expect(res.headers.get('Access-Control-Allow-Origin')).toBe(ORIGIN);
		const [url, init] = fetch.mock.calls[0] as unknown as [string, RequestInit];
		expect(url).toBe('https://cloud.example.com/remote.php/dav/files/ada/Notes/');
		const sent = new Headers(init.headers);
		expect(sent.get('depth')).toBe('1');
		expect(sent.get('if-match')).toBe('"e0"');
		expect(sent.get('authorization')).toBe(auth.Authorization);
		expect(sent.get('cookie')).toBeNull();
		expect(init.redirect).toBe('manual');
		expect(new TextDecoder().decode(init.body as Uint8Array)).toBe('<propfind/>');
	});

	it('refuses other methods, anonymous requests, private hosts and hosts not allowed', async () => {
		vi.stubGlobal('fetch', vi.fn());
		expect((await call('/dav/cloud.example.com/x', { method: 'POST', headers: auth })).status).toBe(
			405
		);
		expect((await call('/dav/cloud.example.com/x', { method: 'GET' })).status).toBe(401);
		expect((await call('/dav/192.168.1.2/x', { method: 'GET', headers: auth })).status).toBe(403);
		const pinned = { ...env, DAV_HOSTS: 'mine.example.com' };
		const req = new Request('https://proxy.example/dav/cloud.example.com/x', {
			method: 'GET',
			headers: { ...auth, Origin: ORIGIN }
		});
		expect((await worker.fetch(req, pinned)).status).toBe(403);
	});

	it('relays only to the https port unless host:port is listed in DAV_HOSTS', async () => {
		const fetch = vi.fn(async () => new Response(null, { status: 204 }));
		vi.stubGlobal('fetch', fetch);
		const get = (host: string, e: Env = env) =>
			worker.fetch(
				new Request(`https://proxy.example/dav/${host}/x`, {
					headers: { ...auth, Origin: ORIGIN }
				}),
				e
			);
		for (const bad of ['example.com:22', 'example.com:0', 'example.com:8443'])
			expect((await get(bad)).status, bad).toBe(403);
		expect(fetch).not.toHaveBeenCalled();
		expect((await get('example.com')).status).toBe(204);
		expect((await get('example.com:443')).status).toBe(204);
		expect(fetch).toHaveBeenLastCalledWith('https://example.com/x', expect.anything());
		const listed = { ...env, DAV_HOSTS: 'nas.example.com:8443' };
		expect((await get('nas.example.com:8443', listed)).status).toBe(204);
		expect((await get('nas.example.com:22', listed)).status).toBe(403);
		expect((await get('nas.example.com', listed)).status).toBe(403);
	});

	it('holds WebDAV bodies to 20 MB,whether or not they declare a length', async () => {
		const upstream = vi.fn();
		vi.stubGlobal('fetch', upstream);
		const big = 20 * 1024 * 1024 + 1;
		// Declared too large: refused before reading.
		const declared = await call('/dav/cloud.example.com/x', {
			method: 'PUT',
			headers: { ...auth, 'Content-Length': String(big) },
			body: 'x'
		});
		expect(declared.status).toBe(413);
		// Streamed with no length: refused once the bytes pass the limit.
		const chunk = new Uint8Array(1024 * 1024);
		let sent = 0;
		const stream = new ReadableStream<Uint8Array>({
			pull(c) {
				if (sent >= big) return c.close();
				sent += chunk.byteLength;
				c.enqueue(chunk);
			}
		});
		const req = new Request('https://proxy.example/dav/cloud.example.com/x', {
			method: 'PUT',
			headers: { ...auth, Origin: ORIGIN },
			body: stream,
			duplex: 'half'
		} as RequestInit);
		expect((await worker.fetch(req, env)).status).toBe(413);
		expect(sent).toBeLessThan(big + 2 * chunk.byteLength);
		expect(upstream).not.toHaveBeenCalled();
	});

	it('answers preflights for WebDAV methods and headers', async () => {
		const res = await call('/dav/cloud.example.com/x', { method: 'OPTIONS' });
		expect(res.status).toBe(204);
		expect(res.headers.get('Access-Control-Allow-Methods')).toContain('PROPFIND');
		expect(res.headers.get('Access-Control-Allow-Headers')).toContain('If-Match');
		expect(res.headers.get('Access-Control-Expose-Headers')).toContain('ETag');
	});
});
