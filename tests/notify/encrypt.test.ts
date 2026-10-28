// SPDX-License-Identifier: GPL-2.0-or-later
/**
 * Adapted from Mycelium (https://github.com/jackhale98/mycelium-web,
 * src/lib/push/encrypt.test.ts), GPL-3.0-or-later, used in Fasti under
 * GPL-2.0-or-later by its copyright holder's grant (THIRD_PARTY_NOTICES.md).
 */
import { describe, expect, it } from 'vitest';
import { encryptPush, fromBase64Url, messageKeys, toBase64Url } from '../../src/lib/notify/encrypt';

// RFC 8291, Appendix A.
const V = {
	plaintext: 'When I grow up, I want to be a watermelon',
	asPrivate: 'yfWPiYE-n46HLnH0KqZOF1fJJU3MYrct3AELtAQ-oRw',
	asPublic:
		'BP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27mlmlMoZIIgDll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A8',
	uaPrivate: 'q1dXpw3UpT5VOmu_cf_v6ih07Aems3njxI-JWgLcM94',
	uaPublic:
		'BCVxsr7N_eNgVRqvHtD0zTZsEc6-VV-JvLexhqUzORcxaOzi6-AYWXvTBHm4bjyPjs7Vd8pZGH6SRpkNtoIAiw4',
	auth: 'BTBZMqHH6r4Tts7J_aSIgg',
	salt: 'DGv6ra1nlYgDCS1FRnbzlw',
	result:
		'DGv6ra1nlYgDCS1FRnbzlwAAEABBBP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27mlmlMoZIIgDll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A_yl95bQpu6cVPTpK4Mqgkf1CXztLVBSt2Ks3oZwbuwXPXLWyouBWLVWGNWQexSgSxsj_Qulcy4a-fN'
};

/** A P-256 key pair from its raw public point and private scalar. */
async function pair(pub: string, priv: string, usages: KeyUsage[]): Promise<CryptoKeyPair> {
	const p = fromBase64Url(pub);
	const jwk = {
		kty: 'EC',
		crv: 'P-256',
		x: toBase64Url(p.slice(1, 33)),
		y: toBase64Url(p.slice(33, 65)),
		d: priv
	};
	const alg = { name: 'ECDH', namedCurve: 'P-256' };
	return {
		privateKey: await crypto.subtle.importKey('jwk', jwk, alg, true, usages),
		publicKey: await crypto.subtle.importKey('raw', p, alg, true, [])
	};
}

describe('base64url', () => {
	it('round-trips bytes without padding', () => {
		const bytes = Uint8Array.from([0, 251, 255, 62, 63, 1]);
		const text = toBase64Url(bytes);
		expect(text).not.toMatch(/[+/=]/);
		expect([...fromBase64Url(text)]).toEqual([...bytes]);
	});
});

describe('encryptPush', () => {
	it('matches the RFC 8291 example', async () => {
		const out = await encryptPush(
			new TextEncoder().encode(V.plaintext),
			fromBase64Url(V.uaPublic),
			fromBase64Url(V.auth),
			{ keys: await pair(V.asPublic, V.asPrivate, ['deriveBits']), salt: fromBase64Url(V.salt) }
		);
		expect(toBase64Url(out)).toBe(V.result);
	});

	it('is read back by the receiving browser with its own keys', async () => {
		const ua = await pair(V.uaPublic, V.uaPrivate, ['deriveBits']);
		const body = await encryptPush(
			new TextEncoder().encode('{"title":"Dentist"}'),
			fromBase64Url(V.uaPublic),
			fromBase64Url(V.auth)
		);
		// What the receiving side does: header, sender key, then decrypt.
		const salt = body.slice(0, 16);
		const idlen = body[20]!;
		const asPublic = body.slice(21, 21 + idlen);
		const sender = await crypto.subtle.importKey(
			'raw',
			asPublic,
			{ name: 'ECDH', namedCurve: 'P-256' },
			false,
			[]
		);
		const ecdh = new Uint8Array(
			await crypto.subtle.deriveBits({ name: 'ECDH', public: sender }, ua.privateKey, 256)
		);
		const { cek, nonce } = await messageKeys(
			ecdh,
			fromBase64Url(V.auth),
			fromBase64Url(V.uaPublic),
			asPublic,
			salt
		);
		const key = await crypto.subtle.importKey('raw', cek, 'AES-GCM', false, ['decrypt']);
		const plain = new Uint8Array(
			await crypto.subtle.decrypt({ name: 'AES-GCM', iv: nonce }, key, body.slice(21 + idlen))
		);
		expect(plain.at(-1)).toBe(2);
		expect(new TextDecoder().decode(plain.slice(0, -1))).toBe('{"title":"Dentist"}');
	});
});
