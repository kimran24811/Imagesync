@echo off
setlocal enabledelayedexpansion
title SceneSync Studio — Local Launcher
cd /d "%~dp0"

echo ========================================================
echo   SceneSync Studio — Automated Local Video Workstation
echo ========================================================
echo.

where node >nul 2>nul
if %errorlevel% neq 0 (
  echo [ERROR] Node.js v20+ is required but was not found in PATH.
  echo Please install Node.js LTS from https://nodejs.org/ and try again.
  pause
  exit /b 1
)

where ffmpeg >nul 2>nul
if %errorlevel% neq 0 (
  echo [ERROR] FFmpeg is required for audio analysis and 1080p MP4 rendering.
  echo Install via winget: winget install Gyan.FFmpeg
  echo Or download from https://www.gyan.dev/ffmpeg/builds/ and add bin\ to PATH.
  pause
  exit /b 1
)

if not exist "node_modules" (
  echo [SETUP] First-time dependency installation...
  call npm install
  if %errorlevel% neq 0 (
    echo [ERROR] npm install failed.
    pause
    exit /b 1
  )
)

if not exist ".env" (
  if exist ".env.example" (
    copy /Y ".env.example" ".env" >nul
    echo [INFO] Created .env from .env.example.
    echo [INFO] Optional: Add GEMINI_API_KEY in .env for Multimodal Vision matching.
  )
)

echo [START] Launching SceneSync Studio on http://localhost:3000 ...
start "" cmd /c "timeout /t 3 /nobreak >nul && start http://localhost:3000"

call npm run dev
if %errorlevel% neq 0 (
  echo.
  echo [ERROR] Studio server stopped unexpectedly.
  pause
)
