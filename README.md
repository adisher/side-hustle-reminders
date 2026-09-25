# 45-Day Challenge reminders

A single Vercel serverless function (`api/remind.js`) that emails you the day's three challenge tasks (Physical, Mindset, Business) at fixed times in Pakistan time (PKT, UTC+5). Mail goes out over Gmail SMTP via `nodemailer`. Task data lives in `data/tasks.json`. There is no database, no framework and no build step.

A GitHub Action calls the endpoint every hour. The endpoint only sends when the current PKT hour matches one of the `reminder_hours`, so every other call is a cheap no-op. A daily Vercel cron (03:00 UTC, which is 08:00 PKT) acts as a backup in case the Action is delayed or disabled.

## Setup

1. **Push to GitHub.** Commit this repo and push it to a GitHub repository.

2. **Create a Gmail App Password.**
   - 2-Step Verification must be enabled on the Google account.
   - Go to <https://myaccount.google.com/apppasswords>, create one (name it anything), and copy the 16-character password.
   - `MAIL_FROM` must equal `SMTP_USER` (the Gmail address). If it does not, Gmail rewrites the sender to your account address anyway.

3. **Import into Vercel.** New Project, pick the repo, set Framework Preset to **Other**, and leave the build command and output directory empty.

4. **Add environment variables** (Project Settings, Environment Variables), then **redeploy** so they take effect:

   | Name          | Value                                             |
   | ------------- | ------------------------------------------------- |
   | `SMTP_USER`   | your Gmail address                                |
   | `SMTP_PASS`   | the App Password from step 2                      |
   | `MAIL_FROM`   | same as `SMTP_USER`                               |
   | `MAIL_TO`     | where reminders should arrive                     |
   | `CRON_SECRET` | a long random string, e.g. `openssl rand -hex 32` |

   Optional: `SMTP_HOST` (default `smtp.gmail.com`) and `SMTP_PORT` (default `587`, STARTTLS).

   Vercel's own cron automatically sends `Authorization: Bearer $CRON_SECRET`, so the backup cron passes the auth guard with no extra config.

5. **Test a send.** `force=1` skips the hour check and uses the label "Manual send":

   ```sh
   curl -H "Authorization: Bearer <secret>" "https://<project>.vercel.app/api/remind?force=1"
   ```

   Expected: `{"sent":true,"day":1,"slot":"Manual send","hour":...}`. If today's date has no entry you get `{"sent":false,"reason":"no tasks for YYYY-MM-DD"}`. A `502` carries the SMTP error message (usually a wrong App Password).

6. **Add repo secrets** (GitHub repo, Settings, Secrets and variables, Actions):
   - `CRON_SECRET`: same value as in Vercel.
   - `REMIND_URL`: `https://<project>.vercel.app/api/remind`

7. **Trigger the Action manually** (Actions tab, "Hourly reminder", Run workflow). The log prints the HTTP code and body. Outside a reminder hour you will see `{"sent":false,"reason":"not a reminder hour",...}`, which is a pass.

## Endpoint reference

`GET /api/remind`

- Auth: `Authorization: Bearer <secret>` or `?key=<secret>`. Required whenever `CRON_SECRET` is set.
- `?force=1`: send now regardless of hour.

| Status | Body                                                        |
| ------ | ----------------------------------------------------------- |
| 200    | `{"sent":true,"day":n,"slot":"<label>","hour":h}`           |
| 200    | `{"sent":false,"reason":"no tasks for <date>"}`             |
| 200    | `{"sent":false,"reason":"not a reminder hour","hour":h}`    |
| 401    | `{"error":"unauthorized"}`                                  |
| 502    | `{"sent":false,"error":"<message>"}`                        |

## Adding later days

Add entries to the `days` object in `data/tasks.json`, keyed by the PKT calendar date in `YYYY-MM-DD` form:

```json
"2026-10-02": {
  "day": 8, "week": 2, "phase": "Foundations",
  "physical": "...",
  "mindset": "...",
  "business": "..."
}
```

Day 1 is 2026-09-25, so day `n` falls on 2026-09-25 plus `n - 1` days and day 45 is 2026-11-08. Commit and push; Vercel redeploys automatically. Task strings are inserted into the email HTML as-is, so plain text or simple inline HTML both work. Dates with no entry are skipped silently.

## Changing reminder times

Edit `reminder_hours` in `data/tasks.json`. Each entry is a PKT hour (0 to 23) and the label shown in the subject and email header:

```json
{ "hour": 8, "label": "Today's tasks" }
```

The Action runs every hour, so any whole hour works with no workflow change. GitHub scheduled runs can start a few minutes late, which is fine because the handler only checks the hour.

If you move to another timezone, change `timezone_offset_hours` (whole hours only; no DST handling). If you drop the 08:00 slot, also move the Vercel backup cron in `vercel.json` to a slot you keep (UTC hour = PKT hour minus 5). The Hobby plan allows only one run per day, so never make that cron hourly or the deploy is rejected.

Note: the 08:00 PKT slot can be hit by both the Action and the Vercel backup cron, so on some days you may get that one twice. That is the cost of having a backup without a store to de-duplicate.
