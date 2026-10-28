// SPDX-License-Identifier: GPL-2.0-or-later
import js from '@eslint/js';
import svelte from 'eslint-plugin-svelte';
import globals from 'globals';
import ts from 'typescript-eslint';

export default ts.config(
	{
		ignores: [
			'build/',
			'.svelte-kit/',
			'dist/',
			'node_modules/',
			'playwright-report/',
			'test-results/',
			'static/engine/',
			'engine/vendor/',
			'engine/.build/',
			'reference/',
			'.cache/',
			'.lighthouseci/',
			'worker/.wrangler/'
		]
	},
	js.configs.recommended,
	...ts.configs.recommended,
	...svelte.configs.recommended,
	{
		languageOptions: {
			globals: {
				...globals.browser,
				...globals.node,
				// Build-time constants from vite.config.ts `define`.
				__APP_COMMIT__: 'readonly',
				__APP_BUILT__: 'readonly'
			}
		}
	},
	{
		files: ['**/*.svelte', '**/*.svelte.ts', '**/*.svelte.js'],
		languageOptions: {
			parserOptions: {
				projectService: true,
				extraFileExtensions: ['.svelte'],
				parser: ts.parser
			}
		}
	}
);
