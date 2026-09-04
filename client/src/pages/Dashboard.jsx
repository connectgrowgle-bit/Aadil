import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api.js';
import { parseCsv, rowsToProspects } from '../csv.js';

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
  const [importResult, setImportResult] = useState(null);
  const [importing, setImporting] = useState(false);
  const fileInputRef = useRef(null);

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

  async function handleCsvSelected(e) {
    const file = e.target.files?.[0];
    e.target.value = ''; // allow re-selecting the same file later
    if (!file) return;

    setImportResult(null);
    setError('');
    setImporting(true);
    try {
      const text = await file.text();
      const rows = parseCsv(text);
      const prospects = rowsToProspects(rows);
      if (prospects.length === 0) throw new Error('No data rows found in that CSV');
      const result = await api.bulkImportProspects(prospects);
      setImportResult(result);
      load();
    } catch (err) {
      setError(err.message);
    } finally {
      setImporting(false);
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
        <div className="header-actions">
          <input
            type="file"
            accept=".csv,text/csv"
            ref={fileInputRef}
            onChange={handleCsvSelected}
            hidden
          />
          <button disabled={importing} onClick={() => fileInputRef.current?.click()}>
            {importing ? 'Importing…' : 'Import CSV'}
          </button>
          <button className="primary" onClick={() => setShowForm((s) => !s)}>
            {showForm ? 'Cancel' : '+ Add prospect'}
          </button>
        </div>
      </div>

      <p className="hint">
        CSV import expects a header row with a <code>handle</code> column (required) plus
        optional <code>name</code>, <code>niche</code>, <code>bio</code>, <code>notes</code> columns.
      </p>

      {error && <div className="banner error">{error}</div>}

      {importResult && (
        <div className="banner success">
          Imported {importResult.created} prospect{importResult.created === 1 ? '' : 's'}.
          {importResult.skipped.length > 0 && (
            <>
              {' '}
              Skipped {importResult.skipped.length}: {importResult.skipped
                .slice(0, 5)
                .map((s) => `@${s.handle || '(blank)'} (${s.reason})`)
                .join(', ')}
              {importResult.skipped.length > 5 ? '…' : ''}
            </>
          )}
        </div>
      )}

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
