#!/bin/bash

# Farben für ansprechende Terminal-Ausgaben
GREEN='\033[0;32m'
BLUE='\033[0;34m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m' # No Color

echo -e "${BLUE}====================================================${NC}"
echo -e "${BLUE}   Haystack Pipeline Builder - Docker Starter-Skript ${NC}"
echo -e "${BLUE}====================================================${NC}"

# Überprüfe, ob Docker installiert ist
if ! [ -x "$(command -v docker)" ]; then
  echo -e "${RED}Fehler: Docker ist nicht installiert oder nicht im PATH verfügbar.${NC}"
  echo -e "Bitte installiere Docker (https://docs.docker.com/get-docker/) und versuche es erneut."
  exit 1
fi

# Überprüfe, ob Docker-Daemon läuft
if ! docker info >/dev/null 2>&1; then
  echo -e "${RED}Fehler: Der Docker-Daemon läuft nicht.${NC}"
  echo -e "Bitte starte Docker Desktop oder den Docker-Service und führe das Skript erneut aus."
  exit 1
fi

# Lokales 'gen'-Verzeichnis erstellen, um generierte Pipelines zu mappen
mkdir -p gen

# Prüfen, ob docker-compose bzw. docker compose verfügbar ist
if docker compose version >/dev/null 2>&1; then
  echo -e "${GREEN}✓ Docker Compose erkannt! Starte Container über Compose...${NC}"
  echo -e "${YELLOW}Baue und starte die Applikation...${NC}"
  docker compose up --build
elif command -v docker-compose >/dev/null 2>&1; then
  echo -e "${GREEN}✓ Docker Compose (Legacy) erkannt! Starte Container...${NC}"
  echo -e "${YELLOW}Baue und starte die Applikation...${NC}"
  docker-compose up --build --force-recreate
else
  echo -e "${YELLOW}⚠ Docker Compose wurde nicht gefunden. Verwende standardmäßige Docker-Befehle...${NC}"
  
  IMAGE_NAME="haystack-pipeline-builder"
  CONTAINER_NAME="haystack-pipeline-builder-container"

  echo -e "${BLUE}1. Baue das Docker-Image (${IMAGE_NAME})...${NC}"
  docker build -t $IMAGE_NAME .

  # Stoppe alten Container, falls vorhanden
  if [ "$(docker ps -aq -f name=$CONTAINER_NAME)" ]; then
    echo -e "${YELLOW}Stoppe und entferne existierenden Container...${NC}"
    docker rm -f $CONTAINER_NAME
  fi

  echo -e "${BLUE}2. Starte den Container auf Port 3000...${NC}"
  echo -e "Generierte Dateien werden im lokalen Verzeichnis './gen' gespeichert."
  docker run -d \
    --name $CONTAINER_NAME \
    -p 3000:3000 \
    -v "$(pwd)/gen:/app/gen" \
    $IMAGE_NAME

  echo -e "${GREEN}✓ Container erfolgreich im Hintergrund gestartet!${NC}"
  echo -e "Die Anwendung ist erreichbar unter: ${BLUE}http://localhost:3000${NC}"
  echo -e "Verwende 'docker logs -f $CONTAINER_NAME' um die Logs anzuzeigen."
  echo -e "Verwende 'docker stop $CONTAINER_NAME' um die App zu beenden."
fi
