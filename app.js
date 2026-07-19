/**
 * Haystack Low-Code Pipeline Builder – App-Logik.
 *
 * Erzeugt eine JSON-Struktur, die vom haystack_parser.py in eine echte
 * Haystack-v2 Pipeline übersetzt werden kann.
 *
 * JSON-Schema (pipeline_model):
 * {
 *   "version": "1.0",
 *   "name": "lasttest-analyse",
 *   "settings": { "api_base_url": "", "api_key": "" },
 *   "nodes": [
 *     { "id": "n1", "type": "WebServerLogLoader", "x": 40, "y": 40, "params": { "log_path": "..." } }
 *   ],
 *   "connections": [
 *     { "from": "n1", "from_port": "documents", "to": "n2", "to_port": "documents" }
 *   ]
 * }
 */

const DEFAULT_NAME = "lasttest-log-analyse";

const APP = {
  nodes: [],          // { id, type, x, y, params }
  connections: [],    // { from, from_port, to, to_port }
  selected: null,
  seq: 1,
  name: DEFAULT_NAME,
  settings: { api_base_url: "", api_key: "" },  // globale LLM-Einstellungen
  zoom: 1,
  pan: { x: 0, y: 0 },
  dragEdge: null      // temporäres Verbinden
};

const MIN_ZOOM = 0.2, MAX_ZOOM = 2.5;

function applyTransform() {
  const vp = document.getElementById("viewport");
  vp.style.transform = `translate(${APP.pan.x}px, ${APP.pan.y}px) scale(${APP.zoom})`;
  document.getElementById("zoom-level").textContent = Math.round(APP.zoom * 100) + "%";
}

// Lokale Koordinate (innerhalb des viewports) aus einem Screen-Client-Punkt
function clientToLocal(clientX, clientY) {
  const vp = document.getElementById("viewport");
  const r = vp.getBoundingClientRect();
  return {
    x: (clientX - r.left) / APP.zoom,
    y: (clientY - r.top) / APP.zoom
  };
}

/* ---------------------------------------------------------------- Registry */
function buildPalette() {
  const host = document.getElementById("palette-groups");
  const titles = { DataSource: "Datenquellen", Processing: "Verarbeitung", Analysis: "Analyse", Output: "Ausgabe" };
  Object.entries(COMPONENT_REGISTRY).forEach(([cat, defs]) => {
    const group = document.createElement("div");
    group.className = "palette-group";
    group.dataset.group = cat;
    group.innerHTML = `<h3>${titles[cat] || cat}</h3>`;
    defs.forEach((def) => {
      const item = document.createElement("div");
      item.className = "pal-item";
      item.draggable = true;
      item.innerHTML = `${def.label}<small>${def.description}</small>`;
      item.addEventListener("dragstart", (e) => {
        e.dataTransfer.setData("text/comp-type", def.type);
      });
      group.appendChild(item);
    });
    host.appendChild(group);
  });
}

/* ---------------------------------------------------------------- Canvas */
const canvas = document.getElementById("canvas");
const svg = document.getElementById("edges");

canvas.addEventListener("dragover", (e) => e.preventDefault());
canvas.addEventListener("drop", (e) => {
  e.preventDefault();
  const type = e.dataTransfer.getData("text/comp-type");
  if (!type) return;
  const p = clientToLocal(e.clientX, e.clientY);
  addNode(type, p.x - 100, p.y - 20); // grob zentriert auf Cursor
});

function addNode(type, x, y, id, params) {
  const def = REGISTRY_BY_TYPE[type];
  if (!def) return;
  const node = {
    id: id || "n" + (APP.seq++),
    type, x: x || 40, y: y || 40,
    params: params ? { ...params } : defaultParams(def)
  };
  APP.nodes.push(node);
  renderNode(node);
  renderEdges();
  return node;
}

function defaultParams(def) {
  const p = {};
  (def.params || []).forEach((f) => { p[f.name] = f.default; });
  return p;
}

function renderNode(node) {
  const def = REGISTRY_BY_TYPE[node.type];
  const el = document.createElement("div");
  el.className = "node";
  el.style.left = node.x + "px";
  el.style.top = node.y + "px";
  el.dataset.id = node.id;
  el.dataset.cat = def.category || "Generic";

  const ins = (def.inputs || []).map((p) => `<div class="port in" data-port="${p.name}" data-dir="in">${p.label}</div>`).join("");
  const outs = (def.outputs || []).map((p) => `<div class="port out" data-port="${p.name}" data-dir="out">${p.label}</div>`).join("");

  el.innerHTML = `
    <div class="node-head"><span>${def.label}</span><span class="del" title="Löschen">✕</span></div>
    <div class="node-ports">
      <div class="port-col">${ins}</div>
      <div class="port-col" style="align-items:flex-end">${outs}</div>
    </div>`;

  // Auswahl
  el.addEventListener("mousedown", (e) => {
    if (e.target.classList.contains("del")) return;
    if (e.target.classList.contains("port")) return;
    selectNode(node.id);
  });
  // Löschen
  el.querySelector(".del").addEventListener("click", () => deleteNode(node.id));
  // Verschieben
  const head = el.querySelector(".node-head");
  head.addEventListener("mousedown", (e) => startMove(e, node, el));
  // Verbindungen ziehen
  el.querySelectorAll(".port").forEach((portEl) => {
    portEl.addEventListener("mousedown", (e) => startEdge(e, node, portEl));
  });

  canvas.appendChild(el);
}

function selectNode(id) {
  APP.selected = id;
  document.querySelectorAll(".node").forEach((n) => n.classList.toggle("selected", n.dataset.id === id));
  renderInspector();
}

function deleteNode(id) {
  APP.nodes = APP.nodes.filter((n) => n.id !== id);
  APP.connections = APP.connections.filter((c) => c.from !== id && c.to !== id);
  if (APP.selected === id) APP.selected = null;
  document.querySelector(`.node[data-id="${id}"]`)?.remove();
  renderEdges();
  renderInspector();
}

/* ---------------------------------------------------------------- Move */
function startMove(e, node, el) {
  if (spaceDown) return; // Pan (Leertaste) hat Vorrang vor Node-Verschieben
  e.preventDefault();
  const startX = e.clientX, startY = e.clientY;
  const origX = node.x, origY = node.y;
  function mv(ev) {
    node.x = origX + (ev.clientX - startX) / APP.zoom;
    node.y = origY + (ev.clientY - startY) / APP.zoom;
    el.style.left = node.x + "px";
    el.style.top = node.y + "px";
    renderEdges();
  }
  function up() { document.removeEventListener("mousemove", mv); document.removeEventListener("mouseup", up); }
  document.addEventListener("mousemove", mv);
  document.addEventListener("mouseup", up);
}

/* ---------------------------------------------------------------- Edges */
function portCenter(nodeId, portName, dir) {
  const el = document.querySelector(`.node[data-id="${nodeId}"]`);
  const portEl = el?.querySelector(`.port.${dir}[data-port="${portName}"]`);
  if (!portEl) return null;
  const vp = document.getElementById("viewport");
  const vpRect = vp.getBoundingClientRect();
  const pRect = portEl.getBoundingClientRect();
  return {
    x: (pRect.left - vpRect.left) / APP.zoom + pRect.width / 2 / APP.zoom,
    y: (pRect.top - vpRect.top) / APP.zoom + pRect.height / 2 / APP.zoom
  };
}

function startEdge(e, node, portEl) {
  e.preventDefault();
  e.stopPropagation();
  const dir = portEl.dataset.dir;
  const portName = portEl.dataset.port;
  function mv(ev) {
    const p = clientToLocal(ev.clientX, ev.clientY);
    const a = dir === "out" ? portCenter(node.id, portName, "out") : { x: p.x, y: p.y };
    const b = dir === "out" ? { x: p.x, y: p.y } : portCenter(node.id, portName, "in");
    drawTempEdge(a, b);
  }
  function up(ev) {
    document.removeEventListener("mousemove", mv);
    document.removeEventListener("mouseup", up);
    const target = document.elementFromPoint(ev.clientX, ev.clientY);
    if (target && target.classList.contains("port")) {
      const tNode = target.closest(".node");
      const tDir = target.dataset.dir;
      const tPort = target.dataset.port;
      if (tDir !== dir) {
        const from = dir === "out" ? node.id : tNode.dataset.id;
        const fromPort = dir === "out" ? portName : tPort;
        const to = dir === "in" ? node.id : tNode.dataset.id;
        const toPort = dir === "in" ? portName : tPort;
        addConnection(from, fromPort, to, toPort);
      }
    }
    svg.innerHTML = "";
    renderEdges();
  }
  document.addEventListener("mousemove", mv);
  document.addEventListener("mouseup", up);
}

function addConnection(from, fromPort, to, toPort) {
  if (from === to) return;
  // Verhindere Duplikate auf dem gleichen Zielport
  APP.connections = APP.connections.filter((c) => !(c.to === to && c.to_port === toPort));
  APP.connections.push({ from, from_port: fromPort, to, to_port: toPort });
}

function drawTempEdge(a, b) {
  svg.innerHTML = `<path d="M ${a.x} ${a.y} C ${(a.x+b.x)/2} ${a.y}, ${(a.x+b.x)/2} ${b.y}, ${b.x} ${b.y}" stroke="#f59e0b" stroke-dasharray="5,4" stroke-width="2" fill="none"/>`;
}

function renderEdges() {
  let paths = "";
  APP.connections.forEach((c, idx) => {
    const a = portCenter(c.from, c.from_port, "out");
    const b = portCenter(c.to, c.to_port, "in");
    if (!a || !b) return;
    paths += `<path d="M ${a.x} ${a.y} C ${(a.x+b.x)/2} ${a.y}, ${(a.x+b.x)/2} ${b.y}, ${b.x} ${b.y}" data-idx="${idx}" title="Verbindung löschen (Klicken)"/>`;
  });
  svg.innerHTML = paths;

  // Click handler to delete connection easily
  svg.querySelectorAll("path").forEach((pathEl) => {
    pathEl.addEventListener("click", (e) => {
      e.stopPropagation();
      const idx = parseInt(pathEl.dataset.idx, 10);
      if (!isNaN(idx)) {
        if (confirm("Möchtest du diese Verbindung löschen?")) {
          APP.connections.splice(idx, 1);
          renderEdges();
        }
      }
    });
  });
}

/* ---------------------------------------------------------------- Inspector */
function renderInspector() {
  const body = document.getElementById("inspector-body");
  if (!APP.selected) {
    body.innerHTML = `<p class="hint">Wähle eine Komponente auf dem Canvas, um Parameter zu bearbeiten.</p>`;
    return;
  }
  const node = APP.nodes.find((n) => n.id === APP.selected);
  const def = REGISTRY_BY_TYPE[node.type];
  let html = `<div class="insp-field"><label>Typ</label><input value="${def.label}" disabled></div>`;
  
  (def.params || []).forEach((f) => {
    const val = node.params[f.name];
    const req = f.required ? ' <span class="req">*</span>' : "";
    let control = "";
    
    if (f.type === "bool") {
      control = `<select data-param="${f.name}">
        <option value="true" ${val === true || val === "true" ? "selected" : ""}>true</option>
        <option value="false" ${val === false || val === "false" ? "selected" : ""}>false</option>
      </select>`;
    } else if (f.type === "enum") {
      control = `<select data-param="${f.name}">` +
        f.options.map((o) => `<option ${o === val ? "selected" : ""}>${o}</option>`).join("") + `</select>`;
    } else if (f.type === "list") {
      if (f.name === "classes") {
        // Spezial-Editor für Key-Value-Muster (Regex -> Klasse)
        const items = val || [];
        const rows = items.map((item, idx) => {
          let key = "";
          let label = "";
          if (typeof item === "string" && item.includes(":")) {
            const parts = item.split(":");
            key = parts[0];
            label = parts.slice(1).join(":");
          } else {
            key = item || "";
          }
          return `
            <div class="kv-row" data-idx="${idx}">
              <input type="text" class="kv-key" value="${key}" placeholder="Regex (z.B. ora-.*)" />
              <span class="kv-arrow">➜</span>
              <input type="text" class="kv-val" value="${label}" placeholder="Klasse" />
              <button type="button" class="kv-del-btn" title="Löschen">&times;</button>
            </div>
          `;
        }).join("");
        
        control = `
          <div class="kv-editor-container" data-kv-param="${f.name}">
            <div class="kv-rows">${rows}</div>
            <button type="button" class="kv-add-btn">+ Regel hinzufügen</button>
          </div>
        `;
      } else {
        // Allgemeiner Tag-basiert-Listen-Editor (low-code chips)
        const items = val || [];
        const chips = items.map((item, idx) => `
          <span class="list-chip" data-idx="${idx}">
            <span class="list-chip-text">${item}</span>
            <span class="remove-chip" title="Entfernen">&times;</span>
          </span>
        `).join("");
        
        control = `
          <div class="list-editor-container" data-list-param="${f.name}">
            <div class="list-chips">${chips}</div>
            <div class="list-add-row">
              <input type="text" class="list-add-input" placeholder="Neuer Wert..." />
              <button type="button" class="list-add-btn">Hinzufügen</button>
            </div>
          </div>
        `;
      }
    } else if (f.type === "code") {
      control = `<div class="code-editor-host" data-code-param="${f.name}"></div>` +
        `<p class="code-hint">Tab = Einzug · "⤢ Bearbeiten" öffnet das große Fenster · "Lint" prüft die Syntax.</p>`;
    } else if (f.type === "int" || f.type === "float") {
      control = `<input type="number" data-param="${f.name}" value="${val}" step="${f.type === "float" ? "0.1" : "1"}">`;
    } else {
      control = `<textarea data-param="${f.name}" rows="3">${val ?? ""}</textarea>`;
    }
    
    html += `<div class="insp-field"><label>${f.label}${req}</label>${control}</div>`;
  });
  
  body.innerHTML = html;
  
  // Standard-Event-Listener binden
  body.querySelectorAll("[data-param]").forEach((ctl) => {
    ctl.addEventListener("change", () => updateParam(node, ctl));
    ctl.addEventListener("input", () => updateParam(node, ctl));
  });
  
  // List-Chips-Editor Interaktionen verdrahten
  body.querySelectorAll("[data-list-param]").forEach((container) => {
    const paramName = container.dataset.listParam;
    const chipsContainer = container.querySelector(".list-chips");
    const input = container.querySelector(".list-add-input");
    const addBtn = container.querySelector(".list-add-btn");

    function saveAndRefresh() {
      const currentList = Array.from(chipsContainer.querySelectorAll(".list-chip-text"))
        .map(t => t.textContent.trim())
        .filter(Boolean);
      node.params[paramName] = currentList;
    }

    chipsContainer.addEventListener("click", (ev) => {
      if (ev.target.classList.contains("remove-chip")) {
        ev.target.closest(".list-chip").remove();
        saveAndRefresh();
      }
    });

    function addItem() {
      const val = input.value.trim();
      if (!val) return;
      
      const span = document.createElement("span");
      span.className = "list-chip";
      span.innerHTML = `<span class="list-chip-text">${val}</span><span class="remove-chip" title="Entfernen">&times;</span>`;
      chipsContainer.appendChild(span);
      input.value = "";
      saveAndRefresh();
    }

    addBtn.addEventListener("click", addItem);
    input.addEventListener("keydown", (ev) => {
      if (ev.key === "Enter") {
        ev.preventDefault();
        addItem();
      }
    });
  });

  // Regex Key-Value-Map (Classes) Interaktionen verdrahten
  body.querySelectorAll("[data-kv-param]").forEach((container) => {
    const paramName = container.dataset.kvParam;
    const rowsContainer = container.querySelector(".kv-rows");
    const addBtn = container.querySelector(".kv-add-btn");

    function saveAndRefresh() {
      const list = [];
      rowsContainer.querySelectorAll(".kv-row").forEach((row) => {
        const key = row.querySelector(".kv-key").value.trim();
        const val = row.querySelector(".kv-val").value.trim();
        if (key && val) {
          list.push(`${key}:${val}`);
        } else if (key) {
          list.push(key);
        }
      });
      node.params[paramName] = list;
    }

    rowsContainer.addEventListener("input", saveAndRefresh);
    
    rowsContainer.addEventListener("click", (ev) => {
      if (ev.target.classList.contains("kv-del-btn")) {
        ev.target.closest(".kv-row").remove();
        saveAndRefresh();
      }
    });

    addBtn.addEventListener("click", () => {
      const row = document.createElement("div");
      row.className = "kv-row";
      row.innerHTML = `
        <input type="text" class="kv-key" placeholder="Regex (z.B. ora-.*)" />
        <span class="kv-arrow">➜</span>
        <input type="text" class="kv-val" placeholder="Klasse" />
        <button type="button" class="kv-del-btn" title="Löschen">&times;</button>
      `;
      rowsContainer.appendChild(row);
      row.querySelector(".kv-key").focus();
    });
  });

  // Code-Editoren (mit Syntax-Highlighting) für type:"code" instanziieren
  body.querySelectorAll(".code-editor-host").forEach((host) => createCodeEditor(node, host));
}

function updateParam(node, ctl) {
  const name = ctl.dataset.param;
  const def = REGISTRY_BY_TYPE[node.type].params.find((p) => p.name === name);
  let v = ctl.value;
  if (def.type === "bool") v = (v === "true");
  else if (def.type === "int") v = parseInt(v, 10);
  else if (def.type === "float") v = parseFloat(v);
  else if (def.type === "list") {
    v = v.split("\n").map((s) => s.trim()).filter(Boolean);
  }
  node.params[name] = v;
}

/* ---------------------------------------------------------------- JSON */
function toModel() {
  // Globale LLM-Einstellungen in alle OpenAIGenerator-Knoten einfügen
  const nodes = APP.nodes.map((n) => {
    const params = { ...n.params };
    if (n.type === "OpenAIGenerator") {
      if (APP.settings.api_base_url) params.api_base_url = APP.settings.api_base_url;
      if (APP.settings.api_key) params.api_key = APP.settings.api_key;
    }
    return { id: n.id, type: n.type, x: n.x, y: n.y, params };
  });
  return {
    version: "1.0",
    name: APP.name || DEFAULT_NAME,
    settings: { ...APP.settings },
    nodes,
    connections: APP.connections.map((c) => ({ ...c }))
  };
}

function fromModel(model) {
  if (!model || !Array.isArray(model.nodes)) throw new Error("Ungültiges Modell");
  clearCanvas();
  // Name + globale Einstellungen übernehmen
  APP.name = model.name || DEFAULT_NAME;
  document.getElementById("pipeline-name").value = APP.name;
  if (model.settings) APP.settings = { ...APP.settings, ...model.settings };
  // seq anpassen
  model.nodes.forEach((n) => {
    const num = parseInt(String(n.id).replace(/\D/g, ""), 10);
    if (!isNaN(num) && num >= APP.seq) APP.seq = num + 1;
  });
  // Layout: gespeicherte Positionen übernehmen; fehlen sie (alte Modelle),
  // rasterförmig anordnen.
  const cols = 4, gapX = 260, gapY = 200, originX = 40, originY = 40;
  model.nodes.forEach((n, i) => {
    const x = n.x != null ? n.x : originX + (i % cols) * gapX;
    const y = n.y != null ? n.y : originY + Math.floor(i / cols) * gapY;
    addNode(n.type, x, y, n.id, n.params);
  });
  APP.connections = (model.connections || []).map((c) => ({ ...c }));
  renderEdges();
}

function clearCanvas() {
  APP.nodes = [];
  APP.connections = [];
  APP.selected = null;
  canvas.querySelectorAll(".node").forEach((n) => n.remove());
  svg.innerHTML = "";
  renderInspector();
}

/* ---------------------------------------------------------------- Validate */
async function validate() {
  const errors = [];
  const ids = new Set(APP.nodes.map((n) => n.id));
  if (APP.nodes.length === 0) errors.push("Keine Komponenten vorhanden.");
  APP.nodes.forEach((n) => {
    const def = REGISTRY_BY_TYPE[n.type];
    (def.params || []).forEach((f) => {
      if (f.required && (n.params[f.name] === undefined || n.params[f.name] === ""))
        errors.push(`${def.label} (${n.id}): Pflichtparameter "${f.label}" fehlt.`);
    });
  });
  APP.connections.forEach((c) => {
    if (!ids.has(c.from) || !ids.has(c.to)) errors.push(`Verbindung zeigt auf nicht existierende Node.`);
    const fromDef = REGISTRY_BY_TYPE[APP.nodes.find((n) => n.id === c.from)?.type];
    if (fromDef && !(fromDef.outputs || []).some((o) => o.name === c.from_port))
      errors.push(`Ausgangsport "${c.from_port}" existiert nicht an ${c.from}.`);
  });
  // mind. eine Datenquelle + eine Ausgabe? (weich)
  const hasSource = APP.nodes.some((n) => (COMPONENT_REGISTRY.DataSource || []).some((d) => d.type === n.type));
  const hasOut = APP.nodes.some((n) => (COMPONENT_REGISTRY.Output || []).some((d) => d.type === n.type));
  if (!hasSource) errors.push("Warnung: keine Datenquelle definiert.");
  if (!hasOut) errors.push("Warnung: keine Ausgabe-Komponente definiert.");

  const status = document.getElementById("status");
  status.textContent = "Validierung läuft...";
  status.className = "status";

  if (errors.filter(e => !e.startsWith("Warnung")).length > 0) {
    status.textContent = "✗ " + errors.slice(0, 3).join(" | ") + (errors.length > 3 ? ` (+${errors.length - 3} weitere)` : "");
    status.className = "status err";
    return errors;
  }

  // Backend advanced checks
  try {
    const resp = await fetch("/validate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(toModel())
    });
    if (!resp.ok) throw new Error("HTTP " + resp.status);
    const data = await resp.json();

    if (data.graph && data.graph.has_cycle) {
      errors.push(`Zyklus-Warnung: Zyklus erkannt (${data.graph.cycle_path.join(" -> ")})`);
    }
    if (data.graph && data.graph.isolated_nodes && data.graph.isolated_nodes.length > 0) {
      errors.push(`Isolierte Knoten: ${data.graph.isolated_nodes.join(", ")}`);
    }
    if (data.python && !data.python.components_compiles) {
      errors.push(`Python Syntaxfehler: ${data.python.components_error || "Fehler in benutzerdefiniertem Code"}`);
    }
    if (data.python && !data.python.pipeline_compiles) {
      errors.push(`Pipeline-Struktur Syntaxfehler: ${data.python.pipeline_error || "Fehler in Pipeline-Struktur"}`);
    }
  } catch (e) {
    // Falls Server nicht antwortet (z.B. Offline-Betrieb) ist das kein Blocker für Client-Validierung
    errors.push("Hinweis: Server-Validierung nicht erreichbar.");
  }

  if (errors.length === 0) {
    status.textContent = "✓ Validiert – Keine Zyklen, Python-Code kompiliert erfolgreich.";
    status.className = "status ok";
  } else {
    const hasCritical = errors.some(e => !e.startsWith("Warnung") && !e.startsWith("Hinweis") && !e.startsWith("Isolierte"));
    status.textContent = (hasCritical ? "✗ " : "⚠️ ") + errors.slice(0, 3).join(" | ") + (errors.length > 3 ? ` (+${errors.length - 3} weitere)` : "");
    status.className = hasCritical ? "status err" : "status ok";
  }

  return errors;
}

/* ---------------------------------------------------------------- Modal */
const modal = document.getElementById("modal");
const modalText = document.getElementById("modal-text");
function openModal(title, text) {
  document.getElementById("modal-title").textContent = title;
  modalText.value = text;
  modal.classList.remove("hidden");
}
function closeModal() { modal.classList.add("hidden"); }

/* ---------------------------------------------------------------- Buttons */
document.getElementById("btn-export").addEventListener("click", () => {
  openModal("Pipeline JSON", JSON.stringify(toModel(), null, 2));
});
document.getElementById("btn-import").addEventListener("click", () => {
  openModal("JSON importieren – einfügen und 'Übernehmen'", "");
});
document.getElementById("modal-close").addEventListener("click", closeModal);
document.getElementById("modal-copy").addEventListener("click", async () => {
  const text = modalText.value;
  try {
    if (navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(text);
    } else {
      modalText.select();
      document.execCommand("copy");
    }
  } catch {
    modalText.select();
    document.execCommand("copy");
  }
});
document.getElementById("modal-apply").addEventListener("click", () => {
  try {
    const model = JSON.parse(modalText.value);
    fromModel(model);
    closeModal();
    document.getElementById("status").textContent = "✓ Importiert.";
    document.getElementById("status").className = "status ok";
  } catch (e) {
    alert("JSON-Fehler: " + e.message);
  }
});
document.getElementById("btn-clear").addEventListener("click", clearCanvas);
document.getElementById("btn-validate").addEventListener("click", validate);
document.getElementById("btn-sample").addEventListener("click", loadSample);
document.getElementById("btn-generate").addEventListener("click", generatePipeline);

// Pipeline direkt aus der UI erzeugen (via Server)
async function generatePipeline() {
  const status = document.getElementById("status");
  status.textContent = "Erzeuge Pipeline …";
  status.className = "status";
  const model = toModel();
  try {
    const resp = await fetch("/generate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(model)
    });
    if (!resp.ok) {
      const err = await resp.json().catch(() => ({}));
      throw new Error(err.error || ("HTTP " + resp.status));
    }
    const data = await resp.json();
    showGenerated(data);
    
    let suffix = "";
    let isErr = false;
    if (data.validation) {
      const val = data.validation;
      if (!val.compiles) {
        suffix = " (⚠️ Python-Syntaxfehler!)";
        isErr = true;
      } else if (val.has_cycle) {
        suffix = " (⚠️ Zyklus-Warnung!)";
        isErr = true;
      }
    }
    
    status.textContent = "✓ Pipeline erzeugt (" + data.pipeline_file + ")" + suffix + ".";
    status.className = isErr ? "status err" : "status ok";
  } catch (e) {
    status.textContent = "✗ Serverfehler beim Erzeugen.";
    status.className = "status err";
    alert("Pipeline-Generator Fehler:\n\n" + e.message);
  }
}

// Zeigt den generierten Code im dedizierten Modal an (Download möglich)
let GEN_DATA = null;
function showGenerated(data) {
  GEN_DATA = data;
  let validationMsg = "";
  if (data.validation) {
    const val = data.validation;
    const items = [];
    if (!val.compiles) {
      if (val.components_error) {
        items.push(`<div style="color:#f87171;font-weight:600;margin-bottom:4px">❌ Syntaxfehler in custom components:</div><pre style="color:#fca5a5;background:#334155;padding:6px;border-radius:4px;overflow-x:auto;margin:0 0 8px">${val.components_error}</pre>`);
      }
      if (val.pipeline_error) {
        items.push(`<div style="color:#f87171;font-weight:600;margin-bottom:4px">❌ Syntaxfehler in Pipeline-Struktur:</div><pre style="color:#fca5a5;background:#334155;padding:6px;border-radius:4px;overflow-x:auto;margin:0 0 8px">${val.pipeline_error}</pre>`);
      }
    }
    if (val.has_cycle) {
      items.push(`<div style="color:#fca5a5;font-weight:600">⚠️ Zyklus erkannt: ${val.cycle_path.join(" -> ")}</div>`);
    }
    if (val.isolated_nodes && val.isolated_nodes.length > 0) {
      items.push(`<div style="color:#93c5fd">⚠️ Isolierte Knoten: ${val.isolated_nodes.join(", ")}</div>`);
    }
    if (items.length > 0) {
      validationMsg = `<div style="margin:8px 0;padding:10px;background:#1e293b;border-radius:6px;font-family:monospace;font-size:11px;border-left:4px solid #ef4444;color:#f3f4f6">${items.join("\n")}</div>`;
    } else {
      validationMsg = `<div style="margin:8px 0;padding:6px 10px;background:#065f46;color:#34d399;font-weight:600;font-size:11px;border-radius:6px;border-left:4px solid #34d399">✓ Syntax- und Topologieprüfung erfolgreich bestanden (on-premise / container-ready)</div>`;
    }
  }

  const container = document.getElementById("gen-info");
  if (container) {
    container.innerHTML = `
      <div style="margin-bottom:6px">Die Dateien <code>${data.components_file}</code>, <code>${data.pipeline_file}</code> und <code>${data.yaml_file}</code> wurden im Verzeichnis <code>gen/</code> erzeugt.</div>
      ${validationMsg}
    `;
  }

  document.querySelector("#gen-modal .gen-tab[data-file='components']").textContent = data.components_file;
  document.querySelector("#gen-modal .gen-tab[data-file='pipeline']").textContent = data.pipeline_file;
  document.querySelector("#gen-modal .gen-tab[data-file='yaml']").textContent = data.yaml_file;
  showGenFile("components");
  document.getElementById("gen-modal").classList.remove("hidden");
}

function showGenFile(file) {
  if (!GEN_DATA) return;
  
  let code = "";
  if (file === "components") code = GEN_DATA.components_code;
  else if (file === "pipeline") code = GEN_DATA.pipeline_code;
  else if (file === "yaml") code = GEN_DATA.yaml_code;

  document.getElementById("gen-code").value = code;
  document.querySelectorAll("#gen-modal .gen-tab").forEach((t) =>
    t.classList.toggle("active", t.dataset.file === file));
}

function bindGenModal() {
  document.querySelectorAll("#gen-modal .gen-tab").forEach((t) =>
    t.addEventListener("click", () => showGenFile(t.dataset.file)));
  document.getElementById("gen-close").addEventListener("click", () =>
    document.getElementById("gen-modal").classList.add("hidden"));
  document.getElementById("gen-download").addEventListener("click", () => {
    if (!GEN_DATA) return;
    const file = document.querySelector("#gen-modal .gen-tab.active").dataset.file;
    
    let code = "";
    let fname = "";
    let mimeType = "text/plain";
    
    if (file === "components") {
      code = GEN_DATA.components_code;
      fname = GEN_DATA.components_file;
      mimeType = "text/x-python";
    } else if (file === "pipeline") {
      code = GEN_DATA.pipeline_code;
      fname = GEN_DATA.pipeline_file;
      mimeType = "text/x-python";
    } else if (file === "yaml") {
      code = GEN_DATA.yaml_code;
      fname = GEN_DATA.yaml_file;
      mimeType = "text/yaml";
    }

    const blob = new Blob([code], { type: mimeType });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = fname;
    a.click();
    URL.revokeObjectURL(a.href);
  });
}

// Pipeline-Name
document.getElementById("pipeline-name").addEventListener("input", (e) => {
  APP.name = e.target.value || DEFAULT_NAME;
});

// Globale Einstellungen (LLM URL + API-Key)
const settingsModal = document.getElementById("settings-modal");
document.getElementById("btn-settings").addEventListener("click", () => {
  document.getElementById("set-url").value = APP.settings.api_base_url || "";
  document.getElementById("set-key").value = APP.settings.api_key || "";
  settingsModal.classList.remove("hidden");
});
document.getElementById("settings-close").addEventListener("click", () => settingsModal.classList.add("hidden"));
document.getElementById("settings-save").addEventListener("click", () => {
  APP.settings.api_base_url = document.getElementById("set-url").value.trim();
  APP.settings.api_key = document.getElementById("set-key").value.trim();
  settingsModal.classList.add("hidden");
  document.getElementById("status").textContent = "✓ Einstellungen gespeichert.";
  document.getElementById("status").className = "status ok";
});

// Eingebettetes Beispiel (funktioniert auch ohne Webserver via file://)
const EMBEDDED_SAMPLE = {
  version: "1.0",
  name: "lasttest-log-analyse",
  nodes: [
    { id: "ingest", type: "WebServerLogLoader", params: { log_path: "/var/log/nginx/access.log", format: "combined", max_lines: 500000 } },
    { id: "prep", type: "LogParser", params: { extract_fields: ["status", "latency_ms", "path", "method", "timestamp"] } },
    { id: "window", type: "TimeWindowFilter", params: { start: "2026-07-18T10:00:00", end: "2026-07-18T11:00:00", timestamp_field: "timestamp" } },
    { id: "filter", type: "KeywordFilter", params: { keywords: ["fatal", "error", "ora-", "stacktrace"], case_sensitive: false } },
    { id: "classify", type: "ErrorClassifier", params: { classes: ["ora-.*:Datenbankfehler", "stacktrace:Stacktrace", "fatal:Fatal", "error:Allgemeiner Fehler"], ok_label: "OK" } },
    { id: "prompt", type: "PromptBuilder", params: { template: "Analysiere die folgenden klassifizierten Lasttest-Fehler und fasse Auffälligkeiten sowie Handlungsempfehlungen zusammen:\n\n{% for d in documents %}{{ d.content }}\n{% endfor %}", required_variables: ["documents"] } },
    { id: "llm", type: "OpenAIGenerator", params: { model: "gpt-4o-mini" } },
    { id: "report", type: "ResultExporter", params: { output_path: "analysis_result.json", include_raw: false } }
  ],
  connections: [
    { from: "ingest", from_port: "documents", to: "prep", to_port: "documents" },
    { from: "prep", from_port: "documents", to: "window", to_port: "documents" },
    { from: "window", from_port: "documents", to: "filter", to_port: "documents" },
    { from: "filter", from_port: "matches", to: "classify", to_port: "matches" },
    { from: "classify", from_port: "classified", to: "prompt", to_port: "documents" },
    { from: "prompt", from_port: "prompt", to: "llm", to_port: "prompt" },
    { from: "classify", from_port: "summary", to: "report", to_port: "summary" },
    { from: "llm", from_port: "replies", to: "report", to_port: "replies" }
  ]
};

function loadSample() {
  // Versuche zuerst die externe Datei (wenn per Webserver geladen), sonst eingebettetes Beispiel
  fetch("sample_pipeline.json")
    .then((r) => { if (!r.ok) throw new Error("no file"); return r.json(); })
    .then((m) => fromModel(m))
    .catch(() => fromModel(EMBEDDED_SAMPLE));
}

/* ---------------------------------------------------------------- Zoom & Navigation */
const canvasWrap = document.getElementById("canvas-wrap");
const viewport = document.getElementById("viewport");

function setZoom(newZoom, centerClientX, centerClientY) {
  newZoom = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, newZoom));
  const rect = canvasWrap.getBoundingClientRect();
  const cx = centerClientX != null ? centerClientX : rect.left + canvasWrap.clientWidth / 2;
  const cy = centerClientY != null ? centerClientY : rect.top + canvasWrap.clientHeight / 2;
  // Punkt unter dem Cursor im lokalen Raum beibehalten (Zoom zum Cursor)
  const before = clientToLocal(cx, cy);
  APP.zoom = newZoom;
  const after = clientToLocal(cx, cy);
  APP.pan.x += (after.x - before.x) * APP.zoom;
  APP.pan.y += (after.y - before.y) * APP.zoom;
  applyTransform();
}

function zoomBy(factor) {
  setZoom(APP.zoom * factor);
}

function resetZoom() {
  APP.zoom = 1;
  applyTransform();
}

function fitView() {
  if (APP.nodes.length === 0) { APP.pan = { x: 0, y: 0 }; APP.zoom = 1; applyTransform(); return; }
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  APP.nodes.forEach((n) => {
    const w = 200, h = 90;
    minX = Math.min(minX, n.x); minY = Math.min(minY, n.y);
    maxX = Math.max(maxX, n.x + w); maxY = Math.max(maxY, n.y + h);
  });
  const pad = 60;
  minX -= pad; minY -= pad; maxX += pad; maxY += pad;
  const bw = maxX - minX, bh = maxY - minY;
  const z = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, Math.min(canvasWrap.clientWidth / bw, canvasWrap.clientHeight / bh)));
  APP.zoom = z;
  APP.pan.x = (canvasWrap.clientWidth - bw * z) / 2 - minX * z;
  APP.pan.y = (canvasWrap.clientHeight - bh * z) / 2 - minY * z;
  applyTransform();
}

// Mausrad-Zoom (zum Cursor)
canvasWrap.addEventListener("wheel", (e) => {
  e.preventDefault();
  const factor = e.deltaY < 0 ? 1.1 : 1 / 1.1;
  setZoom(APP.zoom * factor, e.clientX, e.clientY);
}, { passive: false });

// Pan: Leertaste+Ziehen oder Mittelklick
let spaceDown = false;
let panning = false, panStart = null;
canvasWrap.addEventListener("mousedown", (e) => {
  if (e.button === 1 || (spaceDown && e.button === 0)) {
    e.preventDefault();
    panning = true;
    panStart = { x: e.clientX, y: e.clientY, px: APP.pan.x, py: APP.pan.y };
    canvasWrap.style.cursor = "grabbing";
  }
});
window.addEventListener("mousemove", (e) => {
  if (!panning) return;
  APP.pan.x = panStart.px + (e.clientX - panStart.x);
  APP.pan.y = panStart.py + (e.clientY - panStart.y);
  applyTransform();
});
window.addEventListener("mouseup", () => {
  if (panning) { panning = false; canvasWrap.style.cursor = "default"; }
});

// Zoom-Buttons
document.getElementById("zoom-in").addEventListener("click", () => zoomBy(1.2));
document.getElementById("zoom-out").addEventListener("click", () => zoomBy(1 / 1.2));
document.getElementById("zoom-reset").addEventListener("click", resetZoom);
document.getElementById("zoom-fit").addEventListener("click", fitView);

// Hotkeys
window.addEventListener("keydown", (e) => {
  const tag = (e.target.tagName || "").toLowerCase();
  if (tag === "input" || tag === "textarea" || tag === "select") return; // nicht im Formular
  if (e.key === " ") { spaceDown = true; canvasWrap.style.cursor = "grab"; e.preventDefault(); }
  else if (e.key === "+" || e.key === "=") { zoomBy(1.2); e.preventDefault(); }
  else if (e.key === "-" || e.key === "_") { zoomBy(1 / 1.2); e.preventDefault(); }
  else if (e.key === "0") { resetZoom(); e.preventDefault(); }
  else if (e.key === "f" || e.key === "F") { fitView(); e.preventDefault(); }
  else if (e.key.startsWith("Arrow")) {
    const step = e.shiftKey ? 80 : 25;
    if (e.key === "ArrowLeft") APP.pan.x += step;
    else if (e.key === "ArrowRight") APP.pan.x -= step;
    else if (e.key === "ArrowUp") APP.pan.y += step;
    else if (e.key === "ArrowDown") APP.pan.y -= step;
    applyTransform();
    e.preventDefault();
  }
});
window.addEventListener("keyup", (e) => {
  if (e.key === " ") { spaceDown = false; if (!panning) canvasWrap.style.cursor = "default"; }
});

/* ---------------------------------------------------------------- Python-Code-Editor
 * Leichtgewichtiger Editor mit Syntax-Highlighting (Regex-Tokenizer) und
 * Linting via server.py /lint. Komplett offline (Highlight) – Lint nutzt den
 * lokalen Server, falls verfügbar. */
const PY_KW = new Set(("def class return import from as if elif else for while try except " +
  "finally with lambda None True False and or not in is pass break continue raise " +
  "global nonlocal yield assert async await match case").split(" "));
const PY_BUILTINS = new Set(("print len range str int float list dict set tuple open " +
  "enumerate zip map filter sum min max abs sorted repr type isinstance hasattr " +
  "Document params").split(" "));

function pyHighlight(code) {
  const esc = (t) => t.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  // Single-Pass: Kommentar | String | Zahl | Identifier. So werden Keywords
  // niemals innerhalb von Strings/Kommentaren oder im generierten HTML markiert.
  const re = /(#[^\n]*)|("""[\s\S]*?"""|'''[\s\S]*?'''|"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*')|(\b\d+\.?\d*\b)|([A-Za-z_]\w*)/g;
  let out = "";
  let last = 0;
  let m;
  while ((m = re.exec(code)) !== null) {
    out += esc(code.slice(last, m.index));   // Klartext dazwischen escapen
    if (m[1] !== undefined) {                 // Kommentar
      out += `<span class="tk-com">${esc(m[1])}</span>`;
    } else if (m[2] !== undefined) {          // String
      out += `<span class="tk-str">${esc(m[2])}</span>`;
    } else if (m[3] !== undefined) {          // Zahl
      out += `<span class="tk-num">${esc(m[3])}</span>`;
    } else if (m[4] !== undefined) {          // Identifier
      const w = m[4];
      if (PY_KW.has(w)) out += `<span class="tk-kw">${esc(w)}</span>`;
      else if (PY_BUILTINS.has(w)) out += `<span class="tk-bi">${esc(w)}</span>`;
      else out += esc(w);
    }
    last = re.lastIndex;
  }
  out += esc(code.slice(last));
  return out;
}

function createCodeEditor(node, host, opts) {
  opts = opts || {};
  const paramName = host.dataset.codeParam;
  const current = node.params[paramName] ?? "";

  const wrap = document.createElement("div");
  wrap.className = "code-editor" + (opts.large ? " code-editor-large" : "");
  const ta = document.createElement("textarea");
  ta.className = "code-input";
  ta.value = current;
  ta.spellcheck = false;
  const pre = document.createElement("pre");
  pre.className = "code-highlight";
  pre.setAttribute("aria-hidden", "true");

  const toolbar = document.createElement("div");
  toolbar.className = "code-toolbar";
  const lintBtn = document.createElement("button");
  lintBtn.type = "button";
  lintBtn.textContent = "Lint";
  const lintMsg = document.createElement("span");
  lintMsg.className = "code-lint-msg";
  toolbar.appendChild(lintBtn);
  toolbar.appendChild(lintMsg);

  if (opts.large) {
    const closeBtn = document.createElement("button");
    closeBtn.type = "button";
    closeBtn.textContent = "Schließen";
    closeBtn.addEventListener("click", () => {
      document.getElementById("code-modal").classList.add("hidden");
      renderInspector(); // Sync zurück in den Inspector
    });
    toolbar.appendChild(closeBtn);
  } else {
    const expandBtn = document.createElement("button");
    expandBtn.type = "button";
    expandBtn.textContent = "⤢ Bearbeiten";
    expandBtn.className = "code-expand";
    expandBtn.addEventListener("click", () => openCodeModal(node, paramName));
    toolbar.appendChild(expandBtn);
  }

  wrap.appendChild(pre);
  wrap.appendChild(ta);
  wrap.appendChild(toolbar);
  host.appendChild(wrap);

  function refresh() {
    pre.innerHTML = pyHighlight(ta.value) + "\n";
    pre.scrollTop = ta.scrollTop;
    pre.scrollLeft = ta.scrollLeft;
  }
  refresh();

  ta.addEventListener("input", () => {
    node.params[paramName] = ta.value;
    refresh();
  });
  ta.addEventListener("scroll", () => {
    pre.scrollTop = ta.scrollTop;
    pre.scrollLeft = ta.scrollLeft;
  });
  // Tab fügt 4 Leerzeichen ein (statt Fokus-Sprung)
  ta.addEventListener("keydown", (e) => {
    if (e.key === "Tab") {
      e.preventDefault();
      const s = ta.selectionStart, en = ta.selectionEnd;
      ta.value = ta.value.slice(0, s) + "    " + ta.value.slice(en);
      ta.selectionStart = ta.selectionEnd = s + 4;
      node.params[paramName] = ta.value;
      refresh();
    }
  });

  lintBtn.addEventListener("click", async () => {
    lintMsg.textContent = "Lint läuft …";
    lintMsg.className = "code-lint-msg";
    try {
      const resp = await fetch("/lint", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code: ta.value })
      });
      if (!resp.ok) throw new Error("HTTP " + resp.status);
      const data = await resp.json();
      if (data.ok) {
        lintMsg.textContent = "✓ Syntax OK";
        lintMsg.className = "code-lint-msg ok";
      } else {
        const errs = (data.errors || []).map((e) => `Zeile ${e.line}: ${e.msg}`).join(" | ");
        lintMsg.textContent = "✗ " + errs;
        lintMsg.className = "code-lint-msg err";
      }
    } catch (e) {
      lintMsg.textContent = "Linter nicht erreichbar.";
      lintMsg.className = "code-lint-msg err";
    }
  });
}

// Großes Bearbeitungs-Modal für Python-Script/Filter
function openCodeModal(node, paramName) {
  const modal = document.getElementById("code-modal");
  const host = document.getElementById("code-modal-host");
  host.innerHTML = "";
  const h = document.createElement("div");
  h.className = "code-editor-host";
  h.dataset.codeParam = paramName;
  host.appendChild(h);
  createCodeEditor(node, h, { large: true });
  modal.classList.remove("hidden");

  // Schließen per Esc oder Klick auf den dunklen Hintergrund
  function onKey(e) { if (e.key === "Escape") closeCodeModal(); }
  function onBackdrop(e) { if (e.target === modal) closeCodeModal(); }
  document.addEventListener("keydown", onKey);
  modal.addEventListener("mousedown", onBackdrop);
  modal._cleanup = () => {
    document.removeEventListener("keydown", onKey);
    modal.removeEventListener("mousedown", onBackdrop);
  };
}

function closeCodeModal() {
  const modal = document.getElementById("code-modal");
  if (modal.classList.contains("hidden")) return;
  if (modal._cleanup) modal._cleanup();
  modal.classList.add("hidden");
  renderInspector(); // Sync zurück in den Inspector
  const status = document.getElementById("status");
  status.textContent = "✓ Code gespeichert.";
  status.className = "status ok";
}

/* ---------------------------------------------------------------- Deployment Guide */
function bindDeployModal() {
  const modal = document.getElementById("deploy-modal");
  const btnOpen = document.getElementById("btn-deploy");
  const btnClose = document.getElementById("deploy-close");

  if (!modal || !btnOpen || !btnClose) return;

  btnOpen.addEventListener("click", () => {
    modal.classList.remove("hidden");
    showDeployTab("arch");
  });

  btnClose.addEventListener("click", () => {
    modal.classList.add("hidden");
  });

  // Modal schließen per Klick auf den Hintergrund
  modal.addEventListener("mousedown", (e) => {
    if (e.target === modal) {
      modal.classList.add("hidden");
    }
  });

  const tabs = ["arch", "fastapi", "docker", "standard"];
  tabs.forEach((t) => {
    const btn = document.getElementById(`tab-btn-${t}`);
    if (btn) {
      btn.addEventListener("click", () => showDeployTab(t));
    }
  });

  function showDeployTab(tabName) {
    tabs.forEach((t) => {
      const btn = document.getElementById(`tab-btn-${t}`);
      const content = document.getElementById(`tab-content-${t}`);
      if (btn && content) {
        btn.classList.toggle("active", t === tabName);
        content.classList.toggle("hidden", t !== tabName);
      }
    });
  }
}

function bindPaletteSearch() {
  const filterInput = document.getElementById("palette-filter");
  if (!filterInput) return;
  filterInput.addEventListener("input", (e) => {
    const q = e.target.value.toLowerCase().trim();
    document.querySelectorAll(".pal-item").forEach((item) => {
      const text = item.textContent.toLowerCase();
      const matches = text.includes(q);
      item.style.display = matches ? "block" : "none";
    });
    // Hide or show empty groups
    document.querySelectorAll(".palette-group").forEach((group) => {
      const visibleItems = Array.from(group.querySelectorAll(".pal-item")).filter(i => i.style.display !== "none");
      group.style.display = visibleItems.length > 0 ? "block" : "none";
    });
  });
}

/* ---------------------------------------------------------------- Init */
buildPalette();
bindPaletteSearch();
bindGenModal();
bindDeployModal();
applyTransform();