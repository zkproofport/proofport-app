# Play "App content" — what was answered, and where it can be read back

The store listing (text, screenshots, icon, graphic) is in this repository and
uploaded from it — see `upload-listing.py` and the metadata tree it reads.

The **App content** answers are not, and until 2026-09-04 nothing recorded them
anywhere. That is what this file is for. They are the declarations Play requires
before a release can be sent for review: Data safety, Content rating, Target
audience, Ads, App access, News, Government apps, Financial features, Health,
and the privacy policy URL.

## What can be read back, and what cannot

Asked directly on 2026-09-04, not assumed:

| | |
|---|---|
| Store listing text | readable — `scripts/play-api.py get /listings` |
| Screenshots, icon, graphic | readable — `scripts/play-api.py get /listings/<lang>/phoneScreenshots`. The path is `/listings/...`; `/images/...` answers a 404 HTML page, which reads as "there are none" |
| Which track holds what | readable — `scripts/play-api.py tracks` |
| **Data safety** | **write only.** `POST .../applications/<package>/dataSafety` takes a CSV; there is no GET. Confirmed: `scripts/play-api.py app-get /dataSafety` → 404 |
| **Content rating** | **no API at all**, neither read nor write |
| Target audience, Ads, App access, News, Government, Financial, Health | **no API** |

So most of this section exists only inside the console. A person filled it in,
and nothing outside Google's servers knows what they said. If the app record is
ever recreated — which is exactly what the move to the corporate account did to
the App Store side — every one of these has to be answered again from memory.

## The one part with a round trip: Data safety

The console can export the Data safety answers, and the API can write them back:

1. Play Console → App content → Data safety → **export the form responses to a
   CSV**.
2. Commit that CSV next to this file as `data-safety.csv`.
3. It can then be re-applied with `POST .../applications/<package>/dataSafety`,
   whose body carries the CSV contents.

Google documents both halves:
https://support.google.com/googleplay/android-developer/answer/10787469

Not yet done — the CSV has to come out of the console first, and no script here
writes it back until there is a real file to run against.

## What is answered

Read off **App content → Actioned** in the console on 2026-09-04: **10 actioned
declarations, every one last edited 2026-08-31.** The names below are the
console's own, not paraphrases.

There is no export for these, so the answer text has to be copied out by hand —
expand a row in the console, or use its Manage link. A blank cell here means
nobody has copied it yet, not that the declaration is missing. A half-remembered
answer is worse than none: leave the cell empty rather than guess.

| Declaration | Answered as | Last edited |
|---|---|---|
| Health apps | | 2026-08-31 |
| Financial features | | 2026-08-31 |
| Government apps | | 2026-08-31 |
| Advertising ID | | 2026-08-31 |
| Data safety | (exportable — see above) | 2026-08-31 |
| Target audience and content | 만 18세 이상 / 18 and older | 2026-08-31 |
| Content ratings | | 2026-08-31 |
| Sign in details | | 2026-08-31 |
| Ads | | 2026-08-31 |
| Privacy policy | `https://github.com/zkproofport/proofport-app/blob/main/docs/legal/privacy-policy.md` — checked 2026-09-04, reachable without auth (HTTP 200), repo is public | 2026-08-31 |

The target-age and privacy-policy values above are read from the Publishing
overview's own description text, so they are the console's words rather than a
recollection.

**Answered is not submitted.** On 2026-09-04 six of these ten also sat in
"Changes not yet submitted for review" on the Publishing overview — content
ratings, target audience, privacy policy, ads, data safety, health apps. The
`Send app for review` button was greyed with "complete the required steps in the
app dashboard": Play wants a release rolled out on a reviewable track before it
accepts the app for review. Internal testing does not count as one — see the
draft-app note in `.claude/agents/app-dev.md`.

## One answer that depends on the code, and can be made false by a build

The Data safety answers say the app collects nothing. That claim rests on the
OpenStoa mini-app being **unreachable**, not on it being absent — the release
bundle does contain its code, and the feature flag closes the route to it. Ship
a build with the mini-app switched on and the declaration becomes a false
statement to Google.

The switch is pinned by a test that fails if a release path stops saying it
(`theMiniAppShipsSwitchedOff.test.ts`), because absent means ON. See the longer
note in `.claude/agents/app-dev.md`.
