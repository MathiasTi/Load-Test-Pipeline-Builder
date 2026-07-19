# ADR-0003: Standardisierte YAML & JSON-Serialisierung für Deployment

## Status
Accepted

## Kontext
Entwickler müssen die visuell entworfenen Pipelines in verschiedenen Phasen verwalten:
* Speichern und Laden des interaktiven Layout-Zustands im Editor.
* Deklaratives Deployment in Cloud-Umgebungen und Einbindung in CI/CD GitOps-Workflows.

## Entscheidung
Wir nutzen ein duales Serialisierungsmodell:

1. **JSON Layout Format**: Speichert alle Positionsdaten, UI-Spezifika, Port-Verbindungen und Parameter-Werte. Es dient als "Source of Truth" für die Web-Applikation.
2. **Haystack v2 Standard-YAML**: Generiert eine standardkonforme YAML-Definition der Pipeline. Dieses Format enthält keine UI-Metadaten, sondern ausschließlich deklarative `components` und `connections`, die direkt von Haystacks eingebautem `Pipeline.loads()` gelesen werden können.

Beispiel des generierten Standard-YAML:
```yaml
components:
  web_server_log_loader:
    type: WebServerLogLoader
    init_parameters:
      log_path: "/var/log/nginx/access.log"
  log_parser:
    type: LogParser
    init_parameters:
      regex_pattern: "^(?P<ip>\\S+) ... (?P<status>\\d+)"

connections:
  - sender: web_server_log_loader.documents
    receiver: log_parser.documents
```

## Konsequenzen
* **Vorteile**:
  * Saubere Trennung von Präsentation (JSON) und fachlicher Ablaufbeschreibung (YAML).
  * Kompatibilität: Jede Standard-Haystack-Installation kann die YAML-Datei ohne unseren Parser direkt importieren und ausführen.
  * GitOps-freundlich: Die YAML-Dateien können direkt reviewed und versioniert werden.
* **Nachteile**:
  * Änderungen an der Pipeline müssen entweder im UI vorgenommen und neu exportiert werden, oder Änderungen am YAML müssen manuell nachgepflegt werden.
