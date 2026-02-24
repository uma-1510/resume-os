// ai.js — Gemini SDK wrapper
//
// WHY we use the @google/generative-ai SDK instead of raw fetch():
//   Direct fetch() to Gemini's REST endpoint from a browser extension fails
//   with CORS errors. The SDK uses a request path that Chrome's extension
//   context permits. No proxy, no Cloudflare Worker, no backend required.
//   Bundle cost: ~85KB minified — acceptable for an extension.
//
// WHY gemini-2.0-flash:
//   Free tier: 15 req/min, 1500 req/day. A heavy job seeker applies to
//   10-20 jobs/week. This is effectively unlimited for individual use.
//   Flash is also significantly faster than Pro, important for UX.

import { GoogleGenerativeAI } from '@google/generative-ai';
import { buildSystemPrompt, buildUserPrompt, buildSummaryPrompt } from './prompts.js';

const MODEL_ID = 'gemini-2.0-flash';

// ─── validateApiKey ──────────────────────────────────────────────────────────
// Called during onboarding to verify key before marking setup complete.
// WHY: Discovering an invalid key mid-rewrite is a bad experience.
//      Better to catch it at save time with a clear, actionable error.
export async function validateApiKey(apiKey) {
  try {
    const genAI = new GoogleGenerativeAI(apiKey);
    const model = genAI.getGenerativeModel({ model: MODEL_ID });
    // Minimal test call — tiny input, tiny output
    const result = await model.generateContent('Say "ok" and nothing else.');
    const text = result.response.text();
    return { valid: true, text };
  } catch (err) {
    return {
      valid: false,
      error: parseGeminiError(err),
    };
  }
}

// ─── tailorResume ────────────────────────────────────────────────────────────
// Main AI call: takes base resume + JD → returns structured JSON resume
export async function tailorResume({ apiKey, baseResume, jobDescription, missingKeywords, jdKeywords, preferenceSummary }) {
  const genAI = new GoogleGenerativeAI(apiKey);
  const model = genAI.getGenerativeModel({
    model: MODEL_ID,
    systemInstruction: buildSystemPrompt(preferenceSummary),
    generationConfig: {
      // WHY 4096: Resumes are long. 1024 would truncate experience sections.
      // 4096 covers even verbose 3-page resumes with room to spare.
      maxOutputTokens: 4096,
      // WHY temperature 0.3: We want creative rewriting but not hallucination.
      // Lower temp = more faithful to base resume. Higher = more creative but risky.
      temperature: 0.3,
    },
  });

  const userPrompt = buildUserPrompt({ baseResume, jobDescription, missingKeywords, jdKeywords });

  const result = await model.generateContent(userPrompt);
  const rawText = result.response.text();

  // Parse and validate the JSON response
  return parseResumeJSON(rawText);
}

// ─── rebuildPreferenceSummary ────────────────────────────────────────────────
// Regenerates the career memory summary every 5 confirmed sessions.
// WHY every 5: Rebuilding every session is expensive. Every 10 is too stale.
//              5 strikes the balance — new patterns emerge after a few sessions.
export async function rebuildPreferenceSummary({ apiKey, sessions }) {
  const genAI = new GoogleGenerativeAI(apiKey);
  const model = genAI.getGenerativeModel({
    model: MODEL_ID,
    generationConfig: {
      maxOutputTokens: 200,
      temperature: 0.1, // Very low temp — we want consistent, factual summary
    },
  });

  const prompt = buildSummaryPrompt(sessions);
  const result = await model.generateContent(prompt);
  return result.response.text().trim();
}

// ─── parseResumeJSON ─────────────────────────────────────────────────────────
// Gemini sometimes wraps JSON in markdown fences. Strip them before parsing.
// Also handles trailing commas (common model output bug).
function parseResumeJSON(rawText) {
  let text = rawText.trim();

  // Strip markdown code fences if present
  // WHY: Despite instructions, Gemini 2.0 Flash occasionally wraps output in
  //      ```json ... ``` blocks. We strip them defensively.
  text = text.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '');

  // Find JSON object boundaries (in case there's any preamble)
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start === -1 || end === -1) {
    throw new Error('No JSON object found in AI response');
  }
  text = text.slice(start, end + 1);

  try {
    const parsed = JSON.parse(text);
    return validateResumeSchema(parsed);
  } catch (e) {
    // Last resort: try to fix common JSON issues
    // Remove trailing commas before ] or }
    const fixed = text.replace(/,(\s*[}\]])/g, '$1');
    const parsed = JSON.parse(fixed); // Will throw if still broken → caught upstream
    return validateResumeSchema(parsed);
  }
}

// ─── validateResumeSchema ───────────────────────────────────────────────────
// Ensure the parsed JSON has all required fields. Fill in defaults for missing ones.
function validateResumeSchema(data) {
  return {
    name: data.name || '',
    email: data.email || '',
    phone: data.phone || '',
    location: data.location || '',
    linkedin: data.linkedin || '',
    summary: data.summary || '',
    experience: (data.experience || []).map(exp => ({
      company: exp.company || '',
      title: exp.title || '',
      dates: exp.dates || '',
      bullets: (exp.bullets || []).map(b =>
        typeof b === 'string'
          ? { text: b, authentic: true }
          : { text: b.text || '', authentic: b.authentic !== false }
      ),
    })),
    skills: Array.isArray(data.skills) ? data.skills : [],
    education: (data.education || []).map(ed => ({
      institution: ed.institution || '',
      degree: ed.degree || '',
      dates: ed.dates || '',
    })),
  };
}

// ─── parseGeminiError ────────────────────────────────────────────────────────
// Extract a user-friendly error message from Gemini SDK errors
export function parseGeminiError(err) {
  const msg = err?.message || String(err);

  if (msg.includes('429') || msg.includes('RESOURCE_EXHAUSTED')) {
    return {
      code: 'RATE_LIMIT',
      message: 'Gemini free tier limit reached. Wait 60 seconds and try again.',
      retryAfter: 60,
    };
  }
  if (msg.includes('401') || msg.includes('API_KEY_INVALID') || msg.includes('invalid api key')) {
    return {
      code: 'INVALID_KEY',
      message: 'Invalid API key. Check your key in Settings and try again.',
    };
  }
  if (msg.includes('403') || msg.includes('PERMISSION_DENIED')) {
    return {
      code: 'PERMISSION',
      message: 'API key doesn\'t have access to Gemini. Make sure you\'ve enabled the Generative Language API.',
    };
  }
  if (msg.includes('500') || msg.includes('INTERNAL')) {
    return {
      code: 'SERVER_ERROR',
      message: 'Gemini server error. Try again in a moment.',
    };
  }
  return {
    code: 'UNKNOWN',
    message: `AI error: ${msg.slice(0, 120)}`,
  };
}
