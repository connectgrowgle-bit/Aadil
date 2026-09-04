# Instagram Outreach Pipeline

A lead-research → personalized-DM → conversation-tracking → call-booking workflow
for 1-on-1 Instagram outreach, with AI assist at every step.

## Why this isn't a "fully automated" bot

Instagram's Terms of Use prohibit scraping profiles and sending bulk/automated DMs,
and Meta's official Messaging API only allows a business to message people who have
already engaged with the account first — there's no compliant way to cold-DM a
stranger you found via search. Tools that do this anyway rely on unofficial APIs or
browser automation tuned to dodge Instagram's bot detection, which is how accounts
get shadow-banned or permanently disabled.

This tool instead automates everything *around* the send: research, ICP scoring,
personalized message drafting, conversation tracking, interest detection, and call
booking — while you click "send" yourself inside Instagram. That keeps your account
safe and keeps outreach genuinely personalized, which converts better than mass
DMs anyway.

## How the workflow maps to the app

1. **Search & shortlist** — you (or a VA) find prospects manually via Instagram
   search/hashtags/competitor followers and add their handle + bio to the pipeline.
2. **Check their profile** — click "AI: Score ICP fit" to have Claude evaluate the
   prospect against your ideal-client profile (configured in Settings).
3. **Send a personalized DM** — click "Draft opener" to generate a personalized
   opener from their bio/niche/notes, copy it, send it in Instagram, then mark it
   "I sent this in Instagram" to log it.
4. **Start a conversation** — paste their replies into "Log their reply"; draft
   follow-ups the same way as the opener.
5. **Pitch the 1-on-1 call** — click "AI: Is this prospect warm?" to have Claude read
   the conversation for buying signals. When warm, draft a call-pitch message and
   grab a tracked Calendly link.
6. **Book the appointment** — the Calendly link is tagged with the prospect's ID.
   Point a Calendly webhook (`invitee.created`) at `/api/calendly/webhook` and a
   booking automatically moves the prospect to "Call Booked".

## Project structure

```
server/   Express + SQLite API (prospects, messages, drafts, settings, Calendly webhook)
client/   React (Vite) dashboard — pipeline board + prospect detail + settings
```

## Setup

### 1. Backend

```bash
cd server
cp .env.example .env   # add your ANTHROPIC_API_KEY and CALENDLY_WEBHOOK_SECRET
npm install
npm run dev             # http://localhost:4000
```

### 2. Frontend

```bash
cd client
npm install
npm run dev              # http://localhost:5173, proxies /api to :4000
```

### 3. Settings

Open the app → **Settings** and fill in:
- Your ideal client profile (be specific — this drives AI scoring and drafting)
- What you offer
- Your DM tone
- Your Calendly link

### 4. Calendly webhook (optional, for auto-detecting bookings)

Register a webhook subscription for the `invitee.created` event pointing at:

```
https://<your-deployed-host>/api/calendly/webhook?secret=<CALENDLY_WEBHOOK_SECRET>
```

using the same secret you set in `server/.env`.

## Notes

- All AI features (ICP scoring, DM drafting, interest analysis) call the Anthropic
  API server-side using `ANTHROPIC_API_KEY` — never exposed to the browser.
- The SQLite database lives at `server/data/outreach.db` by default (configurable
  via `DB_PATH`); back it up like you would any client data.
