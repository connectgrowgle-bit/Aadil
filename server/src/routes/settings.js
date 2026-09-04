import { Router } from 'express';
import { getSetting, setSetting } from '../db.js';

export const router = Router();

const KEYS = ['icp_description', 'offer_description', 'tone', 'calendly_link'];

router.get('/', (_req, res) => {
  const settings = {};
  for (const key of KEYS) settings[key] = getSetting(key);
  res.json(settings);
});

router.put('/', (req, res) => {
  for (const key of KEYS) {
    if (key in req.body) setSetting(key, String(req.body[key] ?? ''));
  }
  const settings = {};
  for (const key of KEYS) settings[key] = getSetting(key);
  res.json(settings);
});
