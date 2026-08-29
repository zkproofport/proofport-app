# Play store listing

Written for `fastlane supply`, which reads
`metadata/android/<locale>/{title,short_description,full_description}.txt`.

The full descriptions are the App Store ones, copied verbatim — the same app
deserves the same words, and keeping one of them edited while the other drifts is
how the two stores end up describing different products.

**The short description has no App Store equivalent and was written here.** Play
shows it under the app name in search results and asks for at most 80 characters;
the closest Apple field, the subtitle, allows 30 and is empty in this app's
metadata anyway. It is not a truncation of the long description — at that length
it has to be one sentence that survives on its own.

Play's limits, which differ from Apple's: title 30 characters, short description
80, full description 4000. `supply` refuses anything longer, so the guard test in
`src/__tests__/theStoreListingFitsPlaysLimits.test.ts` checks them here rather
than letting an upload fail after a build.

Screenshots are not kept here. Play wants Android captures, and the ones in
`screenshots/` are iPhone frames at 1320×2868 — wrong device, wrong aspect ratio.
They have to be taken on an Android device or emulator before the listing is
complete.
