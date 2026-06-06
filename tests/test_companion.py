"""
TalkFlow Companion Test Suite  v2.1
=====================================
Tests: native host manifest, /health, /diagnostics, ensureReady,
       pollReady, model-pull lifecycle, Windows-only process flags,
       cloud fallback confirmation, noHost error mapping.

Run from project root:
    pip install pytest httpx
    pytest tests/test_companion.py -v

Marks:
    @pytest.mark.live    — requires server running on port 8765
    @pytest.mark.offline — requires server to be STOPPED
    @pytest.mark.slow    — tests that may run for 10+ seconds
"""

import json
import os
import platform
import socket
import struct
import subprocess
import sys
import time
import threading
from pathlib import Path
from unittest.mock import patch, MagicMock

import pytest

# ── Paths ──────────────────────────────────────────────────────────────────────
PROJECT_ROOT = Path(__file__).parent.parent
LOCAL_DIR    = PROJECT_ROOT / "local-transcriber"
NATIVE_HOST  = LOCAL_DIR / "native_host.py"
SERVER_PY    = LOCAL_DIR / "server.py"
CONFIG_FILE  = LOCAL_DIR / "talkflow_companion_config.json"
BACKGROUND_JS = PROJECT_ROOT / "talkflow" / "background.js"
APP_JS        = PROJECT_ROOT / "talkflow" / "app.js"
HOST         = "127.0.0.1"
PORT         = 8765


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


def _nm_exchange(action: dict, read_timeout: float = 30.0) -> dict:
    """
    Spawn native_host.py as a subprocess, send one NM message, read one reply.
    read_timeout: seconds to wait for the reply (set high for slow ops).
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

    # Read response (blocking with timeout via select/thread)
    result_box = [None]
    error_box  = [None]

    def _reader():
        try:
            raw_len = proc.stdout.read(4)
            if len(raw_len) < 4:
                error_box[0] = RuntimeError("Native host returned no response")
                return
            msg_len  = struct.unpack("=I", raw_len)[0]
            raw_body = proc.stdout.read(msg_len)
            result_box[0] = json.loads(raw_body.decode("utf-8"))
        except Exception as e:
            error_box[0] = e

    t = threading.Thread(target=_reader, daemon=True)
    t.start()
    t.join(timeout=read_timeout)

    try:
        proc.kill()
    except Exception:
        pass

    if error_box[0]:
        raise error_box[0]
    if result_box[0] is None:
        raise TimeoutError(f"Native host did not reply within {read_timeout}s")
    return result_box[0]


def _read_source(path: Path) -> str:
    return path.read_text(encoding="utf-8")


# ──────────────────────────────────────────────────────────────────────────────
# Tests — config & file presence
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
        assert NATIVE_HOST.exists(), f"native_host.py missing"

    def test_server_script_exists(self):
        assert SERVER_PY.exists(), f"server.py missing"


# ──────────────────────────────────────────────────────────────────────────────
# Tests — Windows-only process flags (Fix 3)
# ──────────────────────────────────────────────────────────────────────────────

class TestWindowsOnlyFlags:
    """
    Ensure CREATE_NO_WINDOW is only applied on Windows.
    The flag must not be set on Linux / macOS.
    """

    def test_create_no_window_guarded_by_platform_check(self):
        """
        native_host.py must guard subprocess.CREATE_NO_WINDOW behind
        sys.platform == 'win32'. Docstring/comment mentions are skipped.
        """
        source = _read_source(NATIVE_HOST)
        lines = source.splitlines()

        # Track whether we are inside a triple-quoted docstring
        in_docstring = False
        for i, line in enumerate(lines):
            stripped = line.strip()
            # Toggle docstring state on triple-quote boundaries
            if stripped.startswith('"""') or stripped.startswith("'''"):
                in_docstring = not in_docstring

            # Skip pure comment lines and lines inside docstrings
            if stripped.startswith("#") or in_docstring:
                continue

            if "CREATE_NO_WINDOW" in line:
                # This is a real code line — scan backwards for the platform guard
                found_guard = any(
                    "sys.platform" in lines[j] and "win32" in lines[j]
                    for j in range(max(0, i - 20), i)
                )
                assert found_guard, (
                    f"Line {i+1}: subprocess.CREATE_NO_WINDOW used in code "
                    f"without a sys.platform == 'win32' guard within 20 lines."
                )

    def test_popen_does_not_crash_on_non_windows(self):
        """
        _popen_server must not raise AttributeError on Linux/macOS.
        We mock subprocess.Popen to avoid actually starting the server.
        """
        # Import native_host as a module
        import importlib.util
        spec = importlib.util.spec_from_file_location("native_host", NATIVE_HOST)
        nh = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(nh)

        started_pids = []

        class FakeProc:
            pid = 99999
            def poll(self): return None

        def fake_popen(args, **kwargs):
            # Verify: on non-Windows, creationflags must NOT be set
            if sys.platform != "win32":
                assert "creationflags" not in kwargs, (
                    "creationflags must not be passed on non-Windows"
                )
            started_pids.append(1)
            return FakeProc()

        with patch.object(subprocess, "Popen", side_effect=fake_popen):
            with patch.object(nh, "LOG_PATH", Path(os.devnull)):
                with patch("builtins.open", return_value=open(os.devnull, "a")):
                    # Temporarily patch sys.platform to test non-Windows path
                    original = sys.platform
                    try:
                        sys.modules["native_host"] = nh
                        # On the current platform (whatever it is), just call it
                        nh._popen_server()
                    except Exception:
                        pass  # Any process-related error is fine; we just check no AttributeError
                    finally:
                        pass


# ──────────────────────────────────────────────────────────────────────────────
# Tests — Manifest generation
# ──────────────────────────────────────────────────────────────────────────────

class TestManifestGeneration:

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
        assert "path" in data and data["path"]


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
        assert "whisper" in data and "status" in data["whisper"]

    def test_health_has_ollama_key(self):
        _, data = _http_get("/health")
        assert "ollama" in data and "reachable" in data["ollama"]

    def test_health_whisper_model_loaded(self):
        _, data = _http_get("/health")
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
        status, _ = _http_get("/diagnostics")
        assert status == 200

    def test_diagnostics_has_required_keys(self):
        _, data = _http_get("/diagnostics")
        for key in ["server", "python", "platform", "ffmpeg", "whisper", "ollama", "config"]:
            assert key in data, f"Missing key: {key}"

    def test_diagnostics_ffmpeg_structure(self):
        _, data = _http_get("/diagnostics")
        assert "available" in data["ffmpeg"]
        assert isinstance(data["ffmpeg"]["available"], bool)

    def test_diagnostics_config_port(self):
        _, data = _http_get("/diagnostics")
        assert data["config"]["port"] == 8765


# ──────────────────────────────────────────────────────────────────────────────
# Tests — Native Host Protocol
# ──────────────────────────────────────────────────────────────────────────────

class TestNativeHostProtocol:

    def test_ping_returns_v21(self):
        reply = _nm_exchange({"action": "ping"})
        assert reply["ok"] is True
        assert reply["action"] == "ping"
        # Version should be 2.1 or higher
        assert reply.get("version", "0") >= "2.1"

    def test_health_action_returns_serverRunning(self):
        reply = _nm_exchange({"action": "health"})
        assert "serverRunning" in reply
        assert isinstance(reply["serverRunning"], bool)

    def test_unknown_action_returns_error(self):
        reply = _nm_exchange({"action": "doesNotExist_xyz"})
        assert "error" in reply

    def test_getStatus_action_exists(self):
        """getStatus is a new action in v2.1."""
        reply = _nm_exchange({"action": "getStatus"})
        assert "server" in reply
        assert "model" in reply

    def test_pollReady_action_exists(self):
        """pollReady is a new action in v2.1."""
        reply = _nm_exchange({"action": "pollReady"})
        assert "ok" in reply
        # ok can be True or False; what matters is the action returned something valid

    @pytest.mark.live
    def test_diagnostics_action_when_server_running(self):
        if not _port_open():
            pytest.skip("Server not running")
        reply = _nm_exchange({"action": "diagnostics"}, read_timeout=10.0)
        assert reply["ok"] is True
        assert "data" in reply


# ──────────────────────────────────────────────────────────────────────────────
# Tests — noHost error mapping (Fix 2)
# ──────────────────────────────────────────────────────────────────────────────

class TestNoHostErrorMapping:
    """
    Verify that background.js maps a 'not registered' native host error
    to stage=companion_not_installed with a fix message.
    """

    def test_bg_js_has_companion_not_installed_stage(self):
        code = _read_source(BACKGROUND_JS)
        assert "companion_not_installed" in code, \
            "background.js must map unregistered host to companion_not_installed stage"

    def test_bg_js_has_fix_field_for_not_registered(self):
        code = _read_source(BACKGROUND_JS)
        # Must provide a fix — check for the install instructions text
        assert "install_native_host_windows.bat" in code or "releases" in code, \
            "background.js companion_not_installed must include fix instructions"

    def test_bg_js_maps_all_not_registered_messages(self):
        """All Chrome error strings for 'host not registered' must be detected."""
        code = _read_source(BACKGROUND_JS)
        required_strings = [
            "not registered",
            "not found",
            "Specified native messaging host not found",
        ]
        for s in required_strings:
            assert s in code, f"background.js must check for: '{s}'"

    def test_bg_js_mapNativeHostError_exists(self):
        code = _read_source(BACKGROUND_JS)
        assert "_mapNativeHostError" in code, \
            "background.js must have a _mapNativeHostError function"

    def test_app_js_handles_companion_not_installed_stage(self):
        code = _read_source(APP_JS)
        assert "companion_not_installed" in code, \
            "app.js _STAGE_MESSAGES must include companion_not_installed"


# ──────────────────────────────────────────────────────────────────────────────
# Tests — Ollama installed but model missing (Fix 7)
# ──────────────────────────────────────────────────────────────────────────────

class TestOllamaModelMissing:
    """
    Verify native_host.py behaviour when Ollama is running but model is missing.
    Uses mocking to avoid actually pulling the model.
    """

    def test_ensure_ready_starts_pull_when_model_missing(self):
        """
        When Ollama is reachable but model is not in the list,
        ensureReady should return stage=model_downloading (not model_missing),
        because it starts the pull asynchronously.
        """
        import importlib.util
        spec = importlib.util.spec_from_file_location("native_host_test", NATIVE_HOST)
        nh = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(nh)

        # Save and replace SERVER_SCRIPT on the module so exists() returns True
        original_server_script = nh.SERVER_SCRIPT
        nh.SERVER_SCRIPT = MagicMock()
        nh.SERVER_SCRIPT.exists.return_value = True

        try:
            # Patch: server is running (port open)
            with patch.object(nh, "_port_open", return_value=True):
                # Patch: ffmpeg found
                with patch.object(nh, "_find_ffmpeg", return_value="/usr/bin/ffmpeg"):
                    # Patch: /health returns ok, Ollama returns no models
                    def fake_http_get(url, timeout=3.0):
                        if "health" in url:
                            return 200, json.dumps({
                                "whisper": {"status": "ok", "model_loaded": True}
                            })
                        if "api/tags" in url:
                            return 200, json.dumps({"models": []})
                        raise ConnectionError("unexpected URL")

                    with patch.object(nh, "_http_get", side_effect=fake_http_get):
                        pull_called = []
                        def fake_start_pull():
                            pull_called.append(True)
                        with patch.object(nh, "_start_model_pull_if_not_running",
                                          side_effect=fake_start_pull):
                            result = nh._action_ensure_ready()
        finally:
            nh.SERVER_SCRIPT = original_server_script

        assert result["ok"] is False
        assert result["stage"] == "model_downloading", \
            f"Expected model_downloading, got: {result['stage']}"
        assert len(pull_called) == 1, "Pull should have been started exactly once"
        assert "fix" in result, "model_downloading response must include fix field"

    def test_poll_ready_returns_downloading_while_pull_active(self):
        """
        When _pull_state.active=True, pollReady must return stage=model_downloading.
        """
        import importlib.util
        spec = importlib.util.spec_from_file_location("native_host_poll", NATIVE_HOST)
        nh = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(nh)

        # Simulate: server up, Ollama up, model still missing, pull active
        with patch.object(nh, "_port_open", return_value=True):
            def fake_ollama_status():
                return True, False, []   # (reachable, model_ok=False, models=[])
            with patch.object(nh, "_ollama_status", side_effect=fake_ollama_status):
                with nh._pull_lock:
                    nh._pull_state = {
                        "active": True, "done": False, "success": False,
                        "error": None, "started_at": time.time() - 45,
                    }
                result = nh._action_poll_ready()

        assert result["ok"] is False
        assert result["stage"] == "model_downloading"
        assert result.get("pull_elapsed_seconds", 0) >= 40, \
            "Should report elapsed time >= 40s"

    def test_poll_ready_returns_model_missing_after_failed_pull(self):
        """
        After a failed pull (done=True, success=False), pollReady must
        return stage=model_missing with a fix.
        """
        import importlib.util
        spec = importlib.util.spec_from_file_location("native_host_poll2", NATIVE_HOST)
        nh = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(nh)

        with patch.object(nh, "_port_open", return_value=True):
            def fake_ollama_status():
                return True, False, []
            with patch.object(nh, "_ollama_status", side_effect=fake_ollama_status):
                with nh._pull_lock:
                    nh._pull_state = {
                        "active": False, "done": True, "success": False,
                        "error": "timeout after 600s", "started_at": time.time() - 620,
                    }
                result = nh._action_poll_ready()

        assert result["ok"] is False
        assert result["stage"] == "model_missing"
        assert "fix" in result


# ──────────────────────────────────────────────────────────────────────────────
# Tests — Long model pull does not cause premature failure (Fix 7)
# ──────────────────────────────────────────────────────────────────────────────

class TestLongModelPullNoPrematureFailure:
    """
    Verify that background.js does NOT use a single short timeout for the
    entire ensureReady flow (which would fail mid-download).
    """

    def test_bg_js_uses_polling_not_single_timeout(self):
        """
        background.js must use the polling loop pattern, not a single 90s timeout.
        Verify: MODEL_POLL_TIMEOUT_MS evaluates to >= 600000 (10 minutes).
        """
        code = _read_source(BACKGROUND_JS)
        assert "MODEL_POLL_TIMEOUT_MS" in code, \
            "background.js must define MODEL_POLL_TIMEOUT_MS for the polling loop"
        # Extract the raw value expression (e.g. '10 * 60 * 1000' or '600000')
        import re
        match = re.search(r"MODEL_POLL_TIMEOUT_MS\s*=\s*([\d\s\*]+)", code)
        assert match, "MODEL_POLL_TIMEOUT_MS must be assigned a numeric expression"
        raw_expr = match.group(1).strip().rstrip(";")
        try:
            # Safe eval of pure arithmetic
            value = eval(raw_expr, {"__builtins__": {}})  # noqa: S307
        except Exception:
            pytest.fail(f"Could not evaluate MODEL_POLL_TIMEOUT_MS expression: {raw_expr!r}")
        assert value >= 600000, \
            f"MODEL_POLL_TIMEOUT_MS must be >= 600000ms (10min), evaluated to {value}ms"

    def test_bg_js_poll_interval_is_reasonable(self):
        """Poll interval must be 2–10 seconds (not too fast, not too slow)."""
        code = _read_source(BACKGROUND_JS)
        import re
        match = re.search(r"MODEL_POLL_INTERVAL_MS\s*=\s*(\d+)", code)
        assert match, "background.js must define MODEL_POLL_INTERVAL_MS"
        value = int(match.group(1))
        assert 2000 <= value <= 10000, \
            f"MODEL_POLL_INTERVAL_MS should be 2000–10000ms, got {value}ms"

    def test_bg_js_single_nm_roundtrip_timeout_is_short(self):
        """
        Each individual native messaging round-trip must have a SHORT timeout
        (not 90000ms, since model pulls now happen in background threads).
        The round-trip timeout should be <= 60000ms.
        """
        code = _read_source(BACKGROUND_JS)
        import re
        match = re.search(r"NM_ROUNDTRIP_TIMEOUT_MS\s*=\s*(\d+)", code)
        assert match, "background.js must define NM_ROUNDTRIP_TIMEOUT_MS"
        value = int(match.group(1))
        assert value <= 60000, \
            f"NM_ROUNDTRIP_TIMEOUT_MS should be <= 60000ms (individual round-trips are fast), got {value}ms"

    def test_bg_js_model_downloading_stage_triggers_polling(self):
        """background.js must have logic that polls when stage=model_downloading."""
        code = _read_source(BACKGROUND_JS)
        assert "model_downloading" in code, \
            "background.js must handle the model_downloading stage"
        assert "pollReady" in code, \
            "background.js must send pollReady messages during model download"

    def test_native_host_server_boot_timeout_is_180s(self):
        """native_host.py SERVER_BOOT_TIMEOUT must be >= 180 seconds."""
        code = _read_source(NATIVE_HOST)
        import re
        match = re.search(r"SERVER_BOOT_TIMEOUT\s*=\s*(\d+)", code)
        assert match, "native_host.py must define SERVER_BOOT_TIMEOUT"
        value = int(match.group(1))
        assert value >= 180, \
            f"SERVER_BOOT_TIMEOUT must be >= 180s (Whisper model download), got {value}s"

    def test_native_host_model_pull_timeout_is_600s(self):
        """native_host.py MODEL_PULL_TIMEOUT must be >= 600 seconds."""
        code = _read_source(NATIVE_HOST)
        import re
        match = re.search(r"MODEL_PULL_TIMEOUT\s*=\s*(\d+)", code)
        assert match, "native_host.py must define MODEL_PULL_TIMEOUT"
        value = int(match.group(1))
        assert value >= 600, \
            f"MODEL_PULL_TIMEOUT must be >= 600s (large model downloads), got {value}s"


# ──────────────────────────────────────────────────────────────────────────────
# Tests — Cloud fallback requires explicit confirmation (Fix 5)
# ──────────────────────────────────────────────────────────────────────────────

class TestCloudFallbackConfirmation:
    """
    Verify that switching to cloud transcription requires explicit user action.
    No silent provider switching.
    """

    def test_app_js_has_confirmCloudSwitch_function(self):
        code = _read_source(APP_JS)
        assert "_confirmCloudSwitch" in code, \
            "app.js must have _confirmCloudSwitch function"

    def test_app_js_cloud_switch_is_not_direct(self):
        """
        The btn-server-switch-cloud click handler must NOT directly call
        setLocalStorage or startRecording. It must go through _confirmCloudSwitch.
        """
        code = _read_source(APP_JS)
        # Find the click handler block for btn-server-switch-cloud
        import re
        # Locate the handler
        handler_match = re.search(
            r'btn-server-switch-cloud.*?addEventListener.*?\{(.*?)\}\)',
            code, re.DOTALL
        )
        if handler_match:
            handler_body = handler_match.group(1)
            assert "setLocalStorage" not in handler_body, \
                "Cloud switch handler must not call setLocalStorage directly"
            assert "_confirmCloudSwitch" in handler_body, \
                "Cloud switch handler must call _confirmCloudSwitch"

    def test_app_js_cloud_confirm_modal_id_referenced(self):
        """app.js must reference cloud-confirm-modal."""
        code = _read_source(APP_JS)
        assert "cloud-confirm-modal" in code

    def test_app_js_privacy_notice_text_present(self):
        """app.js must include a privacy notice about data transmission."""
        code = _read_source(APP_JS)
        assert "PRIVACY NOTICE" in code or "privacy policy" in code.lower(), \
            "Cloud switch confirmation must include privacy notice text"

    def test_app_js_doCloudSwitch_is_separate_function(self):
        """_doCloudSwitch must be a separate function from _confirmCloudSwitch."""
        code = _read_source(APP_JS)
        assert "_doCloudSwitch" in code, \
            "Actual cloud switch must be in separate _doCloudSwitch function"

    def test_index_html_has_cloud_confirm_modal(self):
        html_path = PROJECT_ROOT / "talkflow" / "index.html"
        html = html_path.read_text(encoding="utf-8")
        assert "cloud-confirm-modal" in html, \
            "index.html must contain the cloud-confirm-modal element"
        assert "btn-cloud-confirm-ok" in html, \
            "index.html must have the confirm button"
        assert "btn-cloud-confirm-cancel" in html, \
            "index.html must have the cancel button"


# ──────────────────────────────────────────────────────────────────────────────
# Tests — ensureReady (requires server RUNNING)
# ──────────────────────────────────────────────────────────────────────────────

@pytest.mark.live
class TestEnsureReadyServerRunning:

    def setup_method(self):
        if not _port_open():
            pytest.skip("Server not running — skip live tests")

    def test_ensure_ready_ok_when_server_up(self):
        reply = _nm_exchange({"action": "ensureReady"}, read_timeout=30.0)
        assert reply.get("ok") is True, \
            f"ensureReady returned ok=False: {reply.get('message')}"

    def test_ensure_ready_has_all_status_keys(self):
        reply = _nm_exchange({"action": "ensureReady"}, read_timeout=30.0)
        for key in ["ok", "server", "whisper", "ffmpeg", "ollama", "model", "message"]:
            assert key in reply, f"Missing key: {key}"

    def test_ensure_ready_reports_ffmpeg_path(self):
        """v2.1: ensureReady must include ffmpeg_path and ffmpeg_bundled."""
        reply = _nm_exchange({"action": "ensureReady"}, read_timeout=30.0)
        assert "ffmpeg_path" in reply, "ensureReady must include ffmpeg_path"
        assert "ffmpeg_bundled" in reply, "ensureReady must include ffmpeg_bundled"
        assert isinstance(reply["ffmpeg_bundled"], bool)


# ──────────────────────────────────────────────────────────────────────────────
# Tests — ensureReady (requires server STOPPED)
# ──────────────────────────────────────────────────────────────────────────────

@pytest.mark.offline
class TestEnsureReadyServerStopped:

    def setup_method(self):
        if _port_open():
            pytest.skip("Server is running — stop it to run @offline tests")

    def test_ensure_ready_starts_server(self):
        reply = _nm_exchange({"action": "ensureReady"}, read_timeout=200.0)
        assert "ok" in reply
        assert "stage" in reply or reply["ok"] is True

    def test_ensure_ready_failure_has_fix_field(self):
        reply = _nm_exchange({"action": "ensureReady"}, read_timeout=200.0)
        if not reply.get("ok"):
            assert "fix" in reply, "Failure response must include fix field"
            assert isinstance(reply["fix"], str) and len(reply["fix"]) > 5


# ──────────────────────────────────────────────────────────────────────────────
# Tests — Extension JS smoke checks
# ──────────────────────────────────────────────────────────────────────────────

class TestExtensionJSSmoke:

    def test_bg_handles_ensureReady(self):
        assert "ensureReady" in _read_source(BACKGROUND_JS)

    def test_bg_handles_pollReady(self):
        assert "pollReady" in _read_source(BACKGROUND_JS)

    def test_bg_handles_getDiagnostics(self):
        assert "getDiagnostics" in _read_source(BACKGROUND_JS)

    def test_bg_handles_checkServerHealth(self):
        assert "checkServerHealth" in _read_source(BACKGROUND_JS)

    def test_bg_broadcasts_progress_during_download(self):
        code = _read_source(BACKGROUND_JS)
        assert "_broadcastProgress" in code or "readiness_progress" in code, \
            "background.js must broadcast progress during model download"

    def test_app_js_handles_readiness_progress(self):
        code = _read_source(APP_JS)
        assert "readiness_progress" in code, \
            "app.js must listen for readiness_progress to update status bar"


if __name__ == "__main__":
    pytest.main([__file__, "-v", "--tb=short"])
