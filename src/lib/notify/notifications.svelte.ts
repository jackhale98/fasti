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
 *   8 days; edits upload again, debounced.
 *
 * Adapted in part from Mycelium (https://github.com/jackhale98/mycelium-web,
 * src/app/reminders.svelte.ts and src/app/push.ts: showing a notification
 * through the service worker or the page, enabling and disabling push, the
 * debounced upload), GPL-3.0-or-later, used in Fasti under GPL-2.0-or-later
 * by its copyright holder's grant (THIRD_PARTY_NOTICES.md).
 *
 * The push subscription and the last upload's summary are kept with
 * getPush/setPush (src/lib/store/db.ts); the extra fields ride along in the
 * same record. Whether notifications are on is kept in localStorage, so it
 * also covers browsers without push.
 */
import { untrack } from 'svelte';
import { resolve } from '$app/paths';
import { app } from '#lib/app/app.svelte.ts';
import { engine } from '#lib/engine/client.ts';
import type { IsoDate } from '#lib/engine/types.ts';
import { dayMonth, time as formatTime, weekdayShort } from '#lib/app/format.ts';
import { getPush, openFastiDB, setPush, type FastiDB, type PushRecord } from '#lib/store/db.ts';
import { WORKER_URL } from './config.ts';
import { fromBase64Url } from './encrypt.ts';
import { firstShowing, pruneShown, type NotificationPayload } from './payload.ts';
import {
	deleteSchedule,
	serverKey,
	pushOnOpen,
	uploadHorizon,
	withTest,
	uploadSchedule,
	type Outgoing,
	type SubscriptionKeys
} from './push.ts';
import { buildSchedule, type Schedule, type ScheduledNotification } from './schedule.ts';

const ENABLED_KEY = 'fasti:notifications';
/** A local notification missed by more than this (the device asleep) is skipped. */
const STALE_MS = 15 * 60_000;
/** Upload this long after the last edit. */
const UPLOAD_DEBOUNCE_MS = 5000;
/** A push test is due this long after the click. */
const TEST_DELAY_MS = 5000;
/** Re-plan local timers this long after the last edit. */
const PLAN_DEBOUNCE_MS = 400;

/** The push record, with the last upload's summary. */
export interface NotifyPushRecord extends PushRecord {
	/** The worker's VAPID key the subscription was made with. */
	key?: string;
	/** Last day fully covered by the last upload (from Remind). */
	through?: IsoDate;
	/** How many notifications the last upload held. */
	count?: number;
	truncated?: boolean;
	/** `Date.now()` of the last upload. */
	uploadedAt?: number;
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

/** "Today at 9:30am", "Thu 5 Nov at 9:30am": when the reminder itself is. */
export function whenText(n: ScheduledNotification, clock: '12h' | '24h'): string {
	const at = formatTime(n.eventTime, clock);
	// A string comparison of two dates Remind printed.
	return n.eventDate === n.date
		? `Today at ${at}`
		: `${weekdayShort(n.eventDate)} ${dayMonth(n.eventDate)} at ${at}`;
}

export function toPayload(n: ScheduledNotification, clock: '12h' | '24h'): NotificationPayload {
	return { id: n.id, title: n.body, body: `${whenText(n, clock)} · ${n.file}`, url: '' };
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
		body: p.body,
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

	#db: Promise<FastiDB> | null = null;
	#timers: ReturnType<typeof setTimeout>[] = [];
	#planTimer: ReturnType<typeof setTimeout> | null = null;
	#uploadTimer: ReturnType<typeof setTimeout> | null = null;
	#planning: Promise<Schedule | null> | null = null;
	#planningHash = '';
	#started = false;
	#firstPlanDone = false;
	#stop: (() => void) | null = null;

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
			this.#queuePlan(0);
		};
		document.addEventListener('visibilitychange', onVisible);
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

	/** Asks Remind for the schedule now (shared by concurrent callers). */
	#buildSchedule(): Promise<Schedule | null> {
		const snapshot = app.snapshot;
		if (!snapshot) return Promise.resolve(null);
		if (this.#planning && this.#planningHash === snapshot.hash) return this.#planning;
		const run = buildSchedule(engine(), snapshot, {
			tz: app.tz,
			horizon: uploadHorizon()
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
	 * then upload the next 8 days.
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
			key
		};
		if (next.subscription.endpoint !== record?.subscription.endpoint || key !== record?.key) {
			await this.#save(next);
		}
		return next;
	}

	/** Uploads the next 8 days (and an optional extra message) to the worker. */
	async upload(): Promise<void> {
		const record = this.push;
		if (!record || !this.pushConfigured || !this.active) return;
		const schedule = await this.#buildSchedule();
		if (!schedule) return;
		await uploadSchedule(WORKER_URL!, record.subscription, this.#outgoing(schedule));
		this.error = null;
		await this.#save({
			...record,
			through: schedule.through,
			count: schedule.notifications.length,
			truncated: schedule.truncated,
			uploadedAt: Date.now()
		});
	}

	#outgoing(schedule: Schedule): Outgoing[] {
		return schedule.notifications.map((n) => ({
			at: n.at,
			payload: toPayload(n, app.settings.clock)
		}));
	}

	/**
	 * Sends a test through push. The worker's list is replaced as a whole, so
	 * the test briefly takes a slot (the last real one, if all 64 are used);
	 * once it's due, the real schedule is uploaded again. The stored summary
	 * (through, count) always describes the real schedule.
	 */
	async sendTest(payload: NotificationPayload): Promise<void> {
		const record = this.push;
		if (!record) return;
		const schedule = await this.#buildSchedule();
		const at = Date.now() + TEST_DELAY_MS;
		const real = schedule ? this.#outgoing(schedule) : [];
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
			const reg = await registration(false);
			await (await reg?.pushManager?.getSubscription())?.unsubscribe().catch(() => undefined);
			await this.#save(null);
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
			id: `test-${Date.now()}`,
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
