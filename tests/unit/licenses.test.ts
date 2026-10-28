// SPDX-License-Identifier: GPL-2.0-or-later
import { describe, expect, it } from 'vitest';
import { allowed, licenceOf } from '../../scripts/check-licenses.mjs';
import { hasSpdx } from '../../scripts/check-spdx.mjs';

describe('licence expressions', () => {
	it('accepts GPLv2-compatible licences', () => {
		for (const id of ['MIT', 'ISC', 'BSD-3-Clause', 'MPL-2.0', 'OFL-1.1', 'GPL-2.0-or-later']) {
			expect(allowed(id), id).toBe(true);
		}
	});

	it('rejects Apache-2.0 alone and GPL-3.0', () => {
		expect(allowed('Apache-2.0')).toBe(false);
		expect(allowed('GPL-3.0-or-later')).toBe(false);
		expect(allowed('UNKNOWN')).toBe(false);
	});

	it('takes the compatible side of OR and needs both sides of AND', () => {
		expect(allowed('(MIT OR Apache-2.0)')).toBe(true);
		expect(allowed('Apache-2.0 OR MIT')).toBe(true);
		expect(allowed('MIT AND Apache-2.0')).toBe(false);
		expect(allowed('(MIT AND ISC) OR Apache-2.0')).toBe(true);
		expect(allowed('GPL-2.0+ WITH Classpath-exception-2.0')).toBe(true);
	});

	it('throws on an expression it cannot read', () => {
		expect(() => allowed('(MIT OR')).toThrow();
	});
});

describe('declared licences', () => {
	it('reads the modern and the old package.json forms', () => {
		expect(licenceOf({ license: 'MIT' })).toBe('MIT');
		expect(licenceOf({ license: { type: 'ISC' } })).toBe('ISC');
		expect(licenceOf({ licenses: [{ type: 'MIT' }, { type: 'Apache-2.0' }] })).toBe(
			'(MIT OR Apache-2.0)'
		);
		expect(licenceOf({})).toBe('UNKNOWN');
	});
});

describe('SPDX headers', () => {
	it('finds an identifier in the first lines only', () => {
		expect(hasSpdx('// SPDX-License-Identifier: GPL-2.0-or-later\nx')).toBe(true);
		expect(hasSpdx('<!-- SPDX-License-Identifier: GPL-2.0-or-later -->')).toBe(true);
		expect(hasSpdx('a\nb\nc\nd\ne\n// SPDX-License-Identifier: MIT')).toBe(false);
		expect(hasSpdx('nothing here')).toBe(false);
	});
});
