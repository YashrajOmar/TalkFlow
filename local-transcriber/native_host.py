#!/usr/bin/env python3
"""
TalkFlow Native Messaging Host  v2.1
======================================
Production-hardened. Changes from v2.0:

- ensureReady uses a POLLING model instead of blocking on model pull.
  Instead of waiting 5+ minutes in one HTTP POST, it returns stage
  "model_downloading" immediately so the extension can poll for progress.

- New action: { "action": "pollReady" }
  Returns current readiness state without attempting to start anything.
  Safe to call repeatedly from the extension polling loop.

- New action: { "action": "getStatus" }
  Returns a lightweight status snapshot: server, whisper, ollama, model.

- Server boot timeout: 180 seconds (covers first-run Whisper model download).
- Model pull tracked in background thread; returns progress in pollReady.
- CREATE_NO_WINDOW is guarded behind sys.platform == "win32".
- ffmpeg bundled path reported in ensureReady (for installer bundling).

Protocol: Chrome Native Messaging (length-prefixed JSON, stdio)
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
import threading
from pathlib import Path

# ── Paths ──────────────────────────────────────────────────────────────────────
SCRIPT_DIR    = Path(os.path.dirname(os.path.abspath(__file__)))
SERVER_SCRIPT = SCRIPT_DIR / "server.py"
CONFIG_FILE   = SCRIPT_DIR / "talkflow_companion_config.json"

if sys.platform == "win32":
    LOG_DIR = Path(os.environ.get("LOCALAPPDATA", str(SCRIPT_DIR))) / "TalkFlow" / "logs"
else:
    LOG_DIR = Path.home() / ".talkflow" / "logs"

LOG_DIR.mkdir(parents=True, exist_ok=True)
LOG_PATH        = LOG_DIR / "talkflow.log"
NATIVE_LOG_PATH = SCRIPT_DIR / "native_host.log"

# ── Logging (file only — stdout/stderr reserved for Chrome protocol) ───────────
logging.basicConfig(
    filename=str(NATIVE_LOG_PATH),
    level=logging.INFO,
    format="%(asctime)s %(levelname)s %(message)s",
    datefmt="%H:%M:%S",
)
log = logging.getLogger("native_host")

# ── Config ────────────────────────────────────────────────────────────────────
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
OLLAMA_URL = CONFIG.get("ollamaUrl", "http://127.0.0.1:11434")

# Timeouts (seconds)
SERVER_BOOT_TIMEOUT   = 180   # first-run Whisper model download can take ~2 min
MODEL_PULL_TIMEOUT    = 600   # large model downloads on slow connections

# ── Global mutable state ──────────────────────────────────────────────────────
_server_proc: "subprocess.Popen | None" = None

# Model pull tracking (updated by background thread)
_pull_state: dict = {
    "active":    False,   # pull in flight
    "done":      False,
    "success":   False,
    "error":     None,
    "started_at": None,
}
_pull_lock = threading.Lock()


# ══════════════════════════════════════════════════════════════════════════════
# Chrome Native Messaging Protocol
# ══════════════════════════════════════════════════════════════════════════════

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


# ══════════════════════════════════════════════════════════════════════════════
# Low-level helpers
# ══════════════════════════════════════════════════════════════════════════════

def _port_open(host: str = HOST, port: int = PORT) -> bool:
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
        s.settimeout(0.5)
        return s.connect_ex((host, port)) == 0


def _http_get(url: str, timeout: float = 3.0):
    """Stdlib HTTP GET — no external dependencies required in host."""
    import http.client
    from urllib.parse import urlparse
    parsed = urlparse(url)
    conn = http.client.HTTPConnection(
        parsed.hostname, parsed.port or 80, timeout=timeout
    )
    conn.request("GET", parsed.path or "/")
    resp = conn.getresponse()
    body = resp.read().decode("utf-8")
    conn.close()
    return resp.status, body


def _http_post(url: str, body: str, timeout: float = 30.0):
    """Stdlib HTTP POST."""
    import http.client
    from urllib.parse import urlparse
    parsed = urlparse(url)
    conn = http.client.HTTPConnection(
        parsed.hostname, parsed.port or 80, timeout=timeout
    )
    conn.request(
        "POST", parsed.path or "/",
        body=body.encode("utf-8"),
        headers={"Content-Type": "application/json"},
    )
    resp = conn.getresponse()
    out = resp.read().decode("utf-8")
    conn.close()
    return resp.status, out


def _find_ffmpeg() -> "str | None":
    """
    Return absolute path to ffmpeg.
    Prefers a bundled copy placed beside native_host.py / server.py,
    then falls back to shutil.which (system PATH).
    """
    # 1. Bundled alongside the companion (installer puts it here)
    for candidate in [
        SCRIPT_DIR / "ffmpeg.exe",
        SCRIPT_DIR / "ffmpeg",
        SCRIPT_DIR / "vendor" / "ffmpeg" / "ffmpeg.exe",
        SCRIPT_DIR / "vendor" / "ffmpeg" / "ffmpeg",
    ]:
        if candidate.exists():
            return str(candidate)
    # 2. System PATH
    return shutil.which("ffmpeg")


def _popen_server() -> "subprocess.Popen":
    """Start server.py silently, redirecting its output to the log file."""
    global _server_proc
    kwargs: dict = {}

    # Windows-only: suppress the console window
    if sys.platform == "win32":
        kwargs["creationflags"] = subprocess.CREATE_NO_WINDOW

    log_fh = open(str(LOG_PATH), "a", encoding="utf-8")
    kwargs["stdout"] = log_fh
    kwargs["stderr"] = log_fh

    _server_proc = subprocess.Popen(
        [sys.executable, str(SERVER_SCRIPT)],
        **kwargs,
    )
    log.info("popen_server: PID %d — logs → %s", _server_proc.pid, LOG_PATH)
    return _server_proc


# ══════════════════════════════════════════════════════════════════════════════
# Ollama model pull — runs in a background thread so the host stays responsive
# ══════════════════════════════════════════════════════════════════════════════

def _pull_model_background() -> None:
    """
    Pull MODEL_NAME from Ollama in a background thread.
    Uses the streaming /api/pull endpoint so we get partial progress.
    Updates _pull_state so the polling loop can report progress.
    """
    global _pull_state
    log.info("pull_model: starting background pull of %s", MODEL_NAME)

    with _pull_lock:
        _pull_state = {
            "active":     True,
            "done":       False,
            "success":    False,
            "error":      None,
            "started_at": time.time(),
        }

    try:
        # Use subprocess ollama pull (more reliable than streaming HTTP for large models)
        ollama_bin = shutil.which("ollama")
        if ollama_bin:
            result = subprocess.run(
                [ollama_bin, "pull", MODEL_NAME],
                capture_output=True, text=True, timeout=MODEL_PULL_TIMEOUT,
            )
            if result.returncode == 0:
                with _pull_lock:
                    _pull_state.update({"active": False, "done": True, "success": True})
                log.info("pull_model: ollama pull succeeded")
                return
            else:
                err = result.stderr.strip() or result.stdout.strip() or "unknown error"
                with _pull_lock:
                    _pull_state.update({"active": False, "done": True, "success": False, "error": err})
                log.warning("pull_model: ollama pull failed: %s", err)
                return

        # Fallback: use HTTP API (stream=False, long timeout)
        st, _ = _http_post(
            f"{OLLAMA_URL}/api/pull",
            json.dumps({"name": MODEL_NAME, "stream": False}),
            timeout=MODEL_PULL_TIMEOUT,
        )
        success = (st == 200)
        with _pull_lock:
            _pull_state.update({
                "active": False, "done": True, "success": success,
                "error": None if success else f"HTTP {st}",
            })
        log.info("pull_model: HTTP pull finished, status %d", st)

    except subprocess.TimeoutExpired:
        with _pull_lock:
            _pull_state.update({"active": False, "done": True, "success": False,
                                 "error": "timeout after 600s"})
        log.warning("pull_model: timed out")
    except Exception as exc:
        with _pull_lock:
            _pull_state.update({"active": False, "done": True, "success": False,
                                 "error": str(exc)})
        log.warning("pull_model: exception: %s", exc)


def _start_model_pull_if_not_running() -> None:
    """Kick off the pull thread unless one is already in progress."""
    with _pull_lock:
        if _pull_state.get("active"):
            return
    t = threading.Thread(target=_pull_model_background, daemon=True)
    t.start()


# ══════════════════════════════════════════════════════════════════════════════
# Ollama helpers
# ══════════════════════════════════════════════════════════════════════════════

def _ollama_status() -> "tuple[bool, bool, list]":
    """
    Returns (ollama_reachable, model_available, model_list).
    """
    try:
        st, body = _http_get(f"{OLLAMA_URL}/api/tags", timeout=3.0)
        if st == 200:
            tags = json.loads(body)
            models = [m.get("name", "") for m in tags.get("models", [])]
            model_ok = any(
                m.startswith("llama3.2:3b") or m.startswith("llama3.2")
                for m in models
            )
            return True, model_ok, models
    except Exception as e:
        log.debug("ollama_status: %s", e)
    return False, False, []


# ══════════════════════════════════════════════════════════════════════════════
# Action implementations
# ══════════════════════════════════════════════════════════════════════════════

def _action_start_server() -> dict:
    global _server_proc

    if _port_open():
        log.info("startServer: already running")
        return {"started": False, "reason": "already_running", "serverRunning": True}

    if not SERVER_SCRIPT.exists():
        log.error("startServer: server.py not found at %s", SERVER_SCRIPT)
        return {"started": False, "reason": "server_script_missing", "serverRunning": False}

    try:
        _popen_server()
    except Exception as exc:
        log.error("startServer: Popen failed: %s", exc)
        return {"started": False, "reason": str(exc), "serverRunning": False}

    # Poll SERVER_BOOT_TIMEOUT seconds (first launch may download Whisper model)
    for _ in range(SERVER_BOOT_TIMEOUT * 2):
        time.sleep(0.5)
        if _port_open():
            log.info("startServer: port %d open", PORT)
            return {"started": True, "serverRunning": True}

    log.warning("startServer: timeout after %ds", SERVER_BOOT_TIMEOUT)
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
    Full readiness check + auto-fix (non-blocking design).

    For model pull, we start a background thread and immediately return
    stage="model_downloading" so the extension can poll with pollReady.

    Sequence:
      1. ffmpeg available (checks bundled path first, then PATH)
      2. server.py exists
      3. Local server port open (start if closed, 180s poll)
      4. Whisper loaded (from /health)
      5. Ollama reachable
      6. llama3.2:3b available — if missing AND pull not already running,
         start background pull → return model_downloading stage immediately
    """
    log.info("ensureReady: starting checks")

    # ── 1. ffmpeg ──────────────────────────────────────────────────────────────
    ffmpeg_path = _find_ffmpeg()
    ffmpeg_bundled = (
        ffmpeg_path is not None and
        SCRIPT_DIR.resolve() in Path(ffmpeg_path).resolve().parents
    )
    if not ffmpeg_path:
        log.warning("ensureReady: ffmpeg not found")
        return {
            "ok": False,
            "stage": "ffmpeg_missing",
            "server": "unknown", "whisper": "unknown",
            "ffmpeg": "missing", "ffmpeg_path": None, "ffmpeg_bundled": False,
            "ollama": "unknown", "model": MODEL_NAME,
            "message": "ffmpeg is not installed or not on PATH.",
            "fix": "Install TalkFlow Companion (includes bundled ffmpeg) or download ffmpeg from ffmpeg.org.",
        }

    # ── 2. server.py exists ────────────────────────────────────────────────────
    if not SERVER_SCRIPT.exists():
        log.error("ensureReady: server.py missing")
        return {
            "ok": False,
            "stage": "server_script_missing",
            "server": "error", "whisper": "unknown",
            "ffmpeg": "ready", "ffmpeg_path": ffmpeg_path, "ffmpeg_bundled": ffmpeg_bundled,
            "ollama": "unknown", "model": MODEL_NAME,
            "message": "TalkFlow server files are missing.",
            "fix": "Reinstall TalkFlow Companion.",
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
                "ffmpeg": "ready", "ffmpeg_path": ffmpeg_path, "ffmpeg_bundled": ffmpeg_bundled,
                "ollama": "unknown", "model": MODEL_NAME,
                "message": f"Failed to start TalkFlow server: {exc}",
                "fix": "Run start-talkflow-local.bat to see detailed error output.",
            }

        # Poll SERVER_BOOT_TIMEOUT seconds (Whisper base model ~75 MB on first run)
        started = False
        for _ in range(SERVER_BOOT_TIMEOUT * 2):
            time.sleep(0.5)
            if _port_open():
                started = True
                break

        if not started:
            return {
                "ok": False, "stage": "server_timeout",
                "server": "timeout", "whisper": "unknown",
                "ffmpeg": "ready", "ffmpeg_path": ffmpeg_path, "ffmpeg_bundled": ffmpeg_bundled,
                "ollama": "unknown", "model": MODEL_NAME,
                "message": f"TalkFlow server did not respond within {SERVER_BOOT_TIMEOUT} seconds.",
                "fix": "Run start-talkflow-local.bat to see error details, or reinstall TalkFlow Companion.",
            }
        log.info("ensureReady: server started successfully")
    else:
        log.info("ensureReady: server already running")

    # ── 4. Whisper check via /health ───────────────────────────────────────────
    whisper_status = "unknown"
    try:
        st, body = _http_get(f"http://{HOST}:{PORT}/health", timeout=10.0)
        if st == 200:
            health = json.loads(body)
            w = health.get("whisper", {})
            whisper_status = "ready" if w.get("status") == "ok" else "error"
            if whisper_status == "error":
                err_msg = w.get("error", "Unknown Whisper error")
                return {
                    "ok": False, "stage": "whisper_error",
                    "server": "running", "whisper": "error",
                    "ffmpeg": "ready", "ffmpeg_path": ffmpeg_path, "ffmpeg_bundled": ffmpeg_bundled,
                    "ollama": "unknown", "model": MODEL_NAME,
                    "message": f"Whisper model failed to load: {err_msg}",
                    "fix": "Ensure faster-whisper is installed correctly. Run: pip install -r requirements.txt",
                }
    except Exception as e:
        log.warning("ensureReady: /health fetch failed: %s", e)
        whisper_status = "unknown"

    # ── 5+6. Ollama + model ────────────────────────────────────────────────────
    ollama_ok, model_ok, _ = _ollama_status()

    if not ollama_ok:
        return {
            "ok": False, "stage": "ollama_missing",
            "server": "running", "whisper": whisper_status,
            "ffmpeg": "ready", "ffmpeg_path": ffmpeg_path, "ffmpeg_bundled": ffmpeg_bundled,
            "ollama": "offline", "model": MODEL_NAME,
            "message": "Ollama is not installed or not running.",
            "fix": "Install Ollama from ollama.com, start it, then click Retry.",
        }

    if not model_ok:
        # Check if pull is already in flight
        with _pull_lock:
            already_pulling = _pull_state.get("active", False)
            pull_elapsed = (
                round(time.time() - _pull_state["started_at"])
                if _pull_state.get("started_at") else 0
            )

        if not already_pulling:
            log.info("ensureReady: %s missing — starting background pull", MODEL_NAME)
            _start_model_pull_if_not_running()

        return {
            "ok": False, "stage": "model_downloading",
            "server": "running", "whisper": whisper_status,
            "ffmpeg": "ready", "ffmpeg_path": ffmpeg_path, "ffmpeg_bundled": ffmpeg_bundled,
            "ollama": "ready", "model": MODEL_NAME,
            "pull_elapsed_seconds": pull_elapsed,
            "message": f"Downloading {MODEL_NAME}… This takes 2–5 minutes on first use.",
            "fix": "Please wait. TalkFlow is downloading the AI model. Do not close the browser.",
        }

    log.info("ensureReady: all checks passed ✓")
    return {
        "ok": True,
        "server": "running",
        "whisper": whisper_status,
        "ffmpeg": "ready",
        "ffmpeg_path": ffmpeg_path,
        "ffmpeg_bundled": ffmpeg_bundled,
        "ollama": "ready",
        "model": MODEL_NAME,
        "message": "TalkFlow is ready",
    }


def _action_poll_ready() -> dict:
    """
    Lightweight poll — returns current readiness without starting anything.
    Designed to be called repeatedly by the extension polling loop.

    States returned:
      - ok=True: everything is up
      - stage="model_downloading": pull in progress (include elapsed time)
      - stage="model_missing": pull finished but failed
      - stage="server_offline": server is not responding
      - stage="ollama_missing": Ollama not reachable
    """
    server_up = _port_open()
    if not server_up:
        return {
            "ok": False, "stage": "server_offline",
            "server": "offline", "whisper": "unknown",
            "ollama": "unknown", "model": MODEL_NAME,
            "message": "TalkFlow server is not running.",
        }

    ollama_ok, model_ok, _ = _ollama_status()

    if not ollama_ok:
        return {
            "ok": False, "stage": "ollama_missing",
            "server": "running", "ollama": "offline", "model": MODEL_NAME,
            "message": "Ollama is not reachable.",
        }

    with _pull_lock:
        pull_active  = _pull_state.get("active", False)
        pull_done    = _pull_state.get("done", False)
        pull_success = _pull_state.get("success", False)
        pull_error   = _pull_state.get("error")
        pull_elapsed = (
            round(time.time() - _pull_state["started_at"])
            if _pull_state.get("started_at") else 0
        )

    if not model_ok:
        if pull_active:
            return {
                "ok": False, "stage": "model_downloading",
                "server": "running", "ollama": "ready", "model": MODEL_NAME,
                "pull_elapsed_seconds": pull_elapsed,
                "message": f"Downloading {MODEL_NAME}… ({pull_elapsed}s elapsed)",
            }
        elif pull_done and not pull_success:
            return {
                "ok": False, "stage": "model_missing",
                "server": "running", "ollama": "ready", "model": MODEL_NAME,
                "message": f"{MODEL_NAME} download failed: {pull_error}",
                "fix": f"Open a terminal and run: ollama pull {MODEL_NAME}",
            }
        else:
            return {
                "ok": False, "stage": "model_missing",
                "server": "running", "ollama": "ready", "model": MODEL_NAME,
                "message": f"{MODEL_NAME} model is not downloaded.",
                "fix": f"Open a terminal and run: ollama pull {MODEL_NAME}",
            }

    return {
        "ok": True,
        "server": "running", "ollama": "ready", "model": MODEL_NAME,
        "message": "TalkFlow is ready",
    }


def _action_get_status() -> dict:
    """Lightweight snapshot of current state — no side effects."""
    server_up = _port_open()
    ollama_ok, model_ok, models = _ollama_status() if server_up else (False, False, [])
    with _pull_lock:
        pull_info = dict(_pull_state)
    return {
        "server": "running" if server_up else "offline",
        "ollama": "ready" if ollama_ok else "offline",
        "model_available": model_ok,
        "model": MODEL_NAME,
        "pull": pull_info,
    }


# ══════════════════════════════════════════════════════════════════════════════
# Background daemon mode (--background flag)
# ══════════════════════════════════════════════════════════════════════════════

def _run_background_daemon() -> None:
    """
    Start the TalkFlow server and keep it alive indefinitely.
    Designed to be launched at Windows startup via installer Run key.
    No console window. Logs to LOG_PATH.
    """
    log.info("background daemon: starting (PID %d)", os.getpid())

    while True:
        if _server_proc is None or _server_proc.poll() is not None:
            log.info("background daemon: (re)starting server")
            try:
                _popen_server()
            except Exception as exc:
                log.error("background daemon: failed to start server: %s", exc)
        time.sleep(10)


# ══════════════════════════════════════════════════════════════════════════════
# Main message loop
# ══════════════════════════════════════════════════════════════════════════════

def main_native_messaging() -> None:
    log.info("TalkFlow Native Host v2.1 started (PID %d, platform=%s)",
             os.getpid(), sys.platform)

    while True:
        try:
            msg = read_message()
        except (json.JSONDecodeError, OSError) as exc:
            log.error("read_message error: %s", exc)
            break

        action = msg.get("action", "")
        log.info("action: %s", action)

        if action == "ping":
            send_message({"action": "ping", "ok": True, "version": "2.1"})

        elif action == "health":
            running = _port_open()
            send_message({"action": "health", "serverRunning": running})

        elif action == "ensureReady":
            result = _action_ensure_ready()
            send_message({"action": "ensureReady", **result})

        elif action == "pollReady":
            result = _action_poll_ready()
            send_message({"action": "pollReady", **result})

        elif action == "getStatus":
            result = _action_get_status()
            send_message({"action": "getStatus", **result})

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
            try:
                st, body = _http_get(
                    f"http://{HOST}:{PORT}/diagnostics", timeout=5.0
                )
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
