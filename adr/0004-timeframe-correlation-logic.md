# ADR-0004: Zeitfenster-basierter Fehler-Korrelator (Timeframe-Correlation)

## Status
Accepted

## Kontext
Lasttests finden in exakt definierten Phasen statt (z.B. 10 Minuten Ramp-up, 30 Minuten Peak-Load, 10 Minuten Ramp-down). Fehler, die vor oder nach dem eigentlichen Lasttest im Log auftauchen, dürfen die Analyse des Testergebnisses nicht verfälschen, müssen jedoch für Baseline-Vergleiche isoliert werden können.

## Entscheidung
Wir führen spezialisierte Filter- und Klassifizierungs-Komponenten ein, die auf Zeitstempel-Korrelation basieren:

1. **TimeWindowFilter**: Filtert Logeinträge anhand von ISO8601 Zeitfenstern aus.
2. **ErrorClassifier**: Gruppiert Logfehler in feste Kategorien (`DB_ERROR`, `STACKTRACE`, `FATAL`, etc.) und setzt bei fehlerfreien Tests das explizite Label `OK`.
3. **Zusammenführung im PromptBuilder**: Die klassifizierten Fehler werden aggregiert und dem nachgelagerten LLM als strukturierter Kontext übergeben.

```
[WebServerLogLoader] 
         |
         v (all logs)
[LogParser]
         |
         v (parsed dicts)
[TimeWindowFilter] <--- Filtert Zeiten außerhalb des Lasttests heraus
         |
         v (logs during load test)
[KeywordFilter] <--- Filtert nach fehlerbezogenen Ausdrücken
         |
         v (only error records)
[ErrorClassifier] <--- Kategorisiert Fehler in DB, Stacktrace, etc.
         |
         v (structured error counts)
[PromptBuilder] ---> [OpenAIGenerator] ---> [ResultExporter]
```

## Konsequenzen
* **Vorteile**:
  * Höhere Präzision: LLMs müssen nicht Tausende Zeilen irrelevanter Logeinträge verarbeiten, sondern erhalten eine hochgradig fokussierte Zusammenfassung.
  * Extrem geringer Token-Verbrauch im Vergleich zu unstrukturierten Log-Prompts.
  * Vollständig konfigurierbar direkt über die grafische Oberfläche.
* **Nachteile**:
  * Log-Formate müssen ein einheitliches Datumsformat besitzen, das vom Parser verarbeitet werden kann (wird im standardmäßigen LogParser über reguläre Ausdrücke abgefangen).
