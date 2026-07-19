# ⚡ Haystack Load-Test Pipeline Builder (Low-Code)

Eine hocheffiziente Low-Code Web-App, mit der man visuell eine **Haystack-v2 Pipeline** zur Analyse von Lasttest-Daten (Webserver-Logs, CPU/RAM-Metriken, JMeter-Reports) zusammenbaut. Am Ende entsteht ein standardisiertes **JSON-Zwischenformat**, das in voll funktionsfähigen **Haystack-Python-Code** und eine standardkonforme **YAML-Definition** übersetzt wird.

---

## 🏗️ System-Architektur & Datenfluss

Der Pipeline-Builder trennt die visuelle Darstellung sauber von der eigentlichen Ausführungslogik. Nachfolgendes Diagramm zeigt, wie die Komponenten zusammenspielen:

```
               +----------------------------------------+
               |   Low-Code Web Canvas (Client-Side)    |
               |  - Visuelle Drag & Drop Verbindung      |
               |  - Parameter-Editor & Live-Linter      |
               +-------------------+--------------------+
                                   |
                       [Exportiert Diagramm-JSON]
                                   |
                                   v
               +-------------------+--------------------+
               |   Helper Engine Runtime (server.ts)    |
               |  - Übersetzt JSON in Python & YAML      |
               |  - Prüft Syntax der Custom-Komponenten |
               +---------+--------------------+---------+
                         |                    |
            (Generiert Python-Code)      (Generiert Standard-YAML)
                         |                    |
                         v                    v
         +---------------+---------------+    +---------------------------+
         | components.py |  pipeline.py  |    |       pipeline.yaml       |
         | (Custom Logic)| (Loader/Graph)|    | (Standard deklarierte     |
         +---------------+---------------+    |   Haystack-v2 Pipeline)   |
                         |                    +-------------+-------------+
                         v                                  |
         +---------------+---------------+                  |
         |     Container-Runtime Engine  |<-----------------+
         | - Geladen über FastAPI REST   | (Direkt-Import ohne Python-Code)
         | - Lokale LLMs via Ollama API  |
         | - Lokale Protokolldateien     |
         +-------------------------------+
```

---

## 📝 Architecture Decision Records (ADRs)

Um die Wartbarkeit und Erweiterbarkeit zu sichern, wurden zentrale Entscheidungen in standardisierten ADRs festgehalten. Die vollständigen Dokumente liegen im Verzeichnis [`/adr/`](./adr/):

1. **[ADR-0001](./adr/0001-frontend-only-canvas-with-helper-runtime.md): Frontend-First Canvas mit optionaler Helper-Runtime** (Akzeptiert)
   * *Ziel:* Hohe Performance und Zuverlässigkeit im Browser, gekoppelt mit einem leichtgewichtigen API-Service zur Generierung und Validierung.
2. **[ADR-0002](./adr/0002-offline-on-premise-focus.md): Komplette Offline-Lauffähigkeit (On-Premise Focus)** (Akzeptiert)
   * *Ziel:* Lasttest-Logs enthalten extrem sensible Systemdaten. Die gesamte App und die generierten Pipelines arbeiten vollständig on-premise und offline (unterstützt lokale LLMs wie Ollama).
3. **[ADR-0003](./adr/0003-standardized-yaml-and-json-serialization.md): Standardisierte YAML & JSON-Serialisierung** (Akzeptiert)
   * *Ziel:* Unterstützung der offiziellen Haystack-v2 YAML-Spezifikation für CI/CD Deployments ohne Python-Verbindungs-Boilerplate.
4. **[ADR-0004](./adr/0004-timeframe-correlation-logic.md): Zeitfenster-basierter Fehler-Korrelator** (Akzeptiert)
   * *Ziel:* Reduzierung des Token-Verbrauchs und Erhöhung der Genauigkeit von LLM-Analysen durch vorherige Filterung von Protokollen auf exakte Testzeiträume (Ramp-up, Peak, Ramp-down).

---

## 🚀 Quick Start: Nutzung der Web-App in 3 Schritten

1. **Pipeline entwerfen:**
   * Ziehen Sie Komponenten (z.B. `WebServerLogLoader`, `TimeWindowFilter`, `ErrorClassifier` und `OpenAIGenerator`) aus der linken Palette auf das Canvas.
   * Verbinden Sie die Ausgänge (rot/orange Punkte) mit passenden Eingängen (grüne Punkte).
   * **QoL-Highlight:** Zum **Löschen einer Verbindung** klicken Sie diese auf dem Canvas einfach an und bestätigen Sie die Abfrage!
2. **Parameter anpassen:**
   * Klicken Sie einen Knoten an, um seine Parameter (wie Log-Dateipfade oder reguläre Ausdrücke) im rechten Inspektor anzupassen.
   * Über das Zahnrad-Symbol **⚙ Einstellungen** im Header legen Sie die globale LLM-Basis-URL und API-Keys fest.
3. **Pipeline erzeugen:**
   * Klicken Sie auf **⚡ Pipeline generieren**. Der generierte Python-Code (für Custom-Logik und den Pipeline-Graphen) sowie die standardkonforme YAML-Definition werden generiert und können direkt heruntergeladen werden.

---

## 📖 Tutorial: Deployment einer generierten Pipeline

Nachdem Sie Ihre Pipeline im Editor entworfen und heruntergeladen haben, können Sie diese auf verschiedene Arten in Produktion nehmen.

### Option A: Deklaratives Deployment mittels Standard-YAML (Empfohlen)

Dank des standardisierten Haystack-v2 YAML-Formats müssen Sie keinen Python-Code schreiben, um die Pipeline zu instanziieren. Die YAML-Datei deklariert alle Komponenten und deren Verbindungen.

1. **Installieren Sie Haystack v2:**
   ```bash
   pip install haystack-ai
   ```
2. **Laden Sie die YAML-Pipeline direkt in Ihrem Python-Skript:**
   ```python
   from haystack import Pipeline
   # Ihre Custom-Komponenten müssen in Python importiert oder registriert sein
   from pipeline_components import WebServerLogLoader, LogParser, TimeWindowFilter, ErrorClassifier, ResultExporter

   # Lädt die komplette visuell entworfene Pipeline
   with open("pipeline_pipeline.yaml", "r") as f:
       yaml_data = f.read()

   pipeline = Pipeline.loads(yaml_data)
   print("✓ Pipeline erfolgreich deklariert geladen!")
   ```

---

### Option B: Komplett offline mit lokalem LLM (z.B. Ollama)

Um Lasttest-Analysen absolut vertraulich und on-premise durchzuführen, nutzen wir ein lokales Sprachmodell.

1. **Ollama installieren & Modell starten:**
   Installieren Sie Ollama (https://ollama.com) lokal auf Ihrem Server und laden Sie das gewünschte Modell (z.B. LLaMA 3):
   ```bash
   ollama run llama3
   ```
2. **Globale API-Einstellungen in der Web-App anpassen:**
   Öffnen Sie die **⚙ Einstellungen** im Header der Web-App und tragen Sie folgende Werte ein:
   * **API Base URL:** `http://localhost:11434/v1` (Standard-Ollama-API)
   * **API Key:** `ollama` (beliebiger Platzhalter)
3. **Generator-Modell anpassen:**
   Wählen Sie in Ihrer `OpenAIGenerator`-Komponente als Modellname `llama3`.
4. **Pipeline ausführen:** Die LLM-Analysen und Berichte werden vollständig offline auf Ihrer eigenen Hardware verarbeitet!

---

### Option C: Containerisiertes API-Deployment (Docker & FastAPI)

Möchten Sie die Pipeline als REST-Service in einem Kubernetes-Cluster oder auf einem Server bereitstellen, gehen Sie wie folgt vor:

#### 1. Erstellen Sie eine `app.py` (FastAPI-Wrapper)
```python
import os
import logging
from fastapi import FastAPI, HTTPException
from pydantic import BaseModel
from typing import Dict, Any

from pipeline_pipeline import build_pipeline

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("haystack-runtime")

app = FastAPI(title="Haystack Load-Test API Runtime", version="1.0")
pipeline = build_pipeline()

class TriggerRequest(BaseModel):
    inputs: Dict[str, Any] = {}

@app.post("/run")
async def run_pipeline(req: TriggerRequest):
    try:
        logger.info("Pipeline-Lauf gestartet...")
        result = pipeline.run(req.inputs)
        return {"success": True, "result": result}
    except Exception as e:
        logger.error(f"Fehler: {str(e)}")
        raise HTTPException(status_code=500, detail=str(e))

@app.get("/health")
def health():
    return {"status": "healthy"}
```

#### 2. Containerisieren mit dem `Dockerfile`
```dockerfile
FROM python:3.11-slim

WORKDIR /app

RUN pip install --no-cache-dir \
    haystack-ai \
    fastapi \
    uvicorn \
    pydantic \
    openai

# Kopieren Sie die generierten Dateien und die REST-Engine
COPY ./pipeline_components.py /app/pipeline_components.py
COPY ./pipeline_pipeline.py /app/pipeline_pipeline.py
COPY ./app.py /app/app.py

EXPOSE 8000

CMD ["python", "app.py"]
```

#### 3. Image bauen & ausführen
```bash
docker build -t haystack-loadtest-api .
docker run -p 8000:8000 -e OPENAI_API_KEY="ollama" -e OPENAI_BASE_URL="http://ollama-service:11434/v1" haystack-loadtest-api
```

---

## 🛠️ Erweiterbarkeit: Neue Komponenten hinzufügen

Sie können die Palette spielend leicht um eigene Komponenten erweitern. Dies geschieht an genau **einer** zentralen Stelle:

1. Öffnen Sie `assets/registry.js`.
2. Fügen Sie unter dem gewünschten Typ (z.B. `DataSource`, `Processing` oder `Analysis`) ein neues Definitionsobjekt hinzu:
   ```javascript
   {
     type: "S3LogBucketLoader",
     label: "S3 Log Loader",
     desc: "Lädt Access-Logs direkt aus einem AWS S3 Bucket.",
     params: [
       { name: "bucket_name", label: "S3 Bucket Name", type: "string", required: true },
       { name: "aws_profile", label: "AWS Profil", type: "string", required: false }
     ],
     inputs: [],
     outputs: [{ name: "documents", label: "Geladene Dokumente" }]
   }
   ```
3. Der Code-Generator (Parser) ordnet neue Komponenten automatisch einer generischen Klasse zu. Die eigentliche Geschäftslogik (z.B. AWS SDK Anbindung) implementieren Sie nach dem Download in der Platzhalter-Klasse in `pipeline_components.py`.

---

## 🔒 Sicherheitshinweise

Da dieses Tool das Ausführen und Testen von dynamischem Python-Code (z.B. in `PythonScript`- und `PythonFilter`-Knoten) ermöglicht, beachten Sie bitte folgende Sicherheitsregeln:
* **Exec-Isolierung:** Im Generator-Server wird die Ausführung von Code über eingeschränkte Namespaces gesichert. Dennoch sollten Sie nur Pipelines laden und generieren, deren Herkunft Sie vertrauen.
* **API-Schlüssel:** Hinterlegen Sie API-Keys vorzugsweise über Umgebungsvariablen (`${OPENAI_API_KEY}`) im Zielsystem, anstatt sie im JSON fest zu verdrahten.
