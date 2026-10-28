// SPDX-License-Identifier: GPL-2.0-or-later
/**
 * Adapted from Mycelium (https://github.com/jackhale98/mycelium-web,
 * src/lib/push/encrypt.ts), GPL-3.0-or-later, used in Fasti under
 * GPL-2.0-or-later by its copyright holder's grant (THIRD_PARTY_NOTICES.md).
 *
 * Web Push message encryption (RFC 8291, aes128gcm), done on the device that
 * will receive the message: reminders go to Fasti's worker already sealed
 * for this browser's push subscription, so the worker relays text it can't
 * read. One record, no padding.
 */

const enc = new TextEncoder();

export function fromBase64Url(text: string): Uint8Array<ArrayBuffer> {
	const b64 = text.replace(/-/g, '+').replace(/_/g, '/');
	const bin = atob(b64 + '='.repeat((4 - (b64.length % 4)) % 4));
	return Uint8Array.from(bin, (c) => c.charCodeAt(0));
}

export function toBase64Url(bytes: Uint8Array): string {
	let bin = '';
	for (const b of bytes) bin += String.fromCharCode(b);
	return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function concat(...parts: Uint8Array[]): Uint8Array<ArrayBuffer> {
	const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
	let at = 0;
	for (const p of parts) {
		out.set(p, at);
		at += p.length;
	}
	return out;
}

async function hkdf(salt: Uint8Array, ikm: Uint8Array, info: Uint8Array, bits: number) {
	const key = await crypto.subtle.importKey('raw', ikm as BufferSource, 'HKDF', false, [
		'deriveBits'
	]);
	return new Uint8Array(
		await crypto.subtle.deriveBits(
			{ name: 'HKDF', hash: 'SHA-256', salt: salt as BufferSource, info: info as BufferSource },
			key,
			bits
		)
	);
}

/** The content key and nonce for one message (RFC 8291 §3.3–3.4, RFC 8188 §2.2). */
export async function messageKeys(
	ecdhSecret: Uint8Array,
	authSecret: Uint8Array,
	uaPublic: Uint8Array,
	asPublic: Uint8Array,
	salt: Uint8Array
) {
	const keyInfo = concat(enc.encode('WebPush: info\0'), uaPublic, asPublic);
	const ikm = await hkdf(authSecret, ecdhSecret, keyInfo, 256);
	const cek = await hkdf(salt, ikm, enc.encode('Content-Encoding: aes128gcm\0'), 128);
	const nonce = await hkdf(salt, ikm, enc.encode('Content-Encoding: nonce\0'), 96);
	return { cek, nonce };
}

/**
 * Encrypt `plaintext` for a subscription's `p256dh` key and `auth` secret.
 * `fixed` pins the sender's key pair and salt (tests only).
 */
export async function encryptPush(
	plaintext: Uint8Array,
	uaPublic: Uint8Array,
	authSecret: Uint8Array,
	fixed?: { keys: CryptoKeyPair; salt: Uint8Array }
): Promise<Uint8Array<ArrayBuffer>> {
	const keys =
		fixed?.keys ??
		((await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, [
			'deriveBits'
		])) as CryptoKeyPair);
	const salt = fixed?.salt ?? crypto.getRandomValues(new Uint8Array(16));
	const asPublic = new Uint8Array(await crypto.subtle.exportKey('raw', keys.publicKey));
	const ua = await crypto.subtle.importKey(
		'raw',
		uaPublic as BufferSource,
		{ name: 'ECDH', namedCurve: 'P-256' },
		false,
		[]
	);
	const ecdh = new Uint8Array(
		await crypto.subtle.deriveBits({ name: 'ECDH', public: ua }, keys.privateKey, 256)
	);
	const { cek, nonce } = await messageKeys(ecdh, authSecret, uaPublic, asPublic, salt);
	const key = await crypto.subtle.importKey('raw', cek as BufferSource, 'AES-GCM', false, [
		'encrypt'
	]);
	// The last (only) record ends with the delimiter 0x02.
	const sealed = new Uint8Array(
		await crypto.subtle.encrypt(
			{ name: 'AES-GCM', iv: nonce as BufferSource },
			key,
			concat(plaintext, new Uint8Array([2])) as BufferSource
		)
	);
	const header = new Uint8Array(16 + 4 + 1);
	header.set(salt, 0);
	new DataView(header.buffer).setUint32(16, 4096);
	header[20] = asPublic.length;
	return concat(header, asPublic, sealed);
}
