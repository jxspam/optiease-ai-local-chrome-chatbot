#!/bin/bash
# Optiease AI Server - Setup & Run Script for macOS/Linux
# First run: Sets up environment and starts server
# Subsequent runs: Just starts the server

set -e  # Exit on error

# Check if virtual environment already exists
if [ -f "venv/bin/python" ]; then
    echo "========================================="
    echo "Optiease AI Server Launcher"
    echo "========================================="
    echo ""
    echo "✓ Virtual environment detected. Starting server..."
    echo "Server will run on http://localhost:5000"
    echo ""
    echo "Press Ctrl+C to stop the server"
    echo "========================================="
    echo ""
    
    venv/bin/python server.py
    
    echo ""
    echo "Server stopped."
    read -p "Press Enter to exit..."
    exit 0
fi

echo "========================================="
echo "Optiease AI Server Setup (Mac/Linux)"
echo "========================================="
echo ""

# Check if Python is installed
if ! command -v python3 &> /dev/null; then
    echo "❌ Error: Python 3 is not installed."
    echo "Please install Python 3 from https://www.python.org/downloads/"
    exit 1
fi

PYTHON_VERSION=$(python3 --version)
echo "✓ Found $PYTHON_VERSION"
echo ""

# Check if pip is installed
if ! command -v pip3 &> /dev/null; then
    echo "❌ Error: pip3 is not installed."
    echo "Installing pip..."
    python3 -m ensurepip --upgrade
fi

echo "✓ pip3 is available"
echo ""

# Create virtual environment if it doesn't exist
if [ ! -d "venv" ]; then
    echo "Creating virtual environment..."
    python3 -m venv venv
    echo "✓ Virtual environment created"
else
    echo "✓ Virtual environment already exists"
fi
echo ""

# Activate virtual environment
echo "Activating virtual environment..."
source venv/bin/activate
echo "✓ Virtual environment activated"
echo ""

# Upgrade pip
echo "Upgrading pip..."
pip install --upgrade pip
echo ""

# Install dependencies
echo "Installing dependencies..."
echo "This may take a few minutes..."
echo ""

pip install flask flask-cors "markitdown[all]" youtube-transcript-api yt-dlp

echo ""
echo "✓ All dependencies installed successfully!"
echo ""

# Check if server.py exists
if [ ! -f "server.py" ]; then
    echo "❌ Error: server.py not found in current directory"
    exit 1
fi

echo "========================================="
echo "Setup Complete!"
echo "========================================="
echo ""

# Check for --no-run flag
if [ "$1" = "--no-run" ]; then
    echo "Setup complete! Run this script again to start the server."
    read -p "Press Enter to exit..."
    exit 0
fi

echo "Starting server..."
echo "Server will run on http://localhost:5000"
echo "Press Ctrl+C to stop the server"
echo ""

# Run the server
python server.py

# If server stops, pause so user can see any error messages
echo ""
echo "Server stopped."
read -p "Press Enter to exit..."
