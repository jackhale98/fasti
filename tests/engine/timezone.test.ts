// SPDX-License-Identifier: GPL-2.0-or-later
/**
 * Spike check (docs/engine.md): the TZ keyword. Remind converts zones with
 * setenv("TZ") + mktime/localtime; engine/time-zone.js.in makes Emscripten's
 * versions of those honour TZ through Intl. Each run sets the local zone with
 * the TZ environment variable, so the results don't depend on the host.
 */
import { describe, expect, it } from 'vitest';
import { engineBuilt, runRemind, type MonthDescriptor } from './remind';

// remind(1), TIMEZONE SUPPORT: "If the local time zone is UTC and we feed
// Remind the following file on 2025-09-04 UTC ... Then the output is as
// follows: a = 2025-09-10, b = 18:00 / c = 2026-05-14, d = 06:59"
const manPageExample = `SET $AddBlankLines 0
BANNER %
REM Wednesday AT 14:00 TZ America/Toronto MSG 2PM Eastern (%2).
set a $T
set b $Tt
REM MSG a = [a], b = [b]
REM Wednesday AT 23:59 TZ America/Los_Angeles SATISFY [$Td == 13] MSG Foo %b %2.
set c $T
set d $Tt
REM MSG c = [c], d = [d]
`;

async function agenda(text: string, day: string, tz: string, zoneNames?: string[]) {
	return runRemind({ 'm.rem': text }, ['-q', '/vault/m.rem', day], { env: { TZ: tz }, zoneNames });
}

describe.skipIf(!engineBuilt)('TZ keyword', () => {
	it('matches the man page example with local time UTC', async () => {
		const r = await agenda(manPageExample, '2025-09-04', 'UTC');
		expect(r.stderr).toBe('');
		expect(r.stdout.trim()).toBe('a = 2025-09-10, b = 18:00\nc = 2026-05-14, d = 06:59');
	});

	it('converts into another local zone (America/Toronto)', async () => {
		const r = await agenda(manPageExample, '2025-09-04', 'America/Toronto');
		// 14:00 Toronto stays 14:00; 23:59 Wed 13 May in Los Angeles is 02:59 Thu 14 May in Toronto.
		expect(r.stdout.trim()).toBe('a = 2025-09-10, b = 14:00\nc = 2026-05-14, d = 02:59');
	});

	// remind(1): "Suppose the local time zone is America/Toronto ... On 2025-09-05
	// ... the reminder will trigger ... on 2025-09-12 ... the reminder will not
	// trigger."
	it('evaluates OMITs in the reminder zone (man page SKIP example)', async () => {
		const text = `# A Friday
OMIT 2025-09-05

# A Saturday
OMIT 2025-09-13

REM Saturday AT 01:00 TZ Europe/Amsterdam SKIP MSG Early Sat AM
`;
		expect((await agenda(text, '2025-09-05', 'America/Toronto')).stdout).toContain('Early Sat AM');
		expect((await agenda(text, '2025-09-12', 'America/Toronto')).stdout).not.toContain(
			'Early Sat AM'
		);
	});

	it('follows daylight saving changes in both zones', async () => {
		// US clocks change on 2026-03-08, UK clocks on 2026-03-29.
		const text = `SET $AddBlankLines 0
BANNER %
REM 2026-03-07 AT 12:00 TZ America/New_York MSG x
SET a $Tt
REM 2026-03-09 AT 12:00 TZ America/New_York MSG x
SET b $Tt
REM 2026-03-30 AT 12:00 TZ America/New_York MSG x
SET c $Tt
MSG [a] [b] [c]%
`;
		const r = await agenda(text, '2026-03-01', 'Europe/London');
		expect(r.stdout.trim()).toBe('17:00 16:00 17:00');
	});

	it('reports tz, time and time_in_tz in -ppp entries', async () => {
		const r = await runRemind(
			{ 'm.rem': 'REM 2025-09-10 AT 14:00 TZ America/Toronto MSG x\n' },
			['-ppp1', '/vault/m.rem', '2025-09-01'],
			{ env: { TZ: 'UTC' } }
		);
		const [entry] = (JSON.parse(r.stdout) as MonthDescriptor[]).flatMap((m) => m.entries);
		expect(entry).toMatchObject({
			date: '2025-09-10',
			tz: 'America/Toronto',
			time: 18 * 60,
			time_in_tz: 14 * 60,
			eventstart: '2025-09-10T18:00',
			eventstart_in_tz: '2025-09-10T14:00'
		});
	});

	it('warns about an unknown zone name when /usr/share/zoneinfo is present', async () => {
		const zones = Intl.supportedValuesOf('timeZone');
		const good = await agenda(
			'REM Wed AT 14:00 TZ Europe/Amsterdam MSG x\n',
			'2025-09-04',
			'UTC',
			zones
		);
		expect(good.stderr).toBe('');
		const bad = await agenda(
			'REM Wed AT 14:00 TZ Mars/Olympus MSG x\n',
			'2025-09-04',
			'UTC',
			zones
		);
		expect(bad.stderr).toBe(
			"/vault/m.rem(1): No time zone file found for TZ `Mars/Olympus'... is it valid?"
		);
	});

	it('reads names Intl lacks as POSIX STDoffset (DST rule ignored), else UTC', async () => {
		const text = `SET $AddBlankLines 0
BANNER %
REM 2025-07-09 AT 14:00 TZ !EST+5EDT,M3.2.0/2,M11.1.0/2 MSG x
SET a $Tt
REM 2025-07-09 AT 14:00 TZ Mars/Olympus MSG x
SET b $Tt
MSG [a] [b]%
`;
		// A real EST5EDT zone would give 18:00 in July; the DST rule is a known limitation.
		expect((await agenda(text, '2025-07-01', 'UTC')).stdout.trim()).toBe('19:00 14:00');
	});
});
