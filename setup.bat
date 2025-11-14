@echo off
REM Cross-platform setup script for Optiease AI Server
REM Works on Windows

setlocal enabledelayedexpansion

echo =========================================
echo Optiease AI Server Setup (Windows)
echo =========================================
echo.

REM Check if Python is installed
python --version >nul 2>&1
if %errorlevel% neq 0 (
    echo Error: Python is not installed.
    echo Please install Python from https://www.python.org/downloads/
    echo Make sure to check "Add Python to PATH" during installation
    pause
    exit /b 1
)

for /f "tokens=*" %%i in ('python --version') do set PYTHON_VERSION=%%i
echo Found !PYTHON_VERSION!
echo.

REM Check if pip is installed
python -m pip --version >nul 2>&1
if %errorlevel% neq 0 (
    echo Error: pip is not installed.
    echo Installing pip...
    python -m ensurepip --upgrade
)

echo pip is available
echo.

REM Create virtual environment if it doesn't exist
if not exist "venv" (
    echo Creating virtual environment...
    python -m venv venv
    echo Virtual environment created
) else (
    echo Virtual environment already exists
)
echo.

REM Activate virtual environment
echo Activating virtual environment...
call venv\Scripts\activate.bat
echo Virtual environment activated
echo.

REM Upgrade pip
echo Upgrading pip...
python -m pip install --upgrade pip
echo.

REM Install dependencies
echo Installing dependencies...
echo This may take a few minutes...
echo.

python -m pip install flask flask-cors markitdown youtube-transcript-api yt-dlp

echo.
echo All dependencies installed successfully!
echo.

REM Check if server.py exists
if not exist "server.py" (
    echo Error: server.py not found in current directory
    pause
    exit /b 1
)

echo =========================================
echo Setup Complete!
echo =========================================
echo.
echo Starting server...
echo Server will run on http://localhost:5000
echo Press Ctrl+C to stop the server
echo.

REM Run the server
python server.py
