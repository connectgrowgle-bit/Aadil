import { useEffect, useState } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { api } from '../api.js';

const STAGES = ['new', 'researched', 'dm_sent', 'replying', 'warm', 'call_booked', 'not_interested'];

export default function ProspectDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [prospect, setProspect] = useState(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState('');
  const [inboundText, setInboundText] = useState('');
  const [analysis, setAnalysis] = useState(null);
  const [bookingLink, setBookingLink] = useState('');

  async function load() {
    try {
      setProspect(await api.getProspect(id));
    } catch (err) {
      setError(err.message);
    }
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  async function run(action, fn) {
    setBusy(action);
    setError('');
    try {
      await fn();
      await load();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy('');
    }
  }

  if (!prospect) return <div className="detail">{error || 'Loading…'}</div>;

  return (
    <div className="detail">
      <Link to="/" className="back-link">
        ← Back to pipeline
      </Link>

      <div className="detail-header">
        <h1>@{prospect.handle}</h1>
        <select
          value={prospect.stage}
          onChange={(e) => run('stage', () => api.updateProspect(id, { stage: e.target.value }))}
        >
          {STAGES.map((s) => (
            <option key={s} value={s}>
              {s.replace('_', ' ')}
            </option>
          ))}
        </select>
        <button className="danger" onClick={() => run('delete', async () => {
          await api.deleteProspect(id);
          navigate('/');
        })}>
          Delete
        </button>
      </div>

      {error && <div className="banner error">{error}</div>}

      <div className="detail-grid">
        <section className="card">
          <h2>Profile</h2>
          <EditableField label="Name" value={prospect.name} onSave={(v) => run('name', () => api.updateProspect(id, { name: v }))} />
          <EditableField label="Niche" value={prospect.niche} onSave={(v) => run('niche', () => api.updateProspect(id, { niche: v }))} />
          <EditableField label="Bio" value={prospect.bio} textarea onSave={(v) => run('bio', () => api.updateProspect(id, { bio: v }))} />
          <EditableField label="Notes" value={prospect.notes} textarea onSave={(v) => run('notes', () => api.updateProspect(id, { notes: v }))} />

          <button disabled={busy === 'score'} onClick={() => run('score', () => api.scoreProspect(id))}>
            {busy === 'score' ? 'Scoring…' : 'AI: Score ICP fit'}
          </button>
          {prospect.icp_score != null && (
            <div className="score-block">
              <strong>ICP fit: {prospect.icp_score}/100</strong>
              <p>{prospect.icp_reasoning}</p>
            </div>
          )}
        </section>

        <section className="card">
          <h2>Draft a DM</h2>
          <div className="draft-buttons">
            <button disabled={busy === 'opener'} onClick={() => run('opener', () => api.draftMessage(id, 'opener'))}>
              {busy === 'opener' ? '…' : 'Draft opener'}
            </button>
            <button disabled={busy === 'followup'} onClick={() => run('followup', () => api.draftMessage(id, 'followup'))}>
              {busy === 'followup' ? '…' : 'Draft follow-up'}
            </button>
            <button disabled={busy === 'call_pitch'} onClick={() => run('call_pitch', () => api.draftMessage(id, 'call_pitch'))}>
              {busy === 'call_pitch' ? '…' : 'Draft call pitch'}
            </button>
          </div>
          <div className="drafts-list">
            {prospect.drafts.length === 0 && <p className="empty">No drafts yet — generate one above.</p>}
            {prospect.drafts.map((d) => (
              <div className={`draft ${d.used ? 'used' : ''}`} key={d.id}>
                <div className="draft-type">{d.type.replace('_', ' ')}</div>
                <p>{d.content}</p>
                <div className="draft-actions">
                  <button onClick={() => navigator.clipboard.writeText(d.content)}>Copy</button>
                  {!d.used && (
                    <button
                      className="primary"
                      disabled={busy === `use-${d.id}`}
                      onClick={() => run(`use-${d.id}`, () => api.useDraft(id, d.id))}
                    >
                      I sent this in Instagram
                    </button>
                  )}
                  {d.used && <span className="used-badge">Sent ✓</span>}
                </div>
              </div>
            ))}
          </div>
        </section>

        <section className="card">
          <h2>Conversation</h2>
          <div className="messages">
            {prospect.messages.length === 0 && <p className="empty">No messages logged yet.</p>}
            {prospect.messages.map((m) => (
              <div className={`message ${m.direction}`} key={m.id}>
                <span className="who">{m.direction === 'outbound' ? 'You' : 'Them'}</span>
                <p>{m.content}</p>
              </div>
            ))}
          </div>
          <div className="log-inbound">
            <textarea
              placeholder="Paste what they replied with in Instagram, then log it here…"
              value={inboundText}
              onChange={(e) => setInboundText(e.target.value)}
            />
            <button
              disabled={!inboundText.trim() || busy === 'inbound'}
              onClick={() =>
                run('inbound', async () => {
                  await api.addMessage(id, { direction: 'inbound', content: inboundText });
                  setInboundText('');
                })
              }
            >
              Log their reply
            </button>
          </div>

          <button disabled={busy === 'analyze'} onClick={() => run('analyze', async () => setAnalysis(await api.analyzeInterest(id)))}>
            {busy === 'analyze' ? 'Analyzing…' : 'AI: Is this prospect warm?'}
          </button>
          {analysis && (
            <div className={`analysis ${analysis.warm ? 'warm' : 'cool'}`}>
              <strong>{analysis.warm ? '🔥 Warm — worth pitching a call' : 'Not warm yet'}</strong>
              <p>{analysis.reasoning}</p>
              <p className="suggestion">Next step: {analysis.suggested_next_step}</p>
            </div>
          )}
        </section>

        <section className="card">
          <h2>Book the call</h2>
          <p className="hint">
            Once they're warm, send your Calendly link. This tags the link so a booking automatically moves them
            to &ldquo;Call Booked&rdquo; via your Calendly webhook.
          </p>
          <button
            disabled={busy === 'booking'}
            onClick={() =>
              run('booking', async () => {
                const res = await api.sendBookingLink(id);
                setBookingLink(res.calendlyLink);
              })
            }
          >
            {busy === 'booking' ? '…' : 'Get tracked booking link'}
          </button>
          {bookingLink && (
            <div className="booking-link">
              <code>{bookingLink}</code>
              <button onClick={() => navigator.clipboard.writeText(bookingLink)}>Copy</button>
            </div>
          )}
          {prospect.calendly_sent_at && <p className="hint">Link sent: {prospect.calendly_sent_at}</p>}
          {prospect.call_booked_at && <p className="hint good">✅ Call booked: {prospect.call_booked_at}</p>}
        </section>
      </div>
    </div>
  );
}

function EditableField({ label, value, textarea, onSave }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value || '');

  useEffect(() => setDraft(value || ''), [value]);

  if (!editing) {
    return (
      <div className="field" onClick={() => setEditing(true)}>
        <label>{label}</label>
        <div className="field-value">{value || <span className="empty">Click to add…</span>}</div>
      </div>
    );
  }

  const Field = textarea ? 'textarea' : 'input';
  return (
    <div className="field editing">
      <label>{label}</label>
      <Field value={draft} onChange={(e) => setDraft(e.target.value)} autoFocus />
      <div className="field-actions">
        <button
          className="primary"
          onClick={() => {
            onSave(draft);
            setEditing(false);
          }}
        >
          Save
        </button>
        <button onClick={() => setEditing(false)}>Cancel</button>
      </div>
    </div>
  );
}
