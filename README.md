# TweetXer Improved – eXterminate your Tweets

An enhanced fork of [Luca Hammer's TweetXer](https://github.com/lucahammer/tweetXer) for deleting **all** of your Tweets (and Likes, DMs, follows) for free using your Twitter/X data export — even Tweets that no longer show up on your profile.

> ⚠️ Because this automates deletion, it may get your account locked or banned. Use at your own risk, and never run a script like this from a source you don't trust.

## What's improved in this fork

- **Redesigned control panel.** A self-contained, dark "glass" panel that matches X's look instead of the old light-blue bar. It's **draggable**, **minimizable**, and **responsive** (works on mobile). All styles are scoped to the panel, so it no longer leaks CSS into the host X page.
- **Drag-and-drop file picker** with a clear dropzone (click still works too).
- **Live progress bar** showing percentage, a running **rate** (per second/minute), and an **ETA**.
- **Auto-pause** — automatically pause for a set duration after every N deletions to avoid rate limits and account locks. Defaults to **15 minutes after every 190 deletions**, both configurable.
- **Spare by likes** — keep Tweets that have more than a chosen number of likes. Reads counts instantly from `tweets.js`, or optionally fetches each Tweet's **live** like count from X (works with `tweet-headers.js` too, at the cost of one extra request per Tweet).
- **Spare recent days** — keep the most recent N days of Tweets. The date is decoded from each Tweet's ID, so it works with any tweet file.

All the other original capabilities (bookmark export, slow delete without a file, DM deletion, skip/resume) are still here.

## Usage

0. [Request](https://x.com/settings/your_twitter_data/data) your Data Export (takes several days), download it, and unzip it.
1. Log into your Twitter/X account in a desktop browser.
2. Open the browser console (`F12` or `Cmd+Option+I`).
3. Paste the whole contents of `tweetXer.js` into the console and press Enter.
   - If your browser blocks pasting, type `allow pasting` and press Enter first.
4. The TweetXer panel appears at the top of the page.
5. Drag in (or click to select) your `tweet-headers.js` file from the export.
6. Wait for your Tweets to vanish. Watch progress, rate, and ETA in the panel.

If the process is interrupted, you can resume: open **Advanced options** and set how many items to **skip**. The script also auto-detects already-deleted Tweets by comparing the file count to your profile count (with a 5% buffer). Enter `1` to force a start from the beginning.

## Advanced options

Open **Advanced options** in the panel to configure:

| Option | What it does |
| --- | --- |
| **Skip the oldest N items** | Skip the first N items (for resuming). Empty = auto-detect. |
| **Spare tweets with more than N likes** | Keep popular Tweets. Uses counts from `tweets.js`, or enable live fetching below. |
| **Fetch live like counts from X** | Look up each Tweet's current like count via the API right before deleting it. Works with `tweet-headers.js`; adds one request per Tweet. |
| **Spare tweets from the last N days** | Keep your most recent Tweets (e.g. last 30 days). |
| **Pause after every N deletions** | Auto-pause cadence. Default `190`. Set `0` to disable. |
| **Pause duration (minutes)** | How long each auto-pause lasts. Default `15`. |
| **Export bookmarks** | Export bookmarks (not included in the official data export). |
| **Slow delete without file** | Delete directly from your profile if you have no export (much slower). Only deletes Tweets authored by your account, and honors the like threshold by reading each Tweet's count straight from the UI — no extra requests. |

## Supported files

- `tweet-headers.js` — delete Tweets (≈10,000–20,000 / hour)
- `tweets.js` — delete Tweets **and** enables the "spare by likes" filter
- `direct-message-headers.js` and `direct-message-group-headers.js` — delete DMs (≈800 / 15 min)
- `like.js` — remove Likes (≈500 / 15 min; only the most recent few thousand)

## Alternative: userscript

Instead of pasting into the console, you can run `tweetXer.js` as a userscript with [Violentmonkey](https://addons.mozilla.org/firefox/addon/violentmonkey/), [FireMonkey](https://addons.mozilla.org/firefox/addon/firemonkey/), or [Tampermonkey](https://addons.mozilla.org/firefox/addon/tampermonkey/). This also works on mobile (Firefox + Tampermonkey on Android, or the Userscripts Safari extension on iOS).

## How it works

The script intercepts your browser's requests to X and swaps in Tweet IDs from your data export, which lets it reach and delete old Tweets that aren't visible on your profile.

- XHR interception inspired by [ttodua/Tamper-Request-Javascript-Tool](https://github.com/ttodua/Tamper-Request-Javascript-Tool)
- Faster deletion inspired by [Lyfhael/DeleteTweets](https://github.com/Lyfhael/DeleteTweets)

## Known issues

- **Not all Tweets removed.** The script can only delete IDs present in your file. Re-run, or request a fresh export. Remaining "ghost" Tweets are often Retweets of accounts that were deactivated/banned.
- **Likes aren't fully removed.** X only allows unliking the most recent few hundred.
- **Browser crashes** are more common in Chrome, especially past ~15k Tweets. Closing the console while it runs helps.
- **Profile count still shows Tweets but none are visible.** Usually Retweets of banned/deactivated accounts — nothing you can do.

## Credits & license

Original project by **Luca Hammer** and contributors (Luca, dbort, pReya, Micolithe, STrRedWolf). Licensed under the **NoHarm (draft)** license, inherited from the upstream project. This fork keeps the same license and credits.

Support the original author: [buymeacoffee.com/lucahammer](https://www.buymeacoffee.com/lucahammer)
