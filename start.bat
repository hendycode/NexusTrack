@echo off
echo.
echo ╔══════════════════════════════════════════╗
echo ║       NexusTrack — Full-Stack App        ║
echo ╚══════════════════════════════════════════╝
echo.

cd /d "%~dp0backend"

python --version >nul 2>&1
if %errorlevel% neq 0 (
    echo ERROR: Python not found. Install from https://python.org
    pause
    exit /b 1
)

python -c "import flask" >nul 2>&1
if %errorlevel% neq 0 (
    echo Installing dependencies...
    pip install flask werkzeug pyjwt itsdangerous
)

echo Starting NexusTrack...
echo.
echo    Frontend:  http://localhost:5000
echo    API:       http://localhost:5000/api
echo    Health:    http://localhost:5000/api/health
echo.
python app.py
pause
