#!/usr/bin/env python3
"""
TalkFlow Native Messaging Host  v2.0
======================================
Allows the Chrome extension to start/stop/query/auto-prepare the local
TalkFlow server without the user touching a terminal.

Registered as native host:  com.talkflow.local
Protocol:  Chrome Native Messaging (length-prefixed JSON over stdin/stdout)

Supported actions:
    { "action": "ping"         }  confirm host is alive
    { "action": "health"       }  check if port 8765 is open
    { "action": "ensureReady" }  full readiness check + auto-fix
    { "action": "startServer"  }  start server.py if not running
    { "action": "stopServer"   }  stop the server we started
    { "action": "openLogs"     }  open log file
    { "action": "diagnostics"  }  fetch /diagnostics from running server

CLI flags:
    --background   Start server.py and keep it alive as a background service.
                   Logs to %LOCALAPPDATA%\TalkFlow\logs\talkflow.log
                   No console window — designed for installer startup entry.
"""

import os
import sys
import json
import struct
import socket
import time
import subprocess
import shutil
import logging
import platform
from pathlib import Path

# ─── Paths ────────────────────────────────────────────────────────────────────
SCRIPT_DIR   = Path(os.path.dirname(os.path.abspath(__file__)))
SERVER_SCRIPT = SCRIPT_DIR / "server.py"
CONFIG_FILE  = SCRIPT_DIR / "talkflow_companion_config.json"

if sys.platform == "win32":
    LOG_DIR = Path(os.environ.get("LOCALAPPDATA", str(SCRIPT_DIR))) / "TalkFlow" / "logs"
else:
    LOG_DIR = Path.home() / ".talkflow" / "logs"

LOG_DIR.mkdir(parents=True, exist_ok=True)
LOG_PATH = LOG_DIR / "talkflow.log"
NATIVE_LOG_PATH = SCRIPT_DIR / "native_host.log"

# ─── Logging ──────────────────────────────────────────────────────────────────
# stdout/stderr are reserved for the Chrome protocol. Log ONLY to file.
logging.basicConfig(
    filename=str(NATIVE_LOG_PATH),
    level=logging.INFO,
    format="%(asctime)s %(levelname)s %(message)s",
    datefmt="%H:%M:%S",
)
log = logging.getLogger("native_host")

# ─── Config ───────────────────────────────────────────────────────────────────
def _load_config() -> dict:
    if CONFIG_FILE.exists():
        try:
            return json.loads(CONFIG_FILE.read_text(encoding="utf-8"))
        except Exception:
            pass
    return {"serverPort": 8765, "defaultModel": "llama3.2:3b"}

CONFIG     = _load_config()
PORT       = int(CONFIG.get("serverPort", 8765))
HOST       = "127.0.0.1"
MODEL_NAME = CONFIG.get("defaultModel", "llama3.2:3b")
OLLAMA_URL = "http://127.0.0.1:11434"

# ─── Globals ──────────────────────────────────────────────────────────────────
_server_proc: "subprocess.Popen | None" = None


# ═══════════════════════════════════════════════════════════════════════════════
# Chrome Native Messaging Protocol
# ═══════════════════════════════════════════════════════════════════════════════

def read_message() -> dict:
    """Read one length-prefixed JSON message from Chrome via stdin."""
    raw_len = sys.stdin.buffer.read(4)
    if len(raw_len) < 4:
        log.info("stdin closed — Chrome disconnected")
        sys.exit(0)
    msg_len = struct.unpack("=I", raw_len)[0]
    raw_msg = sys.stdin.buffer.read(msg_len)
    return json.loads(raw_msg.decode("utf-8"))


def send_message(obj: dict) -> None:
    """Write one length-prefixed JSON response to Chrome via stdout."""
    encoded = json.dumps(obj).encode("utf-8")
    sys.stdout.buffer.write(struct.pack("=I", len(encoded)))
    sys.stdout.buffer.write(encoded)
    sys.stdout.buffer.flush()


# ═══════════════════════════════════════════════════════════════════════════════
# Low-level helpers
# ═══════════════════════════════════════════════════════════════════════════════

def _port_open(host: str = HOST, port: int = PORT) -> bool:
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
        s.settimeout(0.5)
        return s.connect_ex((host, port)) == 0


def _http_get(url: str, timeout: float = 3.0):
    """Simple stdlib HTTP GET — avoids requiring requests/httpx in host."""
    import http.client
    from urllib.parse import urlparse
    parsed = urlparse(url)
    conn = http.client.HTTPConnection(parsed.hostname, parsed.port or 80, timeout=timeout)
    conn.request("GET", parsed.path or "/")
    resp = conn.getresponse()
    body = resp.read().decode("utf-8")
    conn.close()
    return resp.status, body


def _http_post(url: str, body: str, timeout: float = 120.0):
    """Simple stdlib HTTP POST for triggering ollama pull."""
    import http.client
    from urllib.parse import urlparse
    parsed = urlparse(url)
    conn = http.client.HTTPConnection(parsed.hostname, parsed.port or 80, timeout=timeout)
    conn.request("POST", parsed.path or "/", body=body.encode("utf-8"),
                 headers={"Content-Type": "application/json"})
    resp = conn.getresponse()
    out = resp.read().decode("utf-8")
    conn.close()
    return resp.status, out


def _popen_server() -> "subprocess.Popen":
    global _server_proc
    kwargs: dict = {}
    if sys.platform == "win32":
        kwargs["creationflags"] = subprocess.CREATE_NO_WINDOW
    # Redirect server stdout/stderr to the log file so the companion is silent
    log_fh = open(str(LOG_PATH), "a", encoding="utf-8")
    kwargs["stdout"] = log_fh
    kwargs["stderr"] = log_fh
    _server_proc = subprocess.Popen([sys.executable, str(SERVER_SCRIPT)], **kwargs)
    log.info("popen_server: PID %d — logs → %s", _server_proc.pid, LOG_PATH)
    return _server_proc


# ═══════════════════════════════════════════════════════════════════════════════
# Action implementations
# ═══════════════════════════════════════════════════════════════════════════════

def _action_start_server() -> dict:
    global _server_proc

    if _port_open():
        log.info("startServer: already running")
        return {"started": False, "reason": "already_running", "serverRunning": True}

    if not SERVER_SCRIPT.exists():
        log.error("server.py not found at %s", SERVER_SCRIPT)
        return {"started": False, "reason": "server_script_missing", "serverRunning": False}

    try:
        _popen_server()
    except Exception as exc:
        log.error("startServer: Popen failed: %s", exc)
        return {"started": False, "reason": str(exc), "serverRunning": False}

    # Wait up to 30s for port to open (model download takes time on first run)
    for _ in range(60):
        time.sleep(0.5)
        if _port_open():
            log.info("startServer: port %d open", PORT)
            return {"started": True, "serverRunning": True}

    log.warning("startServer: timeout waiting for port")
    return {"started": False, "reason": "timeout", "serverRunning": False}


def _action_stop_server() -> dict:
    global _server_proc
    if _server_proc and _server_proc.poll() is None:
        pid = _server_proc.pid
        _server_proc.terminate()
        try:
            _server_proc.wait(timeout=5)
        except subprocess.TimeoutExpired:
            _server_proc.kill()
        log.info("stopServer: terminated PID %d", pid)
        _server_proc = None
        return {"stopped": True}
    return {"stopped": False, "reason": "not_managed_by_host"}


def _action_ensure_ready() -> dict:
    """
    Full readiness check + auto-fix. Called before recording starts.

    Checks in order:
      1. ffmpeg available
      2. server.py exists
      3. Local server port open (start if closed, wait up to 30s)
      4. Ollama reachable
      5. llama3.2:3b model available (attempt pull if missing)

    Returns a flat JSON describing each component's status.
    """
    log.info("ensureReady: starting checks")

    # ── 1. ffmpeg ──────────────────────────────────────────────────────────────
    ffmpeg_path = shutil.which("ffmpeg")
    if not ffmpeg_path:
        log.warning("ensureReady: ffmpeg not found")
        return {
            "ok": False,
            "stage": "ffmpeg_missing",
            "server": "unknown",
            "whisper": "unknown",
            "ffmpeg": "missing",
            "ollama": "unknown",
            "model": MODEL_NAME,
            "message": "ffmpeg is not installed or not on PATH.",
            "fix": "Install TalkFlow Companion (which bundles ffmpeg) or install ffmpeg from ffmpeg.org and add it to PATH."
        }

    # ── 2. server.py exists ────────────────────────────────────────────────────
    if not SERVER_SCRIPT.exists():
        log.error("ensureReady: server.py missing")
        return {
            "ok": False,
            "stage": "server_script_missing",
            "server": "error",
            "whisper": "unknown",
            "ffmpeg": "ready",
            "ollama": "unknown",
            "model": MODEL_NAME,
            "message": "TalkFlow server.py not found.",
            "fix": "Reinstall TalkFlow Companion."
        }

    # ── 3. Local server ────────────────────────────────────────────────────────
    if not _port_open():
        log.info("ensureReady: server not running — starting")
        try:
            _popen_server()
        except Exception as exc:
            return {
                "ok": False, "stage": "server_start_failed",
                "server": "error", "whisper": "unknown",
                "ffmpeg": "ready", "ollama": "unknown", "model": MODEL_NAME,
                "message": f"Failed to start TalkFlow server: {exc}",
                "fix": "Restart TalkFlow Companion or run start-talkflow-local.bat."
            }

        # Poll up to 60s (first launch downloads Whisper model)
        started = False
        for _ in range(120):
            time.sleep(0.5)
            if _port_open():
                started = True
                break

        if not started:
            return {
                "ok": False, "stage": "server_timeout",
                "server": "timeout", "whisper": "unknown",
                "ffmpeg": "ready", "ollama": "unknown", "model": MODEL_NAME,
                "message": "TalkFlow server did not start within 60 seconds.",
                "fix": "Check that Python packages are installed. Run start-talkflow-local.bat to see error details."
            }
        log.info("ensureReady: server started")
    else:
        log.info("ensureReady: server already running")

    # ── 4. Read /health from server ────────────────────────────────────────────
    whisper_status = "unknown"
    try:
        status, body = _http_get(f"http://{HOST}:{PORT}/health", timeout=5.0)
        if status == 200:
            health = json.loads(body)
            w = health.get("whisper", {})
            whisper_status = "ready" if w.get("status") == "ok" else "error"
            if whisper_status == "error":
                err_msg = w.get("error", "Unknown Whisper error")
                return {
                    "ok": False, "stage": "whisper_error",
                    "server": "running", "whisper": "error",
                    "ffmpeg": "ready", "ollama": "unknown", "model": MODEL_NAME,
                    "message": f"Whisper model failed to load: {err_msg}",
                    "fix": "Ensure faster-whisper is installed and ffmpeg is on PATH."
                }
    except Exception as e:
        log.warning("ensureReady: /health fetch failed: %s", e)
        whisper_status = "unknown"

    # ── 5. Ollama ──────────────────────────────────────────────────────────────
    ollama_ok = False
    model_ok = False
    try:
        status, body = _http_get(f"{OLLAMA_URL}/api/tags", timeout=3.0)
        if status == 200:
            ollama_ok = True
            tags = json.loads(body)
            models = [m.get("name", "") for m in tags.get("models", [])]
            model_ok = any(m.startswith("llama3.2:3b") or m.startswith("llama3.2") for m in models)
    except Exception as e:
        log.warning("ensureReady: Ollama unreachable: %s", e)

    if not ollama_ok:
        return {
            "ok": False, "stage": "ollama_missing",
            "server": "running", "whisper": whisper_status,
            "ffmpeg": "ready", "ollama": "offline", "model": MODEL_NAME,
            "message": "Ollama is not installed or not running.",
            "fix": "Install TalkFlow Companion (includes Ollama) or install Ollama from ollama.com and start it."
        }

    if not model_ok:
        log.info("ensureReady: %s not found — attempting pull", MODEL_NAME)
        # Attempt to pull the model (may take a few minutes on first run)
        try:
            pull_status, _ = _http_post(
                f"{OLLAMA_URL}/api/pull",
                json.dumps({"name": MODEL_NAME, "stream": False}),
                timeout=300.0   # model pulls can be slow
            )
            # Re-check after pull
            status2, body2 = _http_get(f"{OLLAMA_URL}/api/tags", timeout=3.0)
            if status2 == 200:
                tags2 = json.loads(body2)
                models2 = [m.get("name", "") for m in tags2.get("models", [])]
                model_ok = any(m.startswith("llama3.2:3b") or m.startswith("llama3.2") for m in models2)
        except Exception as pull_err:
            log.warning("ensureReady: model pull failed: %s", pull_err)

        if not model_ok:
            return {
                "ok": False, "stage": "model_missing",
                "server": "running", "whisper": whisper_status,
                "ffmpeg": "ready", "ollama": "ready", "model": MODEL_NAME,
                "message": f"{MODEL_NAME} model is not downloaded.",
                "fix": f"Open a terminal and run: ollama pull {MODEL_NAME}"
            }

    log.info("ensureReady: all checks passed")
    return {
        "ok": True,
        "server": "running",
        "whisper": whisper_status,
        "ffmpeg": "ready",
        "ollama": "ready",
        "model": MODEL_NAME,
        "message": "TalkFlow is ready"
    }


# ═══════════════════════════════════════════════════════════════════════════════
# Background daemon mode (--background flag)
# ═══════════════════════════════════════════════════════════════════════════════

def _run_background_daemon() -> None:
    """
    Start the TalkFlow server and keep it alive indefinitely.
    Designed to be launched at Windows startup (via installer Run key).
    No console window; logs everything to %LOCALAPPDATA%/TalkFlow/logs/talkflow.log.
    """
    log.info("background daemon: starting")

    def _restart_if_dead() -> None:
        global _server_proc
        while True:
            if _server_proc is None or _server_proc.poll() is not None:
                log.info("background daemon: (re)starting server")
                try:
                    _popen_server()
                except Exception as exc:
                    log.error("background daemon: failed to start server: %s", exc)
            time.sleep(10)

    _restart_if_dead()   # blocks forever


# ═══════════════════════════════════════════════════════════════════════════════
# Main message loop
# ═══════════════════════════════════════════════════════════════════════════════

def main_native_messaging() -> None:
    log.info("TalkFlow Native Host v2.0 started (PID %d)", os.getpid())

    while True:
        try:
            msg = read_message()
        except (json.JSONDecodeError, OSError) as exc:
            log.error("read_message error: %s", exc)
            break

        action = msg.get("action", "")
        log.info("action: %s", action)

        if action == "ping":
            send_message({"action": "ping", "ok": True, "version": "2.0"})

        elif action == "health":
            running = _port_open()
            send_message({"action": "health", "serverRunning": running})

        elif action == "ensureReady":
            result = _action_ensure_ready()
            send_message({"action": "ensureReady", **result})

        elif action == "startServer":
            result = _action_start_server()
            send_message({"action": "startServer", **result})

        elif action == "stopServer":
            result = _action_stop_server()
            send_message({"action": "stopServer", **result})

        elif action == "openLogs":
            if sys.platform == "win32" and LOG_PATH.exists():
                os.startfile(str(LOG_PATH))
            send_message({"action": "openLogs", "path": str(LOG_PATH)})

        elif action == "diagnostics":
            # Proxy /diagnostics from the running server
            try:
                status, body = _http_get(f"http://{HOST}:{PORT}/diagnostics", timeout=5.0)
                data = json.loads(body)
                send_message({"action": "diagnostics", "ok": True, "data": data})
            except Exception as exc:
                send_message({"action": "diagnostics", "ok": False, "error": str(exc)})

        else:
            send_message({"error": f"Unknown action: {action}"})


if __name__ == "__main__":
    if "--background" in sys.argv:
        _run_background_daemon()
    else:
        main_native_messaging()
