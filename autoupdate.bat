@echo off
rem Daily auto-update (run by Windows Task Scheduler). ASCII only on purpose.
cd /d "%~dp0"
echo ===== %date% %time% >> data\autoupdate.log
python -u update.py >> data\autoupdate.log 2>&1
rem If the site is connected to GitHub Pages, publish the fresh data.
git remote get-url origin >nul 2>&1 && call publish.bat >> data\autoupdate.log 2>&1
