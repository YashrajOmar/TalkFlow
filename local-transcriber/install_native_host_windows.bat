@echo off
:: ============================================================
::  TalkFlow Native Messaging Host Installer  v2.0  (Windows)
::  Registers com.talkflow.local in the Windows Registry.
::
::  This version reads the extension ID automatically from:
::    talkflow_companion_config.json
::
::  If extensionId is still a placeholder, you will be prompted
::  once to paste your Chrome extension ID.
::
::  NO ADMIN RIGHTS required (writes to HKCU, not HKLM).
:: ============================================================

setlocal enabledelayedexpansion

title TalkFlow Native Host Installer v2.0

echo.
echo  ============================================================
echo   TalkFlow Native Messaging Host Installer
echo  ============================================================
echo.

:: ── Resolve paths ─────────────────────────────────────────────────────────────
set "SCRIPT_DIR=%~dp0"
if "%SCRIPT_DIR:~-1%"=="\" set "SCRIPT_DIR=%SCRIPT_DIR:~0,-1%"

:: Determine if we're running from inside local-transcriber/ or from dist/
set "HOST_EXE=%SCRIPT_DIR%\TalkFlowLocal.exe"
set "HOST_PY=%SCRIPT_DIR%\native_host.py"
set "CONFIG_FILE=%SCRIPT_DIR%\talkflow_companion_config.json"

:: ── Find Python ───────────────────────────────────────────────────────────────
set "PYTHON="
for %%P in (python python3 py) do (
    if not defined PYTHON (
        %%P --version >nul 2>&1 && set "PYTHON=%%P"
    )
)

if not defined PYTHON (
    echo  WARNING: Python not found. Will use .exe host if available.
    echo.
)

:: ── Determine host executable ─────────────────────────────────────────────────
:: Prefer compiled .exe (for end-users), fall back to Python script (for devs)
set "USE_EXE=0"
set "HOST_PATH="

if exist "%HOST_EXE%" (
    set "USE_EXE=1"
    set "HOST_PATH=%HOST_EXE%"
    echo  Host executable : %HOST_EXE%
) else if exist "%HOST_PY%" (
    if not defined PYTHON (
        echo  ERROR: Neither TalkFlowLocal.exe nor Python were found.
        echo  Install TalkFlow Companion or Python, then re-run this installer.
        echo.
        pause
        exit /b 1
    )
    :: Create a wrapper .bat that Chrome will call (Chrome needs executable)
    set "WRAPPER_BAT=%SCRIPT_DIR%\native_host_runner.bat"
    echo @echo off > "!WRAPPER_BAT!"
    echo "!PYTHON!" "%HOST_PY%" %%* >> "!WRAPPER_BAT!"
    set "HOST_PATH=!WRAPPER_BAT!"
    echo  Host script : %HOST_PY%
    echo  Wrapper     : !WRAPPER_BAT!
) else (
    echo  ERROR: Neither TalkFlowLocal.exe nor native_host.py found in:
    echo    %SCRIPT_DIR%
    echo.
    echo  Run scripts/build_windows_companion.ps1 first, or run this
    echo  installer from the local-transcriber/ directory.
    echo.
    pause
    exit /b 1
)

:: ── Read extension ID from config ─────────────────────────────────────────────
set "EXT_ID="
set "PLACEHOLDER=REPLACE_WITH_PUBLISHED_EXTENSION_ID"

if exist "%CONFIG_FILE%" (
    if defined PYTHON (
        for /f "usebackq delims=" %%L in (`%PYTHON% -c "import json; d=json.load(open(r'%CONFIG_FILE%')); print(d.get('extensionId',''))"`) do (
            set "EXT_ID=%%L"
        )
    )
)

:: If extensionId is placeholder or empty, prompt user
if "!EXT_ID!"=="!PLACEHOLDER!" set "EXT_ID="
if "!EXT_ID!"=="" (
    echo.
    echo  The extension ID was not found in talkflow_companion_config.json.
    echo.
    echo  To find your Extension ID:
    echo    1. Open Chrome ^> chrome://extensions
    echo    2. Enable Developer Mode ^(top right^)
    echo    3. Find "TalkFlow - Interview Speech Coach"
    echo    4. Copy the 32-character ID shown below the extension name
    echo.
    set /p EXT_ID="  Paste Extension ID and press Enter: "
)

if "!EXT_ID!"=="" (
    echo  ERROR: No Extension ID provided. Installation cancelled.
    pause
    exit /b 1
)

:: Basic length validation (Chrome extension IDs are 32 chars)
set "ID_LEN=0"
for /l %%i in (0,1,31) do (
    set "C=!EXT_ID:~%%i,1!"
    if not "!C!"=="" set /a ID_LEN+=1
)
if !ID_LEN! lss 32 (
    echo  WARNING: Extension ID looks too short ^(!ID_LEN! chars^). Double-check it.
)

echo.
echo  Extension ID : !EXT_ID!
echo  Host path    : !HOST_PATH!

:: ── Write the native messaging manifest ───────────────────────────────────────
set "MANIFEST_PATH=%SCRIPT_DIR%\com.talkflow.local.json"

if defined PYTHON (
    %PYTHON% -c ^
"import json, sys; ^
manifest = { ^
    'name': 'com.talkflow.local', ^
    'description': 'TalkFlow Local Companion - auto-starts local Whisper/Ollama server', ^
    'path': r'!HOST_PATH!', ^
    'type': 'stdio', ^
    'allowed_origins': ['chrome-extension://!EXT_ID!/'] ^
}; ^
open(r'%MANIFEST_PATH%', 'w').write(json.dumps(manifest, indent=2)); ^
print('Manifest written to %MANIFEST_PATH%')"
) else (
    :: Fallback: write manifest without Python (simple text construction)
    (
        echo {
        echo   "name": "com.talkflow.local",
        echo   "description": "TalkFlow Local Companion",
        echo   "path": "!HOST_PATH:\=\\!",
        echo   "type": "stdio",
        echo   "allowed_origins": ["chrome-extension://!EXT_ID!/"]
        echo }
    ) > "%MANIFEST_PATH%"
    echo  Manifest written to %MANIFEST_PATH%
)

if not exist "%MANIFEST_PATH%" (
    echo  ERROR: Failed to write manifest.
    pause
    exit /b 1
)

:: ── Register in Windows Registry (HKCU — no admin needed) ────────────────────
set "REG_KEY=HKCU\Software\Google\Chrome\NativeMessagingHosts\com.talkflow.local"
reg add "%REG_KEY%" /ve /t REG_SZ /d "%MANIFEST_PATH%" /f >nul

if %errorlevel% neq 0 (
    echo  ERROR: Failed to write registry key.
    pause
    exit /b 1
)

:: ── Validate ──────────────────────────────────────────────────────────────────
echo.
echo  Validating installation...

:: Confirm registry key was written
for /f "tokens=*" %%V in ('reg query "%REG_KEY%" /ve 2^>nul') do (
    echo  Registry : OK
)

:: Confirm manifest can be parsed
if defined PYTHON (
    %PYTHON% -c "import json; d=json.load(open(r'%MANIFEST_PATH%')); print('  Manifest : OK -', d['name'])" 2>nul
)

:: ── Done ──────────────────────────────────────────────────────────────────────
echo.
echo  ============================================================
echo   Installation complete!
echo  ============================================================
echo.
echo   Native host : com.talkflow.local
echo   Manifest    : %MANIFEST_PATH%
echo   Extension   : chrome-extension://!EXT_ID!/
echo.
echo   TalkFlow can now auto-start the local server when you
echo   click Start Recording in Chrome - no terminal required!
echo.
echo   To uninstall, run:
echo     reg delete "%REG_KEY%" /f
echo.
pause
