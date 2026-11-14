@echo off
rem ASCII only: cmd.exe reads .bat files in the OEM code page, so Cyrillic text here breaks parsing.
cd /d "%~dp0"
python -u update.py %*
echo.
echo Site: http://localhost:8777  (close this window to stop)
start "" http://localhost:8777
python -m http.server 8777 --bind 127.0.0.1
