// Minimal CSV parser: handles quoted fields (with escaped "" and embedded commas/
// newlines), which is all we need for a handle/name/niche/bio/notes import sheet.
// Not a full RFC 4180 implementation, but covers what Excel/Sheets/Numbers export.
export function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = '';
  let inQuotes = false;

  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    const next = text[i + 1];

    if (inQuotes) {
      if (char === '"' && next === '"') {
        field += '"';
        i++;
      } else if (char === '"') {
        inQuotes = false;
      } else {
        field += char;
      }
      continue;
    }

    if (char === '"') {
      inQuotes = true;
    } else if (char === ',') {
      row.push(field);
      field = '';
    } else if (char === '\n' || char === '\r') {
      if (char === '\r' && next === '\n') i++;
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
    } else {
      field += char;
    }
  }
  if (field.length > 0 || row.length > 0) {
    row.push(field);
    rows.push(row);
  }

  return rows.filter((r) => r.some((cell) => cell.trim() !== ''));
}

const KNOWN_COLUMNS = ['handle', 'name', 'niche', 'bio', 'notes'];

// Turns raw CSV rows into prospect objects, matching header names case-insensitively
// against the columns the API accepts. Unrecognized columns are ignored.
export function rowsToProspects(rows) {
  if (rows.length === 0) return [];
  const header = rows[0].map((h) => h.trim().toLowerCase());
  const columnIndex = {};
  header.forEach((h, i) => {
    if (KNOWN_COLUMNS.includes(h)) columnIndex[h] = i;
  });

  if (columnIndex.handle === undefined) {
    throw new Error('CSV must have a "handle" column (name, niche, bio, notes are optional)');
  }

  return rows.slice(1).map((cells) => {
    const prospect = {};
    for (const col of KNOWN_COLUMNS) {
      if (columnIndex[col] !== undefined) prospect[col] = (cells[columnIndex[col]] || '').trim();
    }
    return prospect;
  });
}
