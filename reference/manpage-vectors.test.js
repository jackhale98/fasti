// Golden vectors from worked examples in the Remind 06.03.06 man page.
// Written against the prototype engine API (K.evaluate / K.occurrences / K.agenda / K.subst).
// Port the expected values to the WebAssembly engine's harness; the expectations are what matter.
// Run as-is: node manpage-vectors.test.js <path-to-prototype-engine.js>

const K = require(process.argv[2] || './engine.js');
const D = s => { const [y,m,d]=s.split('-').map(Number); return K.dnum(y,m,d); };
let pass=0, fail=0;
function check(name, got, want){ const ok = JSON.stringify(got)===JSON.stringify(want); ok?pass++:fail++; if(!ok) console.log('FAIL', name, '\n  got ', got, '\n  want', want); }
function ev(text){ return K.evaluate({'m.rem':text}, 'm.rem'); }
function occ(text, a, b){ const c=ev(text); const it=c.items[c.items.length-1]; if(!it) { console.log('no item', text, c.lines['m.rem'].map(l=>l.error)); return []; } return K.occurrences(it.rem, D(a), D(b)).map(K.iso); }
function ag(text, day){ const c=ev(text); return K.agenda(c, D(day)).map(x=>({t:K.iso(x.t), s:x.state, msg:K.subst(x.it.rem,x.t,D(day),600)})); }

// date spec interpretation
check('Mon Tue 28 Oct 1990', occ('REM Mon Tue 28 Oct 1990 MSG Hi','1990-10-01','1990-11-30'), ['1990-10-29']);
check('Sat 1 first Saturday', occ('REM Sat 1 MSG x','2026-10-01','2026-12-31'), ['2026-10-03','2026-11-07','2026-12-05']);
check('31 every month w/31', occ('REM 31 MSG x','2026-09-01','2026-12-31'), ['2026-10-31','2026-12-31']);
check('Feb 29', occ('REM Feb 29 MSG x','2026-01-01','2028-12-31'), ['2028-02-29']);
check('Last Monday', occ('REM Last Monday MSG x','2026-10-01','2026-12-31'), ['2026-10-26','2026-11-30','2026-12-28']);
check('Last Monday April = Mon 1 May --7', occ('REM Last Monday April MSG x','2026-01-01','2027-12-31'), occ('REM Mon 1 May --7 MSG x','2026-01-01','2027-12-31'));
check('Last Monday December 2025', occ('REM Last Monday December 2025 MSG x','2025-01-01','2026-12-31'), ['2025-12-29']);
check('Second Monday May', occ('REM Second Monday in May MSG x','2026-01-01','2026-12-31'), ['2026-05-11']);
check('Lastday', occ('REM Lastday MSG x','2026-01-01','2026-03-31'), ['2026-01-31','2026-02-28','2026-03-31']);
check('Lastworkday Apr OMIT', occ('REM Lastworkday April OMIT SAT SUN MSG x','2026-01-01','2027-12-31'), occ('REM 1 May -1 OMIT SAT SUN MSG x','2026-01-01','2027-12-31'));
check('Apr ~~7', occ('REM Apr ~~7 MSG x','2026-01-01','2026-12-31'), ['2026-04-24']);
// back with omit: 1 -1 OMIT Sat Sun ; 2026-11-01 is Sunday -> Fri Oct 30; 2026-06-01 is Monday -> Fri May 29
check('1 -1 OMIT Sat Sun', occ('REM 1 -1 OMIT Sat Sun MSG x','2026-05-01','2026-11-30'), ['2026-05-29','2026-06-30','2026-07-31','2026-08-31','2026-09-30','2026-10-30','2026-11-30']);
check('1 --1 OMIT Sat Sun', occ('REM 1 --1 OMIT Sat Sun MSG x','2026-10-01','2026-10-31'), ['2026-10-31']);
// delta with omit: 1 +1 OMIT Sat Sun, first is Monday (2026-06-01) -> warn from Fri May 29
{ const c=ev('REM 1 +1 OMIT Sat Sun MSG x'); const r=c.items[0].rem; check('warnStart +1', K.iso(K.warnStart(r,D('2026-06-01'))), '2026-05-29');
  const c2=ev('REM 1 ++1 OMIT Sat Sun MSG x'); check('warnStart ++1', K.iso(K.warnStart(c2.items[0].rem,D('2026-06-01'))), '2026-05-31'); }
// SKIP / BEFORE / AFTER (man page, 1992)
const base='OMIT 11 Nov +4 MSG Remembrance Day\n';
check('Wed plain', occ(base+'REM Wed MSG Code meeting','1992-11-09','1992-11-19'), ['1992-11-11','1992-11-18']);
check('Wed SKIP', occ(base+'REM Wed SKIP MSG Code','1992-11-09','1992-11-19'), ['1992-11-18']);
check('Wed BEFORE', occ(base+'REM Wed BEFORE MSG Code','1992-11-09','1992-11-19'), ['1992-11-10','1992-11-18']);
check('Wed AFTER', occ(base+'REM Wed AFTER MSG Code','1992-11-09','1992-11-19'), ['1992-11-12','1992-11-18']);
check('OMIT with MSG is also a REM', occ('OMIT 11 Nov +4 MSG Remembrance Day','1992-01-01','1992-12-31'), ['1992-11-11']);
// THROUGH / UNTIL
check('jury THROUGH', occ('REM 1992-11-30 +2 THROUGH 1992-12-04 MSG Jury duty','1992-11-01','1992-12-31'), ['1992-11-30','1992-12-01','1992-12-02','1992-12-03','1992-12-04']);
check('jury *1 UNTIL', occ('REM 1992-11-30 *1 +2 UNTIL 1992-12-04 MSG Jury duty','1992-11-01','1992-12-31'), ['1992-11-30','1992-12-01','1992-12-02','1992-12-03','1992-12-04']);
check('THROUGH + AFTER respects expiry', occ('OMIT 2021-01-08\nREM 2021-01-01 THROUGH 2021-01-08 AFTER MSG Test','2021-01-01','2021-01-31'), ['2021-01-01','2021-01-02','2021-01-03','2021-01-04','2021-01-05','2021-01-06','2021-01-07']);
check('Fri UNTIL', occ('REM Fri UNTIL 11 Dec 1992 MSG Class','1992-11-30','1992-12-31'), ['1992-12-04','1992-12-11']);
check('payday *14', occ('REM 28 Oct 1992 *14 MSG Payday','1992-10-01','1992-12-01'), ['1992-10-28','1992-11-11','1992-11-25']);
check('wkday 15', occ('REM Mon Tue Wed Thu Fri 15 MSG x','2026-08-01','2026-11-30'), ['2026-08-17','2026-09-15','2026-10-15','2026-11-16']);
check('backup AFTER', occ('REM 1 OMIT Sat Sun AFTER RUN do_backup','2026-10-01','2026-11-30'), ['2026-10-01','2026-11-02']);
// ADDOMIT Labour Day then a delta that skips it
check('ADDOMIT', occ('REM Mon 1 Sep SCANFROM -7 ADDOMIT MSG Labour Day\nREM Tue 2 Sep -1 MSG day before tue','2026-08-01','2026-09-30'), ['2026-09-06']);
// TODOs
check('TODO cat food before', ag('REM TODO 15 August 2025 ++5 MSG Buy cat food %b.','2025-08-10'), [{t:'2025-08-15',s:'soon',msg:"Buy cat food in 5 days' time."}]);
check('TODO cat food after', ag('REM TODO 15 August 2025 ++5 MSG Buy cat food %b.','2025-08-16'), [{t:'2025-08-15',s:'overdue',msg:'Buy cat food yesterday.'}]);
check('MAX-OVERDUE last', ag('REM TODO 2025-08-13 ++5 MAX-OVERDUE 5 MSG Task: %b.','2025-08-18').length, 1);
check('MAX-OVERDUE gone', ag('REM TODO 2025-08-13 ++5 MAX-OVERDUE 5 MSG Task: %b.','2025-08-19').length, 0);
check('MAX-OVERDUE start', ag('REM TODO 2025-08-13 ++5 MAX-OVERDUE 5 MSG Task: %b.','2025-08-08').length, 1);
check('MAX-OVERDUE before start', ag('REM TODO 2025-08-13 ++5 MAX-OVERDUE 5 MSG Task: %b.','2025-08-07').length, 0);
check('trash from 1990', ag('REM TODO Wed +7 MSG Take out the trash %a (%b)','2025-08-13')[0].msg, 'Take out the trash on Wednesday, 3 January, 1990 (13006 days ago)');
check('trash done', ag('REM TODO Wed +7 COMPLETE-THROUGH 2025-08-13 MSG Take out the trash %a (%b)','2025-08-13')[0].msg, "Take out the trash on Wednesday, 20 August, 2025 (in 7 days' time)");
check('plants', ag('REM TODO Wed +7 FROM 2025-08-06 UNTIL 2025-08-27 MSG Plants %b.','2025-08-13')[0].msg, 'Plants 7 days ago.');
check('plants done', ag('REM TODO Wed +7 FROM 2025-08-06 UNTIL 2025-08-27 COMPLETE-THROUGH 2025-08-27 MSG Plants %b.','2025-08-28').length, 0);
check('taxes', ag('REM TODO 30 April ++15 COMPLETE-THROUGH 2025-04-30 MSG File taxes','2026-04-20')[0].t, '2026-04-30');
// substitutions from the man page
const bob=(code,day)=>ag(`REM 18 Oct 1990 +4 MSG Meeting with Bob ${code}.`,day)[0].msg;
check('%a', [bob('%a','1990-10-16'),bob('%a','1990-10-17'),bob('%a','1990-10-18')], ['Meeting with Bob on Thursday, 18 October, 1990.','Meeting with Bob tomorrow.','Meeting with Bob today.']);
check('%b', bob('%b','1990-10-16'), "Meeting with Bob in 2 days' time.");
check('%c', bob('%c','1990-10-16'), 'Meeting with Bob on Thursday.');
check('%x %p', ag('REM 1 Jan +4 MSG %x day%p to go before New Year!','2026-12-30')[0].msg, '2 days to go before New Year!');
check('%q', ag('REM 1 Jan +4 MSG New Year in %x day%q time!','2026-12-31')[0].msg, "New Year in 1 day's time!");
check('%j %*c %U', ag('REM 2026-11-02 MSG %j / %*c / %U','2026-10-01').length, 0);
check('INFO %<>', ag('REM 2026-11-02 INFO "Location: Boardroom #2" MSG Meet at %<location>','2026-11-02')[0].msg, 'Meet at Boardroom #2');
check('%2 %3', ag('REM AT 13:05 MSG x %2 %3','2026-11-02')[0].msg, 'x at 1:05pm at 13:05');
// sugar errors
const err = t => { const c=ev(t); return c.lines['m.rem'][0].error || null; };
check('err First Monday 3 June', !!err('REM First Monday 3 June MSG Huh?'), true);
check('err April 3 ~~1', !!err('REM April 3 ~~1 MSG What?'), true);
check('err Second June', !!err('REM Second June MSG x'), true);
check('err Mnday', err('REM Mnday MSG x'), 'I don’t recognise “Mnday”'.replace('’',"'"));
check('err COMPLETE w/o TODO', !!err('REM 15 COMPLETE-THROUGH 2026-01-01 MSG x'), true);
check('omit range wrap', (()=>{const c=ev('OMIT 25 Dec THROUGH 4 Jan\nREM 1 Jan MSG x');return [K.isOmitted(D('2026-12-30'),c.finalOmit),K.isOmitted(D('2027-01-05'),c.finalOmit)]})(), [true,false]);
check('OMIT May whole month', (()=>{const c=ev('OMIT May');return K.isOmitted(D('2026-05-31'),c.finalOmit)})(), true);
check('push/pop', (()=>{const c=ev('PUSH-OMIT-CONTEXT\nOMIT Sat Sun\nREM Sat SKIP MSG a\nPOP-OMIT-CONTEXT\nREM Sat SKIP MSG b'); return c.items.map(i=>K.occurrences(i.rem,D('2026-10-01'),D('2026-10-10')).length)})(), [0,2]);
check('continuation', occ('REM Mon \\\n  Wed MSG x','2026-10-26','2026-10-31'), ['2026-10-26','2026-10-28']);
check('satisfy engine-only', ev('REM 13 SATISFY [$Tw == 5] MSG Friday 13th').items[0].engineOnly, true);
console.log(pass+' passed, '+fail+' failed');
