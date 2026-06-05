# Security Policy

## Supported Versions

We actively maintain the current open-source release of TalkFlow:

| Version | Supported          |
| ------- | ------------------ |
| 1.0.x   | :white_check_mark: |
| < 1.0   | :x:                |

---

## 🔒 Safe Credential Management

TalkFlow runs entirely client-side. There is no TalkFlow-owned backend server. Credential safety is your responsibility:

1.  **Gemini API Key (Optional):** If you configure a Gemini API key for cloud analysis, it is saved locally in your browser's extension storage sandbox. Do not use this tool on shared or public machines.
2.  **OpenAI API Key (Optional):** Similarly stored locally. Never paste it into bug reports or GitHub issues.
3.  **Google OAuth Token (Optional):** If you enable Google Drive sync, the OAuth access token is stored locally. It grants access only to TalkFlow's private `appDataFolder` — it cannot read any other Drive content.
4.  **Local Ollama & Whisper:** No credentials are required for local AI. These services run on `127.0.0.1` and are never exposed to the internet.
5.  **No Code Repository Exposure:** If you fork this project, **never** hardcode API keys, OAuth client secrets, or tokens inside any source file or commit them to a public branch.
6.  **Sanitize Debug Logs:** If you experience errors and submit a GitHub issue, sanitize console logs to remove any `key=AIzaSy...` API key parameters or bearer tokens from HTTP request URLs.

---

## 🛡️ Reporting a Vulnerability

If you discover a security vulnerability in this project (e.g. storage leaks, injection exploits, or token exposure):

1.  Please do **not** file a public issue on GitHub.
2.  Instead, send a detailed security report to the repository owner via email (refer to the GitHub repository homepage for contact options).
3.  Include a brief description of the issue, steps to reproduce, and any suggested remediation steps. We will review and publish a patch swiftly.
