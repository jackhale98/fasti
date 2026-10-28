// SPDX-License-Identifier: GPL-2.0-or-later
/**
 * Build-time settings (docs/PLAN.md section 3.7). All are optional and public:
 * they end up in the published JavaScript. An unset or empty one reads as
 * `undefined`, and the matching sign-in button is not shown.
 */
import { defineEnvVars } from '@sveltejs/kit/env';

const optional = (value: string | undefined) => value?.trim() || undefined;

export const variables = defineEnvVars({
	PUBLIC_WORKER_URL: {
		public: true,
		static: true,
		schema: optional,
		description: 'Fasti’s Cloudflare Worker: git proxy, OAuth exchange, WebDAV relay and push.'
	},
	PUBLIC_GITHUB_CLIENT_ID: {
		public: true,
		static: true,
		schema: optional,
		description: 'The GitHub App’s client ID, for “Sign in with GitHub”.'
	},
	PUBLIC_GITHUB_APP_SLUG: {
		public: true,
		static: true,
		schema: optional,
		description: 'The GitHub App’s slug (github.com/apps/<slug>), for choosing repositories.'
	},
	PUBLIC_GITLAB_CLIENT_ID: {
		public: true,
		static: true,
		schema: optional,
		description: 'The GitLab OAuth application ID.'
	},
	PUBLIC_BITBUCKET_CLIENT_ID: {
		public: true,
		static: true,
		schema: optional,
		description: 'The Bitbucket OAuth consumer key.'
	},
	PUBLIC_DROPBOX_APP_KEY: {
		public: true,
		static: true,
		schema: optional,
		description: 'The Dropbox app key (PKCE, no secret).'
	},
	PUBLIC_ONEDRIVE_CLIENT_ID: {
		public: true,
		static: true,
		schema: optional,
		description: 'The Microsoft Entra application (client) ID (PKCE, no secret).'
	}
});
