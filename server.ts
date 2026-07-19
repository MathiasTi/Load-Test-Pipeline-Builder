import express from "express";
import path from "path";
import fs from "fs";
import { spawn, execSync } from "child_process";

const app = express();
const PORT = 3000;

app.use(express.json());

import {
  COMPONENT_REGISTRY,
  CODE_TYPES,
  HAYSTACK_BUILTIN,
  HAYSTACK_IMPORTS,
  CUSTOM_CLASSES,
  CUSTOM_FALLBACK_TEMPLATE,
  CUSTOM_CODE_TEMPLATE,
} from "./components_templates";

// Format a Javascript/JSON value into a valid Python literal representation
function pyValue(v: any): string {
  if (typeof v === "boolean") {
    return v ? "True" : "False";
  }
  if (typeof v === "number") {
    return String(v);
  }
  if (Array.isArray(v)) {
    return "[" + v.map((x) => pyValue(x)).join(", ") + "]";
  }
  if (v === null || v === undefined) {
    return "None";
  }
  return JSON.stringify(v);
}

// Generates standard Haystack v2 YAML representation
function buildYamlFile(model: any): string {
  const lines: string[] = [];
  lines.push("components:");
  
  const nodes = model.nodes || [];
  for (const n of nodes) {
    const t = n.type;
    const params = n.params || {};
    
    let cls = t;
    if (t in HAYSTACK_BUILTIN) {
      cls = HAYSTACK_BUILTIN[t];
    }
    
    lines.push(`  ${n.id}:`);
    lines.push(`    type: ${cls}`);
    
    const paramEntries = Object.entries(params);
    if (paramEntries.length > 0) {
      lines.push("    init_parameters:");
      for (const [k, v] of paramEntries) {
        if (v === null || v === undefined) {
          lines.push(`      ${k}: null`);
        } else if (typeof v === "boolean") {
          lines.push(`      ${k}: ${v}`);
        } else if (typeof v === "number") {
          lines.push(`      ${k}: ${v}`);
        } else if (Array.isArray(v)) {
          if (v.length === 0) {
            lines.push(`      ${k}: []`);
          } else {
            lines.push(`      ${k}:`);
            for (const item of v) {
              const escaped = typeof item === "string" ? JSON.stringify(item) : String(item);
              lines.push(`        - ${escaped}`);
            }
          }
        } else {
          const escaped = typeof v === "string" ? JSON.stringify(v) : JSON.stringify(v);
          lines.push(`      ${k}: ${escaped}`);
        }
      }
    } else {
      lines.push("    init_parameters: {}");
    }
  }
  
  lines.push("");
  lines.push("connections:");
  const conns = model.connections || [];
  if (conns.length > 0) {
    for (const c of conns) {
      lines.push(`  - sender: ${c.from}.${c.from_port}`);
      lines.push(`    receiver: ${c.to}.${c.to_port}`);
    }
  } else {
    lines.push("  []");
  }
  
  return lines.join("\n");
}

// Generates the Python custom components source code from the diagram model
function buildComponentsFile(model: any): string {
  const lines = [
    "import json",
    "import re",
    "import csv",
    "import statistics",
    "from collections import Counter",
    "from datetime import datetime",
    "from typing import List, Dict, Any, Optional",
    "from haystack import Component",
    "import haystack.components as component",
    "from haystack.dataclasses import Document",
    "",
  ];
  const usedTypes = new Set<string>((model.nodes || []).map((n: any) => n.type));
  const sortedTypes = Array.from(usedTypes).sort();

  for (const t of sortedTypes) {
    if (t in HAYSTACK_BUILTIN) {
      continue;
    }
    let src = "";
    if (CODE_TYPES.has(t)) {
      src = CUSTOM_CODE_TEMPLATE;
    } else {
      src = CUSTOM_CLASSES[t] || CUSTOM_FALLBACK_TEMPLATE;
    }
    lines.push(src.replace(/###CLS###/g, t));
  }
  return lines.join("\n");
}

// Generates the Python pipeline setup script from the diagram model
function buildPipelineFile(model: any, componentsModule: string): string {
  const name = model.name || "pipeline";
  const nodes = model.nodes || [];
  const conns = model.connections || [];

  const imports = new Set<string>();
  const compInits: string[] = [];
  const settings = model.settings || {};

  for (const n of nodes) {
    const t = n.type;
    const params = { ...n.params };

    if (t === "OpenAIGenerator") {
      if (settings.api_base_url) {
        params.api_base_url = params.api_base_url || settings.api_base_url;
      }
      if (settings.api_key) {
        params.api_key = params.api_key || settings.api_key;
      }
    }

    let cls = t;
    if (t in HAYSTACK_BUILTIN) {
      imports.add(HAYSTACK_IMPORTS[t]);
      cls = HAYSTACK_BUILTIN[t];
    }

    const pstr = Object.entries(params)
      .map(([k, v]) => `${k}=${pyValue(v)}`)
      .join(", ");

    compInits.push(`    builder.add_component("${n.id}", ${cls}(${pstr}))`);
  }

  const edgeLines: string[] = [];
  for (const c of conns) {
    edgeLines.push(`    builder.connect("${c.from}.${c.from_port}", "${c.to}.${c.to_port}")`);
  }

  // Find entry datasource
  const dataSources = COMPONENT_REGISTRY.DataSource;
  const entryNode = nodes.find((n: any) => dataSources.includes(n.type)) || nodes[0];
  const entryId = entryNode ? entryNode.id : "ingest";

  const importsBlock = imports.size > 0 ? Array.from(imports).sort().join("\n") : "# (keine eingebauten Haystack-Komponenten)";

  const content = `"""
${name}_pipeline.py – automatisch aus ${name}.json generiert.
"""
import json
from haystack import Pipeline
${importsBlock}
from ${componentsModule.replace(/-/g, "_")} import *  # eigene + gespiegelte Komponenten

def build_pipeline():
    builder = Pipeline()
${compInits.join("\n")}
${edgeLines.join("\n")}

    return builder


def run():
    pipe = build_pipeline()
    # Die Entry-Component (Datenquelle) hat keine Eingabe -> leeres Dict.
    entry = "${entryId}"
    result = pipe.run({entry: {}})
    return result


if __name__ == "__main__":
    p = build_pipeline()
    print("Pipeline gebaut mit", len(p.graph.nodes), "Komponenten.")
    res = run()
    print("Ergebnis:", json.dumps(res, ensure_ascii=False, default=str)[:500])
`;
  return content;
}

// Helper to compile a Python file to check for syntax errors without executing it
function compilePythonFile(filePath: string): { success: boolean; error?: string } {
  try {
    execSync(`python3 -m py_compile ${filePath}`, { stdio: "pipe" });
    return { success: true };
  } catch (err: any) {
    return {
      success: false,
      error: err.stderr ? err.stderr.toString() : err.message || "Unbekannter Syntaxfehler",
    };
  }
}

// DFS-based cycle detection for directed connection graphs
function detectCycles(model: any): { hasCycle: boolean; path: string[] } {
  const adj: Record<string, string[]> = {};
  const nodes = model.nodes || [];
  const conns = model.connections || [];

  for (const n of nodes) {
    adj[n.id] = [];
  }
  for (const c of conns) {
    if (adj[c.from]) {
      adj[c.from].push(c.to);
    }
  }

  const visited: Record<string, number> = {}; // 0: unvisited, 1: visiting, 2: visited
  const path: string[] = [];

  function dfs(u: string): boolean {
    visited[u] = 1;
    path.push(u);
    for (const v of adj[u] || []) {
      if (visited[v] === 1) {
        path.push(v);
        return true; // Cycle detected
      }
      if (!visited[v]) {
        if (dfs(v)) return true;
      }
    }
    path.pop();
    visited[u] = 2;
    return false;
  }

  for (const n of nodes) {
    if (!visited[n.id]) {
      if (dfs(n.id)) {
        return { hasCycle: true, path };
      }
    }
  }

  return { hasCycle: false, path: [] };
}

// Find nodes that have no incoming or outgoing connections
function findIsolatedNodes(model: any): string[] {
  const nodes = model.nodes || [];
  const conns = model.connections || [];
  const connected = new Set<string>();

  for (const c of conns) {
    connected.add(c.from);
    connected.add(c.to);
  }

  const isolated: string[] = [];
  for (const n of nodes) {
    if (!connected.has(n.id)) {
      isolated.push(`${n.type} (${n.id})`);
    }
  }

  return isolated;
}

// REST Endpoint: Generate pipeline Python code and perform validation checks
app.post("/generate", (req, res) => {
  try {
    const model = req.body;
    if (!model || !Array.isArray(model.nodes)) {
      return res.status(400).json({ error: "Ungültige Model-Struktur." });
    }

    const name = (model.name || "pipeline").replace(/\s+/g, "_");
    const componentsCode = buildComponentsFile(model);
    const pipelineCode = buildPipelineFile(model, `${name}_components`);
    const yamlCode = buildYamlFile(model);

    // Ensure 'gen' directory exists
    const genDir = path.join(process.cwd(), "gen");
    if (!fs.existsSync(genDir)) {
      fs.mkdirSync(genDir, { recursive: true });
    }

    // Write to files
    const componentsFile = `${name}_components.py`;
    const pipelineFile = `${name}_pipeline.py`;
    const yamlFile = `${name}_pipeline.yaml`;

    const compFullPath = path.join(genDir, componentsFile);
    const pipeFullPath = path.join(genDir, pipelineFile);
    const yamlFullPath = path.join(genDir, yamlFile);

    fs.writeFileSync(compFullPath, componentsCode, "utf-8");
    fs.writeFileSync(pipeFullPath, pipelineCode, "utf-8");
    fs.writeFileSync(yamlFullPath, yamlCode, "utf-8");

    // Perform compilation and graph validation on the generated files
    const compCompile = compilePythonFile(compFullPath);
    const pipeCompile = compilePythonFile(pipeFullPath);
    const cycle = detectCycles(model);
    const isolated = findIsolatedNodes(model);

    res.json({
      ok: true,
      components_file: componentsFile,
      pipeline_file: pipelineFile,
      yaml_file: yamlFile,
      components_code: componentsCode,
      pipeline_code: pipelineCode,
      yaml_code: yamlCode,
      validation: {
        compiles: compCompile.success && pipeCompile.success,
        components_error: compCompile.error || null,
        pipeline_error: pipeCompile.error || null,
        has_cycle: cycle.hasCycle,
        cycle_path: cycle.path,
        isolated_nodes: isolated,
      }
    });
  } catch (error: any) {
    res.status(500).json({ error: `Parser-Fehler: ${error.message}` });
  }
});

// REST Endpoint: Validation API for checking pipeline graph consistency and compilation
app.post("/validate", (req, res) => {
  try {
    const model = req.body;
    if (!model || !Array.isArray(model.nodes)) {
      return res.status(400).json({ error: "Ungültige Model-Struktur." });
    }

    const name = (model.name || "pipeline").replace(/\s+/g, "_");
    const componentsCode = buildComponentsFile(model);
    const pipelineCode = buildPipelineFile(model, `${name}_components`);

    // Write to temp files for compiling check
    const tempDir = path.join(process.cwd(), "gen", "temp_val");
    if (!fs.existsSync(tempDir)) {
      fs.mkdirSync(tempDir, { recursive: true });
    }

    const compFile = path.join(tempDir, `${name}_components.py`);
    const pipeFile = path.join(tempDir, `${name}_pipeline.py`);

    fs.writeFileSync(compFile, componentsCode, "utf-8");
    fs.writeFileSync(pipeFile, pipelineCode, "utf-8");

    const compCompile = compilePythonFile(compFile);
    const pipeCompile = compilePythonFile(pipeFile);

    // Clean up temporary files
    try {
      if (fs.existsSync(compFile)) fs.unlinkSync(compFile);
      if (fs.existsSync(pipeFile)) fs.unlinkSync(pipeFile);
    } catch (e) {}

    const cycle = detectCycles(model);
    const isolated = findIsolatedNodes(model);

    res.json({
      ok: true,
      graph: {
        has_cycle: cycle.hasCycle,
        cycle_path: cycle.path,
        isolated_nodes: isolated,
      },
      python: {
        components_compiles: compCompile.success,
        components_error: compCompile.error || null,
        pipeline_compiles: pipeCompile.success,
        pipeline_error: pipeCompile.error || null,
      }
    });
  } catch (error: any) {
    res.status(500).json({ error: `Validierung-Fehler: ${error.message}` });
  }
});

// REST Endpoint: Lint Python custom code
app.post("/lint", async (req, res) => {
  const { code } = req.body;
  if (typeof code !== "string") {
    return res.status(400).json({ ok: false, errors: [{ line: 0, msg: "Kein Code geliefert." }] });
  }
  if (!code.trim()) {
    return res.json({ ok: true, errors: [] });
  }

  try {
    // Compile syntax check via python3
    const py = spawn("python3", ["-c", "import sys; compile(sys.stdin.read(), '<user-code>', 'exec')"]);
    let stderr = "";

    py.stdin.write(code);
    py.stdin.end();

    py.stderr.on("data", (data) => {
      stderr += data.toString();
    });

    py.on("close", (exitCode) => {
      if (exitCode === 0) {
        res.json({ ok: true, errors: [] });
      } else {
        const lines = stderr.split("\n");
        let lineNo = 0;
        let msg = "Syntaxfehler";

        const lineMatch = stderr.match(/line (\d+)/);
        if (lineMatch) {
          lineNo = parseInt(lineMatch[1], 10);
        }

        const errorLine = lines.find(
          (l) =>
            l.includes("Error:") ||
            l.startsWith("SyntaxError:") ||
            l.startsWith("IndentationError:") ||
            l.startsWith("TabError:")
        );
        if (errorLine) {
          msg = errorLine.trim();
        } else if (lines.length > 0) {
          const nonEmpty = lines.filter((l) => l.trim()).pop();
          if (nonEmpty) msg = nonEmpty.trim();
        }

        res.json({
          ok: false,
          errors: [{ line: lineNo, msg: msg }],
        });
      }
    });
  } catch (error: any) {
    res.json({ ok: false, errors: [{ line: 0, msg: `Fehler beim Linter-Aufruf: ${error.message}` }] });
  }
});

// Serve static assets from root directory
app.use(express.static(process.cwd()));

// SPA Fallback for static root
app.get("*", (req, res) => {
  res.sendFile(path.join(process.cwd(), "index.html"));
});

// CLI and Server Execution Router
const args = process.argv.slice(2);

function printHelp() {
  console.log(`
Haystack Load-Test Pipeline Builder (On-Premise CLI & Server)
============================================================

Usage:
  node server.ts [options]

Server Options:
  --port, -p <number>        Start the server on the specified port (default: 3000)

CLI Options (Headless Generator):
  --generate-cli, -g <file>  Path to the exported pipeline JSON file to generate Python scripts from
  --out, -o <directory>      Output directory for generated scripts (default: current directory or 'gen/')
  --help, -h                 Show this help screen

Examples:
  # Start server on default port
  node server.ts

  # Start server on port 8080
  node server.ts --port 8080

  # Headless generation of a pipeline from a saved JSON
  node server.ts --generate-cli sample_pipeline.json --out ./my_pipelines
  `);
  process.exit(0);
}

function runCLI(args: string[]) {
  if (args.includes("--help") || args.includes("-h")) {
    printHelp();
  }

  const fileIdx = args.indexOf("--generate-cli") !== -1 ? args.indexOf("--generate-cli") : args.indexOf("-g");
  const jsonPath = args[fileIdx + 1];
  if (!jsonPath) {
    console.error("Fehler: Bitte geben Sie den Pfad zu einer JSON-Datei an.");
    process.exit(1);
  }

  const outIdx = args.indexOf("--out") !== -1 ? args.indexOf("--out") : args.indexOf("-o");
  const outDir = outIdx !== -1 && args[outIdx + 1] ? args[outIdx + 1] : path.join(process.cwd(), "gen");

  try {
    if (!fs.existsSync(jsonPath)) {
      console.error(`Fehler: Datei nicht gefunden: ${jsonPath}`);
      process.exit(1);
    }

    const raw = fs.readFileSync(jsonPath, "utf-8");
    const model = JSON.parse(raw);

    if (!model || !Array.isArray(model.nodes)) {
      console.error("Fehler: Ungültiges Pipeline-Modell (Knoten fehlen).");
      process.exit(1);
    }

    const name = (model.name || "pipeline").replace(/\s+/g, "_");
    const componentsCode = buildComponentsFile(model);
    const pipelineCode = buildPipelineFile(model, `${name}_components`);

    if (!fs.existsSync(outDir)) {
      fs.mkdirSync(outDir, { recursive: true });
    }

    const compPath = path.join(outDir, `${name}_components.py`);
    const pipePath = path.join(outDir, `${name}_pipeline.py`);

    fs.writeFileSync(compPath, componentsCode, "utf-8");
    fs.writeFileSync(pipePath, pipelineCode, "utf-8");

    console.log(`\n\x1b[32m✓ Pipeline erfolgreich generiert!\x1b[0m`);
    console.log(`  - Komponenten: ${compPath}`);
    console.log(`  - Pipeline:    ${pipePath}`);

    // Run compile syntax checks
    const compCheck = compilePythonFile(compPath);
    const pipeCheck = compilePythonFile(pipePath);

    if (compCheck.success && pipeCheck.success) {
      console.log(`  - \x1b[32mSyntax Check: OK (Erfolgreich kompiliert)\x1b[0m`);
    } else {
      console.log(`  - \x1b[31mSyntax Check: FEHLERHAFT!\x1b[0m`);
      if (compCheck.error) console.log(`    Knoten Fehler:\n${compCheck.error}`);
      if (pipeCheck.error) console.log(`    Pipeline Fehler:\n${pipeCheck.error}`);
    }

    // Topological validation
    const cycle = detectCycles(model);
    if (cycle.hasCycle) {
      console.log(`  - \x1b[33m⚠️  Warnung: Zyklus in Verbindungsgraph gefunden!:\x1b[0m ${cycle.path.join(" -> ")}`);
    } else {
      console.log(`  - \x1b[32mTopologie: OK (Keine Zyklen)\x1b[0m`);
    }

    const isolated = findIsolatedNodes(model);
    if (isolated.length > 0) {
      console.log(`  - \x1b[33m⚠️  Warnung: Isolierte Knoten ohne Verbindungen gefunden:\x1b[0m ${isolated.join(", ")}`);
    }

    process.exit(0);
  } catch (error: any) {
    console.error(`Fehler bei der CLI-Generierung: ${error.message}`);
    process.exit(1);
  }
}

// Check if we are running in CLI mode
if (args.includes("--generate-cli") || args.includes("-g") || args.includes("--help") || args.includes("-h")) {
  runCLI(args);
} else {
  // Otherwise, start the express server
  const portArgIndex = args.indexOf("--port") !== -1 ? args.indexOf("--port") : args.indexOf("-p");
  let port = PORT;
  if (portArgIndex !== -1 && args[portArgIndex + 1]) {
    port = parseInt(args[portArgIndex + 1], 10) || PORT;
  }

  app.listen(port, "0.0.0.0", () => {
    console.log(`[server] Haystack Pipeline Generator is running on http://0.0.0.0:${port}`);
    console.log(`[info] Local-only container-ready on-premise service. Run with --help for CLI usage.`);
  });
}
