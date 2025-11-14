#!/usr/bin/env python3
"""
Universal setup script for Optiease AI Server
Works on Windows, macOS, and Linux
"""

import os
import sys
import subprocess
import platform

def print_header(text):
    """Print formatted header"""
    print("\n" + "=" * 50)
    print(text)
    print("=" * 50 + "\n")

def run_command(command, description):
    """Run a command and handle errors"""
    print(f"→ {description}...")
    try:
        subprocess.check_call(command, shell=True)
        print(f"✓ {description} complete\n")
        return True
    except subprocess.CalledProcessError as e:
        print(f"✗ Error: {description} failed")
        print(f"  {str(e)}\n")
        return False

def check_python():
    """Check if Python is installed and get version"""
    print(f"✓ Python {sys.version.split()[0]} detected")
    if sys.version_info < (3, 7):
        print("✗ Error: Python 3.7 or higher is required")
        return False
    return True

def check_pip():
    """Check if pip is available"""
    try:
        subprocess.check_output([sys.executable, "-m", "pip", "--version"])
        print("✓ pip is available")
        return True
    except subprocess.CalledProcessError:
        print("✗ pip not found, attempting to install...")
        return run_command(f"{sys.executable} -m ensurepip --upgrade", "Installing pip")

def create_venv():
    """Create virtual environment"""
    venv_path = "venv"
    if os.path.exists(venv_path):
        print(f"✓ Virtual environment already exists at '{venv_path}'")
        return True
    
    print(f"Creating virtual environment at '{venv_path}'...")
    return run_command(f"{sys.executable} -m venv {venv_path}", "Creating virtual environment")

def get_venv_python():
    """Get the path to the Python executable in the virtual environment"""
    system = platform.system()
    if system == "Windows":
        return os.path.join("venv", "Scripts", "python.exe")
    else:  # macOS and Linux
        return os.path.join("venv", "bin", "python")

def install_dependencies(venv_python):
    """Install required dependencies"""
    print_header("Installing Dependencies")
    print("This may take a few minutes...\n")
    
    dependencies = [
        "flask",
        "flask-cors",
        "markitdown",
        "youtube-transcript-api",
        "yt-dlp"
    ]
    
    # Upgrade pip first
    if not run_command(f"{venv_python} -m pip install --upgrade pip", "Upgrading pip"):
        return False
    
    # Install all dependencies
    deps_str = " ".join(dependencies)
    if not run_command(f"{venv_python} -m pip install {deps_str}", "Installing packages"):
        return False
    
    print("✓ All dependencies installed successfully!")
    return True

def check_server_file():
    """Check if server.py exists"""
    if not os.path.exists("server.py"):
        print("✗ Error: server.py not found in current directory")
        print(f"  Current directory: {os.getcwd()}")
        return False
    print("✓ server.py found")
    return True

def start_server(venv_python):
    """Start the Flask server"""
    print_header("Starting Server")
    print("Server will run on http://localhost:5000")
    print("Press Ctrl+C to stop the server\n")
    
    try:
        subprocess.call([venv_python, "server.py"])
    except KeyboardInterrupt:
        print("\n\n✓ Server stopped by user")
        return True

def main():
    """Main setup process"""
    print_header("Optiease AI Server Setup")
    print(f"Platform: {platform.system()} {platform.release()}")
    print(f"Working directory: {os.getcwd()}\n")
    
    # Check Python
    if not check_python():
        sys.exit(1)
    
    # Check pip
    if not check_pip():
        sys.exit(1)
    
    print()
    
    # Create virtual environment
    if not create_venv():
        sys.exit(1)
    
    # Get virtual environment Python path
    venv_python = get_venv_python()
    
    # Install dependencies
    if not install_dependencies(venv_python):
        sys.exit(1)
    
    # Check server file
    if not check_server_file():
        sys.exit(1)
    
    print_header("Setup Complete!")
    
    # Start server
    start_server(venv_python)

if __name__ == "__main__":
    try:
        main()
    except KeyboardInterrupt:
        print("\n\n✓ Setup cancelled by user")
        sys.exit(0)
    except Exception as e:
        print(f"\n✗ Unexpected error: {str(e)}")
        sys.exit(1)
