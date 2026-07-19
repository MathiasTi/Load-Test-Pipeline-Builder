# ADR-0001: Frontend-First Canvas mit optionaler Helper-Runtime

## Status
Accepted

## Kontext
Die Benutzer benötigen ein einfach zu bedienendes, visuelles Werkzeug, um komplexe Haystack-v2 Pipelines für Lasttest-Log-Analysen zu entwerfen. Das Ergebnis muss in standardisierten Python- und YAML-Skripten resultieren, die sich nahtlos in CI/CD-Pipelines integrieren lassen.

## Entscheidung
Wir etablieren ein **Frontend-First Design** mit einer flexiblen, optionalen TypeScript/Python-basierten Helper-Runtime:

1. **Visueller Canvas (Client-Side)**: Die grafische Benutzeroberfläche läuft vollständig im Browser unter Verwendung von Vanilla JS und einer CSS-optimierten HTML5-Rendering-Engine für unübertroffene Performance und Offline-Fähigkeit.
2. **Intermediate JSON-Format**: Alle Verbindungen, Parameter und Einstellungen werden in einer leicht verständlichen, standardisierten JSON-Spezifikation gehalten.
3. **Helper-Runtime Server**: Ein kompakter Server (`server.ts`) nimmt die JSON-Definition entgegen, generiert den finalen ausführbaren Python-Code sowie die Standard-YAML-Dateien und validiert die Integrität der Pipeline durch Python-Syntaxprüfungen vorab.

```
+-------------------------------------------------------+
|                 Visual UI Canvas (JS)                 |
|  - Drag & Drop Palette                                |
|  - Node Parameters Editor                             |
+--------------------------+----------------------------+
                           |
               (Intermediate JSON Format)
                           |
                           v
+--------------------------+----------------------------+
|             Helper-Runtime (TS Server)                |
|  - Translates Node JSON into Python & YAML            |
|  - Compiles Python code to catch errors early         |
+--------------------------+----------------------------+
                           |
     +---------------------+---------------------+
     |                     |                     |
     v                     v                     v
(Pipeline.py)       (Components.py)       (Pipeline.yaml)
```

## Konsequenzen
* **Vorteile**:
  * Unabhängigkeit von schweren serverseitigen UI-Frameworks.
  * Hohe Modularität: Der Code-Generator kann separat als CLI genutzt werden.
  * Benutzer sehen Validierungsergebnisse direkt in Echtzeit auf dem Canvas.
* **Nachteile**:
  * Benötigt lokale Ausführungsumgebung (Node/Python) für Codegenerierung direkt über das UI. Dies wird über den schlanken TypeScript Dev-Server gelöst.
