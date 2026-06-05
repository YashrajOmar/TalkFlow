# TalkFlow: Privacy-First Interview English Coach

TalkFlow is a privacy-first web application and Google Chrome Extension that records practice or live interviews, transcribes your speech in real-time, and provides constructive AI feedback to help you correct broken English, reduce filler words, and polish your delivery.

## 🌟 Key Features
*   **Mode 1: Self Recording (Default):** Captures only your microphone. Zero legal or privacy risks.
*   **Mode 2: Full Interview Recording:** Captures your mic + the interviewer's tab audio. Requires explicit confirmation that you obtained consent from all participants before recording.
*   **Local-First Architecture:** All transcripts, metrics, and session history are stored strictly on your local device via browser `IndexedDB`.
*   **Bring Your Own Key (BYO-Key):** We do not run middleman servers. The extension sends transcript data directly from your browser to Google's Gemini API endpoints using your configured API key.
*   **Practice Arena:** A flashcard-style review dashboard with built-in text-to-speech standard voice guide and a mic repetition grading engine.
*   **No Remote Scripts:** Built with 100% bundled assets to comply with Google Chrome Web Store Manifest V3 guidelines.

---

## 🛠️ Getting Started

### Method A: Load as a Chrome Extension (Recommended)
1.  Clone this repository or download the `talkflow/` directory.
2.  Open Google Chrome and navigate to `chrome://extensions`.
3.  Toggle the **Developer mode** switch in the top-right corner.
4.  Click the **Load unpacked** button in the top-left.
5.  Select the `talkflow` directory.
6.  Click the Extension (puzzle piece) icon in your toolbar, pin **TalkFlow**, and click it to open the side panel!

### Method B: Run as a Standalone Web Page
Simply open `index.html` directly in any modern browser or run a simple local server:
```bash
npx serve .
```

### Method C: Run Fully Local (Free & Private - Recommended)
TalkFlow is designed to run entirely offline on your computer. Follow these steps to set up local transcription (via `faster-whisper`) and local speech analysis (via `Ollama`):

1. **Install Ollama**:
   * Download and install Ollama from [ollama.com](https://ollama.com).
   * Pull the default analysis model in your terminal:
     ```bash
     ollama pull llama3.2:3b
     ```
   * Make sure the Ollama app is running in the background.

2. **Set up the local TalkFlow server**:
   * Open your terminal and navigate to the transcriber directory:
     ```bash
     cd local-transcriber
     ```
   * Install the Python dependencies:
     ```bash
     pip install -r requirements.txt
     ```
     *Note: Ensure `ffmpeg` is installed and added to your system's PATH.*
   * Start the TalkFlow local server:
     ```bash
     python server.py
     ```

3. **Open TalkFlow**:
   * Load the Chrome extension, go to settings, and verify that **Local Transcriber** and **Local Ollama** are selected (they are active by default). Your recordings, transcriptions, and analyses are processed 100% locally!

---

### Method D: Google Drive Sync Setup (Optional)
TalkFlow supports syncing your session history and practice cards to a private Google Drive `appDataFolder` so you never lose your data. To enable this, you must configure a Google Cloud OAuth client ID:

1. **Get your Chrome Extension ID**:
   * Open `chrome://extensions` in Google Chrome.
   * Locate the loaded **TalkFlow - Interview Speech Coach** extension and copy its ID (a 32-character string, e.g. `obkblbjgokcagpdhech...`).

2. **Configure Google Cloud Console**:
   * Go to the [Google Cloud Console](https://console.cloud.google.com/).
   * Create a new project or select an existing one.
   * Go to **APIs & Services > OAuth consent screen**. Complete the required app details (select User Type *External* or *Internal*).
   * Go to **Credentials**. Click **+ Create Credentials** and select **OAuth client ID**.
   * Under **Application type**, choose **Chrome app**.
   * Enter a name and paste your 32-character **Application ID** in the field.
   * Click **Create** and copy the generated **Client ID**.

3. **Update Manifest File**:
   * Open `talkflow/manifest.json`.
   * Find the `"oauth2"` section and replace the placeholder client ID under `"client_id"` with your copied Google Client ID.
   * Go back to `chrome://extensions` and click the **Reload** icon on the TalkFlow extension card to apply the changes.

---

## 🔒 Security & Privacy Policy
TalkFlow is designed with strict data privacy guidelines:
1.  **No Server Uploads:** Your voice recordings and transcriptions are never transmitted to any third-party developer servers.
2.  **API Key Safety:** Your Gemini API key is stored locally in your browser's local settings. Do not configure this extension on shared or untrusted machines.
3.  **Automatic Audio Disposal:** Recorded voice segments are temporarily stored in browser IndexedDB during a session and are permanently deleted immediately after the local Whisper or cloud evaluation completes (unless cloud audio backup is explicitly turned ON by the user).

Please read [privacy.md](./privacy.md) and [consent.md](./consent.md) for full terms.
