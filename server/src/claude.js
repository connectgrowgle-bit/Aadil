// Thin wrapper around the Anthropic Messages API used for the three AI-assisted
// steps in the outreach workflow: scoring a prospect against your ideal-client
// profile, drafting personalized messages, and reading a conversation for buying
// signals. All three return structured JSON that the routes persist as-is.

const API_URL = 'https://api.anthropic.com/v1/messages';
const MODEL = process.env.ANTHROPIC_MODEL || 'claude-sonnet-5';

async function callClaude({ system, prompt, maxTokens = 1024 }) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    throw new Error(
      'ANTHROPIC_API_KEY is not set. Add it to server/.env to enable AI scoring/drafting.'
    );
  }

  const res = await fetch(API_URL, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: MODEL,
      max_tokens: maxTokens,
      system,
      messages: [{ role: 'user', content: prompt }],
    }),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Anthropic API error ${res.status}: ${text}`);
  }

  const data = await res.json();
  return data.content?.map((block) => block.text ?? '').join('') ?? '';
}

function extractJson(text) {
  // Models sometimes wrap JSON in prose or a code fence despite instructions;
  // grab the first {...} block as a best effort.
  const match = text.match(/\{[\s\S]*\}/);
  if (!match) throw new Error(`Could not find JSON in model response: ${text}`);
  return JSON.parse(match[0]);
}

export async function scoreProspect({ icpDescription, offerDescription, prospect }) {
  const system = `You help a solo service provider qualify Instagram outreach prospects
against their ideal-client profile (ICP). You are strict and honest: a mediocre fit
should score low, not be talked up. Respond with ONLY a JSON object, no prose, no
markdown fences, matching exactly:
{"score": <integer 0-100>, "reasoning": "<2-3 sentences, specific to this profile>"}`;

  const prompt = `Ideal client profile (ICP):
${icpDescription || '(not specified)'}

What I offer:
${offerDescription || '(not specified)'}

Prospect to evaluate:
- Handle: @${prospect.handle}
- Name: ${prospect.name || '(unknown)'}
- Niche: ${prospect.niche || '(unknown)'}
- Bio: ${prospect.bio || '(none provided)'}
- Notes: ${prospect.notes || '(none)'}

Score how well this prospect matches the ICP and how likely they are to want the offer.`;

  const text = await callClaude({ system, prompt, maxTokens: 400 });
  return extractJson(text);
}

export async function draftMessage({ type, icpDescription, offerDescription, tone, prospect, history }) {
  const kindInstructions = {
    opener: `Write a first-contact DM opener. It must NOT pitch anything yet — its only
job is to start a genuine, personalized conversation by referencing something specific
and real from their bio/niche/notes. No generic compliments, no "I help X do Y, interested?"
sales language. Keep it under 300 characters, like a real DM.`,
    followup: `Write a natural follow-up message continuing an existing conversation
(see history below). Move the conversation forward based on what they last said. Keep it
conversational and short, like a real DM, not a sales script.`,
    call_pitch: `The prospect has shown genuine interest in the conversation below. Write a
message that naturally transitions into proposing a free/low-key 1-on-1 call to explore
whether working together makes sense. Low-pressure, specific about what the call would
cover, one clear call-to-action. Keep it under 400 characters.`,
  };

  const system = `You write short, human-sounding Instagram DMs for a solo service
provider doing 1-on-1 outreach — never generic mass-blast copy. Match the requested tone.
Respond with ONLY a JSON object, no prose, no markdown fences, matching exactly:
{"message": "<the drafted DM text>"}`;

  const historyText = (history || [])
    .map((m) => `${m.direction === 'outbound' ? 'Me' : 'Them'}: ${m.content}`)
    .join('\n') || '(no messages yet)';

  const prompt = `Tone to use: ${tone || 'friendly, warm, casual, confident — not salesy'}

Ideal client profile / offer context:
${icpDescription || '(not specified)'}
${offerDescription || ''}

Prospect:
- Handle: @${prospect.handle}
- Name: ${prospect.name || '(unknown)'}
- Niche: ${prospect.niche || '(unknown)'}
- Bio: ${prospect.bio || '(none provided)'}
- Notes: ${prospect.notes || '(none)'}

Conversation so far:
${historyText}

Task: ${kindInstructions[type] || kindInstructions.opener}`;

  const text = await callClaude({ system, prompt, maxTokens: 400 });
  return extractJson(text);
}

export async function analyzeInterest({ history }) {
  const system = `You analyze an Instagram DM conversation and judge whether the other
person is showing real buying interest (warm) worth pitching a 1-on-1 call, versus just
being polite or not interested. Respond with ONLY a JSON object, no prose, no markdown
fences, matching exactly:
{"warm": <true|false>, "reasoning": "<1-2 sentences>", "suggested_next_step": "<short actionable suggestion>"}`;

  const historyText = (history || [])
    .map((m) => `${m.direction === 'outbound' ? 'Me' : 'Them'}: ${m.content}`)
    .join('\n') || '(no messages yet)';

  const prompt = `Conversation so far:\n${historyText}\n\nIs this prospect warm enough to pitch a 1-on-1 call?`;

  const text = await callClaude({ system, prompt, maxTokens: 300 });
  return extractJson(text);
}
