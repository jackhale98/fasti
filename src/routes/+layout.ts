// SPDX-License-Identifier: GPL-2.0-or-later
// Client-only SPA. Each view is prerendered as an empty shell (index.html,
// month.html, …) so a deep link is served with status 200, not the 404 fallback.
export const ssr = false;
export const prerender = true;
