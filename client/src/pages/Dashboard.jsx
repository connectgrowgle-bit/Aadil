import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api.js';

const STAGE_LABELS = {
  new: 'New',
  researched: 'Researched',
  dm_sent: 'DM Sent',
  replying: 'Replying',
  warm: 'Warm 🔥',
  call_booked: 'Call Booked ✅',
  not_interested: 'Not Interested',
};

const STAGE_ORDER = ['new', 'researched', 'dm_sent', 'replying', 'warm', 'call_booked', 'not_interested'];

export default function Dashboard() {
  const [prospects, setProspects] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [form, setForm] = useState({ handle: '', name: '', niche: '', bio: '', notes: '' });
  const [showForm, setShowForm] = useState(false);

  async function load() {
    setLoading(true);
    try {
      setProspects(await api.listProspects());
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, []);

  async function handleAdd(e) {
    e.preventDefault();
    if (!form.handle.trim()) return;
    try {
      await api.createProspect(form);
      setForm({ handle: '', name: '', niche: '', bio: '', notes: '' });
      setShowForm(false);
      load();
    } catch (err) {
      setError(err.message);
    }
  }

  const byStage = STAGE_ORDER.reduce((acc, stage) => {
    acc[stage] = prospects.filter((p) => p.stage === stage);
    return acc;
  }, {});

  return (
    <div className="dashboard">
      <div className="dashboard-header">
        <h1>Pipeline</h1>
        <button className="primary" onClick={() => setShowForm((s) => !s)}>
          {showForm ? 'Cancel' : '+ Add prospect'}
        </button>
      </div>

      {error && <div className="banner error">{error}</div>}

      {showForm && (
        <form className="card add-form" onSubmit={handleAdd}>
          <div className="form-row">
            <input
              placeholder="Instagram handle (e.g. jane.doe)"
              value={form.handle}
              onChange={(e) => setForm({ ...form, handle: e.target.value })}
              required
            />
            <input
              placeholder="Name (optional)"
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
            />
            <input
              placeholder="Niche (optional)"
              value={form.niche}
              onChange={(e) => setForm({ ...form, niche: e.target.value })}
            />
          </div>
          <textarea
            placeholder="Bio / about them (paste what's on their profile)"
            value={form.bio}
            onChange={(e) => setForm({ ...form, bio: e.target.value })}
          />
          <textarea
            placeholder="Your notes (why they're a good fit, recent posts, etc.)"
            value={form.notes}
            onChange={(e) => setForm({ ...form, notes: e.target.value })}
          />
          <button className="primary" type="submit">
            Add to pipeline
          </button>
        </form>
      )}

      {loading ? (
        <p>Loading…</p>
      ) : (
        <div className="board">
          {STAGE_ORDER.map((stage) => (
            <div className="column" key={stage}>
              <div className="column-header">
                <span>{STAGE_LABELS[stage]}</span>
                <span className="count">{byStage[stage].length}</span>
              </div>
              <div className="column-body">
                {byStage[stage].map((p) => (
                  <Link className="prospect-card" to={`/prospects/${p.id}`} key={p.id}>
                    <div className="handle">@{p.handle}</div>
                    {p.name && <div className="name">{p.name}</div>}
                    {p.niche && <div className="niche">{p.niche}</div>}
                    {p.icp_score != null && (
                      <div className={`score ${p.icp_score >= 70 ? 'good' : p.icp_score >= 40 ? 'mid' : 'low'}`}>
                        ICP fit: {p.icp_score}
                      </div>
                    )}
                  </Link>
                ))}
                {byStage[stage].length === 0 && <div className="empty">Nothing here</div>}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
