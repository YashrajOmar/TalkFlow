# TalkFlow Privacy Policy

TalkFlow is built from the ground up to respect user privacy, adhering to a strict local-first data processing and storage model.

## 1. Local-First Data Collection & Storage
*   **Audio Recording & Timeslices:** During recording, audio is captured in 60-second timeslices and saved immediately to your browser's private `IndexedDB` database.
*   **No Automatic Cloud Upload:** Audio chunks are **never** automatically uploaded anywhere. Cloud audio backup is **OFF by default**. You must explicitly enable it and grant consent before any audio is sent off-device.
*   **Automatic Disposal:** Once transcription and analysis are completed, temporary audio chunks are permanently deleted from your local database (unless you have explicitly enabled Google Drive Audio Backup).
*   **Local Transcript & Analysis Database:** All transcribed speech, grammar evaluation reports, fluency scores, and practice cards are stored strictly in your browser's local sandbox using IndexedDB. We do not transmit this history to any TalkFlow-owned servers.

## 2. Server Architecture & Processing Options
You have full control over where your voice and text data are processed:

*   **Local Whisper Server (Default & Recommended):** Audio transcription is processed offline on your machine via the local faster-whisper server (`http://127.0.0.1:8765/transcribe`). No audio leaves your computer.
*   **Local Ollama Server (Default & Recommended):** Text transcripts are analyzed offline on your machine using Ollama and the `llama3.2:3b` model (`http://127.0.0.1:8765/analyze`). No text leaves your computer.
*   **Cloud Providers (Optional):** If you configure OpenAI Whisper or Google Gemini in settings, your audio and/or text will be sent directly to those third-party APIs using your personal API keys. This connection is direct from your browser; TalkFlow does not act as a middleman.
*   **No Silent Fallback:** TalkFlow will never silently fall back to a cloud provider if the local server is unavailable. You will see a clear error message and the option to retry.

## 3. Google Drive Sync & Authentication
*   **appDataFolder Scope:** TalkFlow's Google Drive sync uses the restricted `drive.appdata` scope. This restricts the extension to accessing *only* its own hidden application folder. TalkFlow cannot read or write any other files in your Google Drive.
*   **API Credentials:** Your OAuth tokens and settings are stored locally in your browser's extension settings sandbox.
*   **Audio Cloud Backup is OFF by default.** You must explicitly enable it in Settings → Google Drive Sync. A consent warning is displayed before enabling.

## 4. Shared Devices Warning
Because all data (including local recordings, analysis reports, and optional API keys) is stored inside your browser sandbox, do not install or configure TalkFlow on public, shared, or untrusted machines.
