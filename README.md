# Juzni Vetar Raids

Every 30 minutes this repo pulls the guild's Raid-Helper events from Discord and
publishes them on a small page with one **Copy all raids** button.
Paste that in game: `/gr` → **Import** → **Ctrl+V** → **Import**.

## One-time setup (about 10 minutes)

1. **Create the repo**: on GitHub, click **New repository**, name it `juzni-vetar-raids`,
   choose **Public**, and create it. Pages is free on public repos; the page only shows raid
   titles, times and Discord names.
2. **Upload the files**: on the empty repo page, click **uploading an existing file**,
   drag in everything from this folder (including the `.github` folder), and **Commit changes**.
   If the `.github` folder didn't come along, see "Workflow missing" below.
3. **Add the Raid-Helper key**: **Settings → Secrets and variables → Actions → New repository secret**
   - Name `RH_API_KEY`, value: the key from `/apikey` (a Discord server admin runs it).
4. **Optional, Discord ping for new raids**: in Discord, open an officer channel's
   **Settings → Integrations → Webhooks → New Webhook → Copy Webhook URL**, then add another
   secret named `DISCORD_WEBHOOK` with that URL.
5. **Turn on the page**: **Settings → Pages → Build and deployment → Source: Deploy from a branch**,
   branch **main**, folder **/docs**, **Save**. Your page will be at
   `https://<your-username>.github.io/juzni-vetar-raids/`. Bookmark it.
6. **First run**: **Actions** tab → **Update raids** → **Run workflow**. After about a minute
   the page shows your raids. From then on it updates by itself every 30 minutes.

## Day to day

- Open the bookmark → **Copy all raids** → in game `/gr` → **Import** → **Ctrl+V** → **Import**.
- Need it right now? Click **Update now** at the bottom of the page, then **Run workflow**.

## No API key yet?

Paste Raid-Helper message links (right-click the post → **Copy Message Link**) into
`events.txt`, one per line, and commit. Those raids show up without a key.

## Workflow missing

If the **Actions** tab has no "Update raids" workflow, the `.github` folder didn't upload.
Click **Add file → Create new file**, type `.github/workflows/update.yml` as the name,
paste the contents of that file from this folder, and commit.

## Settings

| Where | Name | What |
|---|---|---|
| Secret | `RH_API_KEY` | Raid-Helper server key (`/apikey`) |
| Secret | `DISCORD_WEBHOOK` | Optional: posts "new raid ready" in Discord |
| Variable | `RH_SERVER_ID` | Optional: Discord server ID, defaults to Juzni Vetar's |

GitHub turns off scheduled runs if a repo has no activity for 60 days; the bot's own
updates count as activity, so this only happens if there are no raids for two months.
Re-enable it from the Actions tab if needed.
