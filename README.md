# Personal Hub: setup guide

Your personal app for **purchase planning (Essentials & Lifestyle), expenses, bills, vehicles and notes**, with a dashboard.
It installs on your computer and your Galaxy S23, works offline, keeps its data in your own Google Drive, and puts bill reminders in your Google Calendar.

**Time needed:** about 20 minutes, once. **Cost:** free.

You can try the app before any setup: unzip the folder and double-click `index.html`.
It works fully on that computer, except Google Drive sync, which starts after the steps below.

---

## Step 1: Put the app online with GitHub Pages

GitHub Pages gives the app a web address so both devices can open and install it.

1. Go to **github.com** and create a free account (or sign in).
2. Click **+** (top right) → **New repository**.
   - Repository name: `personal-hub`
   - Choose **Public** (free Pages needs this; only the app's code is public, never your data)
   - Click **Create repository**.
3. On the new repository page, click **uploading an existing file**.
4. Drag in **everything** from the unzipped `personal-hub` folder, including the `icons` folder. Click **Commit changes**.
5. Go to **Settings** → **Pages** (left menu).
   - Source: **Deploy from a branch**
   - Branch: **main**, folder **/ (root)** → **Save**.
6. Wait 1–2 minutes and refresh. The page shows your address, e.g.
   `https://YOUR-USERNAME.github.io/personal-hub/`

Note down two things:
- **App address:** `https://YOUR-USERNAME.github.io/personal-hub/`
- **Origin:** `https://YOUR-USERNAME.github.io` (no `/personal-hub`, no slash at the end)

---

## Step 2: Allow the app to use your Google Drive (Google Cloud)

Use the **same Google account** whose Drive should hold your data. Google renames menu items now and then, so labels may differ slightly.

1. Open **console.cloud.google.com** and sign in.
2. Top bar → project picker → **New project** → name it `Personal Hub` → **Create**. Make sure it is selected.
3. Menu ☰ → **APIs & Services** → **Library** → search **Google Drive API** → **Enable**.
   Go back to **Library**, search **Google Calendar API** → **Enable** (this is for bill reminders).
4. Menu ☰ → **APIs & Services** → **OAuth consent screen** (also called **Google Auth Platform**) → **Get started**:
   - App name: `Personal Hub`, support email: your email
   - Audience: **External**
   - Contact email: your email → agree → **Create**.
5. Go to **Audience** → under **Test users** click **Add users** → add your Gmail address → **Save**.
   Leave the app in **Testing**. That keeps it private to you.
6. Go to **Clients** (or **Credentials** → **Create credentials** → **OAuth client ID**):
   - Application type: **Web application**, name: `Personal Hub web`
   - **Authorised JavaScript origins** → **Add URI** → paste your **origin** from Step 1
     (e.g. `https://YOUR-USERNAME.github.io`)
   - **Create**, then copy the **Client ID** (ends in `.apps.googleusercontent.com`). You don't need the client secret.

---

## Step 3: Add the Client ID to the app

1. In your GitHub repository, click **config.js** → the **pencil** icon (Edit).
2. Replace `PASTE_YOUR_CLIENT_ID_HERE` with your Client ID, keeping the quotes:
   ```js
   GOOGLE_CLIENT_ID: "1234567890-abc123.apps.googleusercontent.com",
   ```
3. Click **Commit changes**. Wait about a minute for the site to update.

---

## Step 4: Install on your computer

1. Open your **app address** in **Chrome** or **Edge**.
2. Tap **Connect Drive** (top right) → choose your Google account.
3. Google will say **"Google hasn't verified this app"**. That's expected, because it is your own private app. Click **Continue**.
   On the next screen, **tick both boxes** (Drive files and Calendar events) and continue.
4. The button turns to **● Synced**. Your Drive now has a folder **Personal Hub** with `personal-hub-data.json`.
5. To install: click the **install icon** at the right end of the address bar (or ⋮ → **Install Personal Hub**).

## Step 5: Install on your Galaxy S23

1. Open your **app address** in **Chrome** on the phone.
2. Tap ⋮ → **Add to Home screen** → **Install**.
3. Open **Hub** from the home screen → tap **Connect Drive** → sign in with the same Google account.
4. Everything you added on the computer appears on the phone, and the other way round.

---

## Bill reminders

- When you add or edit a bill, pick **Remind me** (on the due date, 1, 2, 3, 5 days or a week before). The default is 2 days before.
- Each bill becomes a repeating **9:00 AM event in your Google Calendar** named *Bill due: …*. You get a notification on the reminder day and again on the due date, on your phone and your computer, even when Personal Hub is closed.
- Editing or deleting a bill updates or removes its calendar event automatically. Marking a bill paid does not change the event, since it already repeats.
- On your S23, make sure notifications are on for the **Google Calendar** app (Settings → Notifications → Calendar).
- Inside the app, the **Bills** tab shows a red count for bills that are overdue or due within 2 days.
- Reminders are created the next time the app syncs, so a bill added offline gets its reminder once you're back online.

## Vehicles

The **Vehicles** tab tracks your car and two-wheeler.

- **Add a vehicle** with the **+** button: name, type (car or two-wheeler), registration number and current km. You can also enter the last service and alignment (date and km) and the PUC and insurance expiry dates. Leave blank anything you don't know and fill it in later.
- **Items tracked:**

  | Item | Car | Two-wheeler | Due by |
  |---|---|---|---|
  | General service | 10,000 km or 12 months | 3,000 km or 3 months | whichever comes first |
  | Wheel alignment | 5,000 km or 6 months | not tracked | whichever comes first |
  | PUC certificate | expiry date | expiry date | date |
  | Insurance | expiry date | expiry date | date |

  These intervals are common starting points. Tap any item to change them to match your owner's manual. **+ Add item** adds your own, such as tyre rotation or battery check.
- **Update km** every few weeks. The app learns how much you drive and estimates the date you'll reach the km limit (shown as "About 25 Nov"). If a reading is over a month old, it asks you to update it.
- **Done / Renewed:** enter the date, km reading and cost. The cost goes to Expenses under *Vehicle*, the next due date is worked out, and the entry is saved in the vehicle's **History**.
- **Reminders:** each item gets a 9:00 AM Google Calendar event on its due date, with a notification 1 to 4 weeks before (your choice per item). The event moves automatically when you update km or mark an item done.
- **Dashboard:** the **Vehicle due dates** card lists every service, PUC and insurance date across your vehicles, most urgent first. It is separate from bills.

## Good to know

- **Offline:** everything saves on the device first. It syncs when you're online.
- **"Tap to sync":** Google sign-in lasts about an hour. After that the button shows *Tap to sync*, and one tap reconnects (usually no password). Nothing is lost while it waits.
- **Both devices edited:** changes are merged item by item. If the *same* item was edited on both, the most recent edit wins.
- **Your data:** stored only on your devices and in your Drive (`Personal Hub/personal-hub-data.json`). The app can only see files it created, not the rest of your Drive.
- **Backups:** Settings (⚙) → **Download backup** saves a copy. **Restore from backup** merges it back in. **Expenses CSV** opens in Google Sheets or Excel.
- **Turning it off:** Settings → **Disconnect**. To remove access completely: myaccount.google.com → Security → Third-party connections → Personal Hub → Remove.

### If something doesn't work

| Problem | Fix |
|---|---|
| "Google sign-in is not set up yet" | The Client ID in `config.js` is missing or mistyped (Step 3). |
| Error `redirect_uri_mismatch` / `origin_mismatch` | The origin in Step 2.6 must be exactly `https://YOUR-USERNAME.github.io`, with no path and no slash at the end. |
| "Access blocked" / "app is in testing" | Add your Gmail under **Test users** (Step 2.5). |
| Phone shows an old version after an update | Close the app fully and reopen it. If you change the code later, raise the version in `sw.js` (`personal-hub-v1` → `v2`). |
| Sign-in popup doesn't appear | Allow pop-ups for your app address in the browser. |
| Settings shows "Google Calendar access is missing" | Tap **Allow Calendar** and tick the Calendar box. Also check the Google Calendar API is enabled (Step 2.3). |
| No reminder notifications on the phone | Open Google Calendar and check the *Bill due* events are there, then turn on notifications for the Calendar app. |

---

## What's inside

| File | What it does |
|---|---|
| `index.html`, `styles.css`, `app.js` | The app |
| `config.js` | Your Google Client ID |
| `manifest.webmanifest`, `sw.js`, `icons/` | Installing and offline use |
