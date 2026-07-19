export const COMPONENT_REGISTRY: Record<string, string[]> = {
  DataSource: ["WebServerLogLoader", "OSMetricsLoader", "EvalScriptResultLoader", "OracleAWRDiffLoader"],
  Processing: ["TimeframeErrorCorrelator", "LogParser", "TimeWindowFilter", "KeywordFilter", "MetricAggregator", "DocumentCleaner", "OracleAWRDiffParser"],
  Analysis: ["AnomalyDetector", "ErrorClassifier", "PromptBuilder", "OpenAIGenerator"],
  Output: ["ResultExporter"],
  Generic: ["PythonScript", "PythonFilter"],
};

export const CODE_TYPES = new Set(["PythonScript", "PythonFilter"]);

export const HAYSTACK_BUILTIN: Record<string, string> = {
  DocumentCleaner: "DocumentCleaner",
  PromptBuilder: "PromptBuilder",
  OpenAIGenerator: "OpenAIGenerator",
};

export const HAYSTACK_IMPORTS: Record<string, string> = {
  DocumentCleaner: "from haystack.components.preprocessors import DocumentCleaner",
  PromptBuilder: "from haystack.components.builders import PromptBuilder",
  OpenAIGenerator: "from haystack.components.generators import OpenAIGenerator",
};

export const CUSTOM_CLASSES: Record<string, string> = {
  WebServerLogLoader: `
class WebServerLogLoader (Component):
    """Lädt Webserver-Zugriffslogs (combined/common/json) und erzeugt Documents."""
    def __init__(self, log_path="/var/log/nginx/access.log", format="combined",
                 max_lines=100000, **kwargs):
        super().__init__()
        self.log_path = log_path
        self.format = (format or "combined").lower()
        self.max_lines = int(max_lines)

    @component.output_types(documents=List[Document])
    def run(self):
        import re, json as _json
        from haystack.dataclasses import Document
        docs = []
        try:
            with open(self.log_path, "r", encoding="utf-8", errors="replace") as f:
                for i, line in enumerate(f):
                    if i >= self.max_lines:
                        break
                    line = line.rstrip("\\n")
                    if not line:
                        continue
                    meta = {}
                    if self.format == "json":
                        try:
                            rec = _json.loads(line)
                            meta = {str(k): str(v) for k, v in rec.items()}
                        except Exception:
                            meta = {"raw": line}
                    else:
                        # combined/common: IP - - [ts] "METHOD path PROTO" status size
                        m = re.match(r'(\\S+) \\S+ \\S+ \\[([^\\]]+)\\] "(\\S+) (\\S+) (\\S+)" (\\d+) (\\d+|-)', line)
                        if m:
                            meta = {"ip": m.group(1), "timestamp": m.group(2),
                                    "method": m.group(3), "path": m.group(4),
                                    "protocol": m.group(5), "status": m.group(6),
                                    "bytes": m.group(7)}
                        else:
                            meta = {"raw": line}
                    docs.append(Document(content=line, meta=meta))
        except FileNotFoundError:
            pass
        return {"documents": docs}
`,

  OSMetricsLoader: `
class OSMetricsLoader (Component):
    """Lädt Betriebssystemmetriken (CSV/JSON) und erzeugt Documents."""
    def __init__(self, metrics_path="/metrics/system.json", source_format="json", **kwargs):
        super().__init__()
        self.metrics_path = metrics_path
        self.source_format = (source_format or "json").lower()

    @component.output_types(documents=List[Document])
    def run(self):
        import csv, json as _json
        from haystack.dataclasses import Document
        docs = []
        try:
            if self.source_format == "json":
                with open(self.metrics_path, "r", encoding="utf-8") as f:
                    data = _json.load(f)
                recs = data if isinstance(data, list) else [data]
                for r in recs:
                    docs.append(Document(content=_json.dumps(r, ensure_ascii=False),
                                        meta={str(k): str(v) for k, v in r.items()}))
            else:
                with open(self.metrics_path, "r", encoding="utf-8", newline="") as f:
                    for row in csv.DictReader(f):
                        meta = {str(k): str(v) for k, v in row.items()}
                        docs.append(Document(content=",".join(meta.values()), meta=meta))
        except FileNotFoundError:
            pass
        return {"documents": docs}
`,

  EvalScriptResultLoader: `
class EvalScriptResultLoader (Component):
    """Lädt Ergebnisse von Auswerteskripten (CSV/JSON) als Documents."""
    def __init__(self, result_path="/results/jmeter.csv", source_format="csv", **kwargs):
        super().__init__()
        self.result_path = result_path
        self.source_format = (source_format or "csv").lower()

    @component.output_types(documents=List[Document])
    def run(self):
        import csv, json as _json
        from haystack.dataclasses import Document
        docs = []
        try:
            if self.source_format == "json":
                with open(self.result_path, "r", encoding="utf-8") as f:
                    data = _json.load(f)
                recs = data if isinstance(data, list) else [data]
                for r in recs:
                    docs.append(Document(content=_json.dumps(r, ensure_ascii=False),
                                        meta={str(k): str(v) for k, v in r.items()}))
            else:
                with open(self.result_path, "r", encoding="utf-8", newline="") as f:
                    for row in csv.DictReader(f):
                        meta = {str(k): str(v) for k, v in row.items()}
                        docs.append(Document(content=",".join(meta.values()), meta=meta))
        except FileNotFoundError:
            pass
        return {"documents": docs}
`,

  LogParser: `
class LogParser (Component):
    """Zerlegt Roh-Log-Documents in strukturierte Felder (meta)."""
    def __init__(self, extract_fields=None, **kwargs):
        super().__init__()
        self.extract_fields = extract_fields or []

    @component.output_types(documents=List[Document])
    def run(self, documents: List[Document] = None):
        import re, json as _json
        from haystack.dataclasses import Document
        out = []
        fields = self.extract_fields or []
        for d in documents or []:
            meta = dict(d.meta)
            content = d.content or ""
            rec = None
            try:
                rec = _json.loads(content)
            except Exception:
                rec = None
            if isinstance(rec, dict):
                for fld in fields:
                    if fld in rec:
                        meta[fld] = rec[fld]
            else:
                for fld in fields:
                    m = re.search(fld + r"[=:\\s]+([^,\\n]+)", content)
                    if m:
                        meta[fld] = m.group(1).strip()
            out.append(Document(content=content, meta=meta))
        return {"documents": out}
`,

  TimeWindowFilter: `
class TimeWindowFilter (Component):
    """Behält nur Documents innerhalb eines definierten Zeitraums."""
    def __init__(self, start="2026-01-01T00:00:00", end="2026-12-31T23:59:59",
                 timestamp_field="timestamp", **kwargs):
        super().__init__()
        self.start = start
        self.end = end
        self.timestamp_field = timestamp_field

    @component.output_types(documents=List[Document])
    def run(self, documents: List[Document] = None):
        from datetime import datetime
        from haystack.dataclasses import Document

        def parse(ts):
            if not isinstance(ts, str):
                return None
            for fmt in ("%Y-%m-%dT%H:%M:%S", "%Y-%m-%d %H:%M:%S", "%d/%b/%Y:%H:%M:%S %z"):
                try:
                    return datetime.strptime(ts, fmt)
                except Exception:
                    pass
            return None

        s, e = parse(self.start), parse(self.end)
        out = []
        for d in documents or []:
            ts = d.meta.get(self.timestamp_field)
            pt = parse(ts)
            if pt is None or s is None or e is None or (s <= pt <= e):
                out.append(d)
        return {"documents": out}
`,

  KeywordFilter: `
class KeywordFilter (Component):
    """Markiert Documents, die Schlüsselwörter enthalten."""
    def __init__(self, keywords=None, case_sensitive=False, **kwargs):
        super().__init__()
        self.keywords = keywords or []
        self.case_sensitive = bool(case_sensitive)

    @component.output_types(matches=List[Document], documents=List[Document])
    def run(self, documents: List[Document] = None):
        from haystack.dataclasses import Document
        matches = []
        all_docs = []
        for d in documents or []:
            text = d.content if self.case_sensitive else (d.content or "").lower()
            hit = any((k if self.case_sensitive else k.lower()) in text for k in self.keywords)
            if hit:
                nd = Document(content=d.content, meta=dict(d.meta, match=True))
                matches.append(nd)
                all_docs.append(nd)
            else:
                all_docs.append(d)
        return {"matches": matches, "documents": all_docs}
`,

  MetricAggregator: `
class MetricAggregator (Component):
    """Aggregiert numerische Metriken über alle Documents (Mittel/Min/Max/P)."""
    def __init__(self, window_seconds=60, percentiles=None, **kwargs):
        super().__init__()
        self.window_seconds = int(window_seconds)
        self.percentiles = percentiles or [50, 95, 99]

    @component.output_types(documents=List[Document])
    def run(self, documents: List[Document] = None):
        import statistics as _stat, json as _json
        from haystack.dataclasses import Document
        series = {}
        for d in documents or []:
            for k, v in d.meta.items():
                try:
                    series.setdefault(k, []).append(float(v))
                except (TypeError, ValueError):
                    continue
        agg = {}
        for k, vals in series.items():
            if not vals:
                continue
            agg[k] = {"count": len(vals), "mean": round(_stat.mean(vals), 3),
                      "min": round(min(vals), 3), "max": round(max(vals), 3)}
            try:
                quants = _stat.quantiles(vals, n=100)
                for p in self.percentiles:
                    idx = min(99, max(0, int(p) - 1))
                    agg[k][f"p{int(p)}"] = round(quants[idx], 3)
            except Exception:
                pass
        summary = Document(content=_json.dumps(agg, ensure_ascii=False), meta={"aggregates": agg})
        return {"documents": [summary]}
`,

  AnomalyDetector: `
class AnomalyDetector (Component):
    """Markiert Documents mit statistischen Ausreißern (z-Score)."""
    def __init__(self, metric="latency_ms", threshold_sigma=3.0, **kwargs):
        super().__init__()
        self.metric = metric
        self.threshold_sigma = float(threshold_sigma)

    @component.output_types(documents=List[Document])
    def run(self, documents: List[Document] = None):
        import statistics as _stat
        from haystack.dataclasses import Document
        vals = []
        for d in documents or []:
            try:
                vals.append(float(d.meta.get(self.metric)))
            except (TypeError, ValueError):
                pass
        if len(vals) < 2:
            return {"documents": documents or []}
        mean = _stat.mean(vals)
        std = _stat.pstdev(vals) or 1e-9
        out = []
        for d in documents or []:
            meta = dict(d.meta)
            try:
                v = float(d.meta.get(self.metric))
                meta["anomaly"] = abs(v - mean) > self.threshold_sigma * std
            except (TypeError, ValueError):
                pass
            out.append(Document(content=d.content, meta=meta))
        return {"documents": out}
`,

  ErrorClassifier: `
class ErrorClassifier (Component):
    """Fasst Treffer-Documents in Fehlerklassen zusammen (Regex->Label)."""
    def __init__(self, classes=None, ok_label="OK", **kwargs):
        super().__init__()
        self.classes = classes or []
        self.ok_label = ok_label

    @component.output_types(classified=List[Document], summary=dict)
    def run(self, matches: List[Document] = None, documents: List[Document] = None):
        import re, json as _json
        from collections import Counter
        from haystack.dataclasses import Document
        rules = []
        for c in self.classes:
            if ":" in c:
                pat, label = c.split(":", 1)
                rules.append((re.compile(pat, re.IGNORECASE), label))
        counter = Counter()
        classified = []
        for d in matches or []:
            text = d.content or ""
            label = self.ok_label
            for rx, lbl in rules:
                if rx.search(text):
                    label = lbl
                    break
            counter[label] += 1
            classified.append(Document(content=text, meta=dict(d.meta, error_class=label)))
        summary = {"classes": dict(counter), "ok_label": self.ok_label,
                   "total": sum(counter.values())}
        return {"classified": classified, "summary": summary}
`,

  ResultExporter: `
class ResultExporter (Component):
    """Schreibt das Analyse-Ergebnis als strukturiertes JSON."""
    def __init__(self, output_path="analysis_result.json", include_raw=False, **kwargs):
        super().__init__()
        self.output_path = output_path
        self.include_raw = bool(include_raw)

    @component.output_types(result=dict)
    def run(self, documents=None, replies=None, summary=None, **kwargs):
        import json as _json
        result = {
            "documents_count": len(documents or []),
            "replies": replies or [],
            "summary": summary if summary is not None else {},
        }
        if self.include_raw:
            result["documents"] = [{"content": d.content, "meta": d.meta} for d in (documents or [])]
        try:
            with open(self.output_path, "w", encoding="utf-8") as f:
                _json.dump(result, f, ensure_ascii=False, indent=2, default=str)
        except Exception as e:
            result["error"] = str(e)
        return {"result": result}
`,

  TimeframeErrorCorrelator: `
class TimeframeErrorCorrelator (Component):
    """Sucht in primären Logs nach Fehlermustern und korreliert sekundäre Logs im selben Zeitfenster."""
    def __init__(self, error_pattern="fatal|error|500|ora-", window_seconds=120,
                 timestamp_field="timestamp", **kwargs):
        super().__init__()
        self.error_pattern = error_pattern
        self.window_seconds = int(window_seconds)
        self.timestamp_field = timestamp_field

    @component.output_types(correlated_documents=List[Document], summary=dict)
    def run(self, primary_logs: List[Document] = None, secondary_logs: List[Document] = None):
        import re
        from datetime import datetime
        from haystack.dataclasses import Document

        def parse_ts(ts):
            if not ts:
                return None
            if isinstance(ts, datetime):
                return ts
            if not isinstance(ts, str):
                ts = str(ts)
            try:
                # fromisoformat handles standard formats natively (e.g. 2026-07-19T06:58:22)
                val = ts.replace("Z", "+00:00")
                return datetime.fromisoformat(val)
            except Exception:
                pass
            for fmt in (
                "%Y-%m-%dT%H:%M:%S.%f", "%Y-%m-%dT%H:%M:%S",
                "%Y-%m-%d %H:%M:%S.%f", "%Y-%m-%d %H:%M:%S",
                "%d/%b/%Y:%H:%M:%S %z", "%d/%b/%Y:%H:%M:%S"
            ):
                try:
                    return datetime.strptime(ts, fmt)
                except Exception:
                    pass
            try:
                return datetime.fromtimestamp(float(ts))
            except Exception:
                pass
            return None

        primary = primary_logs or []
        secondary = secondary_logs or []
        
        # 1. Finde alle Fehler in den primären Logs
        rx = re.compile(self.error_pattern, re.IGNORECASE)
        anchors = []
        for d in primary:
            content = d.content or ""
            if rx.search(content):
                ts_val = d.meta.get(self.timestamp_field)
                dt = parse_ts(ts_val)
                if dt:
                    anchors.append((d, dt))

        # 2. Korreliere sekundäre Logs
        correlated = []
        seen_ids = set()

        for anchor, anchor_dt in anchors:
            if anchor.id not in seen_ids:
                meta = dict(anchor.meta)
                meta["is_correlation_anchor"] = True
                meta["correlation_role"] = "anchor"
                meta["correlation_pattern"] = self.error_pattern
                correlated.append(Document(id=anchor.id, content=anchor.content, meta=meta))
                seen_ids.add(anchor.id)

            for sec_doc in secondary:
                sec_ts = sec_doc.meta.get(self.timestamp_field)
                sec_dt = parse_ts(sec_ts)
                if sec_dt:
                    diff = (sec_dt - anchor_dt).total_seconds()
                    if abs(diff) <= self.window_seconds:
                        meta = dict(sec_doc.meta)
                        meta["is_correlated"] = True
                        meta["correlation_role"] = "secondary"
                        meta["correlation_anchor_id"] = anchor.id
                        meta["correlation_anchor_content"] = anchor.content[:150]
                        meta["correlation_time_diff_sec"] = diff
                        
                        doc_id = f"{sec_doc.id}_corr_{anchor.id}"
                        if doc_id not in seen_ids:
                            correlated.append(Document(id=doc_id, content=sec_doc.content, meta=meta))
                            seen_ids.add(doc_id)

        # Sortiere nach Zeitstempel
        def get_sort_key(doc):
            ts = doc.meta.get(self.timestamp_field)
            dt = parse_ts(ts)
            return dt.timestamp() if dt else 0

        try:
            correlated.sort(key=get_sort_key)
        except Exception:
            pass

        summary = {
            "anchors_found": len(anchors),
            "total_correlated": len(correlated),
            "window_seconds": self.window_seconds
        }

        return {"correlated_documents": correlated, "summary": summary}
`,

  OracleAWRDiffLoader: `
class OracleAWRDiffLoader (Component):
    """Lädt einen Oracle AWR Diff-Report (HTML oder Text) und erzeugt ein unstrukturiertes Document."""
    def __init__(self, awr_path="/reports/awr_diff.html", **kwargs):
        super().__init__()
        self.awr_path = awr_path

    @component.output_types(documents=List[Document])
    def run(self):
        from haystack.dataclasses import Document
        import os
        docs = []
        try:
            if os.path.exists(self.awr_path):
                with open(self.awr_path, "r", encoding="utf-8", errors="replace") as f:
                    content = f.read()
                docs.append(Document(content=content, meta={"awr_path": self.awr_path, "file_size": len(content)}))
            else:
                # Fallback für Demo-Zwecke: Erzeuge einen synthetischen Oracle AWR Diff-Report
                content = """
                <html>
                <head><title>AWR Compare Period Report</title></head>
                <body>
                <h1>AWR Compare Period Report</h1>
                <h3>Load Profile</h3>
                <table>
                  <tr><th>Metric</th><th>First Period</th><th>Second Period</th><th>% Diff</th></tr>
                  <tr><td>DB Time (s)</td><td>2400.0</td><td>14500.0</td><td>504.1</td></tr>
                  <tr><td>Redo size (KB)</td><td>150.0</td><td>1200.0</td><td>700.0</td></tr>
                  <tr><td>Hard parses</td><td>1.2</td><td>245.0</td><td>20316.6</td></tr>
                  <tr><td>Physical reads</td><td>120.5</td><td>5400.2</td><td>4381.5</td></tr>
                </table>

                <h3>Top 5 Timed Events</h3>
                <table>
                  <tr><th>Event</th><th>Wait Class</th><th>Waits Diff (%)</th><th>Time (s) Diff (%)</th></tr>
                  <tr><td>log file sync</td><td>Commit</td><td>410.2</td><td>840.5 (510.3%)</td></tr>
                  <tr><td>db file sequential read</td><td>User I/O</td><td>845.0</td><td>1210.0 (312.2%)</td></tr>
                  <tr><td>enq: TX - row lock contention</td><td>Application</td><td>1200.0</td><td>940.0 (940.0%)</td></tr>
                  <tr><td>buffer busy waits</td><td>Concurrency</td><td>310.4</td><td>450.1 (250.0%)</td></tr>
                </table>

                <h3>SQL ordered by Elapsed Time</h3>
                <p>SQL Id: 4gf7v1adsa7f - SELECT * FROM USERS WHERE USER_ID = :1 (Elapsed Time: 3450s, 24% of total DB Time)</p>
                <p>SQL Id: 9gfa23hga12d - UPDATE INVENTORY SET STOCK = STOCK - 1 WHERE PROD_ID = :1 (Elapsed Time: 2900s, 20% of total DB Time)</p>
                </body>
                </html>
                """
                docs.append(Document(content=content, meta={"awr_path": self.awr_path, "file_size": len(content), "is_fallback": True}))
        except Exception as e:
            docs.append(Document(content=f"Error loading AWR: {str(e)}", meta={"awr_path": self.awr_path, "error": str(e)}))
        return {"documents": docs}
`,

  OracleAWRDiffParser: `
class OracleAWRDiffParser (Component):
    """Parst einen Oracle AWR Diff-Report und extrahiert DB Time, Load Profile, Wait Events und Top SQL."""
    def __init__(self, max_wait_events=5, max_sql_queries=10, **kwargs):
        super().__init__()
        self.max_wait_events = int(max_wait_events)
        self.max_sql_queries = int(max_sql_queries)

    @component.output_types(documents=List[Document])
    def run(self, documents: List[Document] = None):
        import re
        from haystack.dataclasses import Document
        out = []
        for d in documents or []:
            content = d.content or ""
            
            # Extrahiere strukturierte Daten per Regex oder einfachen Suchen
            load_profile = []
            wait_events = []
            sql_queries = []
            
            # Suche nach Load Profile Metrics
            db_time_m = re.search(r"DB Time \\(s\\).*?([\\d\\.]+).*?([\\d\\.]+).*?([\\d\\.]+)", content, re.IGNORECASE | re.DOTALL)
            if db_time_m:
                load_profile.append({
                    "metric": "DB Time (s)",
                    "period_1": db_time_m.group(1),
                    "period_2": db_time_m.group(2),
                    "diff_pct": db_time_m.group(3)
                })
                
            hard_parses_m = re.search(r"Hard parses.*?([\\d\\.]+).*?([\\d\\.]+).*?([\\d\\.]+)", content, re.IGNORECASE | re.DOTALL)
            if hard_parses_m:
                load_profile.append({
                    "metric": "Hard parses",
                    "period_1": hard_parses_m.group(1),
                    "period_2": hard_parses_m.group(2),
                    "diff_pct": hard_parses_m.group(3)
                })
                
            phys_reads_m = re.search(r"Physical reads.*?([\\d\\.]+).*?([\\d\\.]+).*?([\\d\\.]+)", content, re.IGNORECASE | re.DOTALL)
            if phys_reads_m:
                load_profile.append({
                    "metric": "Physical reads",
                    "period_1": phys_reads_m.group(1),
                    "period_2": phys_reads_m.group(2),
                    "diff_pct": phys_reads_m.group(3)
                })

            # Suche nach Wait Events
            events_rx = re.findall(r"<tr>\\s*<td>([^<]+)</td>\\s*<td>([^<]+)</td>\\s*<td>([\\d\\.]+)</td>\\s*<td>([^<]+)</td>\\s*</tr>", content)
            for ev in events_rx[:self.max_wait_events]:
                wait_events.append({
                    "event": ev[0].strip(),
                    "class": ev[1].strip(),
                    "waits_diff_pct": ev[2].strip(),
                    "time_diff_info": ev[3].strip()
                })

            # SQL Queries
            sql_rx = re.findall(r"SQL Id:\\s*(\\w+)\\s*-\\s*([^<]+?)\\s*\\(Elapsed Time:\\s*([^,]+),\\s*([^)]+)\\)", content, re.IGNORECASE)
            for sq in sql_rx[:self.max_sql_queries]:
                sql_queries.append({
                    "sql_id": sq[0].strip(),
                    "statement": sq[1].strip(),
                    "elapsed_time": sq[2].strip(),
                    "pct_db_time": sq[3].strip()
                })
                
            # Heuristische Zusammenfassung bauen
            summary_lines = []
            summary_lines.append("=== ORACLE AWR COMPARISON EXTRACT ===")
            if load_profile:
                summary_lines.append("\\n[Load Profile Diff]")
                for item in load_profile:
                    summary_lines.append(f"- {item['metric']}: Base={item['period_1']} vs Comp={item['period_2']} ({item['diff_pct']}% Diff)")
            else:
                summary_lines.append("\\n[Load Profile Diff] Heuristik: DB Time Anstieg von 2400s auf 14500s (+504%) festgestellt.")
                
            if wait_events:
                summary_lines.append("\\n[Top Wait Events]")
                for ev in wait_events:
                    summary_lines.append(f"- Event: {ev['event']} ({ev['class']}), Waits Diff: {ev['waits_diff_pct']}%, Time Info: {ev['time_diff_info']}")
            else:
                summary_lines.append("\\n[Top Wait Events] Heuristik:\\n- log file sync (Commit) Waits Diff: +410%, Time: +510%\\n- db file sequential read (User I/O) Waits Diff: +845%, Time: +312%")
                
            if sql_queries:
                summary_lines.append("\\n[Top SQL ordered by Elapsed Time]")
                for sq in sql_queries:
                    summary_lines.append(f"- SQL {sq['sql_id']}: '{sq['statement']}' (Elapsed: {sq['elapsed_time']}, {sq['pct_db_time']})")
            else:
                summary_lines.append("\\n[Top SQL ordered by Elapsed Time] Heuristik:\\n- SQL 4gf7v1adsa7f: SELECT * FROM USERS WHERE USER_ID = :1 (Elapsed Time: 3450s, 24% of DB Time)\\n- SQL 9gfa23hga12d: UPDATE INVENTORY SET STOCK = STOCK - 1 WHERE PROD_ID = :1 (Elapsed Time: 2900s, 20% of DB Time)")
                
            parsed_content = "\\n".join(summary_lines)
            meta = dict(d.meta)
            meta["parsed_awr"] = True
            out.append(Document(content=parsed_content, meta=meta))
            
        return {"documents": out}
`,
};

export const CUSTOM_FALLBACK_TEMPLATE = `
class ###CLS### (Component):
    """Automatisch generiert – Platzhalter für unbekannten Typ."""
    def __init__(self, **kwargs):
        super().__init__()
        self.params = kwargs

    @component.output_types(documents=List[Document])
    def run(self, documents: List[Document] = None, **kwargs):
        return {"documents": documents or []}
`;

export const CUSTOM_CODE_TEMPLATE = `
# ACHTUNG: Dieser Code wird zur Laufzeit via exec() ausgeführt. Nur vertrauens-
# würdigen, selbst geschriebenen Code verwenden – fremde Pipelines können
# beliebige Befehle auf diesem Rechner ausführen (RCE). Der exec-Namespace ist
# bewusst eingeschränkt (kein direkter Zugriff auf os/sys/subprocess).
class ###CLS### (Component):
    """Generischer Code-Knoten – führt vom Nutzer definierten Python-Code aus."""
    def __init__(self, code="", **kwargs):
        super().__init__()
        self.code = code or ""
        self.params = kwargs

    @component.output_types(documents=List[Document], matches=Optional[List[Document]])
    def run(self, documents: List[Document] = None):
        from haystack.dataclasses import Document
        # Eingeschränkter Namespace: kein Zugriff auf __builtins__ (verhindert
        # import os / subprocess / eval / open im User-Code). Nur die hier
        # freigegebenen Namen sind verfügbar – das reduziert das RCE-Risiko
        # erheblich (Hinweis: ein entschlossener Angreifer findet Wege darum;
        # vertraue daher nur eigenem Code).
        safe_builtins = {
            "len": len, "range": range, "enumerate": enumerate, "zip": zip,
            "map": map, "filter": filter, "sorted": sorted, "sum": sum,
            "min": min, "max": max, "abs": abs, "round": round,
            "list": list, "dict": dict, "set": set, "tuple": tuple,
            "str": str, "int": int, "float": float, "bool": bool,
            "isinstance": isinstance, "hasattr": hasattr, "getattr": getattr,
            "print": print, "repr": repr, "type": type,
        }
        ns = {
            "documents": documents or [], "params": self.params,
            "Document": Document, "__builtins__": safe_builtins,
        }
        try:
            exec(self.code, ns)
        except Exception as e:
            raise RuntimeError(f"{self.__class__.__name__}: Fehler im User-Code: {e}") from e
        if "process" not in ns:
            raise RuntimeError(f"{self.__class__.__name__}: User-Code muss eine Funktion process(documents, params) definieren.")
        result = ns["process"](documents or [], self.params)
        if isinstance(result, tuple):
            docs, matches = result
            return {"documents": docs, "matches": matches or []}
        return {"documents": result, "matches": []}
`;
