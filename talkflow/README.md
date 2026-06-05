# TalkFlow — Privacy-First Interview English Coach

> Record. Transcribe. Improve. 100% on your computer. No cloud required.

TalkFlow is a Chrome extension that records your interview practice, transcribes it locally using **faster-whisper**, and gives you AI fluency coaching using **Ollama (llama3.2:3b)** — all running entirely on your own machine.

---

## ⚡ Customer Quick Start (3 Steps)

### Step 1 — Install TalkFlow Companion

Download and run **TalkFlowCompanionSetup.exe** from the [Releases page](https://github.com/YashrajOmar/TalkFlow/releases).

The installer:
- Installs the local AI server (faster-whisper + Ollama bridge)
- Registers the native messaging host so Chrome can auto-start the server
- Optionally starts the companion at Windows login

> **You do not need to install Python, pip, ffmpeg, or Ollama manually.** The installer handles everything.

---

### Step 2 — Install TalkFlow Chrome Extension

1. Open Chrome → `chrome://extensions`
2. Enable **Developer mode** (top-right toggle)
3. Click **Load unpacked** → select the `talkflow/` folder
4. Pin TalkFlow from the Extensions toolbar

> **Note:** When TalkFlow is published to the Chrome Web Store, this step will be a single click.

---

### Step 3 — Click Start Recording

Open the TalkFlow side panel → click **Start Recording**.

TalkFlow will automatically check if the local AI server is running, start it if needed, and begin recording. The first launch may take up to 60 seconds while AI models load.

That's it. 🎉

---

## 🔬 Developer Setup

Only follow this section if you want to run TalkFlow from source without the installer.

### Prerequisites

| Tool | Install |
|---|---|
| Python 3.10+ | [python.org](https://python.org) |
| Ollama | [ollama.com](https://ollama.com) |
| ffmpeg | [ffmpeg.org](https://ffmpeg.org/download.html) |
| Git | [git-scm.com](https://git-scm.com) |

### 1 — Pull the Ollama model
```bash
ollama pull llama3.2:3b
```
Start Ollama and leave it running.

### 2 — Install Python dependencies
```bash
cd local-transcriber
pip install -r requirements.txt
```

### 3 — Start the local server

**Option A — Double-click launcher** (recommended):
```
start-talkflow-local.bat
```

**Option B — Terminal**:
```bash
python local-transcriber/start_talkflow_local.py
```

**Option C — Direct server start**:
```bash
python local-transcriber/server.py
```

Wait for "Server is running!" in the terminal output.

### 4 — Load the Chrome extension

1. Chrome → `chrome://extensions` → Developer mode ON
2. Load unpacked → select `talkflow/`
3. Pin and open TalkFlow

### 5 — (Optional) Register Native Messaging Host

This lets TalkFlow auto-start the server when you click Start Recording — no terminal needed.

```
local-transcriber/install_native_host_windows.bat
```

The script reads the extension ID from `talkflow_companion_config.json` automatically, or prompts you once.

To uninstall:
```
reg delete "HKCU\Software\Google\Chrome\NativeMessagingHosts\com.talkflow.local" /f
```

---

## 🏗️ Building the Windows Installer

### Step 1 — Build the executable
```powershell
powershell -ExecutionPolicy Bypass -File scripts/build_windows_companion.ps1

# With bundled ffmpeg (recommended for distribution):
powershell -ExecutionPolicy Bypass -File scripts/build_windows_companion.ps1 -IncludeFFmpeg
```
Output: `dist/TalkFlowLocal/`

### Step 2 — Build the installer
```
iscc installer/windows/TalkFlowCompanion.iss
```
Output: `installer/output/TalkFlowCompanionSetup.exe`

Requires [Inno Setup](https://jrsoftware.org/isinfo.php).

### Updating the published Extension ID

Before building the installer:
1. Publish the extension to Chrome Web Store
2. Copy the extension ID
3. Update `local-transcriber/talkflow_companion_config.json`:
   ```json
   { "extensionId": "your32charextensionidhere..." }
   ```
4. Update `installer/windows/TalkFlowCompanion.iss`:
   ```ini
   #define ExtensionId "your32charextensionidhere..."
   ```
5. Rebuild the installer

---

## 🧪 Running Tests

```bash
pip install pytest httpx

# Run all tests (requires server running for @live tests)
pytest tests/ -v

# Run only tests that work without the server
pytest tests/ -v -m "not live and not offline"

# Run live tests (server must be running on port 8765)
pytest tests/ -v -m live

# Run offline tests (server must be STOPPED)
pytest tests/ -v -m offline
```

---

## 🔧 Server API

| Endpoint | Method | Description |
|---|---|---|
| `/health` | GET | Whisper + Ollama status |
| `/diagnostics` | GET | Full system info (ffmpeg, Python, models) |
| `/transcribe` | POST | Audio → text (faster-whisper) |
| `/analyze` | POST | Transcript → coaching JSON (Ollama) |

---

## 🌐 Cloud Providers (Optional)

TalkFlow defaults to local-only. If you prefer cloud transcription or analysis:

| Provider | Setup |
|---|---|
| **OpenAI Whisper** | Add API key in Settings → Transcription Provider |
| **Google Gemini** | Add API key in Settings → Transcription Provider |

**TalkFlow never silently uploads audio to the cloud.** If the local server is offline, TalkFlow shows a clear error with a "Use Cloud" option that requires your explicit action.

---

## ☁️ Google Drive Sync (Optional)

Sync session history across devices using your own Google Drive.

1. Go to [Google Cloud Console](https://console.cloud.google.com/) → Create project
2. APIs & Services → OAuth consent screen → Credentials → Chrome App OAuth client
3. Paste your Extension ID in the Application ID field
4. Copy the generated Client ID
5. Update `talkflow/manifest.json` `"oauth2"."client_id"`
6. Reload the extension

---

## 🔒 Privacy & Security

- **No server uploads** — audio never leaves your machine by default
- **No silent cloud fallback** — local failures show clear errors, not silent rerouting  
- **API keys stored locally** — in Chrome extension storage only
- **Audio disposed after analysis** — temporary IndexedDB chunks deleted after session
- **Cloud audio backup is OFF by default**

See [privacy.md](talkflow/privacy.md), [terms.md](talkflow/terms.md), [SECURITY.md](talkflow/SECURITY.md).

---

## 🔮 Roadmap

- [ ] Windows system tray icon (minimize to tray)
- [ ] macOS / Linux native companion
- [ ] Chrome Web Store release (one-click install)
- [ ] Bundled Ollama inside the companion installer
- [ ] Video mode (screen + mic capture analysis)
- [ ] Multi-language support

See [ROADMAP.md](talkflow/ROADMAP.md) for the full list.

---

## 📂 Project Structure

```
TalkFlow/
├── talkflow/                    # Chrome extension
│   ├── manifest.json
│   ├── app.js                   # Main UI logic
│   ├── background.js            # Service worker + native messaging bridge
│   ├── transcription-api.js     # Whisper/Gemini/OpenAI API calls
│   └── ...
├── local-transcriber/           # Local server
│   ├── server.py                # FastAPI server (Whisper + Ollama)
│   ├── native_host.py           # Chrome Native Messaging host v2.0
│   ├── start_talkflow_local.py  # Companion launcher
│   ├── talkflow_companion_config.json
│   └── install_native_host_windows.bat
├── scripts/
│   └── build_windows_companion.ps1
├── installer/
│   └── windows/
│       └── TalkFlowCompanion.iss
├── tests/
│   └── test_companion.py
└── start-talkflow-local.bat     # Root double-click launcher
```
