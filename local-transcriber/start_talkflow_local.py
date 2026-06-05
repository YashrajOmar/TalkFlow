#!/usr/bin/env python3
"""
TalkFlow Local Companion Launcher
===================================
Starts the TalkFlow local Whisper + Ollama server.
Double-click or run from terminal — no Python knowledge required.

Usage:
    python start_talkflow_local.py

Or use the batch file:
    start-talkflow-local.bat
"""

import os
import sys
import time
import socket
import subprocess
import threading

PORT = 8765
HOST = "127.0.0.1"
SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
SERVER_SCRIPT = os.path.join(SCRIPT_DIR, "server.py")

# ─── Helpers ──────────────────────────────────────────────────────────────────

def _port_open(host=HOST, port=PORT) -> bool:
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
        s.settimeout(0.5)
        return s.connect_ex((host, port)) == 0


def _fetch_health() -> dict | None:
    """Lightweight HTTP GET without requiring requests/httpx."""
    import http.client, json as _json
    try:
        conn = http.client.HTTPConnection(HOST, PORT, timeout=3)
        conn.request("GET", "/health")
        resp = conn.getresponse()
        if resp.status == 200:
            return _json.loads(resp.read().decode())
    except Exception:
        pass
    return None


def _print_status(health: dict):
    whisper = health.get("whisper", {})
    ollama  = health.get("ollama", {})

    w_ok = whisper.get("status") == "ok"
    o_ok = ollama.get("status") == "ok"
    m_ok = ollama.get("model_available", False)
    models = ollama.get("models", [])

    print()
    print(f"  {'✅' if w_ok else '❌'}  Whisper ({whisper.get('model', '?')}) — "
          f"{'Ready' if w_ok else 'Not loaded — check server logs'}")
    print(f"  {'✅' if o_ok else '⚠️ '}  Ollama          — "
          f"{'Running' if o_ok else 'Not running  →  start Ollama app and try again'}")
    print(f"  {'✅' if m_ok else '⚠️ '}  llama3.2:3b     — "
          f"{'Available' if m_ok else 'Not pulled   →  run: ollama pull llama3.2:3b'}")
    if models:
        print(f"       Available models: {', '.join(models)}")


def _stream_server_output(proc):
    """Print server stdout in the background so the user can see logs."""
    for line in iter(proc.stdout.readline, ""):
        if line:
            print(line.rstrip())


# ─── Main ─────────────────────────────────────────────────────────────────────

def main():
    print()
    print("╔══════════════════════════════════════════════════════╗")
    print("║          TalkFlow Local Companion  v1.0              ║")
    print("║  Privacy-first interview coach — runs 100% locally   ║")
    print("╚══════════════════════════════════════════════════════╝")
    print()

    # ── Already running? ──────────────────────────────────────────────────────
    if _port_open():
        print(f"  ✅  TalkFlow Local Server is already running on port {PORT}.")
        health = _fetch_health()
        if health:
            _print_status(health)
        else:
            print("  ⚠️   Could not read health data. The server may still be starting.")

        print()
        print("  Open Chrome and start TalkFlow — everything is ready!")
        print("  Press Ctrl+C to close this window (server keeps running).")
        print()
        try:
            while True:
                time.sleep(5)
        except KeyboardInterrupt:
            print("\n  Companion window closed. Server stays running in background.")
        return

    # ── Validate server script ─────────────────────────────────────────────────
    if not os.path.isfile(SERVER_SCRIPT):
        print(f"  ❌  Cannot find server.py at: {SERVER_SCRIPT}")
        print("  Make sure you run this from inside the local-transcriber/ directory.")
        input("\n  Press Enter to close...")
        sys.exit(1)

    print(f"  ▶   Starting TalkFlow Local Server on http://{HOST}:{PORT} ...")
    print("      (First launch downloads the Whisper model — this may take 1-2 minutes.)")
    print()

    # ── Launch server ──────────────────────────────────────────────────────────
    try:
        proc = subprocess.Popen(
            [sys.executable, SERVER_SCRIPT],
            stdout=subprocess.PIPE,
            stderr=subprocess.STDOUT,
            text=True,
            bufsize=1,
        )
    except Exception as exc:
        print(f"  ❌  Failed to start server: {exc}")
        input("\n  Press Enter to close...")
        sys.exit(1)

    # Stream server logs in background thread
    log_thread = threading.Thread(target=_stream_server_output, args=(proc,), daemon=True)
    log_thread.start()

    # ── Wait for server to become responsive (up to 120s for model download) ───
    print("  Waiting for server to become ready", end="", flush=True)
    ready = False
    for _ in range(240):          # 240 × 0.5s = 120 seconds
        time.sleep(0.5)
        print(".", end="", flush=True)
        if _port_open():
            ready = True
            break

    print()

    if not ready:
        print()
        print("  ❌  Server did not start within 120 seconds.")
        print("  Check that faster-whisper is installed:  pip install -r requirements.txt")
        print("  And that ffmpeg is on PATH:               ffmpeg -version")
        proc.terminate()
        input("\n  Press Enter to close...")
        sys.exit(1)

    # ── Health check ───────────────────────────────────────────────────────────
    health = _fetch_health()
    if health:
        _print_status(health)

    print()
    print("╔══════════════════════════════════════════════════════╗")
    print("║  ✅  TalkFlow Local Server is running!               ║")
    print("║  Open Chrome → click TalkFlow → Start Recording      ║")
    print("║  Press Ctrl+C here to stop the server.               ║")
    print("╚══════════════════════════════════════════════════════╝")
    print()

    # ── Keep alive until user presses Ctrl+C or server exits ──────────────────
    try:
        while proc.poll() is None:
            time.sleep(1)
        print("\n  ⚠️  TalkFlow server exited unexpectedly.")
    except KeyboardInterrupt:
        print("\n  Stopping TalkFlow Local Server...")
        proc.terminate()
        try:
            proc.wait(timeout=5)
        except subprocess.TimeoutExpired:
            proc.kill()
        print("  Server stopped. Goodbye!")


if __name__ == "__main__":
    main()
