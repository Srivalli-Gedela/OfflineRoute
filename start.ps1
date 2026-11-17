Write-Host "======================================================================" -ForegroundColor Cyan
Write-Host " Starting OfflineRoute (React + Flask + SQLite + Leaflet + IndexedDB)" -ForegroundColor Green
Write-Host "======================================================================" -ForegroundColor Cyan
Set-Location $PSScriptRoot
python run_app.py
