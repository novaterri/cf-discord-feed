# Soft Latte CurseForge -> Discord feed

Every hour it checks CurseForge for **every new inZOI mod and every new file on any inZOI mod** and posts them to one Discord
channel: "New mod: ..." (with its summary, author and logo) or "Update: ..." (with the file, changelog and a link).
That can be dozens of posts a day, so give it its own channel.
Runs free on GitHub Actions. Nothing runs on your PC.

## What you need (one time)
1. **A CurseForge API key** - request one at https://console.curseforge.com (sign in, then apply for an API key).
   Approval can take a while. Keep the key private: it only goes into GitHub as a secret, never in a file.
2. **A Discord webhook** - in Discord: the CF feed channel -> Edit Channel (gear) -> Integrations -> Webhooks -> New Webhook ->
   name it (for example "Soft Latte Updates"), Copy Webhook URL. Keep this URL private too (anyone with it can post there).
3. **A free GitHub account.**

## Setup
1. On GitHub: **New repository**, name `cf-discord-feed`, **Private**, Create.
2. Upload these files (Add file -> Upload files): `check.js`, `config.json`, `state.json`, `README.md`.
   Then the schedule file: Add file -> **Create new file**, type the name `.github/workflows/cf-feed.yml`
   (typing the `/` makes the folders), paste everything from `cf-feed.yml` in this folder, Commit.
3. `config.json` is already set to watch all of inZOI (`"watchGame": { "on": true, "gameSlug": "inzoi" }`). Nothing to fill in.
   (Optional: `"projects"` can list extra single Project IDs, e.g. from another game; leave it empty for inZOI.)
4. Settings -> Secrets and variables -> Actions -> **New repository secret**, twice:
   - `CF_API_KEY` = your CurseForge API key
   - `DISCORD_WEBHOOK_URL` = the webhook URL
5. Actions tab -> "CurseForge to Discord" -> **Run workflow**. The first run only remembers your current files (no spam).
   From then on, each new upload is posted within about an hour.

## Notes
- The first run posts nothing on purpose: it only remembers the last 3 days of files, so the channel isn't flooded.
  Want a test post right away? Set `"postExistingOnFirstRun": true` before the first run (this posts everything from the
  last 3 days, could be a lot), then set it back to false.
- Posts are spaced about 2 seconds apart to stay under Discord's limit.
- GitHub pauses hourly workflows in a repo with no activity for 60 days. If that happens, Actions -> Enable workflow.
- `state.json` is the bot's memory of files it has already seen; it updates itself. Don't edit it.
- Test locally (optional): `node test.js` (no keys needed, uses fake data).
