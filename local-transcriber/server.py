#!/usr/bin/env python3
"""
TalkFlow Local Transcription Server
====================================
Privacy-first audio transcription using faster-whisper.
Audio never leaves your computer.

Quick start:
    pip install -r requirements.txt
    python server.py

Configuration via environment variables:
    WHISPER_MODEL   = tiny | base | small | medium   (default: base)
    WHISPER_DEVICE  = cpu | cuda                     (default: cpu)
    WHISPER_COMPUTE = int8 | float16 | float32       (default: int8)
    PORT            = 8765                           (default: 8765)
    HOST            = 127.0.0.1                      (default: 127.0.0.1)

GPU acceleration (if you have an NVIDIA GPU + CUDA):
    WHISPER_DEVICE=cuda WHISPER_COMPUTE=float16 python server.py
"""

import io
import os
import logging
import subprocess
import tempfile
from pathlib import Path
from typing import Optional

import uvicorn
import json
import httpx
from pydantic import BaseModel
from fastapi import FastAPI, File, Form, UploadFile, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from faster_whisper import WhisperModel

# ── Configuration ─────────────────────────────────────────────────────────────
MODEL_SIZE   = os.getenv("WHISPER_MODEL",   "base")        # tiny|base|small|medium
DEVICE       = os.getenv("WHISPER_DEVICE",  "cpu")         # cpu|cuda
COMPUTE_TYPE = os.getenv("WHISPER_COMPUTE", "int8")        # int8|float16|float32
PORT         = int(os.getenv("PORT",         "8765"))
HOST         = os.getenv("HOST",             "127.0.0.1")  # localhost only
# ─────────────────────────────────────────────────────────────────────────────

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s  %(levelname)-8s  %(message)s",
    datefmt="%H:%M:%S",
)
log = logging.getLogger("talkflow")

SUPPORTED_EXTENSIONS = {".webm", ".ogg", ".mp4", ".wav", ".mp3", ".m4a", ".flac"}
MAX_FILE_SIZE = 200 * 1024 * 1024  # 200 MB hard cap

# ── App setup ─────────────────────────────────────────────────────────────────
app = FastAPI(
    title="TalkFlow Local Transcriber",
    description="Privacy-first local audio transcription — audio never leaves your machine.",
    version="1.0.0",
    docs_url="/docs",
)

# Chrome extensions have varied origins; allow all since this is localhost-only.
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["GET", "POST", "OPTIONS"],
    allow_headers=["*"],
)

# ── Model loading ─────────────────────────────────────────────────────────────
log.info(f"Loading Whisper '{MODEL_SIZE}' model on {DEVICE}/{COMPUTE_TYPE} ...")
try:
    model = WhisperModel(MODEL_SIZE, device=DEVICE, compute_type=COMPUTE_TYPE)
    log.info("[OK] Model loaded and ready")
    MODEL_LOAD_ERROR = None
except Exception as exc:
    model = None
    MODEL_LOAD_ERROR = str(exc)
    log.error(f"[ERROR] Failed to load model: {exc}")
    log.error("    Run: pip install faster-whisper  and ensure ffmpeg is on PATH")


# ── Routes ────────────────────────────────────────────────────────────────────
class AnalysisRequest(BaseModel):
    transcript: str
    duration: int
    mode: str

async def call_ollama_analysis(transcript: str, duration: int, mode: str) -> dict:
    prompt = f"""You are an English interview communication coach.
Analyze the candidate's spoken interview transcript. Improve English, clarity, structure, confidence, and professional interview delivery.

Rules:
- Do not invent experience, achievements, metrics, or technical details not mentioned in the transcript.
- Do not change the candidate's intended meaning.
- Keep feedback direct, practical, and encouraging.
- Focus only on correcting English grammar, vocabulary, structure, and professional phrasing.
- If the transcript has fewer than 15 words or consists of only brief noise/fragments, you MUST set "insufficientSpeech" to true.
- When "insufficientSpeech" is true:
  1. Set "overallScore" to 0.
  2. Leave "corrections" as an empty list [].
  3. Leave "betterAnswer" and "summary" as empty strings.
  4. Leave other lists empty.
- When "insufficientSpeech" is false:
  1. Set "insufficientSpeech" to false.
  2. Set "overallScore" to a rating from 1 to 10.
  3. Identify issues across grammar, vocabulary, filler words, weak phrases, and repetition.
  4. For each correction provide: original sentence, corrected English, a stronger interview version, an explanation, and the issue type.

You must output a single valid JSON object. Do not wrap the JSON in markdown code blocks (e.g. ```json). Do not add any text before or after the JSON.

JSON Schema:
{{
  "overallScore": 7,
  "summary": "Coaching summary...",
  "fillerWords": {{
    "um": 0,
    "ah": 0,
    "like": 0,
    "youKnow": 0,
    "actually": 0,
    "other": 0
  }},
  "corrections": [
    {{
      "original": "original sentence",
      "corrected": "corrected sentence",
      "strongerVersion": "stronger professional interview phrasing",
      "explanation": "explanation of correction",
      "type": "grammar"
    }}
  ],
  "betterAnswer": "Better rewritten answer in STAR format...",
  "weakSentences": ["weak sentence 1"],
  "reusablePhrases": ["good phrase 1"],
  "actionPlan": ["action item 1"],
  "insufficientSpeech": false
}}

Transcript to analyze:
"{transcript}"
"""
    
    async with httpx.AsyncClient() as client:
        try:
            response = await client.post(
                "http://127.0.0.1:11434/api/generate",
                json={
                    "model": "llama3.2:3b",
                    "prompt": prompt,
                    "stream": False,
                    "options": {
                        "temperature": 0.2
                    },
                    "format": "json"
                },
                timeout=45.0
            )
        except (httpx.ConnectError, httpx.ConnectTimeout):
            raise HTTPException(
                status_code=503,
                detail="Local analysis server is not running. Start Ollama and run: ollama pull llama3.2:3b"
            )
        except Exception as e:
            raise HTTPException(
                status_code=500,
                detail=f"Failed to communicate with Ollama: {str(e)}"
            )

        if response.status_code == 404:
            raise HTTPException(
                status_code=404,
                detail="Ollama model 'llama3.2:3b' not found. Run: ollama pull llama3.2:3b"
            )
        if response.status_code != 200:
            raise HTTPException(
                status_code=response.status_code,
                detail=f"Ollama returned error: {response.text}"
            )

        try:
            data = response.json()
            generated_text = data.get("response", "").strip()
            
            # Clean up markdown if any
            if generated_text.startswith("```"):
                lines = generated_text.splitlines()
                if lines[0].startswith("```"):
                    lines = lines[1:]
                if lines and lines[-1].startswith("```"):
                    lines = lines[:-1]
                generated_text = "\n".join(lines).strip()
            
            analysis_result = json.loads(generated_text)
            
            # Validate required fields
            required_fields = ["overallScore", "summary", "fillerWords", "corrections", "betterAnswer", "weakSentences", "reusablePhrases", "actionPlan", "insufficientSpeech"]
            for field in required_fields:
                if field not in analysis_result:
                    if field == "fillerWords":
                        analysis_result[field] = {"um": 0, "ah": 0, "like": 0, "youKnow": 0, "actually": 0, "other": 0}
                    elif field in ["corrections", "weakSentences", "reusablePhrases", "actionPlan"]:
                        analysis_result[field] = []
                    elif field == "overallScore":
                        analysis_result[field] = 7
                    elif field == "insufficientSpeech":
                        analysis_result[field] = False
                    else:
                        analysis_result[field] = ""
            
            return analysis_result
        except Exception as exc:
            log.warning(f"Failed to parse Ollama JSON response: {exc}. Using fallback analysis.")
            return {
                "overallScore": 5,
                "summary": "Audio transcribed successfully. Local Ollama analysis returned invalid formatting.",
                "fillerWords": {"um": 0, "ah": 0, "like": 0, "youKnow": 0, "actually": 0, "other": 0},
                "corrections": [],
                "weakSentences": [],
                "reusablePhrases": [],
                "betterAnswer": "Your transcript: " + transcript,
                "actionPlan": ["Try speaking again or verify Ollama configuration."],
                "insufficientSpeech": False
            }

# ── Routes ────────────────────────────────────────────────────────────────────
@app.get("/health")
async def health():
    """
    Health-check endpoint checking Whisper and local Ollama status.
    """
    ollama_status = "unknown"
    ollama_error = None
    ollama_models = []
    
    async with httpx.AsyncClient() as client:
        try:
            res = await client.get("http://127.0.0.1:11434/api/tags", timeout=2.0)
            if res.status_code == 200:
                ollama_status = "ok"
                tags_data = res.json()
                ollama_models = [m.get("name") for m in tags_data.get("models", [])]
            else:
                ollama_status = f"error_http_{res.status_code}"
        except Exception as e:
            ollama_status = "unreachable"
            ollama_error = str(e)
            
    is_llama_available = any(m.startswith("llama3.2:3b") or m.startswith("llama3.2") for m in ollama_models)

    return {
        "status": "ok" if (model and ollama_status == "ok") else "degraded",
        "whisper": {
            "status": "ok" if model else "error",
            "model": MODEL_SIZE,
            "model_loaded": model is not None,
            "error": MODEL_LOAD_ERROR
        },
        "ollama": {
            "status": ollama_status,
            "reachable": ollama_status == "ok",
            "model_available": is_llama_available,
            "models": ollama_models,
            "error": ollama_error
        }
    }

@app.post("/analyze")
async def analyze(req: AnalysisRequest):
    """
    Analyze transcript using local Ollama model.
    """
    log.info(f"Analyzing transcript ({len(req.transcript.split())} words) with local Ollama...")
    result = await call_ollama_analysis(req.transcript, req.duration, req.mode)
    return JSONResponse(result)


@app.get("/diagnostics")
async def diagnostics():
    """
    Full diagnostics endpoint. Returns system info, ffmpeg status,
    Whisper model status, Ollama status, and recent error summary.
    Used by the Chrome extension Diagnostics panel.
    """
    import platform
    import shutil
    import sys as _sys

    # ffmpeg check
    ffmpeg_path = shutil.which("ffmpeg")
    ffmpeg_ok = ffmpeg_path is not None
    ffmpeg_version = None
    if ffmpeg_ok:
        try:
            result = subprocess.run(
                ["ffmpeg", "-version"],
                capture_output=True, text=True, timeout=5
            )
            first_line = result.stdout.splitlines()[0] if result.stdout else ""
            ffmpeg_version = first_line.split("version ")[1].split(" ")[0] if "version" in first_line else "unknown"
        except Exception:
            ffmpeg_version = "error"

    # Ollama check
    ollama_reachable = False
    ollama_models = []
    ollama_error = None
    model_name = "llama3.2:3b"
    model_available = False
    async with httpx.AsyncClient() as client:
        try:
            res = await client.get("http://127.0.0.1:11434/api/tags", timeout=2.0)
            if res.status_code == 200:
                ollama_reachable = True
                tags = res.json()
                ollama_models = [m.get("name") for m in tags.get("models", [])]
                model_available = any(m.startswith("llama3.2:3b") or m.startswith("llama3.2") for m in ollama_models)
        except Exception as e:
            ollama_error = str(e)

    return JSONResponse({
        "server": "ok",
        "timestamp": __import__('datetime').datetime.utcnow().isoformat() + "Z",
        "python": _sys.version,
        "platform": platform.platform(),
        "ffmpeg": {
            "available": ffmpeg_ok,
            "path": ffmpeg_path,
            "version": ffmpeg_version
        },
        "whisper": {
            "status": "ok" if model else "error",
            "model": MODEL_SIZE,
            "device": DEVICE,
            "compute_type": COMPUTE_TYPE,
            "model_loaded": model is not None,
            "error": MODEL_LOAD_ERROR
        },
        "ollama": {
            "reachable": ollama_reachable,
            "models": ollama_models,
            "target_model": model_name,
            "model_available": model_available,
            "error": ollama_error
        },
        "config": {
            "port": PORT,
            "host": HOST
        }
    })


@app.post("/transcribe")
async def transcribe(audio: UploadFile = File(...)):
    """
    Transcribe an audio file using faster-whisper.

    Accepts any format supported by ffmpeg:
        audio/webm, audio/ogg, audio/mp4, audio/wav, audio/mpeg ...

    Returns:
        { "text": "transcribed text here", "duration": 12.3, "language": "en" }
    """
    if model is None:
        raise HTTPException(
            status_code=503,
            detail=f"Whisper model failed to load: {MODEL_LOAD_ERROR}. Check server logs.",
        )

    # ── Read uploaded bytes ───────────────────────────────────────────────────
    audio_bytes = await audio.read()

    if len(audio_bytes) == 0:
        raise HTTPException(status_code=400, detail="Uploaded audio file is empty.")

    if len(audio_bytes) > MAX_FILE_SIZE:
        raise HTTPException(
            status_code=413,
            detail=f"Audio file is too large ({len(audio_bytes)//1024//1024} MB). Maximum is 200 MB.",
        )

    size_kb = len(audio_bytes) / 1024
    log.info(
        f"Transcribing: '{audio.filename or 'recording'}' | "
        f"{size_kb:.1f} KB | type: {audio.content_type}"
    )

    # ── Write to temp file (faster-whisper needs a file path) ────────────────
    suffix = _detect_extension(audio.content_type, audio.filename)
    tmp_path: Optional[Path] = None

    try:
        with tempfile.NamedTemporaryFile(suffix=suffix, delete=False) as tmp:
            tmp.write(audio_bytes)
            tmp_path = Path(tmp.name)

        # ── Transcribe ───────────────────────────────────────────────────────
        segments, info = model.transcribe(
            str(tmp_path),
            language="en",          # Hint: English interview audio
            beam_size=5,
            vad_filter=True,        # Skip long silent regions
            condition_on_previous_text=False,
            temperature=0.0,
            vad_parameters=dict(
                min_silence_duration_ms=500,
                speech_pad_ms=200,
            ),
        )

        # Collect all segment text
        text_parts = []
        for seg in segments:
            part = seg.text.strip()
            if part:
                text_parts.append(part)

        text = " ".join(text_parts).strip()

        # If empty, retry once with vad_filter=False
        if not text:
            log.warning("Empty transcription with vad_filter=True. Retrying with vad_filter=False...")
            segments, info = model.transcribe(
                str(tmp_path),
                language="en",
                beam_size=5,
                vad_filter=False,
                condition_on_previous_text=False,
                temperature=0.0,
            )
            text_parts = []
            for seg in segments:
                part = seg.text.strip()
                if part:
                    text_parts.append(part)
            text = " ".join(text_parts).strip()

        log.info(
            f"[OK] Done ({info.duration:.1f}s audio) -> "
            f"{len(text.split())} words: "
            f"{text[:80]}{'...' if len(text) > 80 else ''}"
        )

        return JSONResponse({
            "text": text,
            "language": info.language,
            "duration": round(info.duration, 2),
        })

    except HTTPException:
        raise  # Re-raise HTTP exceptions as-is
    except Exception as exc:
        log.error(f"Transcription error: {exc}", exc_info=True)
        raise HTTPException(
            status_code=500,
            detail=f"Transcription failed: {exc}. Check that ffmpeg is installed and on PATH.",
        )
    finally:
        # Always clean up the temp file
        if tmp_path and tmp_path.exists():
            try:
                tmp_path.unlink()
            except OSError:
                pass


# ── Helpers ───────────────────────────────────────────────────────────────────
def _detect_extension(content_type: Optional[str], filename: Optional[str]) -> str:
    """
    Return an appropriate temp-file extension so that ffmpeg can detect
    the audio container format correctly.
    """
    ct = (content_type or "").lower()
    if "ogg"  in ct: return ".ogg"
    if "mp4"  in ct: return ".mp4"
    if "wav"  in ct: return ".wav"
    if "mpeg" in ct or "mp3" in ct: return ".mp3"
    if "flac" in ct: return ".flac"
    if "m4a"  in ct: return ".m4a"

    # Fall back to filename extension
    if filename:
        ext = Path(filename).suffix.lower()
        if ext in SUPPORTED_EXTENSIONS:
            return ext

    # Default: MediaRecorder output is WebM
    return ".webm"


# ── Entry point ───────────────────────────────────────────────────────────────
if __name__ == "__main__":
    banner = f"""
+------------------------------------------------------+
|         TalkFlow Local Transcriber  v1.0             |
+------------------------------------------------------+
|  Model  : {MODEL_SIZE:<10}  Device : {DEVICE:<15}   |
|  Compute: {COMPUTE_TYPE:<10}  Port   : {PORT:<15}   |
|  URL    : http://{HOST}:{PORT}                |
+------------------------------------------------------+
|  Audio stays on YOUR computer - nothing is uploaded  |
|  Press Ctrl+C to stop the server                     |
+------------------------------------------------------+
"""
    print(banner)
    uvicorn.run(
        app,
        host=HOST,
        port=PORT,
        log_level="warning",   # Suppress uvicorn noise; our logger handles INFO
    )
