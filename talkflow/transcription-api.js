// Transcription API Wrapper for TalkFlow
// Handles Local (faster-whisper), Gemini, and OpenAI Whisper transcription

const AUDIO_FALLBACK_MODELS = [
  'gemini-2.0-flash',
  'gemini-1.5-flash',
  'gemini-1.5-pro',
];

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
 * Convert a Blob to a base64 string (browser-safe, no FileReader).
 */
async function blobToBase64(blob) {
  const ab = await blob.arrayBuffer();
  const bytes = new Uint8Array(ab);
  let bin = '';
  const CHUNK = 32768;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    bin += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  return btoa(bin);
}

/**
 * Attempt a single transcription request with the given model.
 */
async function attemptTranscription(apiKey, base64Audio, mimeType, model) {
  const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;
  const payload = {
    contents: [{
      parts: [
        { inline_data: { mime_type: mimeType, data: base64Audio } },
        { text: 'Transcribe this audio exactly as spoken. Return only the spoken words — no labels, timestamps, or commentary.' }
      ]
    }],
    generationConfig: { temperature: 0.0 }
  };

  const res = await fetch(endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });

  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    const userMsg = classifyApiError(res.status, body);
    const err = new Error(userMsg);
    err.status = res.status;
    throw err;
  }

  const data = await res.json();
  const text = data.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!text) throw new Error('Gemini returned an empty transcription. The audio may be too short or silent.');
  return text.trim();
}

/**
 * Transcribes audio using local faster-whisper server at http://127.0.0.1:8765/transcribe
 *
 * @param {Blob} audioBlob - MediaRecorder output blob
 * @returns {Promise<string>} - Transcribed text
 */
export async function transcribeAudioLocal(audioBlob) {
  if (!audioBlob || audioBlob.size === 0) {
    throw new Error('Audio blob is empty — nothing was recorded.');
  }

  const formData = new FormData();
  // Using the field name "audio" as required by the backend
  formData.append('audio', audioBlob, 'recording.webm');

  try {
    const res = await fetch('http://127.0.0.1:8765/transcribe', {
      method: 'POST',
      body: formData
    });

    if (!res.ok) {
      const errorText = await res.text().catch(() => '');
      throw new Error(`Local transcription server error: ${res.status} ${errorText || res.statusText}`);
    }

    const data = await res.json();
    if (!data || typeof data.text !== 'string') {
      throw new Error('Local server returned an invalid response format.');
    }
    return data.text.trim();
  } catch (err) {
    // If the server is not running/down, fetch throws TypeError
    if (err instanceof TypeError || err.message.includes('Failed to fetch')) {
      throw new Error('Local transcription server is not running. Start TalkFlow Local Transcriber and try again.');
    }
    throw err;
  }
}

/**
 * Transcribes audio using OpenAI Whisper (whisper-1).
 */
export async function transcribeAudioOpenAI(openAIKey, audioBlob) {
  if (!openAIKey) throw new Error('OpenAI API key is missing. Set it in Settings → Transcription Provider.');
  if (!audioBlob || audioBlob.size === 0) throw new Error('Audio blob is empty — nothing was recorded.');

  const ext = audioBlob.type.includes('ogg') ? 'ogg'
    : audioBlob.type.includes('mp4') ? 'mp4'
    : 'webm';

  const formData = new FormData();
  formData.append('file', audioBlob, `recording.${ext}`);
  formData.append('model', 'whisper-1');
  formData.append('response_format', 'text');
  formData.append('language', 'en');

  for (let attempt = 1; attempt <= 2; attempt++) {
    const res = await fetch('https://api.openai.com/v1/audio/transcriptions', {
      method: 'POST',
      headers: { Authorization: `Bearer ${openAIKey}` },
      body: formData
    });

    if (res.status === 429 || res.status === 503) {
      if (attempt < 2) { await new Promise(r => setTimeout(r, attempt * 5000)); continue; }
    }

    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      const msg = body.error?.message || `HTTP ${res.status}`;
      if (res.status === 401) throw new Error('Invalid OpenAI API key. Double-check it in Settings.');
      if (res.status === 429) throw new Error('OpenAI rate limit reached. Wait a moment and try again.');
      if (res.status === 413) throw new Error('Recording file too large (>25 MB). Try a shorter session.');
      throw new Error(`OpenAI transcription failed: ${msg}`);
    }

    const text = await res.text();
    if (!text?.trim()) throw new Error('OpenAI returned an empty transcription. The audio may be silent or too short.');
    return text.trim();
  }

  throw new Error('OpenAI transcription failed after retries.');
}

/**
 * Transcribes an audio Blob using the Gemini multimodal API.
 */
export async function transcribeAudioGemini(apiKey, audioBlob, preferredModel) {
  if (!apiKey) throw new Error('API key is missing. Please set it in Settings.');
  if (!audioBlob || audioBlob.size === 0) throw new Error('Audio blob is empty — nothing was recorded.');

  const base64Audio = await blobToBase64(audioBlob);
  const mimeType = audioBlob.type || 'audio/webm';

  const modelsToTry = [
    ...(preferredModel ? [preferredModel] : []),
    ...AUDIO_FALLBACK_MODELS.filter(m => m !== preferredModel)
  ];

  let lastError;
  for (const model of modelsToTry) {
    for (let attempt = 1; attempt <= 3; attempt++) {
      try {
        console.log(`[TalkFlow] Transcribing with ${model}, attempt ${attempt}`);
        const transcript = await attemptTranscription(apiKey, base64Audio, mimeType, model);
        return transcript;
      } catch (err) {
        lastError = err;
        const status = err.status;

        if (status === 404) {
          console.warn(`[TalkFlow] ${model} → 404, trying next model`);
          break;
        }
        if (status === 429 || status === 503) {
          const wait = attempt * 4000;
          console.warn(`[TalkFlow] ${model} → ${status}, retrying in ${wait}ms`);
          await new Promise(r => setTimeout(r, wait));
          continue;
        }
        throw err;
      }
    }
  }

  throw lastError ?? new Error('All transcription models failed. Check your API key and try again.');
}

/**
 * Analyzes transcript using local server (Ollama model llama3.2:3b).
 *
 * @param {string} transcript - Transcribed text
 * @param {number} duration - Session duration in seconds
 * @param {string} mode - Recording mode ("self" or "full")
 * @returns {Promise<Object>} - Analysis result object
 */
export async function analyzeTranscriptLocal(transcript, duration, mode) {
  if (!transcript || !transcript.trim()) {
    throw new Error('Transcript is empty — nothing to analyze.');
  }

  try {
    const res = await fetch('http://127.0.0.1:8765/analyze', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        transcript,
        duration: parseInt(duration) || 0,
        mode: mode || 'self'
      })
    });

    if (!res.ok) {
      const errorText = await res.text().catch(() => '');
      throw new Error(`Local analysis server error: ${res.status} ${errorText || res.statusText}`);
    }

    return await res.json();
  } catch (err) {
    if (err instanceof TypeError || err.message.includes('Failed to fetch')) {
      throw new Error('Local analysis server is not running. Start Ollama and run: ollama pull llama3.2:3b');
    }
    throw err;
  }
}

/**
 * Queries the local transcription/analysis server's health endpoint.
 *
 * @returns {Promise<Object>} - Health data
 */
export async function checkLocalServerHealth() {
  try {
    const res = await fetch('http://127.0.0.1:8765/health', {
      method: 'GET',
      headers: {
        'Accept': 'application/json'
      }
    });
    if (!res.ok) {
      return { status: 'error', error: `HTTP ${res.status} ${res.statusText}` };
    }
    return await res.json();
  } catch (err) {
    return { status: 'offline', error: err.message };
  }
}
