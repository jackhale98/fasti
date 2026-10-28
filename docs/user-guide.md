# Fasti user guide

Fasti is a web front end for Remind, Dianne Skoll's plain-text reminder
language. You keep your reminders in ordinary `.rem` files; Fasti shows them
as an agenda and a calendar, helps you add and edit them, and can remind you
when they are due. Every date Fasti shows is worked out by Remind itself,
running in your browser.

Fasti is not affiliated with or endorsed by Remind or its author. It was built
with AI assistance.

## Getting started

Open <https://jackhale98.github.io/fasti/> in a browser.

- **On a phone**, the views are tabs along the bottom: **Today**, **Month**,
  **Script** and **Sync**. The round **+** button (**New reminder**) opens
  quick add. **Settings** is the gear at the top.
- **On a desktop**, the views are in a rail on the left, the Inspector is a
  panel on the right, and the **n** key opens quick add from anywhere (except
  while you are typing in a field).

### The sample vault

The first time you open Fasti it fills itself with a small sample vault so
there is something to look at: `reminders.rem` (work, tasks and everyday
reminders), `holidays.rem` (days off) and `birthdays.rem`. They are plain
Remind scripts. Change them freely, or replace them with your own files.

### Bringing your own files

Go to **Settings → Your files**:

- **Import files** picks one or more `.rem` files.
- **Import a folder** picks a whole folder, keeping its subfolders.

Before anything is written, Fasti shows what will be added and what would
replace a different file of the same name. Choose **Add files**, or, when there
are clashes, **Add and replace** or **Add new files only**. Files that aren't
UTF-8 text, are too large or have unusable names are skipped and listed. You
can undo an import from the message that appears right afterwards.

### Choosing the main file

Remind starts from one file and follows its `INCLUDE` and `DO` lines to the
others. Pick that file under **Main entry**. You can also pick a folder, which
means "every `*.rem` file in it, sorted by name", or **Whole vault (every .rem
file)**. Below it, **Files Remind reads** lists every file Remind actually
reaches, and **Include problems** lists any include that can't be followed
(for example a file outside the vault).

### Backing up

Your files live only in this browser until sync exists (see
[What isn't built yet](#what-isnt-built-yet)). Use **Export as zip** now and
then to download a copy (`fasti-vault.zip`). Clearing the browser's site data
deletes the vault.

**Reset local data** deletes every file in this browser's vault and puts the
sample vault back. It can't be undone, so export first.

## Today

Today is Remind's agenda for the current day. The line at the top is Remind's
own banner, for example "Reminders for Wednesday, 28th October, 2026 (today):".

- **Overdue**: `TODO` reminders whose due date has passed and that aren't done.
- **Today**: today's reminders, timed ones in order, with **All day** for the
  rest.
- **Heads-up**: reminders coming soon because of a `+N` warning, with how many
  days away they are.
- **Next two weeks**: the calendar for the coming 14 days, grouped by day, with
  **Day off** on days Remind omits.

Each task has a circle; tap it to mark the task done. Fasti records this in
the file as `COMPLETE-THROUGH` with that date, and the message that appears
offers **Undo**. Tap any reminder to open it in the Inspector.

## Month

A six-week grid. Use **Previous month**, **Next month** and **Today** to move,
or the arrow keys once a day is focused. Wide screens show reminder labels in
each day; phones show dots. Pick a day to see its reminders listed below the
grid.

The legend explains the markings: today is highlighted; weekly days off (such
as `OMIT Sat Sun`) are tinted; dated holidays (`OMIT 25 Dec`) are hatched; and
a small **N** (*nefastus*) marks any day Remind omits. Completed task
occurrences are struck through. The week starts on Sunday or Monday, as set in
Settings.

## Script

Script is the text of your files, with one tab per file.

- Syntax colours follow Remind's grammar; completions offer keywords, weekday
  and month names, `%` sequences and `INFO` headers.
- On phones, a strip of keys inserts common tokens (`REM`, `MSG`, `AT`, `TODO`,
  `SKIP`, `AFTER`, `+3`, `*7`, `%b`, `OMIT`, `DURATION`, `UNTIL`) at the
  cursor.
- **Problems** lists Remind's own error and warning messages for the file, by
  line.
- The **line inspector** explains the line under the cursor in plain language
  and shows its **Next dates** from Remind. "Remind never reaches this line"
  means nothing includes it, or it sits in a branch that isn't taken.
- Edits are saved as you type. A pause in typing is one undo step.
- Below the editor, Fasti shows the line endings it is keeping for the file,
  and says so if the file has no final newline or if nothing includes it.

## Quick add

Open it with the **+** button on a phone, or **n** on a desktop. Describe the
reminder in plain words; Fasti shows the `REM` line it will add, explains it,
and asks Remind for its next dates before you add it. Some phrases that work:

| You type | Fasti writes |
| --- | --- |
| dentist tomorrow at 3pm | `REM <tomorrow's date> AT 15:00 MSG Dentist` |
| standup every weekday at 9:30 | `REM Mon Tue Wed Thu Fri AT 9:30 MSG Standup` |
| pay rent on the 1st of every month | `REM 1 MSG Pay rent` |
| gym every Mon, Wed and Fri at 6pm for 1h | `REM Mon Wed Fri AT 18:00 DURATION 1:00 MSG Gym` |
| farmers market second Saturday of the month at 10am | `REM Second Saturday AT 10:00 MSG Farmers market` |
| submit timesheet last working day of every month | `REM Lastworkday OMIT Sat Sun MSG Submit timesheet` |
| trash every other tue | `REM <next Tuesday> *14 MSG Trash` |
| Maya's birthday 3 Nov | `REM 3 Nov +7 MSG Maya's birthday %b` |
| taxes April 30 remind me 2 days before | `REM <date> +2 MSG Taxes %b` |
| todo renew passport 14 Dec | `REM TODO <date> MSG Renew passport %b` |
| yoga daily until 20 dec | `REM UNTIL <date> MSG Yoga` |

Open **Adjust** to fine-tune: **Message**, **Repeats** (Once, Every day,
Weekly, Monthly on a date or a weekday, Last day of the month, Last working
day, Yearly, Every N days), **Time** and duration, **Heads-up** days, **On days
off** (what to do when the date falls on a day Remind omits), **Ends**, and
**Options**: **It's a task (TODO)** and **Add countdown %b**. Choose the file
at the bottom and press **Add reminder**.

A new repeating task is added with `COMPLETE-THROUGH` set to yesterday, so it
doesn't start out overdue. If you type a line that starts with `REM` or
`OMIT`, quick add takes it as written and Adjust is turned off.

## The Inspector

Tap or click a reminder anywhere to open it: a panel on the right on desktops,
a sheet from the bottom on phones. It shows:

- the message, with Remind's substitutions filled in, and chips for the time,
  duration and `INFO` values;
- **Mark done through** a date, for a task;
- **How Remind reads it**: the line in plain language;
- **Next dates** (or **Due dates** for a task), from Remind;
- **Source**: the line itself, which you can edit. As you type, Fasti checks
  the new line with Remind and shows its next dates or the error. **Save line**
  is enabled only when Remind accepts it.
- **Show in script** jumps to the line in Script; **Delete** removes it, with
  **Undo** in the message that follows.

## Settings

- **Your files**: main entry, the files Remind reads, import, export as zip,
  reset (see [Getting started](#getting-started)).
- **Display**: **Week starts on** Sunday or Monday; **Times** in 12-hour
  (2:00pm) or 24-hour (14:00); **Hide completed TODOs**; **Theme**: Match the
  system, Light or Dark.
- **Notifications** and **Calendar export**: below.
- **About**: the licence, notices and a link to the source code.

## Notifications

Fasti can notify you of reminders that have an `AT` time. The times come from
Remind, including `+` warnings before the time (`+tdelta`) and repeats
(`*trepeat`). Reminders marked `NOQUEUE` don't notify.

Turn them on in **Settings → Notifications** with **Turn on notifications**,
and use **Send a test notification** to check they arrive.

- **While Fasti is open** in a tab or window, Fasti shows each notification at
  its time.
- **While Fasti is closed**, notifications need push, which needs Fasti's
  worker. If push isn't set up for the copy of Fasti you use, Settings says so
  and notifications only work while it is open. When it is, Fasti sends the
  next 8 days of timed reminders (at most 64) to the worker each time you open
  it, and Settings shows "Notifications scheduled through" a date.

Things to know:

- The schedule covers 8 days from the last time Fasti was opened on this
  device. Open it at least once a week.
- Edits made on another device, or a time zone change, take effect the next
  time Fasti is opened here.
- Battery savers, Focus and Low Power Mode can delay notifications.
- **iPhone and iPad** allow notifications only for apps on the Home Screen.
  Open Fasti in Safari, tap the Share button, choose **Add to Home Screen**,
  then **Add**, open Fasti from the Home Screen and turn notifications on
  there.
- If you blocked notifications for the site, allow them again in the
  browser's settings and reload.

## Calendar export

**Settings → Calendar export** saves your reminders as an `.ics` file that
calendar apps can import. Choose the **Range** (3, 6, 12 or 24 months), **All
files** or **Pick files**, and whether to **Include TODOs** and **Include
completed TODOs**, then press **Export .ics**.

- Each occurrence Remind computes is its own event. Timed reminders become
  timed events in your device's time zone; the rest are all-day.
- The file is a **snapshot**. It doesn't update itself. To update it, export
  again and re-import: calendars that honour event IDs update the events
  instead of duplicating them.
- A `%b` countdown reads "today" in the exported events. Remind prints each
  calendar day's entries as of that day, so the countdown on the day itself is
  "today".
- `RUN` reminders are never run, and they don't appear in the export.

## Installing and offline use

Fasti can be installed as an app:

- **Android (Chrome)**: the menu, then **Install app** or **Add to Home
  screen**.
- **iPhone and iPad (Safari)**: Share, then **Add to Home Screen**.
- **Desktop (Chrome, Edge)**: the install icon in the address bar.

After the first visit, Fasti and Remind are stored on your device and work
without a connection, installed or not. When a new version is available, Fasti
says "A new version of Fasti is ready." with a **Reload** button, rather than
reloading on its own.

## Privacy

- Your files, settings and undo history are kept in this browser on this
  device (IndexedDB). Nothing is uploaded, and Fasti has no accounts.
- Remind runs inside your browser. It can't run commands from a script.
- If you turn on push notifications, each notification is encrypted on your
  device before it is sent to the worker. The worker stores only the delivery
  time and the sealed message; it can't read your reminder text.

## What isn't built yet

**Sync** (Phase 4 of the [plan](PLAN.md)) is not built. It will connect Fasti
to GitHub, other git hosts, Dropbox, OneDrive and WebDAV, so the same files
work on all your devices. Until then the Sync tab is a placeholder, and the
files on each device are separate: move them with **Export as zip** and
**Import a folder** (unzip first).

## A Remind primer

A Remind file is a list of lines. The most common is `REM`, which gives a
date pattern and a message:

```
REM 25 Dec MSG Christmas           # every 25 December
REM Mon AT 9:30 MSG Stand-up       # every Monday at 9:30
REM 1 +3 MSG Pay rent %b           # the 1st of each month, from 3 days before
REM 2026-05-12 *182 MSG Check-up   # every 182 days from 12 May 2026
REM TODO 15 MSG Pay the card       # a task due on the 15th, overdue until done
OMIT Sat Sun                       # weekends are days off
REM Lastworkday MSG Timesheet      # the last day of the month that isn't omitted
```

- A date can leave parts out: a missing part matches every value.
- `+N` gives warning days before a date; `*N` repeats every N days.
- `OMIT` marks days off; `SKIP`, `BEFORE` and `AFTER` move or drop a reminder
  that lands on one.
- `AT` gives a time, `DURATION` a length, `UNTIL` an end date.
- `%b` in a message becomes a countdown such as "in 3 days' time",
  "tomorrow" or "today".
- `INCLUDE` and `DO` read other files.

For everything else, read Remind's own manual, `remind(1)`. Its source is in
`engine/vendor/` in Fasti's repository (the man pages are in the release
tarball). The Inspector's **How Remind reads it** and the line inspector in
Script are a good way to learn: they explain any line you write.
