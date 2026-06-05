#!/usr/bin/env python3
"""
TalkFlow Native Messaging Host
================================
Allows the Chrome extension to start/stop/query the local TalkFlow server
without the user manually running any terminal commands.

Registered as native host:  com.talkflow.local
Protocol:  Chrome Native Messaging (length-prefixed JSON over stdin/stdout)

Supported actions:
    { "action": "health"      }  → check if port 8765 is open
    { "action": "startServer" }  → start server.py if not running
    { "action": "stopServer"  }  → stop the server we started
    { "action": "ping"        }  → confirm host is alive
"""

import os
import sys
import json
import struct
import socket
import time
import subprocess
import threading
import logging

# ─── Logging (to file only — stdout is reserved for Chrome protocol) ──────────
LOG_PATH = os.path.join(os.path.dirname(os.path.abspath(__file__)), "native_host.log")
logging.basicConfig(
    filename=LOG_PATH,
    level=logging.INFO,
    format="%(asctime)s %(levelname)s %(message)s",
    datefmt="%H:%M:%S",
)
log = logging.getLogger("native_host")

# ─── Globals ──────────────────────────────────────────────────────────────────
_server_proc: subprocess.Popen | None = None
PORT = 8765
HOST = "127.0.0.1"
SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
SERVER_SCRIPT = os.path.join(SCRIPT_DIR, "server.py")


# ─── Chrome Native Messaging Protocol ─────────────────────────────────────────

def read_message() -> dict:
    """Read one length-prefixed JSON message from Chrome via stdin."""
    raw_len = sys.stdin.buffer.read(4)
    if len(raw_len) < 4:
        log.info("stdin closed — Chrome disconnected")
        sys.exit(0)
    msg_len = struct.unpack("=I", raw_len)[0]
    raw_msg = sys.stdin.buffer.read(msg_len)
    return json.loads(raw_msg.decode("utf-8"))


def send_message(obj: dict):
    """Write one length-prefixed JSON response to Chrome via stdout."""
    encoded = json.dumps(obj).encode("utf-8")
    sys.stdout.buffer.write(struct.pack("=I", len(encoded)))
    sys.stdout.buffer.write(encoded)
    sys.stdout.buffer.flush()


# ─── Helpers ──────────────────────────────────────────────────────────────────

def _port_open() -> bool:
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
        s.settimeout(0.5)
        return s.connect_ex((HOST, PORT)) == 0


def _start_server() -> dict:
    global _server_proc

    if _port_open():
        log.info("startServer: already running")
        return {"started": False, "reason": "already_running", "serverRunning": True}

    if not os.path.isfile(SERVER_SCRIPT):
        log.error("server.py not found at %s", SERVER_SCRIPT)
        return {"started": False, "reason": "server_script_missing", "serverRunning": False}

    try:
        kwargs = {}
        if sys.platform == "win32":
            kwargs["creationflags"] = subprocess.CREATE_NO_WINDOW
        _server_proc = subprocess.Popen(
            [sys.executable, SERVER_SCRIPT],
            **kwargs,
        )
        log.info("startServer: launched PID %d", _server_proc.pid)
    except Exception as exc:
        log.error("startServer: Popen failed: %s", exc)
        return {"started": False, "reason": str(exc), "serverRunning": False}

    # Wait up to 15s for port to open
    for _ in range(30):
        time.sleep(0.5)
        if _port_open():
            log.info("startServer: port %d open", PORT)
            return {"started": True, "serverRunning": True}

    log.warning("startServer: timeout waiting for port")
    return {"started": False, "reason": "timeout", "serverRunning": False}


def _stop_server() -> dict:
    global _server_proc
    if _server_proc and _server_proc.poll() is None:
        _server_proc.terminate()
        try:
            _server_proc.wait(timeout=5)
        except subprocess.TimeoutExpired:
            _server_proc.kill()
        log.info("stopServer: terminated PID %d", _server_proc.pid)
        _server_proc = None
        return {"stopped": True}
    return {"stopped": False, "reason": "not_managed_by_host"}


# ─── Main message loop ─────────────────────────────────────────────────────────

def main():
    log.info("TalkFlow Native Host started (PID %d)", os.getpid())

    while True:
        try:
            msg = read_message()
        except (json.JSONDecodeError, OSError) as exc:
            log.error("read_message error: %s", exc)
            break

        action = msg.get("action", "")
        log.info("action: %s", action)

        if action == "ping":
            send_message({"action": "ping", "ok": True, "version": "1.0"})

        elif action == "health":
            running = _port_open()
            send_message({"action": "health", "serverRunning": running})

        elif action == "startServer":
            result = _start_server()
            send_message({"action": "startServer", **result})

        elif action == "stopServer":
            result = _stop_server()
            send_message({"action": "stopServer", **result})

        elif action == "openLogs":
            log_file = LOG_PATH
            if sys.platform == "win32" and os.path.exists(log_file):
                os.startfile(log_file)
            send_message({"action": "openLogs", "path": log_file})

        else:
            send_message({"error": f"Unknown action: {action}"})


if __name__ == "__main__":
    main()
