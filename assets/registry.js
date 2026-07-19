/**
 * Komponenten-Registry für die Low-Code Haystack Pipeline Builder Web-App.
 *
 * Diese Registry ist das zentrale Erweiterungs-Element der Architektur.
 * Um die App um neue Datenquellen, Verarbeitungsschritte oder Analyzer zu
 * erweitern, genügt es, hier ein neues Objekt in die passende Kategorie
 * einzutragen. Sowohl das Frontend (UI) als auch der Parser
 * (haystack_parser.py) lesen dieselbe Struktur (gespiegelt in Python).
 *
 * Felder pro Komponente:
 *  - type:           eindeutiger Typ-Name (wird im JSON und im Haystack-Mapping verwendet)
 *  - label:          Anzeigename in der UI
 *  - description:    Beschreibungstext
 *  - haystack_type:  entspricht einem eingebauten Haystack-v2 Komponententyp
 *                    (z.B. "PromptBuilder"). Fehlt es, wird eine custom-Klasse generiert.
 *  - custom:         true => der Parser erzeugt eine eigene Haystack-Komponentenklasse
 *  - params:         Liste konfigurierbarer Parameter
 *      - name, label, type (str|int|float|bool|enum|list), default, required, options
 *  - inputs:         Liste von Eingabeports { name, label }
 *  - outputs:        Liste von Ausgabeports { name, label }
 */

const COMPONENT_REGISTRY = {
  // ---------------------------------------------------------------------------
  // DATENQUELLEN – Lasttest-Rohdaten
  // ---------------------------------------------------------------------------
  DataSource: [
    {
      type: "WebServerLogLoader",
      label: "Webserver-Log Loader",
      description: "Lädt Webserver-Zugriffslogs (nginx/apache) und erzeugt Haystack Documents.",
      custom: true,
      params: [
        { name: "log_path", label: "Log-Pfad", type: "str", default: "/var/log/nginx/access.log", required: true },
        { name: "format", label: "Log-Format", type: "enum", options: ["combined", "common", "json"], default: "combined" },
        { name: "max_lines", label: "Max. Zeilen", type: "int", default: 100000 }
      ],
      inputs: [],
      outputs: [{ name: "documents", label: "Documents" }]
    },
    {
      type: "OSMetricsLoader",
      label: "OS-Metriken Loader",
      description: "Lädt Betriebssystemmetriken (CPU, RAM, IO) aus CSV/JSON und erzeugt Documents.",
      custom: true,
      params: [
        { name: "metrics_path", label: "Metrik-Pfad", type: "str", default: "/metrics/system.json", required: true },
        { name: "source_format", label: "Format", type: "enum", options: ["csv", "json"], default: "json" }
      ],
      inputs: [],
      outputs: [{ name: "documents", label: "Documents" }]
    },
    {
      type: "EvalScriptResultLoader",
      label: "Eval-Skript Ergebnis Loader",
      description: "Lädt Ergebnisse von Auswerteskripten (z.B. JMeter/CSV) als Documents.",
      custom: true,
      params: [
        { name: "result_path", label: "Ergebnis-Pfad", type: "str", default: "/results/jmeter.csv", required: true },
        { name: "source_format", label: "Format", type: "enum", options: ["csv", "json"], default: "csv" }
      ],
      inputs: [],
      outputs: [{ name: "documents", label: "Documents" }]
    },
    {
      type: "OracleAWRDiffLoader",
      label: "Oracle AWR Diff Loader",
      description: "Lädt einen Oracle AWR Diff-Report (HTML oder Text) und erzeugt ein unstrukturiertes Document.",
      custom: true,
      params: [
        { name: "awr_path", label: "AWR-Pfad", type: "str", default: "/reports/awr_diff.html", required: true }
      ],
      inputs: [],
      outputs: [{ name: "documents", label: "Documents" }]
    }
  ],

  // ---------------------------------------------------------------------------
  // VERARBEITUNG – Rohdaten aufbereiten
  // ---------------------------------------------------------------------------
  Processing: [
    {
      type: "OracleAWRDiffParser",
      label: "Oracle AWR Diff Parser",
      description: "Parst einen Oracle AWR Diff-Report und extrahiert DB Time, Load Profile, Wait Events und Top SQL.",
      custom: true,
      params: [
        { name: "max_wait_events", label: "Max Wait Events", type: "int", default: 5 },
        { name: "max_sql_queries", label: "Max SQL Queries", type: "int", default: 10 }
      ],
      inputs: [{ name: "documents", label: "Documents" }],
      outputs: [{ name: "documents", label: "Documents (strukturiert)" }]
    },
    {
      type: "TimeframeErrorCorrelator",
      label: "Zeitfenster Fehler-Korrelator",
      description: "Sucht in Primär-Logs nach Fehlern und korreliert Sekundär-Logs/-Metriken im gleichen Zeitfenster (+/- Sekunden).",
      custom: true,
      params: [
        { name: "error_pattern", label: "Fehlermuster (Regex)", type: "str", default: "fatal|error|500|ora-", required: true },
        { name: "window_seconds", label: "Zeitfenster-Radius (s)", type: "int", default: 120, required: true },
        { name: "timestamp_field", label: "Zeitstempel-Feld", type: "str", default: "timestamp", required: true }
      ],
      inputs: [
        { name: "primary_logs", label: "Primär-Logs (Fehler-Quelle)" },
        { name: "secondary_logs", label: "Sekundär-Logs (Korrelation)" }
      ],
      outputs: [
        { name: "correlated_documents", label: "Korrelierte Dokumente" }
      ]
    },
    {
      type: "LogParser",
      label: "Log Parser",
      description: "Zerlegt Roh-Log-Documents in strukturierte Felder (Status, Latenz, Pfad, Zeitstempel).",
      custom: true,
      params: [
        { name: "extract_fields", label: "Zu extrahierende Felder", type: "list", default: ["status", "latency_ms", "path", "method", "timestamp"] }
      ],
      inputs: [{ name: "documents", label: "Documents" }],
      outputs: [{ name: "documents", label: "Documents" }]
    },
    {
      type: "TimeWindowFilter",
      label: "Testzeitraum-Filter",
      description: "Behält nur Log-Zeilen innerhalb eines definierten Testzeitraums (von/bis).",
      custom: true,
      params: [
        { name: "start", label: "Start (ISO8601)", type: "str", default: "2026-07-18T10:00:00", required: true },
        { name: "end", label: "Ende (ISO8601)", type: "str", default: "2026-07-18T11:00:00", required: true },
        { name: "timestamp_field", label: "Zeitstempel-Feld", type: "str", default: "timestamp" }
      ],
      inputs: [{ name: "documents", label: "Documents" }],
      outputs: [{ name: "documents", label: "Documents (gefiltert)" }]
    },
    {
      type: "KeywordFilter",
      label: "Keyword-Filter",
      description: "Durchsucht Dokumente nach Schlüsselwörtern (z.B. fatal, error, ora-, stacktrace) und markiert Treffer.",
      custom: true,
      params: [
        { name: "keywords", label: "Schlüsselwörter", type: "list", default: ["fatal", "error", "ora-", "stacktrace"] },
        { name: "case_sensitive", label: "Groß/Kleinschreibung", type: "bool", default: false }
      ],
      inputs: [{ name: "documents", label: "Documents" }],
      outputs: [
        { name: "matches", label: "Treffer" },
        { name: "documents", label: "Alle" }
      ]
    },
    {
      type: "MetricAggregator",
      label: "Metrik-Aggregator",
      description: "Aggregiert Zeitreihen-Metriken (Mittelwert, P95, Max).",
      custom: true,
      params: [
        { name: "window_seconds", label: "Fenster (s)", type: "int", default: 60 },
        { name: "percentiles", label: "Perzentile", type: "list", default: [50, 95, 99] }
      ],
      inputs: [{ name: "documents", label: "Documents" }],
      outputs: [{ name: "documents", label: "Documents" }]
    },
    {
      type: "DocumentCleaner",
      label: "Document Cleaner (Haystack)",
      description: "Eingebaute Haystack-Komponente zum Bereinigen von Text.",
      haystack_type: "DocumentCleaner",
      params: [
        { name: "remove_empty_lines", label: "Leere Zeilen entfernen", type: "bool", default: true },
        { name: "remove_extra_whitespaces", label: "Whitespace bereinigen", type: "bool", default: true }
      ],
      inputs: [{ name: "documents", label: "Documents" }],
      outputs: [{ name: "documents", label: "Documents" }]
    }
  ],

  // ---------------------------------------------------------------------------
  // ANALYSE – Mustererkennung / LLM
  // ---------------------------------------------------------------------------
  Analysis: [
    {
      type: "AnomalyDetector",
      label: "Anomalie-Detektor",
      description: "Statistische Anomalieerkennung (z.B. Latenz-Spikes, Fehlerraten).",
      custom: true,
      params: [
        { name: "metric", label: "Metrik", type: "str", default: "latency_ms" },
        { name: "threshold_sigma", label: "Sigma-Schwelle", type: "float", default: 3.0 }
      ],
      inputs: [{ name: "documents", label: "Documents" }],
      outputs: [{ name: "documents", label: "Documents" }]
    },
    {
      type: "ErrorClassifier",
      label: "Fehler-Klassifizierer",
      description: "Fasst gefundene Fehler in Fehlerklassen zusammen (z.B. DB-Fehler, Stacktrace, Fatal). Markiert Log sonst als OK.",
      custom: true,
      params: [
        { name: "classes", label: "Fehlerklassen (Regex->Klasse)", type: "list",
          default: ["ora-.*:Datenbankfehler", "stacktrace:Stacktrace", "fatal:Fatal", "error:Allgemeiner Fehler"] },
        { name: "ok_label", label: "Label bei keinem Treffer", type: "str", default: "OK" }
      ],
      inputs: [{ name: "matches", label: "Treffer" }],
      outputs: [
        { name: "classified", label: "Klassifiziert" },
        { name: "summary", label: "Zusammenfassung" }
      ]
    },
    {
      type: "PromptBuilder",
      label: "Prompt Builder (Haystack)",
      description: "Eingebaute Haystack-Komponente zum Zusammenbauen von Prompts.",
      haystack_type: "PromptBuilder",
      params: [
        { name: "template", label: "Prompt-Template", type: "str",
          default: "Fasse die folgenden Lasttest-Fehlerklassen zusammen und gib Handlungsempfehlungen:\n\n{% for d in documents %}{{ d.content }}\n{% endfor %}" },
        { name: "required_variables", label: "Pflichtvariablen", type: "list", default: ["documents"] }
      ],
      inputs: [{ name: "documents", label: "Documents" }],
      outputs: [{ name: "prompt", label: "Prompt" }]
    },
    {
      type: "OpenAIGenerator",
      label: "OpenAI Generator (Haystack)",
      description: "Eingebaute Haystack-LLM-Komponente zur Textgenerierung. API-URL und Key werden global in den Einstellungen konfiguriert.",
      haystack_type: "OpenAIGenerator",
      params: [
        { name: "model", label: "Modell", type: "str", default: "gpt-4o-mini" }
      ],
      inputs: [{ name: "prompt", label: "Prompt" }],
      outputs: [{ name: "replies", label: "Replies" }]
    }
  ],

  // ---------------------------------------------------------------------------
  // AUSGABE – Ergebnis sichern
  // ---------------------------------------------------------------------------
  Output: [
    {
      type: "ResultExporter",
      label: "JSON Ergebnis-Exporter",
      description: "Schreibt das Analyse-Ergebnis als strukturiertes JSON (Klassen, Zusammenfassung, OK/Fehler).",
      custom: true,
      params: [
        { name: "output_path", label: "Ausgabe-Pfad", type: "str", default: "analysis_result.json" },
        { name: "include_raw", label: "Rohdaten einbeziehen", type: "bool", default: false }
      ],
      inputs: [{ name: "documents", label: "Documents" }, { name: "replies", label: "Replies" }, { name: "summary", label: "Summary" }],
      outputs: []
    }
  ],

  // ---------------------------------------------------------------------------
  // GENERISCH – freie Python-Logik (User-Code)
  // ---------------------------------------------------------------------------
  Generic: [
    {
      type: "PythonScript",
      label: "Python Script",
      description: "Führt freien Python-Code auf allen Documents aus (Rückgabe: modifizierte Documents-Liste).",
      custom: true,
      params: [
        {
          name: "code", label: "Python-Code", type: "code",
          default:
`def process(documents, params):
    # documents: List[Document]  |  params: dict der Knoten-Parameter
    # Rückgabe: Liste von Document (kann modifiziert sein)
    for doc in documents:
        doc.meta["touched"] = True
    return documents`
        }
      ],
      inputs: [{ name: "documents", label: "Documents" }],
      outputs: [{ name: "documents", label: "Documents" }]
    },
    {
      type: "PythonFilter",
      label: "Python Filter",
      description: "Freier Python-Code als Filter: gibt (documents, matches) zurück – nur Treffer landen in 'matches'.",
      custom: true,
      params: [
        {
          name: "code", label: "Python-Code", type: "code",
          default:
`def process(documents, params):
    # documents: List[Document]  |  params: dict der Knoten-Parameter
    # Rückgabe: (documents, matches) – beide sind Listen von Document
    matches = [d for d in documents if "error" in (d.content or "").lower()]
    return documents, matches`
        }
      ],
      inputs: [{ name: "documents", label: "Documents" }],
      outputs: [
        { name: "matches", label: "Treffer" },
        { name: "documents", label: "Alle" }
      ]
    }
  ]
};

// Flache Map: type -> definition (für schnellen Zugriff im Parser/UI)
const REGISTRY_BY_TYPE = {};
Object.entries(COMPONENT_REGISTRY).forEach(([cat, list]) => {
  list.forEach((def) => {
    def.category = cat;
    REGISTRY_BY_TYPE[def.type] = def;
  });
});