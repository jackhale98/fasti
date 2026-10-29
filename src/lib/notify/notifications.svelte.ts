// SPDX-License-Identifier: GPL-2.0-or-later
/**
 * Notifications on this device (docs/PLAN.md 3.6):
 *
 * - While Fasti is open, a timer per notification due today (the schedule in
 *   schedule.ts, all from Remind), re-planned after every change to the
 *   vault, when the page comes back into view, and at Remind's next midnight.
 * - While it is closed, Web Push through Fasti's worker (push.ts), only when
 *   the build has PUBLIC_WORKER_URL. Every open checks the subscription,
 *   re-subscribes if the browser dropped or changed it, and uploads the next
 *   30 days, plus a renewal nudge the day before they run out; edits upload
 *   again, debounced.
 * - The plan is also kept in plain text on this device (IndexedDB, never
 *   sent anywhere): the service worker re-seals it for a new subscription
 *   (reseal.ts), and on open Fasti lists the planned notifications that
 *   passed while it was closed and were never shown here.
 *
 * Adapted in part from Mycelium (https://github.com/jackhale98/mycelium-web,
 * src/app/reminders.svelte.ts and src/app/push.ts: showing a notification
 * through the service worker or the page, enabling and disabling push, the
 * debounced upload), GPL-3.0-or-later, used in Fasti under GPL-2.0-or-later
 * by its copyright holder's grant (THIRD_PARTY_NOTICES.md).
 *
 * The push subscription and the last upload's summary are kept with
 * getPush/setPush, the plan with getPlan/setPlan (src/lib/store/db.ts).
 * Whether notifications are on is kept in localStorage, so it also covers
 * browsers without push.
 */
import { untrack } from 'svelte';
import { resolve } from '$app/paths';
import { app } from '#lib/app/app.svelte.ts';
import { engine } from '#lib/engine/client.ts';
import {
	getPlan,
	getPush,
	openFastiDB,
	setPlan,
	setPush,
	type FastiDB,
	type PlannedPush,
	type PushRecord
} from '#lib/store/db.ts';
import { WORKER_URL } from './config.ts';
import { fromBase64Url } from './encrypt.ts';
import { afterDrops, findMissed, planFor, TEST_PREFIX, toPayload, whenText } from './outgoing.ts';
import {
	bodyToShow,
	firstShowing,
	pruneShown,
	wasShown,
	type NotificationPayload
} from './payload.ts';
import {
	deleteSchedule,
	MAX_PUSH,
	serverKey,
	pushOnOpen,
	uploadHorizon,
	withTest,
	uploadSchedule,
	type Outgoing,
	type SubscriptionKeys
} from './push.ts';
import { PUSH_CHECK_INTERVAL_MS, PUSH_CHECK_TAG } from './reseal.ts';
import { buildSchedule, type Schedule } from './schedule.ts';

export { toPayload, whenText };

const ENABLED_KEY = 'fasti:notifications';
/** A local notification missed by more than this (the device asleep) is skipped. */
const STALE_MS = 15 * 60_000;
/** Upload this long after the last edit. */
const UPLOAD_DEBOUNCE_MS = 5000;
/** A push test is due this long after the click. */
const TEST_DELAY_MS = 5000;
/** Re-plan local timers this long after the last edit. */
const PLAN_DEBOUNCE_MS = 400;
/**
 * Missed means due at least this long ago: a timer or push for the current
 * minute may still be on its way.
 */
const MISSED_GRACE_MS = 60_000;

/** The push record, with the last upload's summary. */
export type NotifyPushRecord = PushRecord;

/** The parts of the Periodic Background Sync API used here (Chrome, installed apps). */
interface PeriodicSyncLike {
	register(tag: string, options: { minInterval: number }): Promise<void>;
	unregister(tag: string): Promise<void>;
}

/** The registration's periodicSync, where the browser has it. */
function periodicSyncOf(reg: ServiceWorkerRegistration | null): PeriodicSyncLike | undefined {
	return (reg as (ServiceWorkerRegistration & { periodicSync?: PeriodicSyncLike }) | null)
		?.periodicSync;
}

export type Support =
	/** Notifications and push work here. */
	| 'full'
	/** Notifications only (no service worker or PushManager). */
	| 'local'
	/** iOS or iPadOS Safari outside a Home Screen app: no notifications at all. */
	| 'ios-browser'
	| 'none';

/** iPhone, iPod or iPad (iPadOS reports a Mac with touch). */
export function isIOS(nav: Pick<Navigator, 'userAgent' | 'maxTouchPoints'> = navigator): boolean {
	return (
		/iPad|iPhone|iPod/.test(nav.userAgent) ||
		(/Macintosh/.test(nav.userAgent) && nav.maxTouchPoints > 1)
	);
}

/** Running as an installed app (Home Screen, standalone window). */
export function isStandalone(): boolean {
	return (
		matchMedia('(display-mode: standalone)').matches ||
		(navigator as Navigator & { standalone?: boolean }).standalone === true
	);
}

function detectSupport(): Support {
	if (typeof window === 'undefined') return 'none';
	if (isIOS() && !isStandalone()) return 'ios-browser';
	if (!('Notification' in window)) return 'none';
	if ('serviceWorker' in navigator && 'PushManager' in window) return 'full';
	return 'local';
}

function readEnabled(): boolean {
	try {
		return localStorage.getItem(ENABLED_KEY) === 'on';
	} catch {
		return false;
	}
}

function writeEnabled(on: boolean) {
	try {
		if (on) localStorage.setItem(ENABLED_KEY, 'on');
		else localStorage.removeItem(ENABLED_KEY);
	} catch {
		// Storage blocked: the setting lasts this visit.
	}
}

/** The app's root path, with the base path and a trailing slash (`/` or `/fasti/`). */
const root = (): string => resolve('/');

/** This app's service worker registration, registering it if needed. */
async function registration(create: boolean): Promise<ServiceWorkerRegistration | null> {
	if (!('serviceWorker' in navigator)) return null;
	try {
		const existing = await navigator.serviceWorker.getRegistration(root());
		if (existing || !create) return existing ?? null;
		// Same script and options as #lib/offline/pwa.svelte.ts, so both name one registration.
		await navigator.serviceWorker.register(`${root()}service-worker.js`, { type: 'module' });
		return await navigator.serviceWorker.ready;
	} catch {
		return null;
	}
}

/** Shows one notification through the service worker, or as a page notification. */
export async function showNotification(p: NotificationPayload, dedupe = true): Promise<boolean> {
	if (typeof Notification === 'undefined' || Notification.permission !== 'granted') return false;
	if (dedupe && !(await firstShowing(p.id))) return false;
	const options: NotificationOptions = {
		// A timer that fired late (the device asleep) says when it was due.
		body: bodyToShow(p),
		...(p.id ? { tag: p.id } : {}),
		icon: `${root()}favicon.svg`,
		data: { url: `${location.origin}${root()}${p.url}` }
	};
	const reg = await registration(false);
	if (reg) {
		await reg.showNotification(p.title, options);
		return true;
	}
	// No service worker: a page notification (desktop browsers).
	const n = new Notification(p.title, options);
	n.onclick = () => {
		window.focus();
		n.close();
	};
	return true;
}

function message(e: unknown): string {
	return e instanceof Error ? e.message : String(e);
}

class Notifications {
	readonly support: Support = detectSupport();
	readonly pushConfigured = !!WORKER_URL;
	permission = $state<NotificationPermission | 'unsupported'>(
		typeof Notification === 'undefined' ? 'unsupported' : Notification.permission
	);
	/** Turned on on this device. */
	enabled = $state(readEnabled());
	/** The push record, when subscribed. */
	push = $state.raw<NotifyPushRecord | null>(null);
	/** The current plan (local timers use its first day). */
	schedule = $state.raw<Schedule | null>(null);
	/** Timers set for today. */
	pending = $state(0);
	busy = $state(false);
	error = $state<string | null>(null);
	/** A short note after an action ("Test notification sent"). */
	note = $state<string | null>(null);
	/** Planned notifications that passed unseen while Fasti was closed (shown once on Today). */
	missed = $state.raw<PlannedPush[]>([]);

	#db: Promise<FastiDB> | null = null;
	#timers: ReturnType<typeof setTimeout>[] = [];
	#planTimer: ReturnType<typeof setTimeout> | null = null;
	#uploadTimer: ReturnType<typeof setTimeout> | null = null;
	#planning: Promise<Schedule | null> | null = null;
	#planningHash = '';
	#started = false;
	#firstPlanDone = false;
	#stop: (() => void) | null = null;
	/** The catch-up in progress: the plan is saved only after it has read the old one. */
	#caught: Promise<void> = Promise.resolve();

	get active(): boolean {
		return this.enabled && this.permission === 'granted';
	}

	#openDb(): Promise<FastiDB> {
		this.#db ??= openFastiDB();
		return this.#db;
	}

	/**
	 * Starts once per page (the layout calls it): watches the vault, plans
	 * today's timers, and checks and refreshes push.
	 */
	start(): void {
		if (this.#started || typeof window === 'undefined') return;
		this.#started = true;
		const cleanup = $effect.root(() => {
			$effect(() => {
				// Re-plan after every change Remind sees.
				if (!app.ready || !app.snapshot) return;
				void app.version;
				// Only the vault is watched, not the state the plan and upload write.
				untrack(() => {
					this.#queuePlan(this.#firstPlanDone ? PLAN_DEBOUNCE_MS : 0);
					if (this.#firstPlanDone) this.#queueUpload(UPLOAD_DEBOUNCE_MS);
				});
			});
		});
		const onVisible = () => {
			if (document.visibilityState !== 'visible') return;
			if (typeof Notification !== 'undefined') this.permission = Notification.permission;
			this.#caught = this.#catchUp();
			this.#queuePlan(0);
		};
		document.addEventListener('visibilitychange', onVisible);
		this.#caught = this.#catchUp();
		void pruneShown();
		void this.#openPush();
		this.#stop = () => {
			cleanup();
			document.removeEventListener('visibilitychange', onVisible);
		};
	}

	/** Stops timers and watchers (tests). */
	stop(): void {
		this.#stop?.();
		this.#stop = null;
		this.#started = false;
		this.#clearTimers();
	}

	#queuePlan(delay: number) {
		if (this.#planTimer) clearTimeout(this.#planTimer);
		this.#planTimer = setTimeout(() => {
			this.#planTimer = null;
			void this.plan();
		}, delay);
	}

	#queueUpload(delay: number) {
		if (!this.push || !this.pushConfigured) return;
		if (this.#uploadTimer) clearTimeout(this.#uploadTimer);
		this.#uploadTimer = setTimeout(() => {
			this.#uploadTimer = null;
			void this.upload().catch((e: unknown) => (this.error = message(e)));
		}, delay);
	}

	#clearTimers() {
		for (const t of this.#timers) clearTimeout(t);
		this.#timers = [];
		this.pending = 0;
	}

	/**
	 * Looks in the stored plan for notifications due since the last check that
	 * this device never showed, and adds them to `missed`. Runs before the
	 * plan is replaced (start() begins it at once).
	 */
	async #catchUp(): Promise<void> {
		try {
			const db = await this.#openDb();
			const stored = await getPlan(db);
			const to = Date.now() - MISSED_GRACE_MS;
			if (!stored || !(to > stored.checkedAt)) return;
			if (this.active) {
				const found = await findMissed(stored.planned, stored.checkedAt, to, wasShown);
				if (found.length) {
					const known = new Set(this.missed.map((p) => p.payload.id));
					this.missed = [...this.missed, ...found.filter((p) => !known.has(p.payload.id))];
				}
			}
			// Each planned notification is looked at once. Re-read: a plan may have been saved meanwhile.
			const latest = (await getPlan(db)) ?? stored;
			await setPlan(db, { ...latest, checkedAt: Math.max(latest.checkedAt, to) });
		} catch {
			// No IndexedDB (private mode, say): no catch-up.
		}
	}

	/** Clears the missed list (its Dismiss button). */
	dismissMissed(): void {
		this.missed = [];
	}

	/** Keeps the plan on this device, for the service worker and the next catch-up. */
	async #savePlan(planned: PlannedPush[]): Promise<void> {
		await this.#caught;
		try {
			const db = await this.#openDb();
			const old = await getPlan(db);
			const now = Date.now();
			await setPlan(db, {
				planned,
				savedAt: now,
				checkedAt: old?.checkedAt ?? now - MISSED_GRACE_MS
			});
		} catch {
			// No IndexedDB: nothing kept.
		}
	}

	/** Asks Remind for the schedule now (shared by concurrent callers). */
	#buildSchedule(): Promise<Schedule | null> {
		const snapshot = app.snapshot;
		if (!snapshot) return Promise.resolve(null);
		if (this.#planning && this.#planningHash === snapshot.hash) return this.#planning;
		const run = buildSchedule(engine(), snapshot, {
			tz: app.tz,
			horizon: uploadHorizon(),
			// One slot of the worker's list is kept for the renewal nudge.
			max: MAX_PUSH - 1
		}).finally(() => {
			if (this.#planning === run) this.#planning = null;
		});
		this.#planning = run;
		this.#planningHash = snapshot.hash;
		return run;
	}

	/** Re-plans today's local timers from a fresh schedule. */
	async plan(): Promise<Schedule | null> {
		if (!app.snapshot) return null;
		let schedule: Schedule | null;
		try {
			schedule = await this.#buildSchedule();
		} catch (e) {
			this.error = `Remind couldn’t plan the notifications: ${message(e)}`;
			return null;
		}
		this.#firstPlanDone = true;
		if (!schedule) return null;
		this.schedule = schedule;
		this.#clearTimers();
		const now = Date.now();
		const today = schedule.days[0];
		if (this.active) {
			for (const n of schedule.notifications) {
				// A string comparison of two dates Remind printed.
				if (n.date !== today) continue;
				const delay = n.at - now;
				if (delay < -STALE_MS) continue;
				const payload = toPayload(n, app.settings.clock);
				this.#timers.push(setTimeout(() => void showNotification(payload), Math.max(0, delay)));
			}
		}
		this.pending = this.#timers.length;
		if (this.active) await this.#savePlan(planFor(schedule, app.settings.clock));
		// Remind's next today: re-plan just after its midnight.
		if (schedule.nextDay !== null && schedule.nextDay > now) {
			this.#timers.push(
				setTimeout(
					() => {
						void app.refreshToday();
						this.#queuePlan(0);
						this.#queueUpload(0);
					},
					Math.min(schedule.nextDay - now + 1000, 2 ** 31 - 1)
				)
			);
		}
		return schedule;
	}

	/** The push record, as stored. */
	async #record(): Promise<NotifyPushRecord | null> {
		return ((await getPush(await this.#openDb())) as NotifyPushRecord | undefined) ?? null;
	}

	async #save(record: NotifyPushRecord | null) {
		await setPush(await this.#openDb(), record);
		this.push = record;
	}

	/**
	 * On every open: if this device had push on, make sure the browser still
	 * has the same subscription (re-subscribing if it dropped or changed it),
	 * then upload the next 30 days.
	 */
	async #openPush() {
		try {
			const record = await this.#record();
			this.push = record;
			const action = pushOnOpen({
				configured: this.pushConfigured,
				supported: this.support === 'full',
				enabled: this.enabled,
				permission: this.permission,
				stored: !!record
			});
			if (action === 'none') return;
			if (action === 'drop') {
				// Permission withdrawn in the browser's settings: nothing can be shown.
				await deleteSchedule(WORKER_URL!, record!.subscription.endpoint);
				await this.#save(null);
				return;
			}
			// 'subscribe' (turned on, but subscribing failed last time, the worker
			// down, say) or 'refresh': make sure of the subscription, then upload.
			this.push = await this.#ensureSubscription(record);
			await app.start();
			await this.upload();
		} catch (e) {
			this.error = message(e);
		}
	}

	/** The current subscription, re-made if the browser dropped or changed it. */
	async #ensureSubscription(record: NotifyPushRecord | null): Promise<NotifyPushRecord> {
		const reg = await registration(true);
		if (!reg) throw new Error('This browser can’t receive notifications while Fasti is closed.');
		const key = await serverKey(WORKER_URL!);
		if (!key) throw new Error('Fasti’s server doesn’t have push set up, or can’t be reached.');
		let sub = await reg.pushManager.getSubscription();
		if (sub && record?.key && record.key !== key) {
			// The worker's key changed: a subscription made with the old one is useless.
			await sub.unsubscribe().catch(() => undefined);
			sub = null;
		}
		sub ??= await reg.pushManager.subscribe({
			userVisibleOnly: true,
			applicationServerKey: fromBase64Url(key)
		});
		const json = sub.toJSON() as SubscriptionKeys & { expirationTime?: number | null };
		if (record && record.subscription.endpoint !== json.endpoint) {
			// The old address is dead; have the worker forget its list.
			await deleteSchedule(WORKER_URL!, record.subscription.endpoint);
		}
		const next: NotifyPushRecord = {
			...(record ?? {}),
			subscription: {
				endpoint: json.endpoint,
				expirationTime: json.expirationTime ?? null,
				keys: json.keys
			},
			vault: app.vault?.id ?? record?.vault ?? '',
			createdAt:
				record && record.subscription.endpoint === json.endpoint ? record.createdAt : Date.now(),
			key,
			// Kept for the service worker, which re-uploads the plan there.
			worker: WORKER_URL
		};
		if (
			next.subscription.endpoint !== record?.subscription.endpoint ||
			key !== record?.key ||
			next.worker !== record?.worker
		) {
			await this.#save(next);
		}
		return next;
	}

	/** Uploads the next 30 days and the renewal nudge to the worker. */
	async upload(): Promise<void> {
		const record = this.push;
		if (!record || !this.pushConfigured || !this.active) return;
		const schedule = await this.#buildSchedule();
		if (!schedule) return;
		const plan = planFor(schedule, app.settings.clock);
		const result = await uploadSchedule(WORKER_URL!, record.subscription, this.#outgoing(plan));
		this.error = null;
		const dropped = new Set(result.droppedAt);
		await this.#savePlan(plan.filter((p) => !dropped.has(p.at)));
		await this.#save({
			...record,
			...afterDrops(schedule, plan, result.droppedAt),
			uploadedAt: Date.now()
		});
		await this.#registerCheck();
	}

	#outgoing(plan: readonly PlannedPush[]): Outgoing[] {
		return plan.map((p) => ({ at: p.at, payload: p.payload }));
	}

	/**
	 * Asks for the service worker's periodic push check (every 12 hours or
	 * so) where Chrome offers it: an installed app with notifications allowed.
	 */
	async #registerCheck(): Promise<void> {
		try {
			if (!this.active || !isStandalone()) return;
			const periodic = periodicSyncOf(await registration(false));
			if (!periodic || !navigator.permissions) return;
			const state = await navigator.permissions
				.query({ name: 'periodic-background-sync' as PermissionName })
				.then((s) => s.state);
			if (state !== 'granted') return;
			await periodic.register(PUSH_CHECK_TAG, { minInterval: PUSH_CHECK_INTERVAL_MS });
		} catch {
			// Not offered here: the subscription is still checked on every open.
		}
	}

	async #unregisterCheck(): Promise<void> {
		try {
			await periodicSyncOf(await registration(false))?.unregister(PUSH_CHECK_TAG);
		} catch {
			// Nothing registered.
		}
	}

	/**
	 * Sends a test through push. The worker's list is replaced as a whole, so
	 * the test briefly takes a slot (the latest real one, if the list is full);
	 * once it's due, the real schedule is uploaded again. The stored summary
	 * (through, count) always describes the real schedule.
	 */
	async sendTest(payload: NotificationPayload): Promise<void> {
		const record = this.push;
		if (!record) return;
		const schedule = await this.#buildSchedule();
		const at = Date.now() + TEST_DELAY_MS;
		const real = schedule ? this.#outgoing(planFor(schedule, app.settings.clock)) : [];
		await uploadSchedule(WORKER_URL!, record.subscription, withTest(real, { at, payload }));
		if (this.#uploadTimer) clearTimeout(this.#uploadTimer);
		this.#uploadTimer = setTimeout(() => {
			this.#uploadTimer = null;
			void this.upload().catch((e: unknown) => (this.error = message(e)));
		}, TEST_DELAY_MS + 60_000);
	}

	/** Turns notifications on (from a click: asks for permission). */
	async enable(): Promise<void> {
		this.error = null;
		this.note = null;
		if (typeof Notification === 'undefined') {
			this.error = 'This browser can’t show notifications.';
			return;
		}
		this.busy = true;
		try {
			const result =
				Notification.permission === 'granted' ? 'granted' : await Notification.requestPermission();
			this.permission = result;
			if (result !== 'granted') {
				this.error =
					result === 'denied'
						? 'Notifications are blocked for Fasti. Allow them in the browser’s site settings, then try again.'
						: 'Notifications weren’t allowed.';
				return;
			}
			this.enabled = true;
			writeEnabled(true);
			await this.plan();
			if (this.pushConfigured && this.support === 'full') {
				try {
					this.push = await this.#ensureSubscription(await this.#record());
					await this.upload();
				} catch (e) {
					this.error = `Notifications work while Fasti is open, but not while it’s closed: ${message(e)}`;
				}
			}
		} finally {
			this.busy = false;
		}
	}

	/** Turns notifications off on this device. */
	async disable(): Promise<void> {
		this.error = null;
		this.note = null;
		this.busy = true;
		try {
			this.enabled = false;
			writeEnabled(false);
			this.#clearTimers();
			const record = this.push ?? (await this.#record());
			if (record && this.pushConfigured) {
				await deleteSchedule(WORKER_URL!, record.subscription.endpoint);
			}
			await this.#unregisterCheck();
			const reg = await registration(false);
			await (await reg?.pushManager?.getSubscription())?.unsubscribe().catch(() => undefined);
			await this.#save(null);
			// The plain-text plan isn't needed once notifications are off.
			await setPlan(await this.#openDb(), null).catch(() => undefined);
			this.missed = [];
		} catch (e) {
			this.error = message(e);
		} finally {
			this.busy = false;
		}
	}

	/**
	 * Sends a test notification: through push when it's set up on this device
	 * (so the whole path is tested), otherwise straight away from the page.
	 */
	async test(): Promise<void> {
		this.error = null;
		this.note = null;
		this.busy = true;
		const payload: NotificationPayload = {
			id: `${TEST_PREFIX}${Date.now()}`,
			title: 'Fasti test notification',
			body: 'Notifications work on this device.',
			url: 'settings'
		};
		try {
			if (this.push && this.pushConfigured && this.active) {
				await this.sendTest(payload);
				this.note = 'A test notification is on its way through Fasti’s server.';
			} else if (await showNotification(payload, false)) {
				this.note = 'Test notification sent.';
			} else {
				this.error = 'Notifications aren’t allowed for Fasti.';
			}
		} catch (e) {
			this.error = message(e);
		} finally {
			this.busy = false;
		}
	}
}

export const notifications = new Notifications();
