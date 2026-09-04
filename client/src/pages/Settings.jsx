import { useEffect, useState } from 'react';
import { api } from '../api.js';

export default function Settings() {
  const [settings, setSettings] = useState(null);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    api.getSettings().then(setSettings).catch((err) => setError(err.message));
  }, []);

  if (!settings) return <div className="detail">{error || 'Loading…'}</div>;

  async function save(e) {
    e.preventDefault();
    setError('');
    try {
      await api.updateSettings(settings);
      setSaved(true);
      setTimeout(() => setSaved(false), 1500);
    } catch (err) {
      setError(err.message);
    }
  }

  return (
    <div className="detail">
      <h1>Settings</h1>
      <p className="hint">
        This context is used by AI scoring, DM drafting and interest analysis for every prospect — get it
        specific and it'll make much better drafts.
      </p>
      {error && <div className="banner error">{error}</div>}
      <form className="card settings-form" onSubmit={save}>
        <label>
          Ideal client profile (ICP)
          <textarea
            placeholder="e.g. Female online fitness coaches, 5k-50k followers, already selling a program but struggling with consistent leads..."
            value={settings.icp_description}
            onChange={(e) => setSettings({ ...settings, icp_description: e.target.value })}
          />
        </label>
        <label>
          What you offer
          <textarea
            placeholder="e.g. I help online coaches build an Instagram outreach system that books 10+ qualified calls/month..."
            value={settings.offer_description}
            onChange={(e) => setSettings({ ...settings, offer_description: e.target.value })}
          />
        </label>
        <label>
          Tone for DMs
          <input
            placeholder="e.g. friendly, direct, a little playful — never salesy"
            value={settings.tone}
            onChange={(e) => setSettings({ ...settings, tone: e.target.value })}
          />
        </label>
        <label>
          Calendly link
          <input
            placeholder="https://calendly.com/you/intro-call"
            value={settings.calendly_link}
            onChange={(e) => setSettings({ ...settings, calendly_link: e.target.value })}
          />
        </label>
        <button className="primary" type="submit">
          Save settings
        </button>
        {saved && <span className="saved-badge">Saved ✓</span>}
      </form>
    </div>
  );
}
