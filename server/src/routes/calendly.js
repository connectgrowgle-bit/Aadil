import { Router } from 'express';
import { db } from '../db.js';

export const router = Router();

// Register this URL as a Calendly webhook subscription (invitee.created event) at
// https://<host>/api/calendly/webhook?secret=<CALENDLY_WEBHOOK_SECRET>.
//
// To match a booking back to a prospect, append `?utm_content=prospect-<id>` to the
// Calendly link you hand out (the dashboard's "Copy booking link" button does this
// for you) — Calendly echoes utm_content back in payload.tracking.utm_content.
router.post('/webhook', (req, res) => {
  if (req.query.secret !== process.env.CALENDLY_WEBHOOK_SECRET) {
    return res.status(401).json({ error: 'Invalid webhook secret' });
  }

  const event = req.body?.event;
  if (event !== 'invitee.created') {
    return res.status(200).json({ ok: true, ignored: event || 'unknown event' });
  }

  const utmContent = req.body?.payload?.tracking?.utm_content || '';
  const match = utmContent.match(/^prospect-(\d+)$/);
  if (!match) {
    return res.status(200).json({ ok: true, warning: 'No matching prospect in utm_content' });
  }

  const prospectId = Number(match[1]);
  const info = db
    .prepare(
      "UPDATE prospects SET stage = 'call_booked', call_booked_at = datetime('now'), updated_at = datetime('now') WHERE id = ?"
    )
    .run(prospectId);

  res.status(200).json({ ok: true, updated: info.changes > 0 });
});
