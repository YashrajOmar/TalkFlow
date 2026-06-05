# Security Policy

## Supported Versions

We actively maintain the current open-source release of TalkFlow:

| Version | Supported          |
| ------- | ------------------ |
| 1.0.x   | :white_check_mark: |
| < 1.0   | :x:                |

---

## 🔒 Safe Credential Management

TalkFlow runs entirely client-side. There is no backend server. This shifts the responsibility of credential safety to you, the user:

1.  **Do Not Expose Your API Key:** Your Gemini API Key is saved locally in this browser's database. Do not use this tool on public library terminals, internet cafes, or shared user accounts.
2.  **No Code Repository Exposure:** If you fork this project or create a pull request on GitHub, **never** hardcode your API key inside `gemini-api.js` or commit variables to a public branch.
3.  **Sanitize Debug Logs:** If you experience errors and submit a GitHub issue, make sure to sanitize your screenshot or console copy-paste logs to remove the `key=AIzaSy...` API key parameters from HTTP request URLs.

---

## 🛡️ Reporting a Vulnerability

If you discover a security vulnerability in this project (e.g. storage leaks or injection exploits):

1.  Please do **not** file a public issue on GitHub.
2.  Instead, send a detailed security report to the repository owner via email (refer to the GitHub repository homepage for contact options).
3.  Include a brief description of the issue, steps to reproduce, and any suggested remediation steps. We will review and publish a patch swiftly.
