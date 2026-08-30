# What testers are asked to check

These two files are the TestFlight "What to Test" note, one per language.

They live here rather than being typed into the console because the note for
build 3 opened with "the app comes up in English; that is known, no need to
report it" — true when it was written, and false the moment the Korean
declaration shipped. A tester reading a stale note dismisses the very defect
they were meant to catch. Text nobody can diff is text that goes stale.

Apple does not attach these during the build: `upload_to_testflight` runs with
`skip_waiting_for_build_processing: true`, so there is no processed build to
attach a note to by the time the lane ends. Push them afterwards with:

    source .env.ios && python3 scripts/asc-set-build-note.py

The script writes to the newest build and prints what it replaced.

Rewrite the opening paragraph for every build. It is the part that says what
THIS build changed, and it is the part that rots.
