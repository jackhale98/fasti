// SPDX-License-Identifier: GPL-2.0-or-later
/**
 * Fasti's IndexedDB schema, on `idb`. Written fresh for Fasti; its shape
 * (vault records, one row per file with the last-synced base and revision)
 * follows Mycelium's storage so the Phase 4 sync code can slot in.
 *
 * Everything stays in this browser. Provider sign-ins added in Phase 4 live
 * in the vault record and are sent only to their provider.
 */
import { openDB, type DBSchema, type IDBPDatabase } from 'idb';
import type { VaultPath } from '../engine/types';
import type { Edit } from '../lens/types';
import type { NotificationPayload } from '../notify/payload';
import type { LineEnding } from './text';

export const DB_NAME = 'fasti';
export const DB_VERSION = 2;

/** Where a vault's files come from. Only `browser` exists before Phase 4. */
export type ProviderId = 'browser' | 'github' | 'git' | 'dropbox' | 'onedrive' | 'webdav';

export interface VaultRecord {
	id: string;
	name: string;
	provider: ProviderId;
	/** The entry Remind is pointed at: a file, or a directory (`''` is the root). */
	main: VaultPath;
	/** `Date.now()` when created (bookkeeping, not a reminder date). */
	createdAt: number;
	/** `Date.now()` of the last sync, or null. */
	lastSync: number | null;
}

/** One file of a vault, as stored. */
export interface FileRow {
	vault: string;
	path: VaultPath;
	/** The current text, decoded exactly (a BOM stays as U+FEFF). */
	text: string;
	/** The text as of the last sync; null when never synced. */
	base: string | null;
	/** The provider's revision of `base` (git blob id, Dropbox rev, ETag); null when never synced. */
	rev: string | null;
	/** Whether `text` differs from `base` (always true when never synced). */
	dirty: boolean;
	eol: LineEnding;
	finalNewline: boolean;
	bom: boolean;
}

/** One change inside an undo step. */
export type Change =
	| {
			kind: 'patch';
			path: VaultPath;
			/** Applied to the text before. */
			edit: Edit;
			/** Applied to the text after; restores the bytes before. */
			inverse: Edit;
			/** Length of the text after, to spot a file changed since (by a sync). */
			length: number;
	  }
	| {
			/** A whole file created, removed or replaced (import, reset). */
			kind: 'file';
			path: VaultPath;
			before: string | null;
			after: string | null;
	  };

/** One undoable step: what the user did, as a list of changes applied in order. */
export interface UndoStep {
	label: string;
	/** `Date.now()` when done (bookkeeping, not a reminder date). */
	at: number;
	changes: Change[];
}

export interface UndoRecord {
	vault: string;
	undo: UndoStep[];
	redo: UndoStep[];
}

export type WeekStart = 'sunday' | 'monday';
export type Clock = '12h' | '24h';
export type Theme = 'system' | 'light' | 'dark';

/** App-wide settings. The main entry belongs to each vault (VaultRecord.main). */
export interface Settings {
	/** The vault the app opens. */
	activeVault: string | null;
	weekStart: WeekStart;
	clock: Clock;
	hideCompletedTodos: boolean;
	theme: Theme;
}

export const DEFAULT_SETTINGS: Readonly<Settings> = {
	activeVault: null,
	weekStart: 'sunday',
	clock: '12h',
	hideCompletedTodos: false,
	theme: 'system'
};

/** The Web Push subscription for reminders (Phase 5). */
export interface PushRecord {
	/** `PushSubscription.toJSON()`. */
	subscription: { endpoint: string; expirationTime?: number | null; keys?: Record<string, string> };
	/** The vault whose reminders are pushed. */
	vault: string;
	/** `Date.now()` when subscribed. */
	createdAt: number;
	/** The worker's VAPID public key the subscription was made with. */
	key?: string;
	/** The worker the schedule goes to (the service worker re-uploads there). */
	worker?: string;
	/** Last day fully covered by the last upload (Remind's date). */
	through?: string;
	/** How many notifications the last upload held. */
	count?: number;
	/** Whether the last upload left notifications out (the cap or the size budget). */
	truncated?: boolean;
	/** `Date.now()` of the last upload. */
	uploadedAt?: number;
}

/** One planned notification, in plain text, as last uploaded or set as a timer. */
export interface PlannedPush {
	/** Epoch ms to show it (from Remind). */
	at: number;
	/** The day it is shown on (Remind's date), for listing it as missed; absent for the renewal nudge. */
	date?: string;
	payload: NotificationPayload;
}

/**
 * The last plan, kept only on this device (never sent anywhere in plain
 * text): the service worker re-seals its future part for a new push
 * subscription, and the page lists what passed unseen while Fasti was closed.
 */
export interface NotifyPlanRecord {
	planned: PlannedPush[];
	/** `Date.now()` when saved. */
	savedAt: number;
	/** `Date.now()` up to which missed notifications have been looked for. */
	checkedAt: number;
}

export interface FastiSchema extends DBSchema {
	vaults: { key: string; value: VaultRecord };
	files: { key: [string, VaultPath]; value: FileRow; indexes: { vault: string } };
	undo: { key: string; value: UndoRecord };
	/** One record under the key `app`. */
	settings: { key: 'app'; value: Settings };
	/** One record under the key `subscription`. */
	push: { key: 'subscription'; value: PushRecord };
	/** One record under the key `plan` (version 2). */
	notify: { key: 'plan'; value: NotifyPlanRecord };
}

export type FastiDB = IDBPDatabase<FastiSchema>;

/** Told when a connection was closed because a newer Fasti needs the database. */
const replacedListeners = new Set<() => void>();

/**
 * Calls `listener` when a connection in this context is closed for a newer
 * version of the database (Fasti was updated in another window, or by the
 * service worker). Returns an unsubscribe function.
 */
export function onDatabaseReplaced(listener: () => void): () => void {
	replacedListeners.add(listener);
	return () => replacedListeners.delete(listener);
}

const blockedListeners = new Set<() => void>();
/**
 * Calls `listener` when this window's open waits on an older connection that
 * doesn't give way (another window still running a build from before
 * `blocking`). The open completes by itself once that window closes.
 */
export function onDatabaseBlocked(listener: () => void): () => void {
	blockedListeners.add(listener);
	return () => blockedListeners.delete(listener);
}

/**
 * Open (and create or upgrade) the database. Each version's step runs once,
 * in order, so a browser on any older version catches up.
 *
 * A connection gives way to a newer version: when another window or the
 * service worker opens the database at a higher version, this connection is
 * closed (so that open doesn't hang) and onDatabaseReplaced listeners are
 * told; later use of it fails with an error rather than waiting. `upTo`
 * stops at an older version (tests only).
 */
export function openFastiDB(name = DB_NAME, upTo = DB_VERSION): Promise<FastiDB> {
	return openDB<FastiSchema>(name, upTo, {
		blocking(_current, _blocked, event) {
			(event.target as IDBDatabase).close();
			for (const listener of replacedListeners) {
				try {
					listener();
				} catch {
					// One listener's failure doesn't stop the others.
				}
			}
		},
		blocked() {
			for (const listener of blockedListeners) {
				try {
					listener();
				} catch {
					// As above.
				}
			}
		},
		upgrade(db, oldVersion) {
			if (oldVersion < 1) {
				db.createObjectStore('vaults', { keyPath: 'id' });
				const files = db.createObjectStore('files', { keyPath: ['vault', 'path'] });
				files.createIndex('vault', 'vault');
				db.createObjectStore('undo', { keyPath: 'vault' });
				db.createObjectStore('settings');
				db.createObjectStore('push');
			}
			if (oldVersion < 2 && upTo >= 2) {
				db.createObjectStore('notify');
			}
			// Later versions: `if (oldVersion < 3) { ... }`, never editing a step above.
		}
	});
}

export async function getSettings(db: FastiDB): Promise<Settings> {
	return { ...DEFAULT_SETTINGS, ...(await db.get('settings', 'app')) };
}

/** Change some settings, keeping the rest. */
export async function updateSettings(db: FastiDB, patch: Partial<Settings>): Promise<Settings> {
	const tx = db.transaction('settings', 'readwrite');
	const next = { ...DEFAULT_SETTINGS, ...(await tx.store.get('app')), ...patch };
	await tx.store.put(next, 'app');
	await tx.done;
	return next;
}

export function getPush(db: FastiDB): Promise<PushRecord | undefined> {
	return db.get('push', 'subscription');
}

export async function setPush(db: FastiDB, record: PushRecord | null): Promise<void> {
	if (record) await db.put('push', record, 'subscription');
	else await db.delete('push', 'subscription');
}

export async function getPlan(db: FastiDB): Promise<NotifyPlanRecord | undefined> {
	return db.get('notify', 'plan');
}

export async function setPlan(db: FastiDB, record: NotifyPlanRecord | null): Promise<void> {
	if (record) await db.put('notify', record, 'plan');
	else await db.delete('notify', 'plan');
}
