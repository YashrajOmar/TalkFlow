@echo off
:: ============================================================
::  TalkFlow Native Messaging Host Installer (Windows)
::  Registers com.talkflow.local in the Windows Registry
::  so Chrome can auto-start the TalkFlow local server.
::
::  Usage:
::    1. Load TalkFlow extension in Chrome (chrome://extensions)
::    2. Copy the Extension ID (32-char string) from the page
::    3. Double-click this script and paste the ID when asked
::    4. Done — Chrome can now start TalkFlow automatically
::
::  No admin rights required (writes to HKCU, not HKLM).
:: ============================================================

setlocal enabledelayedexpansion

title TalkFlow Native Host Installer

echo.
echo  ============================================================
echo   TalkFlow Native Messaging Host Installer
echo  ============================================================
echo.

:: ── Locate Python ────────────────────────────────────────────
set "PYTHON="
for %%P in (python python3 py) do (
    if not defined PYTHON (
        %%P --version >nul 2>&1 && set "PYTHON=%%P"
    )
)

if not defined PYTHON (
    echo  ERROR: Python not found on PATH.
    echo  Install Python from https://python.org and add it to PATH.
    echo.
    pause
    exit /b 1
)

echo  Python found: %PYTHON%

:: ── Resolve paths ────────────────────────────────────────────
set "SCRIPT_DIR=%~dp0"
:: Remove trailing backslash
if "%SCRIPT_DIR:~-1%"=="\" set "SCRIPT_DIR=%SCRIPT_DIR:~0,-1%"

set "HOST_SCRIPT=%SCRIPT_DIR%\native_host.py"
set "MANIFEST_SRC=%SCRIPT_DIR%\com.talkflow.local.json"
set "MANIFEST_DEST=%SCRIPT_DIR%\com.talkflow.local.installed.json"

if not exist "%HOST_SCRIPT%" (
    echo  ERROR: native_host.py not found at %HOST_SCRIPT%
    pause
    exit /b 1
)

:: ── Get Extension ID from user ────────────────────────────────
echo.
echo  Step 1: Open chrome://extensions in Chrome.
echo  Step 2: Find "TalkFlow - Interview Speech Coach".
echo  Step 3: Copy the Extension ID (32-character string below the name).
echo.
set /p EXT_ID="  Paste your Extension ID here and press Enter: "

:: Basic validation
if "%EXT_ID%"=="" (
    echo  ERROR: No Extension ID entered.
    pause
    exit /b 1
)

:: ── Build the host path string (Python on Windows needs the py file via a wrapper) ──
:: We create a small .bat wrapper that Chrome will call as the host executable,
:: because Chrome NativeMessaging on Windows must point to an .exe or .bat.
set "WRAPPER_BAT=%SCRIPT_DIR%\native_host_runner.bat"
echo @echo off > "%WRAPPER_BAT%"
echo "%PYTHON%" "%HOST_SCRIPT%" %%* >> "%WRAPPER_BAT%"

:: ── Write the installed manifest ──────────────────────────────
:: Use Python to write the JSON correctly (avoids batch escaping nightmares)
%PYTHON% -c "
import json, sys
manifest = {
    'name': 'com.talkflow.local',
    'description': 'TalkFlow Local Companion — auto-starts the local Whisper/Ollama server',
    'path': r'%WRAPPER_BAT%',
    'type': 'stdio',
    'allowed_origins': ['chrome-extension://%EXT_ID%/']
}
with open(r'%MANIFEST_DEST%', 'w') as f:
    json.dump(manifest, f, indent=2)
print('Manifest written.')
"

if not exist "%MANIFEST_DEST%" (
    echo  ERROR: Failed to write manifest file.
    pause
    exit /b 1
)

:: ── Register in Windows Registry (HKCU — no admin required) ───
set "REG_KEY=HKCU\Software\Google\Chrome\NativeMessagingHosts\com.talkflow.local"
reg add "%REG_KEY%" /ve /t REG_SZ /d "%MANIFEST_DEST%" /f >nul

if %errorlevel% neq 0 (
    echo  ERROR: Failed to write registry key.
    pause
    exit /b 1
)

:: ── Done ──────────────────────────────────────────────────────
echo.
echo  ============================================================
echo   Installation complete!
echo  ============================================================
echo.
echo   Host name : com.talkflow.local
echo   Manifest  : %MANIFEST_DEST%
echo   Extension : chrome-extension://%EXT_ID%/
echo.
echo   TalkFlow can now auto-start the local server when you
echo   click Start Recording — no terminal required.
echo.
echo   To uninstall, run:
echo     reg delete "%REG_KEY%" /f
echo.
pause
