// SPDX-License-Identifier: GPL-2.0-or-later
/** Fasti's worker (src/env.ts), or undefined when push isn't set up for this build. */
import { PUBLIC_WORKER_URL } from '$app/env/public';

export const WORKER_URL: string | undefined = PUBLIC_WORKER_URL;
