// SPDX-License-Identifier: GPL-2.0-or-later
/**
 * The local-only "browser vault": files kept in this browser and nowhere
 * else, seeded with the sample vault on first run.
 */
import { getSettings, updateSettings, type FastiDB } from './db';
import { SAMPLE_FILES, SAMPLE_MAIN } from './sample';
import { Vault } from './vault';

export const BROWSER_VAULT_ID = 'browser';

/**
 * The browser vault, created and seeded with the sample on first run. An
 * existing browser vault is opened as it is, never reseeded. On first run it
 * also becomes the active vault when none is set.
 */
export async function ensureBrowserVault(db: FastiDB): Promise<Vault> {
	const existing = await Vault.open(db, BROWSER_VAULT_ID);
	if (existing) return existing;
	let vault: Vault;
	try {
		vault = await Vault.create(db, {
			id: BROWSER_VAULT_ID,
			name: 'This browser',
			provider: 'browser',
			main: SAMPLE_MAIN,
			files: SAMPLE_FILES
		});
	} catch (e) {
		// Another tab created it first.
		const raced = await Vault.open(db, BROWSER_VAULT_ID);
		if (!raced) throw e;
		return raced;
	}
	if ((await getSettings(db)).activeVault === null)
		await updateSettings(db, { activeVault: BROWSER_VAULT_ID });
	return vault;
}

/**
 * Put the sample files back (an explicit "reset demo" by the user). Changed
 * sample files are replaced, other files are kept, and the main entry goes
 * back to the sample's. One undo step reverses the file changes.
 */
export async function restoreSample(vault: Vault): Promise<void> {
	const plan = await vault.plan(SAMPLE_FILES);
	await vault.addFiles(SAMPLE_FILES, 'Restore the sample vault', plan.conflicts);
	await vault.setMain(SAMPLE_MAIN);
}
