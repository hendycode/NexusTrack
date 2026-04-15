# NexusTrack — PowerShell Startup Script
Write-Host ""
Write-Host "╔══════════════════════════════════════════╗" -ForegroundColor Cyan
Write-Host "║       NexusTrack — Full-Stack App        ║" -ForegroundColor Cyan
Write-Host "╚══════════════════════════════════════════╝" -ForegroundColor Cyan
Write-Host ""

# Check Python
try { python --version | Out-Null }
catch {
    Write-Host "ERROR: Python not found. Download from https://python.org" -ForegroundColor Red
    Read-Host "Press Enter to exit"
    exit 1
}

Set-Location "$PSScriptRoot\backend"

# Check Flask
$flask = python -c "import flask; print('ok')" 2>$null
if ($flask -ne "ok") {
    Write-Host "Installing dependencies..." -ForegroundColor Yellow
    pip install flask werkzeug pyjwt itsdangerous
}

Write-Host "  Frontend:  http://localhost:5000" -ForegroundColor Green
Write-Host "  API:       http://localhost:5000/api" -ForegroundColor Green
Write-Host ""

python app.py
