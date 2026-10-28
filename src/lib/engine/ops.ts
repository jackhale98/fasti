// SPDX-License-Identifier: GPL-2.0-or-later
/**
 * The engine's operations, run inside a worker: each builds a Remind
 * command line (docs/engine.md, "Invocations"), runs it in a fresh instance
 * and parses the output. Every date comes from Remind.
 */
import { dedupeDiagnostics, parseAgenda, parseCalendar, parseDiagnostics } from './parse-json.ts';
import {
	CALENDAR_WRAPPER,
	NOW_PROBE,
	NOW_SCRIPT,
	PROBE_LINE,
	calendarWrapper,
	mainPath,
	parseNow,
	parseProbeReport,
	probeFile
} from './probes.ts';
import type { EngineRequest, NextDatesOp, OpResults, PreviewOp, VaultFiles } from './protocol.ts';
import { runRemind, type Engine } from './run.ts';
import type { NextDatesResult, Occurrence } from './types.ts';

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const MONTH = /^\d{4}-\d{2}$/;
const TIME = /^\d{1,2}:\d{2}$/;

function check(ok: boolean, what: string): void {
	if (!ok) throw new Error(`Invalid ${what}`);
}

/** The default number of dates nextDates and preview return (the inspector's six). */
export const DEFAULT_COUNT = 6;

async function lineDates(
	engine: Engine,
	vault: VaultFiles,
	req: NextDatesOp | PreviewOp
): Promise<NextDatesResult> {
	const text = vault.files[req.file];
	if (text === undefined) throw new Error(`No file ${req.file} in the vault`);
	check(Number.isInteger(req.line) && req.line >= 1, 'line');
	if (req.from !== undefined) check(DATE.test(req.from), 'from date');
	const count = Math.max(1, Math.min(req.count ?? DEFAULT_COUNT, 50));
	const probed = probeFile(text, req.line, req.op === 'preview' ? req.newText : undefined);
	const files = { ...vault.files, [req.file]: probed.text };
	const dates: Occurrence[] = [];
	let reached = false;
	let diagnostics: NextDatesResult['diagnostics'] = [];
	let cursor = req.from;
	for (let i = 0; i < count; i++) {
		const out = await runRemind(engine, {
			files,
			args: ['-q', '-h', mainPath(vault.main), ...(cursor ? [cursor] : [])],
			tz: req.tz
		});
		if (i === 0) {
			diagnostics = parseDiagnostics(out.stderr, PROBE_LINE)
				.filter(
					(d) =>
						d.file === req.file &&
						d.line !== null &&
						d.line >= probed.first &&
						d.line <= probed.last
				)
				.map((d) => ({ ...d, line: d.line! + probed.shift }));
		}
		const report = parseProbeReport(out.stderr);
		if (!report) break;
		reached = true;
		if (!report.valid) break;
		// Stop when Remind's answer no longer moves forward (an overdue TODO keeps
		// its date). A string comparison of two dates Remind printed.
		const last = dates[dates.length - 1];
		if (last && report.date <= last.date) break;
		dates.push({ date: report.date, time: report.time });
		if (!DATE.test(report.next)) break;
		cursor = report.next;
	}
	return { dates, reached, diagnostics };
}

/** Runs one request. */
export async function runOp(
	engine: Engine,
	req: EngineRequest
): Promise<OpResults[EngineRequest['op']]> {
	const { vault } = req;
	switch (req.op) {
		case 'agenda': {
			if (req.date !== undefined) check(DATE.test(req.date), 'date');
			if (req.time !== undefined) check(TIME.test(req.time) && !!req.date, 'time');
			const when = req.date ? [req.time ? `${req.date}@${req.time}` : req.date] : [];
			const out = await runRemind(engine, {
				files: vault.files,
				args: ['--json', '-q', '-h', mainPath(vault.main), ...when],
				tz: req.tz
			});
			return parseAgenda(out.stdout, out.stderr);
		}
		case 'calendarMonth': {
			check(MONTH.test(req.month), 'month');
			const out = await runRemind(engine, {
				files: vault.files,
				extraFiles: { [CALENDAR_WRAPPER]: calendarWrapper(vault.main) },
				args: [
					'-ppp1',
					'-b2',
					...(req.mondayFirst ? ['-m'] : []),
					...(req.hideCompletedTodos ? ['--hide-completed-todos'] : []),
					CALENDAR_WRAPPER,
					`${req.month}-01`
				],
				tz: req.tz
			});
			const diagnostics = parseDiagnostics(out.stderr);
			const [month] = parseCalendar(out.stdout);
			if (!month) {
				const why = diagnostics.map((d) => d.message).join('; ');
				throw new Error(`Remind gave no calendar for ${req.month}${why ? `: ${why}` : ''}`);
			}
			return { month, diagnostics };
		}
		case 'nextDates':
		case 'preview':
			return lineDates(engine, vault, req);
		case 'diagnostics': {
			if (req.date !== undefined) check(DATE.test(req.date), 'date');
			const out = await runRemind(engine, {
				files: vault.files,
				args: ['-q', '-h', mainPath(vault.main), ...(req.date ? [req.date] : [])],
				tz: req.tz
			});
			return dedupeDiagnostics(parseDiagnostics(out.stderr));
		}
		case 'now': {
			const out = await runRemind(engine, {
				files: {},
				extraFiles: { [NOW_PROBE]: NOW_SCRIPT },
				args: ['-q', '-h', NOW_PROBE],
				tz: req.tz
			});
			const now = parseNow(out.stderr);
			if (!now) throw new Error(`Remind did not report the date: ${out.stderr.slice(0, 120)}`);
			return now;
		}
	}
}
