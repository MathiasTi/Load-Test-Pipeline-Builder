@echo off
:: Setze UTF-8 Kodierung für Sonderzeichen in Windows Command Prompt
chcp 65001 >nul

echo ====================================================
echo    Haystack Pipeline Builder - Docker Starter-Skript
echo ====================================================

:: Überprüfe Docker Installation
where docker >nul 2>nul
if %errorlevel% neq 0 (
    echo [FEHLER] Docker wurde nicht gefunden. Bitte installiere Docker und füge es zum PATH hinzu.
    pause
    exit /b 1
)

:: Überprüfe ob Docker läuft
docker info >nul 2>nul
if %errorlevel% neq 0 (
    echo [FEHLER] Der Docker-Daemon läuft nicht. Bitte starte Docker Desktop.
    pause
    exit /b 1
)

:: Erstelle gen-Verzeichnis
if not exist gen mkdir gen

:: Verwende Docker Compose falls verfügbar
docker compose version >nul 2>nul
if %errorlevel% eq 0 (
    echo [INFO] Docker Compose erkannt. Starte Container...
    docker compose up --build
    goto end
)

:: Fallback auf normales docker
echo [INFO] Docker Compose nicht gefunden. Verwende Standard-Docker-Befehle...
echo 1. Baue das Docker-Image (haystack-pipeline-builder)...
docker build -t haystack-pipeline-builder .

echo 2. Entferne alten Container falls vorhanden...
docker rm -f haystack-pipeline-builder-container >nul 2>nul

echo 3. Starte Container auf Port 3000...
docker run -d --name haystack-pipeline-builder-container -p 3000:3000 -v "%cd%/gen:/app/gen" haystack-pipeline-builder

echo ====================================================
echo [ERFOLG] Container gestartet!
echo Anwendung ist erreichbar unter: http://localhost:3000
echo Logs anzeigen mit: docker logs -f haystack-pipeline-builder-container
echo Beenden mit: docker stop haystack-pipeline-builder-container
echo ====================================================
pause

:end
