# TalkFlow: Privacy-First Interview English Coach

TalkFlow is a privacy-first Chrome Extension that records practice or live interviews, transcribes your speech locally using **faster-whisper**, and provides AI fluency feedback using **Ollama (llama3.2:3b)** — all 100% on your own machine, no cloud API key required.

## 🌟 Key Features
*   **Local-First by Default:** Transcription via local faster-whisper. Analysis via local Ollama. No data leaves your machine.
*   **Mode 1 – Self Recording:** Captures only your microphone. Zero privacy risks.
*   **Mode 2 – Full Interview:** Captures your mic + the interviewer's browser tab audio (requires explicit consent from all participants).
*   **Auto-Start Server:** TalkFlow can auto-launch the local server via the Native Companion (optional) or you can double-click the launcher.
*   **Practice Arena:** Flashcard-style review with text-to-speech and mic grading.
*   **Cloud Providers Optional:** Switch to OpenAI Whisper or Google Gemini if you prefer — your API key, your choice.
*   **No Remote Scripts:** 100% bundled assets. Compliant with Chrome Web Store Manifest V3.

---

## 🚀 Quick Start (5 Steps)

### Step 1 — Install Ollama
Download and install from **[ollama.com](https://ollama.com)**. Then pull the model:
```bash
ollama pull llama3.2:3b
```
Start Ollama and leave it running in the background.

### Step 2 — Install Python dependencies (first time only)
```bash
cd local-transcriber
pip install -r requirements.txt
```
> **Note:** `ffmpeg` must be on your PATH. Download from [ffmpeg.org](https://ffmpeg.org/download.html).

### Step 3 — Start TalkFlow Local Companion
**Option A — Double-click (easiest):**
> `start-talkflow-local.bat` (in the project root)

**Option B — Terminal:**
```bash
python local-transcriber/start_talkflow_local.py
```

Wait for the companion window to show **"✅ TalkFlow Local Server is running!"**

### Step 4 — Load the Chrome Extension
1. Open Chrome → `chrome://extensions`
2. Enable **Developer mode** (top-right toggle)
3. Click **Load unpacked** → select the `talkflow/` folder
4. Pin TalkFlow from the Extensions toolbar → click it to open the side panel

### Step 5 — Record
Click **Start Recording** → speak → click **End Session & Analyze**. That's it.

---

## 🤖 Auto-Start via Native Companion (Optional)

The Native Companion lets Chrome start the local server **automatically** when you click Start Recording — no manual BAT file needed.

### Setup (Windows)
1. Load the TalkFlow extension and copy its **Extension ID** from `chrome://extensions`
2. Double-click `local-transcriber/install_native_host_windows.bat`
3. Paste the Extension ID when prompted

After setup, clicking Start Recording auto-launches the local server. No terminal required.

### Setup (macOS / Linux)
1. Make `native_host.py` executable: `chmod +x local-transcriber/native_host.py`
2. Create the native messaging host manifest at:
   - **macOS:** `~/Library/Application Support/Google/Chrome/NativeMessagingHosts/com.talkflow.local.json`
   - **Linux:** `~/.config/google-chrome/NativeMessagingHosts/com.talkflow.local.json`
3. Manifest content (update paths):
```json
{
  "name": "com.talkflow.local",
  "description": "TalkFlow Local Companion",
  "path": "/absolute/path/to/local-transcriber/native_host.py",
  "type": "stdio",
  "allowed_origins": ["chrome-extension://YOUR_EXTENSION_ID/"]
}
```
4. Reload the extension.

### To uninstall Native Host (Windows)
```batch
reg delete "HKCU\Software\Google\Chrome\NativeMessagingHosts\com.talkflow.local" /f
```

---

## 📦 Package as Standalone Executable (optional)

Bundle the companion into a single `.exe` so users don't need Python installed:

```bash
pip install pyinstaller
pyinstaller --onefile --name TalkFlowLocal local-transcriber/start_talkflow_local.py
```

The executable will be in `dist/TalkFlowLocal.exe`. Update the native host manifest path to point to this `.exe` for a fully self-contained setup.

---

## ⚙️ Method D — Google Drive Sync Setup (Optional)

TalkFlow can sync session history and practice cards to a private Google Drive `appDataFolder`.

1. **Get your Extension ID** from `chrome://extensions`
2. **Go to [Google Cloud Console](https://console.cloud.google.com/)** → Create project → APIs & Services → OAuth consent screen → Credentials → Chrome App OAuth client
3. **Paste the generated Client ID** into `talkflow/manifest.json` under `"oauth2"."client_id"`
4. **Reload the extension** at `chrome://extensions`

---

## 🔒 Security & Privacy

1. **No Server Uploads:** Voice and transcripts never reach any TalkFlow-owned server.
2. **No Silent Cloud Fallback:** If the local server is offline, TalkFlow shows an offline modal. You choose what to do next.
3. **API Key Safety:** Any cloud API keys are stored locally in browser extension storage only.
4. **Automatic Audio Disposal:** Recorded chunks are deleted from IndexedDB after analysis completes (unless cloud audio backup is explicitly enabled).
5. **Cloud Audio Backup is OFF by default.**

See [privacy.md](./privacy.md), [terms.md](./terms.md), and [SECURITY.md](./SECURITY.md) for full details.

---

## 🔮 Future: Deeper Native Companion Integration

The current MVP uses the native messaging host to start the server on demand. A future version could:
- Add a system tray icon (via `pystray`) for persistent background operation
- Support auto-start at Windows login via a Run key registry entry
- Bundle Ollama inside the companion for a fully zero-setup experience
- Provide a GUI status dashboard (via `tkinter` or Electron)
