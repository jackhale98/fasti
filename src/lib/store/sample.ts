// SPDX-License-Identifier: GPL-2.0-or-later
/**
 * The sample vault a new browser vault is seeded with. Static text: no date
 * is computed here. Recurring reminders keep the demo useful whenever it is
 * opened; the few fixed dates are either the start of a repeat (`*14`,
 * `*182`), a TODO that stays overdue, or a short trip. The same files live in
 * tests/fixtures/vaults/sample/ and a test keeps the two identical.
 */
import type { VaultPath } from '../engine/types';

export const SAMPLE_MAIN: VaultPath = 'reminders.rem';

export const SAMPLE_FILES: Readonly<Record<VaultPath, string>> = {
	'reminders.rem': `# Fasti demo vault. This is a plain Remind script:
# edit it under Script and every view updates.

DO holidays.rem
DO birthdays.rem

# Work
REM Mon Tue Wed Thu Fri AT 9:30 DURATION 0:15 SKIP MSG Stand-up
REM Thu AT 14:00 DURATION 1:00 SKIP INFO "Location: Room 4B" MSG Design review
REM 2026-01-02 *14 AT 9:00 MSG Payday
REM Lastworkday +2 MSG Submit timesheet %b
REM 1 OMIT Sat Sun AFTER +3 MSG Pay rent %b

# Tasks
REM TODO 2026-10-20 ++3 MSG Renew passport application %b
REM TODO Sun +2 MAX-OVERDUE 6 COMPLETE-THROUGH 2026-10-25 MSG Water the plants %b
REM TODO 15 ++5 MAX-OVERDUE 10 COMPLETE-THROUGH 2026-10-15 MSG Pay the credit card %b
REM TODO 30 Apr ++15 COMPLETE-THROUGH 2026-04-30 MSG File taxes %b

# Life
REM 2026-05-12 *182 AT 15:30 DURATION 1:00 +3 INFO "Location: Elm St Dental" \\
    MSG Dental check-up %b
REM Second Saturday AT 10:00 MSG Farmers market
REM 2026-12-18 +2 THROUGH 2026-12-22 MSG Trip to Montréal %b
REM 13 SATISFY [$Tw == 5] MSG Friday the 13th
`,
	'holidays.rem': `# Days off. Reminders that use SKIP, BEFORE, AFTER,
# -N or +N work around these.
OMIT Sat Sun
OMIT 1 Jan MSG New Year's Day
OMIT 4 Jul MSG Independence Day
OMIT 11 Nov MSG Veterans Day
OMIT 25 Dec +3 MSG Christmas %b
REM Mon 1 Sep SCANFROM -7 ADDOMIT MSG Labor Day
REM Thu 22 Nov SCANFROM -7 ADDOMIT MSG Thanksgiving
`,
	'birthdays.rem': `REM 2 Nov +7 MSG Maya's birthday %b
REM 14 Dec +7 MSG Dad's birthday %b
REM 9 Jan +7 MSG Sam's birthday %b
`
};
