// SPDX-License-Identifier: GPL-2.0-or-later
/**
 * Notifications hardening (docs/PLAN.md 3.6): the upload's size budget, the
 * renewal nudge, the late label, the plan kept on the device and re-sealed
 * by the service worker, and the catch-up of missed notifications.
 *
 * The epoch ms and dates below stand in for what Remind returns; nothing
 * here works out a date.
 */
import 'fake-indexeddb/auto';
import { openDB } from 'idb';
import { describe, expect, it, vi } from 'vitest';
import { longDate } from '../../src/lib/app/format';
import { fromBase64Url, messageKeys, toBase64Url } from '../../src/lib/notify/encrypt';
import {
	MISSED_GRACE_MS,
	RENEWAL_ID,
	RENEWAL_TITLE,
	afterDrops,
	catchUp,
	findMissed,
	planFor,
	renewalPush,
	toPayload
} from '../../src/lib/notify/outgoing';
import {
	LATE_MS,
	SHOWN_CACHE,
	SHOWN_RETENTION_MS,
	bodyToShow,
	readPayload,
	type NotificationPayload
} from '../../src/lib/notify/payload';
import {
	HORIZON_MS,
	MAX_PLAINTEXT,
	MAX_PUSH,
	MAX_UPLOAD_BYTES,
	fitBudget,
	fitPayload,
	uploadSchedule,
	type SubscriptionKeys
} from '../../src/lib/notify/push';
import {
	PUSH_CHECK_TAG,
	resealStored,
	type PushManagerLike,
	type SubscriptionLike
} from '../../src/lib/notify/reseal';
import {
	DAYS_AHEAD,
	MAX_NOTIFICATIONS,
	type Schedule,
	type ScheduledNotification
} from '../../src/lib/notify/schedule';
import { installNotificationHandlers, type NotificationScope } from '../../src/lib/notify/sw';
import { staleCaches } from '../../src/lib/offline/caching';
import {
	getPlan,
	getPush,
	onDatabaseBlocked,
	onDatabaseReplaced,
	openFastiDB,
	setPlan,
	type NotifyPlanRecord,
	type PlannedPush,
	type PushRecord
} from '../../src/lib/store/db';

const DAY = 86_400_000;
const T0 = 1_800_000_000_000;

async function browserSubscription(endpoint = 'https://fcm.googleapis.com/fcm/send/abc') {
	const keys = (await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, [
		'deriveBits'
	])) as CryptoKeyPair;
	const p256dh = new Uint8Array(await crypto.subtle.exportKey('raw', keys.publicKey));
	const auth = crypto.getRandomValues(new Uint8Array(16));
	const sub: SubscriptionKeys = {
		endpoint,
		keys: { p256dh: toBase64Url(p256dh), auth: toBase64Url(auth) }
	};
	return { sub, keys, p256dh, auth };
}

/** What the receiving browser does with one sealed message. */
async function open(
	payload: string,
	keys: CryptoKeyPair,
	p256dh: Uint8Array,
	auth: Uint8Array
): Promise<unknown> {
	const body = fromBase64Url(payload);
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
		await crypto.subtle.deriveBits({ name: 'ECDH', public: sender }, keys.privateKey, 256)
	);
	const { cek, nonce } = await messageKeys(ecdh, auth, p256dh, asPublic, salt);
	const key = await crypto.subtle.importKey('raw', cek, 'AES-GCM', false, ['decrypt']);
	const plain = new Uint8Array(
		await crypto.subtle.decrypt({ name: 'AES-GCM', iv: nonce }, key, body.slice(21 + idlen))
	);
	return JSON.parse(new TextDecoder().decode(plain.slice(0, -1)));
}

function note(
	i: number,
	date: string,
	minute: number,
	extra: Partial<ScheduledNotification> = {}
): ScheduledNotification {
	return {
		id: `${date}T${minute}|m.rem:${i}`,
		date,
		minute,
		at: T0 + i * 3_600_000,
		eventDate: date,
		eventTime: minute,
		body: `Reminder ${i}`,
		file: 'm.rem',
		line: i,
		...extra
	};
}

const DAYS = ['2027-01-14', '2027-01-15', '2027-01-16', '2027-01-17'];

function schedule(extra: Partial<Schedule> = {}): Schedule {
	return {
		days: DAYS,
		now: { date: DAYS[0]!, time: 480 },
		notifications: [note(1, DAYS[0]!, 570), note(2, DAYS[1]!, 600), note(3, DAYS[3]!, 615)],
		through: DAYS[3]!,
		truncated: false,
		nextDay: T0 + DAY,
		renewalAt: T0 + 2 * 3_600_000 + 1_800_000,
		...extra
	};
}

describe('limits', () => {
	it('keeps in step with the schedule’s window and cap', () => {
		expect(HORIZON_MS).toBe((DAYS_AHEAD + 1) * DAY);
		expect(MAX_PUSH).toBe(MAX_NOTIFICATIONS);
		expect(MAX_UPLOAD_BYTES).toBeLessThan(3 * 1024 * 1024);
		// The shown log outlasts the push schedule, for the catch-up.
		expect(SHOWN_RETENTION_MS).toBeGreaterThan(HORIZON_MS);
		// …and survives a new version's service worker clearing its old caches.
		expect(staleCaches([SHOWN_CACHE, 'fasti-old'], 'fasti-new')).toEqual(['fasti-old']);
	});
});

describe('the size budget', () => {
	const sealed = Array.from({ length: 10 }, (_, i) => ({ at: 100 - i, payload: 'x'.repeat(1000) }));

	it('keeps the earliest messages that fit in one body, and counts the rest', () => {
		const endpoint = 'https://push.example/e';
		const { reminders, dropped } = fitBudget(endpoint, sealed, 4000);
		expect(reminders.map((r) => r.at)).toEqual([91, 92, 93]);
		expect(dropped).toBe(7);
		expect(JSON.stringify({ endpoint, reminders }).length).toBeLessThanOrEqual(4000);
		// An exact fit is kept.
		const size = JSON.stringify({ endpoint, reminders }).length;
		expect(fitBudget(endpoint, sealed, size).reminders).toHaveLength(3);
		expect(fitBudget(endpoint, sealed, size - 1).reminders).toHaveLength(2);
		expect(fitBudget(endpoint, sealed).dropped).toBe(0);
	});

	it('reports what the cap left out, latest first dropped, so the summary moves back', async () => {
		const { sub } = await browserSubscription();
		const s = schedule();
		const plan = planFor(s, '12h');
		// One more than the worker takes: the latest goes.
		const many = Array.from({ length: MAX_PUSH - plan.length }, (_, i) => ({
			at: T0 - 1000 - i,
			payload: { id: `early-${i}`, title: 't', body: '', url: '' }
		}));
		const list = [...plan.map((p) => ({ at: p.at, payload: p.payload })), ...many, many[0]!];
		const result = await uploadSchedule(
			'https://w.example',
			sub,
			list,
			async () => new Response(null, { status: 204 })
		);
		expect(result.sent).toBe(MAX_PUSH);
		expect(result.dropped).toEqual([s.notifications[2]!.id]);
		// The last notification (on DAYS[3]) was left out: covered through DAYS[2].
		expect(afterDrops(s, plan, result.dropped)).toEqual({
			through: DAYS[2],
			truncated: true,
			count: 2
		});
		expect(afterDrops(s, plan, [])).toEqual({ through: DAYS[3], truncated: false, count: 3 });
	});

	it('drops by id, so a same-minute sibling of a dropped one is still counted as sent', async () => {
		const { sub } = await browserSubscription();
		// Two reminders in the same minute on the last day; the cap leaves out one.
		const twin = note(4, DAYS[3]!, 615, { at: T0 + 3 * 3_600_000 });
		const s = schedule({
			notifications: [note(1, DAYS[0]!, 570), note(2, DAYS[1]!, 600), note(3, DAYS[3]!, 615), twin],
			renewalAt: null
		});
		const plan = planFor(s, '12h');
		const filler = Array.from({ length: MAX_PUSH - plan.length + 1 }, (_, i) => ({
			at: T0 - 1000 - i,
			payload: { id: `early-${i}`, title: 't', body: '', url: '' }
		}));
		const result = await uploadSchedule(
			'https://w.example',
			sub,
			[...plan.map((p) => ({ at: p.at, payload: p.payload })), ...filler],
			async () => new Response(null, { status: 204 })
		);
		expect(result.dropped).toHaveLength(1);
		const summary = afterDrops(s, plan, result.dropped);
		// One of the twins was sent: the count says so (by time, both would look dropped).
		expect(summary.count).toBe(3);
		expect(summary.truncated).toBe(true);
	});
});

describe('the renewal nudge', () => {
	it('is one extra push at Remind’s renewalAt, naming the last covered day', () => {
		const s = schedule();
		const r = renewalPush(s)!;
		expect(r.at).toBe(s.renewalAt);
		expect(r.date).toBeUndefined();
		expect(r.payload).toEqual({
			id: RENEWAL_ID,
			title: RENEWAL_TITLE,
			body: expect.stringContaining(longDate(DAYS[3]!)),
			url: ''
		});
		expect(r.payload.title).toBe('Open Fasti to keep reminders coming');
		const plan = planFor(s, '12h');
		expect(plan).toHaveLength(4);
		// In time order, between the second and third notification.
		expect(plan.map((p) => p.payload.id)).toEqual([
			s.notifications[0]!.id,
			s.notifications[1]!.id,
			RENEWAL_ID,
			s.notifications[2]!.id
		]);
	});

	it('is left out when there is nothing to renew', () => {
		const s = schedule({ renewalAt: null });
		expect(renewalPush(s)).toBeNull();
		expect(planFor(s, '12h')).toHaveLength(3);
	});
});

describe('the late label', () => {
	const p: NotificationPayload = {
		id: 'a',
		title: 'Dentist',
		body: 'Today at 9:30am · m.rem',
		url: '',
		at: T0,
		due: '9:30am'
	};

	it('carries the moment and its label, in the 12- or 24-hour setting', () => {
		const n = note(1, DAYS[0]!, 570, { eventTime: 585 });
		expect(toPayload(n, '12h')).toMatchObject({ at: n.at, due: '9:30am' });
		expect(toPayload(n, '24h')).toMatchObject({ at: n.at, due: '09:30' });
	});

	it('prefixes the body only when shown more than five minutes late', () => {
		expect(bodyToShow(p, T0 + LATE_MS)).toBe(p.body);
		expect(bodyToShow(p, T0 + LATE_MS + 1)).toBe('Due 9:30am · Today at 9:30am · m.rem');
		expect(bodyToShow({ ...p, body: '' }, T0 + DAY)).toBe('Due 9:30am');
		expect(bodyToShow({ ...p, due: undefined }, T0 + DAY)).toBe(p.body);
		expect(bodyToShow({ id: 'x', title: 't', body: 'b', url: '' }, T0 + DAY)).toBe('b');
	});

	it('is read tolerantly and survives fitting', () => {
		expect(readPayload({ ...p })).toEqual(p);
		expect(readPayload({ title: 't', at: 'soon', due: 7 })).toEqual({
			id: '',
			title: 't',
			body: '',
			url: ''
		});
		expect(readPayload({ title: 't', at: Number.NaN })).not.toHaveProperty('at');
		const big = fitPayload({ ...p, body: 'y'.repeat(9000) });
		expect(big.at).toBe(T0);
		expect(big.due).toBe('9:30am');
		expect(new TextEncoder().encode(JSON.stringify(big)).length).toBeLessThanOrEqual(MAX_PLAINTEXT);
	});

	it('is shown by the service worker for a late push', async () => {
		const shown: NotificationOptions[] = [];
		const listeners = new Map<string, (event: Event) => void>();
		const scope: NotificationScope = {
			addEventListener: (type, listener) => listeners.set(type, listener),
			registration: {
				scope: 'https://fasti.example/',
				showNotification: async (_t: string, options: NotificationOptions) => {
					shown.push(options);
				}
			} as unknown as ServiceWorkerRegistration
		};
		let now = T0 + 60_000;
		installNotificationHandlers(scope, undefined, () => now);
		const fire = async (payload: NotificationPayload) => {
			const waits: Promise<unknown>[] = [];
			listeners.get('push')!({
				data: { json: () => payload, text: () => '' },
				waitUntil: (w: Promise<unknown>) => waits.push(w)
			} as unknown as Event);
			await Promise.all(waits);
		};
		await fire({ ...p, id: 'on-time' });
		now = T0 + 20 * 60_000;
		await fire({ ...p, id: 'late' });
		expect(shown.map((o) => o.body)).toEqual([p.body, `Due 9:30am · ${p.body}`]);
		// Without a re-seal function, no subscription-change handlers.
		expect(listeners.has('pushsubscriptionchange')).toBe(false);
	});
});

describe('the plan kept on the device', () => {
	it('is a new store, added by an upgrade that keeps version 1’s data', async () => {
		const name = `fasti-upgrade-${process.pid}`;
		const v1 = await openDB(name, 1, {
			upgrade(db) {
				db.createObjectStore('vaults', { keyPath: 'id' });
				const files = db.createObjectStore('files', { keyPath: ['vault', 'path'] });
				files.createIndex('vault', 'vault');
				db.createObjectStore('undo', { keyPath: 'vault' });
				db.createObjectStore('settings');
				db.createObjectStore('push');
			}
		});
		const rec: PushRecord = {
			subscription: { endpoint: 'https://push.example/1' },
			vault: 'v',
			createdAt: 1
		};
		await v1.put('push', rec, 'subscription');
		v1.close();
		const db = await openFastiDB(name);
		expect(await getPush(db)).toEqual(rec);
		expect(await getPlan(db)).toBeUndefined();
		const plan: NotifyPlanRecord = {
			planned: planFor(schedule(), '24h'),
			savedAt: T0,
			checkedAt: T0
		};
		await setPlan(db, plan);
		expect(await getPlan(db)).toEqual(plan);
		await setPlan(db, null);
		expect(await getPlan(db)).toBeUndefined();
		db.close();
	});

	it('lists what passed since the last check and was never shown, once', async () => {
		const plan = planFor(schedule(), '12h');
		const test: PlannedPush = {
			at: T0 + 1,
			payload: { id: 'test-1', title: 'Test', body: '', url: '' }
		};
		const all = [...plan, test];
		const shown = new Set([plan[1]!.payload.id]);
		const wasShown = vi.fn(async (id: string) => shown.has(id));
		// Everything up to the third notification has passed; the second was shown.
		const missed = await findMissed(all, T0 - 1, T0 + 3 * 3_600_000, wasShown);
		expect(missed.map((p) => p.payload.id)).toEqual([plan[0]!.payload.id, plan[3]!.payload.id]);
		// The renewal nudge and tests are never "missed".
		expect(missed.some((p) => p.payload.id === RENEWAL_ID)).toBe(false);
		// The next check starts where this one ended.
		expect(await findMissed(all, T0 + 3 * 3_600_000, T0 + DAY, wasShown)).toEqual([]);
		// A log that can't be read counts as not shown.
		const broken = await findMissed(all, T0 - 1, T0 + 3_600_000, async () => {
			throw new Error('no caches');
		});
		expect(broken.map((p) => p.payload.id)).toEqual([plan[0]!.payload.id]);
	});
});

describe('a newer Fasti opening the database', () => {
	it('closes an older connection instead of hanging, and says so', async () => {
		const name = `fasti-blocking-${process.pid}`;
		const v1 = await openFastiDB(name, 1);
		const replaced = vi.fn();
		const stop = onDatabaseReplaced(replaced);
		const v2 = await openFastiDB(name);
		expect(v2.version).toBe(2);
		expect(v2.objectStoreNames.contains('notify')).toBe(true);
		expect(replaced).toHaveBeenCalledTimes(1);
		// The old connection is closed: using it fails rather than hanging.
		expect(() => v1.transaction('settings')).toThrow();
		stop();
		v2.close();
	});

	it('says so when an older build holds the database, then opens once it closes', async () => {
		const name = `fasti-blocked-${process.pid}`;
		// A connection from a build without `blocking`: it never gives way by itself.
		const old = await new Promise<IDBDatabase>((resolve, reject) => {
			const req = indexedDB.open(name, 1);
			req.onupgradeneeded = () => req.result.createObjectStore('settings');
			req.onsuccess = () => resolve(req.result);
			req.onerror = () => reject(req.error);
		});
		const blocked = vi.fn(() => old.close());
		const stop = onDatabaseBlocked(blocked);
		const v2 = await openFastiDB(name);
		expect(blocked).toHaveBeenCalledTimes(1);
		expect(v2.version).toBe(2);
		stop();
		v2.close();
	});
});

describe('the catch-up', () => {
	function deps(
		planned: PlannedPush[],
		checkedAt: number,
		extra: Partial<Parameters<typeof catchUp>[0]> = {}
	) {
		let record: NotifyPlanRecord = { planned, savedAt: checkedAt, checkedAt };
		const marked: string[] = [];
		const d = {
			getPlan: async () => record,
			setPlan: async (r: NotifyPlanRecord) => void (record = r),
			wasShown: async () => false,
			markShown: async (id: string) => void marked.push(id),
			active: true,
			isCurrent: () => true,
			now: T0,
			...extra
		};
		return { d, marked, record: () => record };
	}
	const at = (id: string, t: number): PlannedPush => ({
		at: t,
		date: DAYS[0],
		payload: { id, title: id, body: '', url: '' }
	});

	it('waits ten minutes before calling one missed, and marks what it lists as shown', async () => {
		const list = [at('old', T0 - MISSED_GRACE_MS - 1), at('recent', T0 - MISSED_GRACE_MS + 1)];
		const { d, marked, record } = deps(list, T0 - DAY);
		const found = await catchUp(d);
		expect(found!.map((p) => p.payload.id)).toEqual(['old']);
		expect(marked).toEqual(['old']);
		expect(record().checkedAt).toBe(T0 - MISSED_GRACE_MS);
		// The recent one is looked at by the next run, once its grace has passed.
		const later = await catchUp({ ...d, now: T0 + MISSED_GRACE_MS });
		expect(later!.map((p) => p.payload.id)).toEqual(['recent']);
	});

	it('moves on without listing anything when notifications are off', async () => {
		const { d, marked, record } = deps([at('old', T0 - DAY / 2)], T0 - DAY, { active: false });
		expect(await catchUp(d)).toEqual([]);
		expect(marked).toEqual([]);
		expect(record().checkedAt).toBe(T0 - MISSED_GRACE_MS);
	});

	it('drops an older run’s results and write-back once a newer run started', async () => {
		let seq = 1;
		const { d, marked, record } = deps([at('old', T0 - DAY / 2)], T0 - DAY);
		const mine = 1;
		const run = catchUp({
			...d,
			isCurrent: () => mine === seq,
			wasShown: async () => {
				seq = 2; // A newer catch-up starts while this one reads the log.
				return false;
			}
		});
		expect(await run).toBeNull();
		expect(marked).toEqual([]);
		expect(record().checkedAt).toBe(T0 - DAY);
	});
});

describe('re-sealing the stored plan (service worker)', () => {
	async function setup(options: { changed?: boolean; permission?: PermissionState } = {}) {
		const old = await browserSubscription('https://push.example/old');
		const fresh = options.changed ? await browserSubscription('https://push.example/new') : old;
		const record: PushRecord = {
			subscription: { endpoint: old.sub.endpoint, keys: old.sub.keys },
			vault: 'v',
			createdAt: 5,
			key: toBase64Url(new Uint8Array(65).fill(4)),
			worker: 'https://w.example'
		};
		const planned: PlannedPush[] = [
			{ at: T0 - 1000, payload: { id: 'past', title: 'Past', body: '', url: '' } },
			{ at: T0 + 1000, payload: { id: 'soon', title: 'Soon', body: 'b', url: '', at: T0 + 1000 } },
			{ at: T0 + DAY, payload: { id: RENEWAL_ID, title: RENEWAL_TITLE, body: '', url: '' } }
		];
		const subscription: SubscriptionLike = { toJSON: () => fresh.sub };
		let current: SubscriptionLike | null = options.changed ? null : subscription;
		const subscribe = vi.fn(async () => (current = subscription));
		const pushManager: PushManagerLike = {
			getSubscription: async () => current,
			subscribe,
			permissionState: async () => options.permission ?? 'granted'
		};
		const calls: {
			method: string;
			body: { endpoint: string; reminders?: { at: number; payload: string }[] };
		}[] = [];
		const fetchFn = vi.fn(async (_u: string | URL | Request, init?: RequestInit) => {
			calls.push({ method: init!.method!, body: JSON.parse(init!.body as string) });
			return new Response(null, { status: 204 });
		});
		const saved: PushRecord[] = [];
		const deps = {
			pushManager,
			getRecord: async () => record,
			getPlan: async () => ({ planned, savedAt: T0 - DAY, checkedAt: T0 - DAY }),
			saveRecord: async (r: PushRecord) => void saved.push(r),
			fetchFn: fetchFn as unknown as typeof fetch,
			now: T0
		};
		return { old, fresh, record, deps, calls, saved, subscribe };
	}

	it('re-uploads only the future part, sealed for the current subscription', async () => {
		const { fresh, deps, calls, saved, subscribe } = await setup();
		expect(await resealStored(deps)).toBe('same');
		expect(subscribe).not.toHaveBeenCalled();
		expect(calls).toHaveLength(1);
		expect(calls[0]!.method).toBe('PUT');
		const reminders = calls[0]!.body.reminders!;
		expect(reminders.map((r) => r.at)).toEqual([T0 + 1000, T0 + DAY]);
		const opened = await open(reminders[0]!.payload, fresh.keys, fresh.p256dh, fresh.auth);
		expect(opened).toEqual({ id: 'soon', title: 'Soon', body: 'b', url: '', at: T0 + 1000 });
		expect(saved[0]!.createdAt).toBe(5);
	});

	it('re-subscribes with the cached key when the subscription is gone, and deletes the old list', async () => {
		const { old, fresh, deps, calls, saved, subscribe } = await setup({ changed: true });
		expect(await resealStored(deps)).toBe('changed');
		expect(subscribe).toHaveBeenCalledWith({
			userVisibleOnly: true,
			applicationServerKey: fromBase64Url(toBase64Url(new Uint8Array(65).fill(4)))
		});
		expect(calls.map((c) => [c.method, c.body.endpoint])).toEqual([
			['PUT', fresh.sub.endpoint],
			['DELETE', old.sub.endpoint]
		]);
		expect(saved[0]!.subscription.endpoint).toBe(fresh.sub.endpoint);
		expect(saved[0]!.createdAt).toBe(T0);
	});

	it('does nothing without a worker, a key or permission', async () => {
		const denied = await setup({ permission: 'denied' });
		expect(await resealStored(denied.deps)).toBe('none');
		const none = await setup();
		expect(
			await resealStored({
				...none.deps,
				getRecord: async () => ({ ...none.record, worker: undefined })
			})
		).toBe('none');
		expect(await resealStored({ ...none.deps, getRecord: async () => null })).toBe('none');
		expect(none.calls).toEqual([]);
		expect(denied.calls).toEqual([]);
	});

	it('runs on pushsubscriptionchange and on the periodic check only', async () => {
		const listeners = new Map<string, (event: Event) => void>();
		const scope: NotificationScope = {
			addEventListener: (type, listener) => listeners.set(type, listener),
			registration: { scope: 'https://fasti.example/' } as unknown as ServiceWorkerRegistration
		};
		const reseal = vi.fn(async () => undefined);
		installNotificationHandlers(scope, reseal);
		const fire = async (type: string, event: object) => {
			const waits: Promise<unknown>[] = [];
			listeners.get(type)!({
				...event,
				waitUntil: (w: Promise<unknown>) => waits.push(w)
			} as unknown as Event);
			await Promise.all(waits);
		};
		const next = { toJSON: () => ({}) };
		await fire('pushsubscriptionchange', { newSubscription: next });
		await fire('periodicsync', { tag: 'something-else' });
		await fire('periodicsync', { tag: PUSH_CHECK_TAG });
		expect(reseal.mock.calls).toEqual([[next], [null]]);
		// A failure is swallowed (the next open re-uploads).
		reseal.mockRejectedValueOnce(new Error('offline'));
		await fire('periodicsync', { tag: PUSH_CHECK_TAG });
	});
});
