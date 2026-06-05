# TalkFlow Companion — Windows Build Script
# ==========================================
# Packages the local companion into a self-contained Windows executable.
# Output: dist/TalkFlowLocal/ (--onedir for reliability)
#
# Usage:
#   powershell -ExecutionPolicy Bypass -File scripts/build_windows_companion.ps1
#
# Requirements:
#   - Python 3.10+ on PATH
#   - pip install pyinstaller
#   - ffmpeg.exe (place in local-transcriber/vendor/ffmpeg/ for bundling)

param(
    [switch]$IncludeFFmpeg,   # Bundle ffmpeg.exe from local-transcriber/vendor/ffmpeg/
    [switch]$Clean            # Delete dist/ and build/ before building
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$ScriptDir   = Split-Path -Parent $MyInvocation.MyCommand.Path
$ProjectRoot = Split-Path -Parent $ScriptDir
$LocalTransDir = Join-Path $ProjectRoot "local-transcriber"
$EntryPoint  = Join-Path $LocalTransDir "start_talkflow_local.py"
$DistDir     = Join-Path $ProjectRoot "dist"

Write-Host ""
Write-Host "============================================================"
Write-Host "  TalkFlow Companion — Windows Build"
Write-Host "============================================================"
Write-Host ""

# ── Validate Python ────────────────────────────────────────────────────────────
try {
    $pyVersion = & python --version 2>&1
    Write-Host "  Python : $pyVersion"
} catch {
    Write-Error "Python not found on PATH. Install from https://python.org"
}

# ── Check / install PyInstaller ────────────────────────────────────────────────
Write-Host "  Checking PyInstaller..."
$piCheck = python -c "import PyInstaller; print(PyInstaller.__version__)" 2>&1
if ($LASTEXITCODE -ne 0) {
    Write-Host "  Installing PyInstaller..."
    pip install pyinstaller
    if ($LASTEXITCODE -ne 0) { Write-Error "Failed to install PyInstaller." }
} else {
    Write-Host "  PyInstaller $piCheck OK"
}

# ── Clean ──────────────────────────────────────────────────────────────────────
if ($Clean) {
    Write-Host "  Cleaning dist/ and build/..."
    Remove-Item -Recurse -Force "$DistDir" -ErrorAction SilentlyContinue
    Remove-Item -Recurse -Force (Join-Path $ProjectRoot "build") -ErrorAction SilentlyContinue
}

# ── Build arguments ────────────────────────────────────────────────────────────
$PyinstallerArgs = @(
    "--name", "TalkFlowLocal",
    "--onedir",          # More reliable than --onefile for large ML deps
    "--noconsole",       # No terminal window for background mode
    "--clean",
    "--noconfirm",
    # Add all local-transcriber files as data
    "--add-data", "${LocalTransDir}/server.py:.",
    "--add-data", "${LocalTransDir}/talkflow_companion_config.json:.",
    "--add-data", "${LocalTransDir}/requirements.txt:.",
    # Hidden imports that PyInstaller may miss
    "--hidden-import", "faster_whisper",
    "--hidden-import", "uvicorn",
    "--hidden-import", "fastapi",
    "--hidden-import", "httpx",
    "--hidden-import", "pydantic",
    "--hidden-import", "anyio",
    "--hidden-import", "anyio.from_thread",
    "--hidden-import", "starlette",
    # Entry point
    $EntryPoint
)

# ── Optional: bundle ffmpeg ────────────────────────────────────────────────────
$FfmpegVendorDir = Join-Path $LocalTransDir "vendor" "ffmpeg"
if ($IncludeFFmpeg) {
    $FfmpegExe = Join-Path $FfmpegVendorDir "ffmpeg.exe"
    if (Test-Path $FfmpegExe) {
        # Bundle into the exe root so it's on PATH relative to the executable
        $PyinstallerArgs += "--add-binary"
        $PyinstallerArgs += "${FfmpegExe}:."
        Write-Host "  Bundling ffmpeg from: $FfmpegExe"
    } else {
        Write-Warning "  -IncludeFFmpeg specified but ffmpeg.exe not found at: $FfmpegExe"
        Write-Warning "  Download ffmpeg.exe from https://ffmpeg.org/download.html and place it there."
        Write-Warning "  Building without bundled ffmpeg. Users must install ffmpeg separately."
    }
} else {
    Write-Host ""
    Write-Host "  NOTE: ffmpeg not bundled. To bundle ffmpeg:"
    Write-Host "    1. Download ffmpeg.exe from https://ffmpeg.org/download.html"
    Write-Host "    2. Place it at: local-transcriber/vendor/ffmpeg/ffmpeg.exe"
    Write-Host "    3. Re-run with: -IncludeFFmpeg"
    Write-Host ""
}

# ── Run PyInstaller ────────────────────────────────────────────────────────────
Write-Host "  Running PyInstaller..."
Write-Host "  Entry: $EntryPoint"
Write-Host ""

Push-Location $ProjectRoot
python -m PyInstaller @PyinstallerArgs
$exitCode = $LASTEXITCODE
Pop-Location

if ($exitCode -ne 0) {
    Write-Error "PyInstaller build failed with exit code $exitCode"
}

# ── Copy companion config alongside exe ───────────────────────────────────────
$OutputDir = Join-Path $DistDir "TalkFlowLocal"
$ConfigSrc = Join-Path $LocalTransDir "talkflow_companion_config.json"
$ConfigDst = Join-Path $OutputDir "talkflow_companion_config.json"

if (Test-Path $OutputDir) {
    if (Test-Path $ConfigSrc) {
        Copy-Item $ConfigSrc $ConfigDst -Force
    }
    # Copy install script into dist for convenience
    $InstSrc = Join-Path $LocalTransDir "install_native_host_windows.bat"
    if (Test-Path $InstSrc) {
        Copy-Item $InstSrc (Join-Path $OutputDir "install_native_host_windows.bat") -Force
    }
}

# ── Done ───────────────────────────────────────────────────────────────────────
Write-Host ""
Write-Host "============================================================"
Write-Host "  Build complete!"
Write-Host "  Output: $OutputDir"
Write-Host ""
Write-Host "  Next steps:"
Write-Host "   1. Test: run dist\TalkFlowLocal\TalkFlowLocal.exe"
Write-Host "   2. Run install_native_host_windows.bat inside dist/"
Write-Host "   3. Build installer: iscc installer\windows\TalkFlowCompanion.iss"
Write-Host "============================================================"
Write-Host ""
