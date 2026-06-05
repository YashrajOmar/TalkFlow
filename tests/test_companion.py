"""
TalkFlow Companion Test Suite
==============================
Tests: native host manifest generation, /health, /diagnostics,
       ensureReady success/failure cases, extension message handling.

Run from project root:
    pip install pytest httpx
    pytest tests/test_companion.py -v

NOTE: Tests marked @pytest.mark.live require the local server to be running.
Tests marked @pytest.mark.offline require the server to be STOPPED.
"""

import json
import os
import socket
import struct
import subprocess
import sys
import time
from pathlib import Path

import pytest

# ── Paths ──────────────────────────────────────────────────────────────────────
PROJECT_ROOT  = Path(__file__).parent.parent
LOCAL_DIR     = PROJECT_ROOT / "local-transcriber"
NATIVE_HOST   = LOCAL_DIR / "native_host.py"
SERVER_PY     = LOCAL_DIR / "server.py"
CONFIG_FILE   = LOCAL_DIR / "talkflow_companion_config.json"
HOST          = "127.0.0.1"
PORT          = 8765
BASE_URL      = f"http://{HOST}:{PORT}"


# ──────────────────────────────────────────────────────────────────────────────
# Helpers
# ──────────────────────────────────────────────────────────────────────────────

def _port_open(host: str = HOST, port: int = PORT) -> bool:
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
        s.settimeout(0.5)
        return s.connect_ex((host, port)) == 0


def _http_get(path: str, timeout: float = 5.0):
    import http.client
    conn = http.client.HTTPConnection(HOST, PORT, timeout=timeout)
    conn.request("GET", path)
    resp = conn.getresponse()
    body = resp.read().decode("utf-8")
    conn.close()
    return resp.status, json.loads(body)


def _nm_exchange(action: dict, timeout: float = 30.0) -> dict:
    """
    Spawn native_host.py as a subprocess, send one NM message, read reply.
    Simulates exactly what Chrome does.
    """
    payload = json.dumps(action).encode("utf-8")
    frame   = struct.pack("=I", len(payload)) + payload

    proc = subprocess.Popen(
        [sys.executable, str(NATIVE_HOST)],
        stdin=subprocess.PIPE,
        stdout=subprocess.PIPE,
        stderr=subprocess.DEVNULL,
    )
    proc.stdin.write(frame)
    proc.stdin.flush()

    raw_len = proc.stdout.read(4)
    if len(raw_len) < 4:
        proc.kill()
        raise RuntimeError("Native host returned no response")
    msg_len  = struct.unpack("=I", raw_len)[0]
    raw_body = proc.stdout.read(msg_len)
    proc.kill()
    return json.loads(raw_body.decode("utf-8"))


# ──────────────────────────────────────────────────────────────────────────────
# Tests — companion config & manifest
# ──────────────────────────────────────────────────────────────────────────────

class TestConfig:

    def test_config_file_exists(self):
        assert CONFIG_FILE.exists(), f"Config file missing: {CONFIG_FILE}"

    def test_config_valid_json(self):
        data = json.loads(CONFIG_FILE.read_text(encoding="utf-8"))
        assert "nativeHostName" in data
        assert "serverPort" in data
        assert data["serverPort"] == 8765

    def test_native_host_script_exists(self):
        assert NATIVE_HOST.exists(), f"native_host.py missing: {NATIVE_HOST}"

    def test_server_script_exists(self):
        assert SERVER_PY.exists(), f"server.py missing: {SERVER_PY}"


class TestManifestGeneration:
    """Test that install_native_host_windows.bat produces a valid JSON manifest."""

    def test_manifest_template_valid_json(self):
        manifest_tmpl = LOCAL_DIR / "com.talkflow.local.json"
        assert manifest_tmpl.exists(), "Manifest template missing"
        data = json.loads(manifest_tmpl.read_text(encoding="utf-8"))
        assert data["name"] == "com.talkflow.local"
        assert data["type"] == "stdio"
        assert isinstance(data["allowed_origins"], list)
        assert len(data["allowed_origins"]) > 0

    def test_manifest_has_path_field(self):
        manifest_tmpl = LOCAL_DIR / "com.talkflow.local.json"
        data = json.loads(manifest_tmpl.read_text(encoding="utf-8"))
        assert "path" in data
        # Path should not be empty (even if placeholder)
        assert data["path"]


# ──────────────────────────────────────────────────────────────────────────────
# Tests — /health endpoint (requires server running)
# ──────────────────────────────────────────────────────────────────────────────

@pytest.mark.live
class TestHealthEndpoint:

    def setup_method(self):
        if not _port_open():
            pytest.skip("Local server not running — skip live tests")

    def test_health_returns_200(self):
        status, data = _http_get("/health")
        assert status == 200

    def test_health_has_whisper_key(self):
        _, data = _http_get("/health")
        assert "whisper" in data
        assert "status" in data["whisper"]

    def test_health_has_ollama_key(self):
        _, data = _http_get("/health")
        assert "ollama" in data
        assert "reachable" in data["ollama"]

    def test_health_whisper_model_loaded(self):
        _, data = _http_get("/health")
        # Model should be loaded (base or whatever was configured)
        assert data["whisper"]["model_loaded"] is True, \
            f"Whisper model not loaded: {data['whisper'].get('error')}"


# ──────────────────────────────────────────────────────────────────────────────
# Tests — /diagnostics endpoint (requires server running)
# ──────────────────────────────────────────────────────────────────────────────

@pytest.mark.live
class TestDiagnosticsEndpoint:

    def setup_method(self):
        if not _port_open():
            pytest.skip("Local server not running — skip live tests")

    def test_diagnostics_returns_200(self):
        status, data = _http_get("/diagnostics")
        assert status == 200

    def test_diagnostics_has_required_keys(self):
        _, data = _http_get("/diagnostics")
        for key in ["server", "python", "platform", "ffmpeg", "whisper", "ollama", "config"]:
            assert key in data, f"Missing key: {key}"

    def test_diagnostics_ffmpeg_structure(self):
        _, data = _http_get("/diagnostics")
        ffmpeg = data["ffmpeg"]
        assert "available" in ffmpeg
        assert isinstance(ffmpeg["available"], bool)

    def test_diagnostics_config_port(self):
        _, data = _http_get("/diagnostics")
        assert data["config"]["port"] == 8765


# ──────────────────────────────────────────────────────────────────────────────
# Tests — Native Host protocol
# ──────────────────────────────────────────────────────────────────────────────

class TestNativeHostProtocol:

    def test_ping_action(self):
        reply = _nm_exchange({"action": "ping"})
        assert reply["ok"] is True
        assert reply["action"] == "ping"

    def test_health_action_returns_serverRunning(self):
        reply = _nm_exchange({"action": "health"})
        assert "serverRunning" in reply
        assert isinstance(reply["serverRunning"], bool)

    def test_unknown_action_returns_error(self):
        reply = _nm_exchange({"action": "doesNotExist_xyz"})
        assert "error" in reply

    @pytest.mark.live
    def test_diagnostics_action_when_server_running(self):
        if not _port_open():
            pytest.skip("Server not running")
        reply = _nm_exchange({"action": "diagnostics"}, timeout=10.0)
        assert reply["ok"] is True
        assert "data" in reply


# ──────────────────────────────────────────────────────────────────────────────
# Tests — ensureReady (requires server to be RUNNING)
# ──────────────────────────────────────────────────────────────────────────────

@pytest.mark.live
class TestEnsureReadyServerRunning:

    def setup_method(self):
        if not _port_open():
            pytest.skip("Server not running — skip live ensureReady tests")

    def test_ensure_ready_ok_when_server_up(self):
        """ensureReady should return ok=True when server is already running."""
        reply = _nm_exchange({"action": "ensureReady"}, timeout=30.0)
        assert reply.get("ok") is True, \
            f"ensureReady returned ok=False: {reply.get('message')}"

    def test_ensure_ready_has_all_status_keys(self):
        reply = _nm_exchange({"action": "ensureReady"}, timeout=30.0)
        for key in ["ok", "server", "whisper", "ffmpeg", "ollama", "model", "message"]:
            assert key in reply, f"Missing key in ensureReady response: {key}"

    def test_ensure_ready_message_is_string(self):
        reply = _nm_exchange({"action": "ensureReady"}, timeout=30.0)
        assert isinstance(reply["message"], str)
        assert len(reply["message"]) > 0


# ──────────────────────────────────────────────────────────────────────────────
# Tests — ensureReady (requires server to be STOPPED)
# ──────────────────────────────────────────────────────────────────────────────

@pytest.mark.offline
class TestEnsureReadyServerStopped:
    """
    These tests expect the server to be stopped.
    Run: pytest tests/test_companion.py -m offline -v
    """

    def setup_method(self):
        if _port_open():
            pytest.skip("Server is running — stop it first to run @offline tests")

    def test_ensure_ready_starts_server(self):
        """ensureReady should attempt to start the server when it's stopped."""
        reply = _nm_exchange({"action": "ensureReady"}, timeout=90.0)
        # It may succeed (if Python + deps installed) or fail with a clear stage
        assert "ok" in reply
        assert "stage" in reply or reply["ok"] is True

    def test_ensure_ready_failure_has_fix_field(self):
        """If ensureReady fails, it must include a human-readable fix."""
        reply = _nm_exchange({"action": "ensureReady"}, timeout=90.0)
        if not reply.get("ok"):
            assert "fix" in reply, "Failure response must include 'fix' field"
            assert isinstance(reply["fix"], str)
            assert len(reply["fix"]) > 5


# ──────────────────────────────────────────────────────────────────────────────
# Tests — Extension message routing smoke test
# ──────────────────────────────────────────────────────────────────────────────

class TestExtensionMessageShapes:
    """
    Verify that the expected message shapes and field names exist in background.js
    so the extension-to-background-to-native chain won't silently break.
    """

    def _read_bg_js(self) -> str:
        bg_path = PROJECT_ROOT / "talkflow" / "background.js"
        return bg_path.read_text(encoding="utf-8")

    def test_bg_handles_ensureReady(self):
        code = self._read_bg_js()
        assert "ensureReady" in code

    def test_bg_handles_getDiagnostics(self):
        code = self._read_bg_js()
        assert "getDiagnostics" in code

    def test_bg_handles_checkServerHealth(self):
        code = self._read_bg_js()
        assert "checkServerHealth" in code

    def test_bg_timeout_is_long_enough_for_model_pull(self):
        """Native host timeout must be >= 90s to allow model pull."""
        code = self._read_bg_js()
        # Look for 90000 (ms) or 90 seconds reference
        assert "90000" in code, \
            "background.js timeout should be at least 90000ms to allow Ollama model pull"


if __name__ == "__main__":
    pytest.main([__file__, "-v", "--tb=short"])
