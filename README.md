# Hourglass — Hourly Journal

A journaling PWA that pings you once an hour, and asks three things:

1. **Energy level** (1–10)
2. **Actions** you did in the last hour, picked from an editable list — each action
   carries points you assign (positive or negative), and shows its current streak
3. **To-dos** — a separate one-time checklist, unrelated to the hourly repeat actions

History is a calendar: click any day to see total points and average energy for
that day, plus the hour-by-hour log.

Everything you log is stored **locally on the device** (IndexedDB) — there's no
account and no server database of your journal content. The only thing that
touches a server is the hourly push notification (explained below).

---

## 1. Read this first: how the hourly notification actually works

Browsers (and the Android wrapper you'll build with PWABuilder) do **not** allow
a web app to run a background timer once it's closed. The only reliable way to
notify you on a schedule when the app isn't open is **Web Push**: a server sends
a push message, and the OS wakes the service worker to show the notification.

So this project ships with a small serverless piece:

- A **Netlify Scheduled Function** (`netlify/functions/notify-scheduled.mjs`)
  runs automatically once an hour (`@hourly`) and sends a push notification to
  every device that has notifications enabled and whose configured time window
  covers the current hour.
- Subscriptions are stored in **Netlify Blobs** (no separate database to set up).
- Your journal *content* never goes through this — only the push subscription
  and your chosen reminder window (e.g. 08:00–22:00) are stored server-side.

Two honest caveats:
- Netlify's scheduled functions run on their own clock and aren't guaranteed to
  fire at exactly :00 — expect it to land within a couple of minutes of the hour.
- Android's battery optimization can delay push delivery on some devices/OEMs
  if the app has been unused for a long time. Excluding the app from battery
  optimization after install helps.

If you'd rather not run a server piece at all, you can skip the push setup —
the app still works fully as a manual journal, you'd just open it yourself
each hour instead of being reminded.

---

## 2. Project structure

```
index.html, style.css, app.js, db.js   → the PWA itself
manifest.json, sw.js, icons/           → installability + service worker
netlify/functions/
  vapid-public-key.mjs                 → gives the client the public VAPID key
  subscribe.mjs                        → saves/removes a device's push subscription
  notify-scheduled.mjs                 → cron (@hourly): sends the push notifications
package.json, netlify.toml             → Netlify build & function config
```

## 3. Deploy to Netlify

1. Push this folder to a GitHub repo (or drag-and-drop deploy it directly on
   [app.netlify.com](https://app.netlify.com) — "Deploy manually").
2. In Netlify: **Add new site → Import an existing project**, pick the repo.
   Build settings can stay empty — this is a static site (`publish = "."`),
   Netlify will detect the functions automatically from `netlify.toml`.
3. Generate a VAPID key pair (needed once, for web push):
   ```
   npx web-push generate-vapid-keys
   ```
4. In **Site settings → Environment variables**, add:
   - `VAPID_PUBLIC_KEY`
   - `VAPID_PRIVATE_KEY`
   - `VAPID_CONTACT_EMAIL` (e.g. `mailto:you@yourdomain.com`)
5. Deploy. Visit your `https://your-site.netlify.app` — install it (Chrome will
   offer "Install app"), open **Settings (⏰ icon) → turn on hourly reminders**,
   pick your window, and grant the notification permission when prompted.

That's it — the scheduled function will start firing every hour.

## 4. Wrap it as an Android app with PWABuilder

1. Go to [pwabuilder.com](https://www.pwabuilder.com) and enter your deployed
   Netlify URL.
2. PWABuilder will read your `manifest.json` and audit the PWA. It should score
   well out of the box (icons, manifest, service worker are all included).
3. Click **Package for stores → Android**. Keep the default **Trusted Web
   Activity (TWA)** option — this launches your Netlify site full-screen inside
   a thin native shell, which is what lets it be installed like a normal app
   and receive push notifications the same way the installed PWA does.
4. Download the generated Android package, open it in Android Studio (or use
   the signing key PWABuilder generates) to produce a signed `.apk` / `.aab`
   for sideloading or a Play Store upload.
5. Push notifications continue to work the same way after wrapping — TWA uses
   Chrome's push implementation under the hood, so no extra native code is
   needed. The same VAPID setup from step 3 above is all that's required.

## 5. Local development

You can run this as a plain static site (e.g. `npx serve .` or the Netlify CLI
`netlify dev`, which also runs the functions locally so you can test push).
Without `netlify dev`, the app still works for logging entries — only the
"enable hourly reminders" button will show a setup error, since there's no
`/api/...` function running.

## 6. How streaks & points work

- Each **action** has points you assign when creating it (e.g. `Deep work: +2`,
  `Doom-scrolled: -1`).
- A day's **total points** = sum of points of every action selected across
  that day's hourly entries.
- An action's **streak** = number of consecutive days (counting back from
  today, or from yesterday if today isn't over yet) in which that action was
  selected at least once in any hourly entry.
- **To-dos** are separate: one-off items with no points or streak, just done/not done.

## 7. Known limitations / things you may want to extend

- Single-user, no login — data lives on-device; the only server-side data is
  push subscriptions.
- No cross-device sync of journal entries (by design, for privacy/simplicity).
  Push subscriptions are per-device.
- Editing an action's points changes how *future* calendar totals for entries
  using that action are computed (past entries keep their action selections
  but points are looked up live, not frozen at log time).
