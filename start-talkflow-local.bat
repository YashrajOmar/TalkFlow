@echo off
:: ============================================================
::  TalkFlow Local Companion Launcher (Windows)
::  Double-click to start the local Whisper + Ollama server.
::
::  Keeps the terminal open so you can see status and logs.
::  Press Ctrl+C to stop.
:: ============================================================

title TalkFlow Local Companion

:: Change to the local-transcriber directory
cd /d "%~dp0local-transcriber"

:: Find Python
set "PYTHON="
for %%P in (python python3 py) do (
    if not defined PYTHON (
        %%P --version >nul 2>&1 && set "PYTHON=%%P"
    )
)

if not defined PYTHON (
    echo.
    echo  ERROR: Python is not installed or not on PATH.
    echo  Download Python from: https://python.org/downloads
    echo  Make sure to check "Add python.exe to PATH" during install.
    echo.
    pause
    exit /b 1
)

:: Check requirements are installed
%PYTHON% -c "import faster_whisper" >nul 2>&1
if %errorlevel% neq 0 (
    echo.
    echo  First-time setup: Installing required packages...
    echo  This only happens once.
    echo.
    %PYTHON% -m pip install -r requirements.txt
    if %errorlevel% neq 0 (
        echo.
        echo  ERROR: Failed to install requirements.
        echo  Try running: pip install -r local-transcriber\requirements.txt
        echo.
        pause
        exit /b 1
    )
)

:: Start the companion
%PYTHON% start_talkflow_local.py

:: Keep window open if it exits unexpectedly
echo.
echo  Press any key to close this window...
pause >nul
