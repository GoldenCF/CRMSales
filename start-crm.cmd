@echo off
rem Starts the CRM server. Double-click this file or add it to Task Scheduler.
cd /d "%~dp0"
if not exist node_modules call npm install
npm start
