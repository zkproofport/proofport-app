# Store screenshots live here

These are the real ones. `01_verify` / `02_wallet` / `03_history` / `04_more`,
1320×2868, which is the 6.9-inch size the App Store asks for. They show the
host app only — no mini-app tab, no developer-mode log panel.

`feature-graphic.png` (1024×500) and `app-icon-512.png` are for Play.

## Why this file exists

On 2026-08-29 an assistant read `proofport-app/ios/fastlane/screenshots/en-US`,
found four files there, and reported the store's state from that folder: "the
first shot is a launch screen, the third is a debug log, Korean is zero". Two of
those three statements were about stale files nobody ships, and the third was
about a console it never looked at. The screenshots had already been uploaded.

**A folder on disk is not the state of the App Store.** What is uploaded lives
in App Store Connect and nowhere else. Read the console before saying anything
about what the store has.

The fastlane folder now holds copies of these four so the two do not disagree,
but it is still a copy — treat this directory as the source.
