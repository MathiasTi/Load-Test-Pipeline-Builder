# ADR-0002: Komplette Offline-Lauffähigkeit (On-Premise Focus)

## Status
Accepted

## Kontext
Lasttest-Metriken, Systemauslastungen und Webserver-Accesslogs enthalten sensible Details über die interne IT-Infrastruktur, IP-Adressen, Datenbankstrukturen und Sicherheitsmechanismen. Unternehmen können diese Daten aus Compliance- und Sicherheitsgründen nicht an Cloud-Dienste übertragen.

## Entscheidung
Die gesamte Anwendungsarchitektur ist darauf ausgelegt, **vollständig offline und on-premise** betrieben werden zu können:

1. **Keine externen Web-Requests**: Das UI lädt keine Skripte oder Stylesheets von CDNs; alle Abhängigkeiten (Tailwind, Symbole) sind lokal im Build enthalten bzw. werden per CSS gelöst.
2. **Lokale LLM-Integration**: Bei Generatoren und Auswertern (z.B. OpenAIGenerator) wird der `api_base_url`-Parameter unterstützt. Dadurch können on-premise LLMs (z.B. über Ollama oder LocalAI) direkt angebunden werden, ohne Daten ins öffentliche Internet zu senden.
3. **Lokaler Parser**: Die Code-Erzeugung und -Validierung findet lokal statt.

## Konsequenzen
* **Vorteile**:
  * 100 % konform mit strengen IT-Sicherheitsrichtlinien im Enterprise-Umfeld.
  * Keine laufenden API-Kosten bei der Anbindung lokaler Modelle (z.B. Llama 3 auf Firmen-Servern).
  * Betrieb auch auf gesicherten Entwicklungssystemen ohne Internetverbindung möglich.
* **Nachteile**:
  * Entwickler müssen LLM-Endpoints wie Ollama oder lokale Datenbanken selbst aufsetzen (dies wird durch ausführliche Tutorials kompensiert).
