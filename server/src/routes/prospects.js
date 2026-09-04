import { Router } from 'express';
import { db, STAGES, getSetting } from '../db.js';
import { scoreProspect, draftMessage, analyzeInterest } from '../claude.js';

export const router = Router();

function getProspectOr404(req, res) {
  const prospect = db.prepare('SELECT * FROM prospects WHERE id = ?').get(req.params.id);
  if (!prospect) {
    res.status(404).json({ error: 'Prospect not found' });
    return null;
  }
  return prospect;
}

function getHistory(prospectId) {
  return db
    .prepare('SELECT * FROM messages WHERE prospect_id = ? ORDER BY id ASC')
    .all(prospectId);
}

// List prospects, optionally filtered by stage.
router.get('/', (req, res) => {
  const { stage } = req.query;
  const rows = stage
    ? db.prepare('SELECT * FROM prospects WHERE stage = ? ORDER BY updated_at DESC').all(stage)
    : db.prepare('SELECT * FROM prospects ORDER BY updated_at DESC').all();
  res.json(rows);
});

router.get('/stages', (_req, res) => res.json(STAGES));

router.post('/', (req, res) => {
  const { handle, name, bio, niche, notes } = req.body;
  if (!handle || typeof handle !== 'string') {
    return res.status(400).json({ error: 'handle is required' });
  }
  const cleanHandle = handle.replace(/^@/, '').trim().toLowerCase();
  try {
    const info = db
      .prepare(
        `INSERT INTO prospects (handle, name, bio, niche, notes)
         VALUES (?, ?, ?, ?, ?)`
      )
      .run(cleanHandle, name || null, bio || null, niche || null, notes || null);
    const prospect = db.prepare('SELECT * FROM prospects WHERE id = ?').get(info.lastInsertRowid);
    res.status(201).json(prospect);
  } catch (err) {
    if (String(err.message).includes('UNIQUE')) {
      return res.status(409).json({ error: `@${cleanHandle} is already in your pipeline` });
    }
    res.status(500).json({ error: err.message });
  }
});

router.get('/:id', (req, res) => {
  const prospect = getProspectOr404(req, res);
  if (!prospect) return;
  const messages = getHistory(prospect.id);
  const drafts = db
    .prepare('SELECT * FROM drafts WHERE prospect_id = ? ORDER BY id DESC')
    .all(prospect.id);
  res.json({ ...prospect, messages, drafts });
});

const PATCHABLE = ['name', 'bio', 'niche', 'notes', 'stage'];

router.patch('/:id', (req, res) => {
  const prospect = getProspectOr404(req, res);
  if (!prospect) return;

  const updates = {};
  for (const key of PATCHABLE) {
    if (key in req.body) updates[key] = req.body[key];
  }
  if (updates.stage && !STAGES.includes(updates.stage)) {
    return res.status(400).json({ error: `stage must be one of: ${STAGES.join(', ')}` });
  }
  if (Object.keys(updates).length === 0) {
    return res.status(400).json({ error: 'No valid fields to update' });
  }

  const setClause = Object.keys(updates)
    .map((k) => `${k} = @${k}`)
    .join(', ');
  db.prepare(`UPDATE prospects SET ${setClause}, updated_at = datetime('now') WHERE id = @id`).run({
    ...updates,
    id: prospect.id,
  });

  res.json(db.prepare('SELECT * FROM prospects WHERE id = ?').get(prospect.id));
});

router.delete('/:id', (req, res) => {
  const prospect = getProspectOr404(req, res);
  if (!prospect) return;
  db.prepare('DELETE FROM prospects WHERE id = ?').run(prospect.id);
  res.status(204).end();
});

// --- Messages (manual conversation log) ---

router.get('/:id/messages', (req, res) => {
  const prospect = getProspectOr404(req, res);
  if (!prospect) return;
  res.json(getHistory(prospect.id));
});

router.post('/:id/messages', (req, res) => {
  const prospect = getProspectOr404(req, res);
  if (!prospect) return;
  const { direction, content } = req.body;
  if (!['outbound', 'inbound'].includes(direction) || !content) {
    return res.status(400).json({ error: 'direction (outbound|inbound) and content are required' });
  }
  const info = db
    .prepare('INSERT INTO messages (prospect_id, direction, content) VALUES (?, ?, ?)')
    .run(prospect.id, direction, content);

  // First outbound message logged moves a fresh prospect into dm_sent automatically.
  if (direction === 'outbound' && prospect.stage === 'new') {
    db.prepare("UPDATE prospects SET stage = 'dm_sent', updated_at = datetime('now') WHERE id = ?").run(
      prospect.id
    );
  }
  if (direction === 'inbound' && ['new', 'dm_sent'].includes(prospect.stage)) {
    db.prepare("UPDATE prospects SET stage = 'replying', updated_at = datetime('now') WHERE id = ?").run(
      prospect.id
    );
  }

  res.status(201).json(db.prepare('SELECT * FROM messages WHERE id = ?').get(info.lastInsertRowid));
});

// --- AI: ICP scoring ---

router.post('/:id/score', async (req, res) => {
  const prospect = getProspectOr404(req, res);
  if (!prospect) return;
  try {
    const icpDescription = getSetting('icp_description');
    const offerDescription = getSetting('offer_description');
    const result = await scoreProspect({ icpDescription, offerDescription, prospect });
    db.prepare(
      `UPDATE prospects SET icp_score = ?, icp_reasoning = ?, stage = CASE WHEN stage = 'new' THEN 'researched' ELSE stage END, updated_at = datetime('now') WHERE id = ?`
    ).run(result.score, result.reasoning, prospect.id);
    res.json(db.prepare('SELECT * FROM prospects WHERE id = ?').get(prospect.id));
  } catch (err) {
    res.status(502).json({ error: err.message });
  }
});

// --- AI: draft a DM (opener / followup / call_pitch) ---

router.post('/:id/draft', async (req, res) => {
  const prospect = getProspectOr404(req, res);
  if (!prospect) return;
  const type = req.body.type || 'opener';
  if (!['opener', 'followup', 'call_pitch'].includes(type)) {
    return res.status(400).json({ error: 'type must be opener, followup, or call_pitch' });
  }
  try {
    const icpDescription = getSetting('icp_description');
    const offerDescription = getSetting('offer_description');
    const tone = getSetting('tone');
    const history = getHistory(prospect.id);
    const result = await draftMessage({ type, icpDescription, offerDescription, tone, prospect, history });
    const info = db
      .prepare('INSERT INTO drafts (prospect_id, type, content) VALUES (?, ?, ?)')
      .run(prospect.id, type, result.message);
    res.status(201).json(db.prepare('SELECT * FROM drafts WHERE id = ?').get(info.lastInsertRowid));
  } catch (err) {
    res.status(502).json({ error: err.message });
  }
});

router.post('/:id/drafts/:draftId/use', (req, res) => {
  const prospect = getProspectOr404(req, res);
  if (!prospect) return;
  const draft = db
    .prepare('SELECT * FROM drafts WHERE id = ? AND prospect_id = ?')
    .get(req.params.draftId, prospect.id);
  if (!draft) return res.status(404).json({ error: 'Draft not found' });

  db.prepare('UPDATE drafts SET used = 1 WHERE id = ?').run(draft.id);
  // Marking a draft "used" means you sent it yourself in Instagram — log it as an
  // outbound message so the conversation history and interest analysis stay accurate.
  const info = db
    .prepare('INSERT INTO messages (prospect_id, direction, content) VALUES (?, ?, ?)')
    .run(prospect.id, 'outbound', draft.content);

  if (prospect.stage === 'new') {
    db.prepare("UPDATE prospects SET stage = 'dm_sent', updated_at = datetime('now') WHERE id = ?").run(
      prospect.id
    );
  }

  res.json({
    draft: db.prepare('SELECT * FROM drafts WHERE id = ?').get(draft.id),
    message: db.prepare('SELECT * FROM messages WHERE id = ?').get(info.lastInsertRowid),
  });
});

// --- AI: read the conversation for buying signals ---

router.post('/:id/analyze-interest', async (req, res) => {
  const prospect = getProspectOr404(req, res);
  if (!prospect) return;
  try {
    const history = getHistory(prospect.id);
    const result = await analyzeInterest({ history });
    if (result.warm && prospect.stage !== 'call_booked') {
      db.prepare("UPDATE prospects SET stage = 'warm', updated_at = datetime('now') WHERE id = ?").run(
        prospect.id
      );
    }
    res.json(result);
  } catch (err) {
    res.status(502).json({ error: err.message });
  }
});

// --- Send the Calendly link once a prospect is warm ---

router.post('/:id/send-booking-link', (req, res) => {
  const prospect = getProspectOr404(req, res);
  if (!prospect) return;
  const calendlyLink = getSetting('calendly_link');
  if (!calendlyLink) {
    return res.status(400).json({ error: 'Set your Calendly link in Settings first' });
  }
  db.prepare(
    "UPDATE prospects SET calendly_sent_at = datetime('now'), updated_at = datetime('now') WHERE id = ?"
  ).run(prospect.id);

  const trackedLink = `${calendlyLink}${calendlyLink.includes('?') ? '&' : '?'}utm_content=prospect-${prospect.id}`;

  res.json({
    calendlyLink: trackedLink,
    prospect: db.prepare('SELECT * FROM prospects WHERE id = ?').get(prospect.id),
  });
});
