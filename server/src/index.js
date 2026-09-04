import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import { router as prospectsRouter } from './routes/prospects.js';
import { router as settingsRouter } from './routes/settings.js';
import { router as calendlyRouter } from './routes/calendly.js';

const app = express();
app.use(cors());
app.use(express.json());

app.get('/api/health', (_req, res) => res.json({ ok: true }));
app.use('/api/prospects', prospectsRouter);
app.use('/api/settings', settingsRouter);
app.use('/api/calendly', calendlyRouter);

// eslint-disable-next-line no-unused-vars
app.use((err, _req, res, _next) => {
  console.error(err);
  res.status(500).json({ error: 'Internal server error' });
});

const port = process.env.PORT || 4000;
app.listen(port, () => {
  console.log(`Outreach API listening on http://localhost:${port}`);
});
