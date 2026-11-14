@echo off
rem Push the site to GitHub (GitHub Pages). Needs a remote: git remote add origin https://github.com/<you>/<repo>.git
cd /d "%~dp0"
git remote get-url origin >nul 2>&1 || (echo No GitHub remote yet. See README, section "Hosting". & exit /b 1)
git add -A
git diff --cached --quiet && (echo Nothing new to publish. & exit /b 0)
git commit -q -m "Data update %date%"
git push -q origin HEAD
echo Published.
