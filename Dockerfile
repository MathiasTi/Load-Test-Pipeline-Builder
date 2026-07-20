# Verwende das offizielle Node.js 22 Slim-Image als Basis (Debian-basiert)
FROM node:22-slim

# Installiere Python 3, da das Backend dies zur Syntaxprüfung der generierten Pipelines benötigt
RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 \
    && rm -rf /var/lib/apt/lists/*

# Erstelle das Anwendungsverzeichnis im Container
WORKDIR /app

# Kopiere package.json und package-lock.json (falls vorhanden) für optimales Caching
COPY package*.json ./

# Installiere alle Projektabhängigkeiten (inklusive DevDependencies für tsx)
RUN npm install

# Kopiere den gesamten Quellcode in das Arbeitsverzeichnis des Containers
COPY . .

# Setze Umgebungsvariablen
ENV PORT=3000
ENV NODE_ENV=production

# Mache Port 3000 nach außen hin verfügbar
EXPOSE 3000

# Starte die Anwendung mit tsx, um TypeScript direkt auszuführen
CMD ["npx", "tsx", "server.ts"]
