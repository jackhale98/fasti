// SPDX-License-Identifier: GPL-2.0-or-later
/**
 * Re-sealing the stored plan in the service worker, for when the browser
 * replaces the push subscription while Fasti is closed (the
 * `pushsubscriptionchange` event) and as a periodic check (`periodicsync`,
 * tag PUSH_CHECK_TAG, Chrome for installed apps).
 *
 * The service worker can't run Remind. It only re-encrypts what the page
 * last planned (kept on this device in IndexedDB, see NotifyPlanRecord):
 * the notifications still in the future, for the current subscription, and
 * PUTs them to the worker; when the subscription's address changed it has
 * the worker forget the old one's list. The next open plans afresh.
 *
 * Nothing here touches the DOM.
 */
import type { NotifyPlanRecord, PushRecord } from '../store/db.ts';
import { fromBase64Url } from './encrypt.ts';
import { deleteSchedule, uploadSchedule, type SubscriptionKeys } from './push.ts';

/** The periodic background sync tag the page registers. */
export const PUSH_CHECK_TAG = 'fasti-push-check';
/** How often the page asks for the periodic check. */
export const PUSH_CHECK_INTERVAL_MS = 12 * 3_600_000;

/** The parts of a PushSubscription used here. */
export interface SubscriptionLike {
	toJSON(): unknown;
}

/** The parts of a PushManager used here. */
export interface PushManagerLike {
	getSubscription(): Promise<SubscriptionLike | null>;
	subscribe(options: {
		userVisibleOnly: boolean;
		applicationServerKey: BufferSource;
	}): Promise<SubscriptionLike>;
	permissionState?(options: { userVisibleOnly: boolean }): Promise<PermissionState>;
}

export interface ResealDeps {
	pushManager: PushManagerLike;
	getRecord(): Promise<PushRecord | null | undefined>;
	getPlan(): Promise<NotifyPlanRecord | null | undefined>;
	saveRecord(record: PushRecord): Promise<void>;
	fetchFn?: typeof fetch;
	now?: number;
	/** A subscription the event carries (`pushsubscriptionchange`'s newSubscription). */
	fresh?: SubscriptionLike | null;
}

export type ResealResult =
	/** Push isn't set up on this device (no record, worker or key), or not allowed. */
	| 'none'
	/** Re-uploaded for the same subscription. */
	| 'same'
	/** Re-uploaded for a new subscription; the old list was deleted. */
	| 'changed';

function keysOf(sub: SubscriptionLike): SubscriptionKeys & { expirationTime?: number | null } {
	return sub.toJSON() as SubscriptionKeys & { expirationTime?: number | null };
}

/** Re-subscribes if needed and re-uploads the stored plan's future part. Throws on a failed upload. */
export async function resealStored(deps: ResealDeps): Promise<ResealResult> {
	const record = await deps.getRecord();
	if (!record?.worker || !record.key) return 'none';
	const state = await deps.pushManager
		.permissionState?.({ userVisibleOnly: true })
		.catch(() => undefined);
	if (state !== undefined && state !== 'granted') return 'none';

	let sub = deps.fresh ?? (await deps.pushManager.getSubscription());
	sub ??= await deps.pushManager.subscribe({
		userVisibleOnly: true,
		applicationServerKey: fromBase64Url(record.key)
	});
	const json = keysOf(sub);
	if (!json.endpoint || !json.keys?.p256dh || !json.keys.auth) return 'none';

	const now = deps.now ?? Date.now();
	const plan = await deps.getPlan();
	const future = (plan?.planned ?? []).filter((p) => p.at > now);
	await uploadSchedule(
		record.worker,
		json,
		future.map((p) => ({ at: p.at, payload: p.payload })),
		deps.fetchFn
	);

	const changed = json.endpoint !== record.subscription.endpoint;
	if (changed) await deleteSchedule(record.worker, record.subscription.endpoint, deps.fetchFn);
	await deps.saveRecord({
		...record,
		subscription: {
			endpoint: json.endpoint,
			expirationTime: json.expirationTime ?? null,
			keys: json.keys
		},
		createdAt: changed ? now : record.createdAt,
		uploadedAt: now
	});
	return changed ? 'changed' : 'same';
}
