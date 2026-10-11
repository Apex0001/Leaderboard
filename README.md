# Proud Chitkarians — LeetCode Leaderboard

A premium dark-themed leaderboard built with **plain HTML, CSS, and vanilla JavaScript**, plus a small Node.js/Express backend to fetch public LeetCode profile data. No React, Vite, database, or API key is needed.

## Features
- Top-three podium with profile pictures and gold/silver/bronze accents
- Full rankings table with solved count, relative progress bar, and profile link
- Clicking a participant's name or avatar opens their LeetCode profile
- Search participants by name or username (press `/` to focus search, Escape to clear)
- Automatically reranks participants when new profile counts are fetched
- Refresh button and automatic refresh every 15 minutes
- Server-side 15-minute cache and up to four concurrent profile lookups
- Missing/blocked profiles are shown as unavailable, never as a fake zero
- Uses all 66 participants from the supplied CSV

## Requirements
Node.js 18 or newer (Node 20+ recommended).

## Run locally
1. Extract the ZIP.
2. Open a terminal inside the project folder.
3. Install the one backend dependency and start the server:

```bash
npm install
npm start
```

4. Open **http://localhost:3001** in your browser.

For automatic server restart during development, run `npm run dev` instead.

## Live data limitations
The backend queries LeetCode's public GraphQL endpoint, which is not a guaranteed public API and can be throttled or blocked. If LeetCode refuses a request, that participant will show as unavailable until a later refresh. Profile pictures are loaded when LeetCode returns an avatar URL; otherwise the site displays initials. Counts refresh every 15 minutes, not second-by-second.

## Project layout
- `public/index.html` — page structure
- `public/styles.css` — responsive premium dark theme
- `public/app.js` — rendering, search, refresh, and rankings UI
- `server/index.js` — Express server and LeetCode data fetcher
- `server/participants.json` — names and profile URLs imported from the CSV


### Ranking rules

Ranks are always unique. Participants are sorted by total accepted problems (descending), then Medium problems solved (descending), then Hard problems solved (descending). If all three counts are equal, names are sorted alphabetically for a stable order. Profiles whose total count cannot be fetched are shown as unavailable and receive no rank.


## Admin: add and delete participants

The public can view the leaderboard, but participant changes require the admin password. Click **Manage accounts**, then use **Add participant** or **Delete**. The password is sent only with the protected HTTPS request and checked on the server; it is not stored in browser code or committed to this project. Incorrect attempts are rate-limited per IP.

### Configure the admin password

Set `ADMIN_PASSWORD` in the hosting provider's **environment variables / secrets** panel. For the password you specified during setup, set the value there to `010903` (do not put it into `public/app.js`, HTML, or a committed file). Because this is a short numeric password on a public site, a longer, unique password is strongly recommended before launch.

For local PowerShell testing:

```powershell
$env:ADMIN_PASSWORD = "choose-a-long-unique-password"
npm start
```

For macOS/Linux:

```bash
ADMIN_PASSWORD="choose-a-long-unique-password" npm start
```

If `ADMIN_PASSWORD` is missing, public leaderboard viewing still works but add/delete requests are disabled.

### Deploying (example: Render)

- Create a **Web Service** from this project repository.
- Build command: `npm install`
- Start command: `npm start`
- Add environment variable `ADMIN_PASSWORD` in the service dashboard. Set `NODE_ENV=production` if your host doesn't set it automatically.
- Add a **persistent disk** mounted at `/var/data`, then set `DATA_DIR=/var/data`. This is important: without persistent storage, account additions/deletions stored in the JSON file can be lost on redeploy or restart on hosts with ephemeral filesystems.
- Use HTTPS and do not expose the environment variables in logs or frontend files.

The current JSON-file approach is suitable for a single running service with a persistent disk. If you later run multiple instances or need stronger write concurrency, move participant storage to a database.
