const BASE = '/api';

async function request(path, options = {}) {
  const res = await fetch(`${BASE}${path}`, {
    headers: { 'content-type': 'application/json' },
    ...options,
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error || `Request failed: ${res.status}`);
  }
  if (res.status === 204) return null;
  return res.json();
}

export const api = {
  listProspects: (stage) => request(`/prospects${stage ? `?stage=${stage}` : ''}`),
  getProspect: (id) => request(`/prospects/${id}`),
  createProspect: (data) => request('/prospects', { method: 'POST', body: JSON.stringify(data) }),
  updateProspect: (id, data) => request(`/prospects/${id}`, { method: 'PATCH', body: JSON.stringify(data) }),
  deleteProspect: (id) => request(`/prospects/${id}`, { method: 'DELETE' }),

  addMessage: (id, data) => request(`/prospects/${id}/messages`, { method: 'POST', body: JSON.stringify(data) }),

  scoreProspect: (id) => request(`/prospects/${id}/score`, { method: 'POST' }),
  draftMessage: (id, type) => request(`/prospects/${id}/draft`, { method: 'POST', body: JSON.stringify({ type }) }),
  useDraft: (id, draftId) => request(`/prospects/${id}/drafts/${draftId}/use`, { method: 'POST' }),
  analyzeInterest: (id) => request(`/prospects/${id}/analyze-interest`, { method: 'POST' }),
  sendBookingLink: (id) => request(`/prospects/${id}/send-booking-link`, { method: 'POST' }),

  getSettings: () => request('/settings'),
  updateSettings: (data) => request('/settings', { method: 'PUT', body: JSON.stringify(data) }),
};
