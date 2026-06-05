// Gemini API Wrapper for TalkFlow
// Handles speech analysis and prompt logic using the user's Gemini key

/**
 * Maps an HTTP status + error body to a clear, actionable user message.
 */
function classifyApiError(status, errorBody) {
  const msg = errorBody?.error?.message || '';
  if (status === 400) return `Bad request – check your API key format. (${msg})`;
  if (status === 401 || status === 403) return 'Invalid or unauthorised API key. Check Settings.';
  if (status === 404) return `Model not available for this API key. (${msg})`;
  if (status === 429) return 'API quota or rate-limit reached. Wait a minute and try again.';
  if (status === 500) return `Server error. Try again later. (${msg})`;
  if (status === 503) return 'Service overloaded. Try again in a few seconds.';
  return msg || `HTTP ${status} error.`;
}

/**
 * Analyzes an interview transcript using the Gemini API.
 * @param {string} apiKey
 * @param {string} transcript
 * @param {string} [model]
 * @returns {Promise<Object>}
 */
export async function analyzeTranscript(apiKey, transcript, model = 'gemini-2.0-flash') {
  if (!apiKey) throw new Error('API key is missing. Please set it in Settings.');
  if (!transcript?.trim()) throw new Error('Transcript is empty — nothing to analyze.');

  const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;

  const prompt = `You are an English interview communication coach.

Analyze the candidate's spoken interview transcript. Improve English, clarity, structure, confidence, and professional interview delivery.

CRITICAL INSTRUCTIONS FOR BRIEF/GARBAGE INPUTS:
- If the transcript is under 15 words, or consists of only brief noise, single words, or garbage fragments (e.g. "Wesh", "hello", "um"), you MUST set "insufficientSpeech" to true.
- When "insufficientSpeech" is true:
  1. Do NOT invent meaning, professional experience, or context from these fragments.
  2. Do NOT produce any corrections (leave "corrections" as an empty array []).
  3. Leave "betterAnswer", "summary" as empty or simple warning strings, and leave other arrays empty.
  4. Set "overallScore" to 0.
- When "insufficientSpeech" is false (15 words or more, with coherent speech to analyze):
  1. Set "insufficientSpeech" to false.
  2. Do not invent experience, achievements, metrics, or technical details not mentioned by the candidate.
  3. Do not change the candidate's intended meaning.
  4. Focus only on the candidate's speech.
  5. Keep feedback direct, practical, and encouraging.
  6. Do not label slang or informal words as "inappropriate" or error-ridden unless the user clearly used it incorrectly in context.
  7. Do not produce corrections for unclear, noisy, or isolated one-word fragments.

Identify issues across: grammar, vocabulary, filler words, weak phrases, repetition, underconfident language, and interview-readiness.

For each correction provide: original sentence, corrected English, a stronger interview version, an explanation, and the issue type.

Transcript:
"${transcript}"`;

  const responseSchema = {
    type: 'OBJECT',
    properties: {
      overallScore: { type: 'INTEGER', description: 'Score 1–10 for spoken English clarity and interview communication.' },
      summary: { type: 'STRING', description: 'Short coaching summary.' },
      fillerWords: {
        type: 'OBJECT',
        properties: {
          um: { type: 'INTEGER' }, ah: { type: 'INTEGER' }, like: { type: 'INTEGER' },
          youKnow: { type: 'INTEGER' }, actually: { type: 'INTEGER' }, other: { type: 'INTEGER' }
        },
        required: ['um', 'ah', 'like', 'youKnow', 'actually', 'other']
      },
      corrections: {
        type: 'ARRAY',
        items: {
          type: 'OBJECT',
          properties: {
            original: { type: 'STRING' },
            corrected: { type: 'STRING' },
            strongerVersion: { type: 'STRING' },
            explanation: { type: 'STRING' },
            type: { type: 'STRING', enum: ['grammar', 'vocabulary', 'structure', 'clarity', 'confidence', 'filler'] }
          },
          required: ['original', 'corrected', 'strongerVersion', 'explanation', 'type']
        }
      },
      betterAnswer: { type: 'STRING' },
      weakSentences: { type: 'ARRAY', items: { type: 'STRING' } },
      reusablePhrases: { type: 'ARRAY', items: { type: 'STRING' } },
      actionPlan: { type: 'ARRAY', items: { type: 'STRING' } },
      insufficientSpeech: { type: 'BOOLEAN', description: 'Set to true if the transcript is under 15 words or has insufficient content to provide a meaningful coaching analysis.' }
    },
    required: ['overallScore', 'summary', 'fillerWords', 'corrections', 'betterAnswer', 'weakSentences', 'reusablePhrases', 'actionPlan', 'insufficientSpeech']
  };

  const payload = {
    contents: [{ parts: [{ text: prompt }] }],
    generationConfig: { responseMimeType: 'application/json', responseSchema, temperature: 0.2 }
  };

  const res = await fetch(endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });

  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(`Analysis failed: ${classifyApiError(res.status, body)}`);
  }

  const data = await res.json();
  const responseText = data.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!responseText) throw new Error('Gemini returned no analysis. Try again.');
  return JSON.parse(responseText);
}
