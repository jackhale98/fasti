// SPDX-License-Identifier: GPL-2.0-or-later
// See https://svelte.dev/docs/kit/types#app.d.ts
declare global {
	namespace App {}
	/** The commit the app was built from (`vite.config.ts`), or ''. */
	const __APP_COMMIT__: string;
	/** The day it was built, `YYYY-MM-DD`. */
	const __APP_BUILT__: string;
}

export {};
