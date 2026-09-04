export function initials(prospect) {
  const source = prospect.name || prospect.handle || '?';
  const parts = source.trim().split(/\s+/).filter(Boolean);
  if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase();
  return source.slice(0, 2).toUpperCase();
}

// Deterministic pastel-ish hue from the handle, so the same prospect always gets
// the same avatar color without needing to store one.
export function avatarHue(handle) {
  let hash = 0;
  for (let i = 0; i < handle.length; i++) {
    hash = (hash * 31 + handle.charCodeAt(i)) % 360;
  }
  return hash;
}

export function timeAgo(isoString) {
  if (!isoString) return '';
  // SQLite's datetime('now') returns "YYYY-MM-DD HH:MM:SS" in UTC without a "Z" —
  // append it so Date parses it as UTC instead of local time.
  const date = new Date(isoString.includes('T') ? isoString : `${isoString.replace(' ', 'T')}Z`);
  const seconds = Math.floor((Date.now() - date.getTime()) / 1000);

  if (seconds < 60) return 'just now';
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d ago`;
  const months = Math.floor(days / 30);
  if (months < 12) return `${months}mo ago`;
  return `${Math.floor(months / 12)}y ago`;
}
