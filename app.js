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

/* ---------------------------------------------------------------- Undo / Redo & Autosave */
const UNDO_STACK = [];
const REDO_STACK = [];
const MAX_STACK_SIZE = 50;
let pushStateTimeout = null;
const AUTOSAVE_KEY = "haystack_pipeline_builder_autosave";

function saveToLocalStorage() {
  try {
    const model = toModel();
    localStorage.setItem(AUTOSAVE_KEY, JSON.stringify(model));
  } catch (err) {
    console.error("Autosave to localStorage failed:", err);
  }
}

function pushState() {
  const state = JSON.stringify(toModel());
  if (UNDO_STACK.length > 0 && UNDO_STACK[UNDO_STACK.length - 1] === state) {
    return;
  }
  UNDO_STACK.push(state);
  if (UNDO_STACK.length > MAX_STACK_SIZE) {
    UNDO_STACK.shift();
  }
  REDO_STACK.length = 0;
  updateUndoRedoButtons();
  saveToLocalStorage();
}

function pushStateDebounced() {
  if (pushStateTimeout) clearTimeout(pushStateTimeout);
  pushStateTimeout = setTimeout(() => {
    pushState();
  }, 400);
}

function undo() {
  if (UNDO_STACK.length <= 1) return;
  const currentState = UNDO_STACK.pop();
  REDO_STACK.push(currentState);
  
  const prevState = UNDO_STACK[UNDO_STACK.length - 1];
  try {
    const model = JSON.parse(prevState);
    const selectedBefore = APP.selected;
    fromModel(model);
    if (selectedBefore && APP.nodes.some(n => n.id === selectedBefore)) {
      selectNode(selectedBefore);
    }
    saveToLocalStorage();
  } catch (err) {
    console.error("Undo failed:", err);
  }
  updateUndoRedoButtons();
}

function redo() {
  if (REDO_STACK.length === 0) return;
  const nextState = REDO_STACK.pop();
  UNDO_STACK.push(nextState);
  try {
    const model = JSON.parse(nextState);
    const selectedBefore = APP.selected;
    fromModel(model);
    if (selectedBefore && APP.nodes.some(n => n.id === selectedBefore)) {
      selectNode(selectedBefore);
    }
    saveToLocalStorage();
  } catch (err) {
    console.error("Redo failed:", err);
  }
  updateUndoRedoButtons();
}

function updateUndoRedoButtons() {
  const undoBtn = document.getElementById("btn-undo");
  const redoBtn = document.getElementById("btn-redo");
  if (undoBtn) {
    const canUndo = UNDO_STACK.length > 1;
    undoBtn.disabled = !canUndo;
  }
  if (redoBtn) {
    const canRedo = REDO_STACK.length > 0;
    redoBtn.disabled = !canRedo;
  }
}

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
  pushState();
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
  pushState();
}

/* ---------------------------------------------------------------- Move */
function startMove(e, node, el) {
  if (spaceDown) return; // Pan (Leertaste) hat Vorrang vor Node-Verschieben
  e.preventDefault();
  const startX = e.clientX, startY = e.clientY;
  const origX = node.x, origY = node.y;
  let moved = false;

  const w = el.offsetWidth;
  const h = el.offsetHeight;

  const otherNodes = [];
  APP.nodes.forEach(n => {
    if (n.id === node.id) return;
    const otherEl = document.querySelector(`.node[data-id="${n.id}"]`);
    if (otherEl) {
      otherNodes.push({
        id: n.id,
        x: n.x,
        y: n.y,
        w: otherEl.offsetWidth,
        h: otherEl.offsetHeight,
        cx: n.x + otherEl.offsetWidth / 2,
        cy: n.y + otherEl.offsetHeight / 2
      });
    }
  });

  const SNAP_THRESHOLD = 12;

  function mv(ev) {
    const dx = (ev.clientX - startX) / APP.zoom;
    const dy = (ev.clientY - startY) / APP.zoom;
    if (Math.abs(dx) > 1 || Math.abs(dy) > 1) {
      moved = true;
    }

    let targetX = origX + dx;
    let targetY = origY + dy;

    let snappedX = null;
    let snapLinesX = [];
    let minDiffX = SNAP_THRESHOLD;

    otherNodes.forEach(other => {
      // 1. Links-auf-Links Ausrichtung
      const diffL2L = Math.abs(targetX - other.x);
      if (diffL2L < minDiffX) {
        minDiffX = diffL2L;
        snappedX = other.x;
        snapLinesX = [{
          x1: other.x,
          y1: Math.min(targetY, other.y) - 30,
          x2: other.x,
          y2: Math.max(targetY + h, other.y + other.h) + 30
        }];
      }

      // 2. Zentrum-auf-Zentrum Ausrichtung
      const diffC2C = Math.abs((targetX + w / 2) - other.cx);
      if (diffC2C < minDiffX) {
        minDiffX = diffC2C;
        snappedX = other.cx - w / 2;
        snapLinesX = [{
          x1: other.cx,
          y1: Math.min(targetY, other.y) - 30,
          x2: other.cx,
          y2: Math.max(targetY + h, other.y + other.h) + 30
        }];
      }

      // 3. Rechts-auf-Rechts Ausrichtung
      const diffR2R = Math.abs((targetX + w) - (other.x + other.w));
      if (diffR2R < minDiffX) {
        minDiffX = diffR2R;
        snappedX = (other.x + other.w) - w;
        snapLinesX = [{
          x1: other.x + other.w,
          y1: Math.min(targetY, other.y) - 30,
          x2: other.x + other.w,
          y2: Math.max(targetY + h, other.y + other.h) + 30
        }];
      }
    });

    let snappedY = null;
    let snapLinesY = [];
    let minDiffY = SNAP_THRESHOLD;

    otherNodes.forEach(other => {
      // 1. Oben-auf-Oben Ausrichtung
      const diffT2T = Math.abs(targetY - other.y);
      if (diffT2T < minDiffY) {
        minDiffY = diffT2T;
        snappedY = other.y;
        snapLinesY = [{
          x1: Math.min(targetX, other.x) - 30,
          y1: other.y,
          x2: Math.max(targetX + w, other.x + other.w) + 30,
          y2: other.y
        }];
      }

      // 2. Zentrum-auf-Zentrum Ausrichtung
      const diffC2C = Math.abs((targetY + h / 2) - other.cy);
      if (diffC2C < minDiffY) {
        minDiffY = diffC2C;
        snappedY = other.cy - h / 2;
        snapLinesY = [{
          x1: Math.min(targetX, other.x) - 30,
          y1: other.cy,
          x2: Math.max(targetX + w, other.x + other.w) + 30,
          y2: other.cy
        }];
      }

      // 3. Unten-auf-Unten Ausrichtung
      const diffB2B = Math.abs((targetY + h) - (other.y + other.h));
      if (diffB2B < minDiffY) {
        minDiffY = diffB2B;
        snappedY = (other.y + other.h) - h;
        snapLinesY = [{
          x1: Math.min(targetX, other.x) - 30,
          y1: other.y + other.h,
          x2: Math.max(targetX + w, other.x + other.w) + 30,
          y2: other.y + other.h
        }];
      }
    });

    if (snappedX !== null) {
      targetX = snappedX;
    }
    if (snappedY !== null) {
      targetY = snappedY;
    }

    node.x = targetX;
    node.y = targetY;
    el.style.left = node.x + "px";
    el.style.top = node.y + "px";

    APP.snapLines = [];
    if (snappedX !== null) {
      APP.snapLines.push(...snapLinesX);
    }
    if (snappedY !== null) {
      APP.snapLines.push(...snapLinesY);
    }

    renderEdges();
  }

  function up() {
    document.removeEventListener("mousemove", mv);
    document.removeEventListener("mouseup", up);
    APP.snapLines = [];
    renderEdges();
    if (moved) {
      pushState();
    }
  }
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
        pushState();
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

  if (APP.snapLines && APP.snapLines.length > 0) {
    APP.snapLines.forEach(line => {
      paths += `<line class="snap-guideline" x1="${line.x1}" y1="${line.y1}" x2="${line.x2}" y2="${line.y2}" />`;
    });
  }

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
          pushState();
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
      pushState();
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
      pushStateDebounced();
    }

    rowsContainer.addEventListener("input", saveAndRefresh);
    
    rowsContainer.addEventListener("click", (ev) => {
      if (ev.target.classList.contains("kv-del-btn")) {
        ev.target.closest(".kv-row").remove();
        saveAndRefresh();
        pushState();
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
      saveAndRefresh();
      pushState();
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
  pushStateDebounced();
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
  const plNameInput = document.getElementById("pipeline-name");
  if (plNameInput) {
    plNameInput.value = APP.name;
    plNameInput.title = APP.name;
  }
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
  
  // Clear any existing invalid styling
  document.querySelectorAll(".node").forEach((n) => n.classList.remove("invalid"));
  const invalidNodeIds = new Set();

  if (APP.nodes.length === 0) {
    errors.push("Keine Komponenten vorhanden.");
  }

  // Required parameters check
  APP.nodes.forEach((n) => {
    const def = REGISTRY_BY_TYPE[n.type];
    (def.params || []).forEach((f) => {
      if (f.required && (n.params[f.name] === undefined || n.params[f.name] === "")) {
        errors.push(`${def.label} (${n.id}): Pflichtparameter "${f.label}" fehlt.`);
        invalidNodeIds.add(n.id);
      }
    });
  });

  // Connections endpoints and ports existence check
  APP.connections.forEach((c) => {
    if (!ids.has(c.from)) {
      errors.push(`Verbindung zeigt von nicht existierender Node "${c.from}".`);
    } else {
      const fromDef = REGISTRY_BY_TYPE[APP.nodes.find((n) => n.id === c.from)?.type];
      if (fromDef && !(fromDef.outputs || []).some((o) => o.name === c.from_port)) {
        errors.push(`Ausgangsport "${c.from_port}" existiert nicht an ${c.from}.`);
        invalidNodeIds.add(c.from);
      }
    }
    if (!ids.has(c.to)) {
      errors.push(`Verbindung zeigt auf nicht existierende Node.`);
    } else {
      const toDef = REGISTRY_BY_TYPE[APP.nodes.find((n) => n.id === c.to)?.type];
      if (toDef && !(toDef.inputs || []).some((i) => i.name === c.to_port)) {
        errors.push(`Eingangsport "${c.to_port}" existiert nicht an ${c.to}.`);
        invalidNodeIds.add(c.to);
      }
    }
  });

  // Client-side cycle detection
  const adj = {};
  APP.nodes.forEach(n => adj[n.id] = []);
  APP.connections.forEach(c => {
    if (adj[c.from] && adj[c.to]) adj[c.from].push(c.to);
  });
  const visited = {};
  const cycleNodes = new Set();
  let hasClientCycle = false;
  function dfs(u, path) {
    visited[u] = 1;
    path.push(u);
    for (const v of adj[u] || []) {
      if (visited[v] === 1) {
        hasClientCycle = true;
        const idx = path.indexOf(v);
        if (idx !== -1) {
          path.slice(idx).forEach(nodeId => cycleNodes.add(nodeId));
        }
      } else if (!visited[v]) {
        dfs(v, path);
      }
    }
    path.pop();
    visited[u] = 2;
  }
  APP.nodes.forEach(n => {
    if (!visited[n.id]) {
      dfs(n.id, []);
    }
  });
  if (hasClientCycle) {
    errors.push(`Zyklus-Warnung: Zyklus erkannt (${Array.from(cycleNodes).join(" -> ")})`);
    cycleNodes.forEach(id => invalidNodeIds.add(id));
  }

  // Client-side isolated nodes detection
  const connectedNodeIds = new Set();
  APP.connections.forEach(c => {
    connectedNodeIds.add(c.from);
    connectedNodeIds.add(c.to);
  });
  const isolated = [];
  APP.nodes.forEach(n => {
    if (!connectedNodeIds.has(n.id)) {
      isolated.push(`${n.type} (${n.id})`);
      invalidNodeIds.add(n.id);
    }
  });
  if (isolated.length > 0) {
    errors.push(`Isolierte Knoten: ${isolated.join(", ")}`);
  }

  // Soft check for Source and Output types
  const hasSource = APP.nodes.some((n) => (COMPONENT_REGISTRY.DataSource || []).some((d) => d.type === n.type));
  const hasOut = APP.nodes.some((n) => (COMPONENT_REGISTRY.Output || []).some((d) => d.type === n.type));
  if (!hasSource) errors.push("Warnung: keine Datenquelle definiert.");
  if (!hasOut) errors.push("Warnung: keine Ausgabe-Komponente definiert.");

  const status = document.getElementById("status");
  status.textContent = "Validierung läuft...";
  status.className = "status";

  // Critical client-side block (excluding warnings and isolated notes for server pass)
  const criticalLocal = errors.filter(e => !e.startsWith("Warnung") && !e.startsWith("Isolierte") && !e.startsWith("Zyklus"));
  if (criticalLocal.length > 0) {
    status.textContent = "✗ " + errors.slice(0, 3).join(" | ") + (errors.length > 3 ? ` (+${errors.length - 3} weitere)` : "");
    status.className = "status err";
    invalidNodeIds.forEach(id => {
      const el = document.querySelector(`.node[data-id="${id}"]`);
      if (el) el.classList.add("invalid");
    });
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
      if (!hasClientCycle) {
        errors.push(`Zyklus-Warnung: Zyklus erkannt (${data.graph.cycle_path.join(" -> ")})`);
      }
      if (data.graph.cycle_path) {
        data.graph.cycle_path.forEach(id => invalidNodeIds.add(id));
      }
    }
    if (data.python && !data.python.components_compiles) {
      errors.push(`Python Syntaxfehler: ${data.python.components_error || "Fehler in benutzerdefiniertem Code"}`);
      APP.nodes.forEach(n => {
        if (data.python.components_error && data.python.components_error.includes(n.type)) {
          invalidNodeIds.add(n.id);
        }
      });
    }
    if (data.python && !data.python.pipeline_compiles) {
      errors.push(`Pipeline-Struktur Syntaxfehler: ${data.python.pipeline_error || "Fehler in Pipeline-Struktur"}`);
    }
  } catch (e) {
    // Server validation unreachability is just a notice
    errors.push("Hinweis: Server-Validierung nicht erreichbar.");
  }

  // Apply visual error classes
  invalidNodeIds.forEach(id => {
    const el = document.querySelector(`.node[data-id="${id}"]`);
    if (el) el.classList.add("invalid");
  });

  const hasCritical = errors.some(e => !e.startsWith("Warnung") && !e.startsWith("Hinweis") && !e.startsWith("Isolierte") && !e.startsWith("Zyklus-Warnung"));
  if (errors.length === 0) {
    status.textContent = "✓ Validiert – Keine Zyklen, Python-Code kompiliert erfolgreich.";
    status.className = "status ok";
  } else {
    status.textContent = (hasCritical ? "✗ " : "⚠️ ") + errors.slice(0, 3).join(" | ") + (errors.length > 3 ? ` (+${errors.length - 3} weitere)` : "");
    status.className = hasCritical ? "status err" : "status ok";
  }

  return errors;
}

/* ---------------------------------------------------------------- Auto Layout */
function autoLayout() {
  if (APP.nodes.length === 0) return;

  const ranks = {};
  APP.nodes.forEach(n => ranks[n.id] = 0);

  // Relax ranks to find topological columns
  const N = APP.nodes.length;
  for (let iter = 0; iter < N; iter++) {
    let changed = false;
    APP.connections.forEach(c => {
      const fromNode = APP.nodes.find(n => n.id === c.from);
      const toNode = APP.nodes.find(n => n.id === c.to);
      if (fromNode && toNode) {
        if (ranks[c.to] < ranks[c.from] + 1) {
          ranks[c.to] = ranks[c.from] + 1;
          changed = true;
        }
      }
    });
    if (!changed) break;
  }

  // Group nodes by their calculated ranks
  const columns = {};
  APP.nodes.forEach(n => {
    const r = ranks[n.id] || 0;
    if (!columns[r]) columns[r] = [];
    columns[r].push(n);
  });

  const startX = 60;
  const startY = 80;
  const gapX = 320; // Enough spacing horizontally for ports and labels
  const gapY = 160; // Clean vertical distribution

  const sortedRanks = Object.keys(columns).map(Number).sort((a, b) => a - b);
  sortedRanks.forEach((rank, colIndex) => {
    const colNodes = columns[rank];
    // Sort vertical ordering by their previous Y position to preserve design choice
    colNodes.sort((a, b) => a.y - b.y);
    colNodes.forEach((node, nodeIndex) => {
      node.x = startX + colIndex * gapX;
      node.y = startY + nodeIndex * gapY;

      const el = document.querySelector(`.node[data-id="${node.id}"]`);
      if (el) {
        el.style.left = node.x + "px";
        el.style.top = node.y + "px";
      }
    });
  });

  renderEdges();
  fitView();
  pushState();

  const status = document.getElementById("status");
  status.textContent = "✓ Auto-Layout angewendet.";
  status.className = "status ok";
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
    pushState();
  } catch (e) {
    alert("JSON-Fehler: " + e.message);
  }
});
document.getElementById("btn-clear").addEventListener("click", () => {
  clearCanvas();
  pushState();
});
document.getElementById("btn-validate").addEventListener("click", validate);
document.getElementById("btn-autolayout").addEventListener("click", autoLayout);
document.getElementById("btn-undo").addEventListener("click", undo);
document.getElementById("btn-redo").addEventListener("click", redo);
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

  const tComp = document.querySelector("#gen-modal .gen-tab[data-file='components']");
  tComp.textContent = data.components_file;
  tComp.title = data.components_file;

  const tPipe = document.querySelector("#gen-modal .gen-tab[data-file='pipeline']");
  tPipe.textContent = data.pipeline_file;
  tPipe.title = data.pipeline_file;

  const tYaml = document.querySelector("#gen-modal .gen-tab[data-file='yaml']");
  tYaml.textContent = data.yaml_file;
  tYaml.title = data.yaml_file;
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
  e.target.title = e.target.value;
  pushStateDebounced();
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
  pushState();
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
    .then((r) => {
      const contentType = r.headers.get("content-type");
      if (!r.ok || !contentType || !contentType.includes("application/json")) {
        throw new Error("not JSON");
      }
      return r.json();
    })
    .then((m) => {
      fromModel(m);
      pushState();
    })
    .catch(() => {
      fromModel(EMBEDDED_SAMPLE);
      pushState();
    });
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

  // Ctrl+Z / Ctrl+Y / Ctrl+Shift+Z logic for Undo/Redo
  if (e.ctrlKey || e.metaKey) {
    if (e.key.toLowerCase() === "z") {
      if (tag === "input" || tag === "textarea" || tag === "select") return;
      e.preventDefault();
      if (e.shiftKey) {
        redo();
      } else {
        undo();
      }
      return;
    } else if (e.key.toLowerCase() === "y") {
      if (tag === "input" || tag === "textarea" || tag === "select") return;
      e.preventDefault();
      redo();
      return;
    }
  }

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
    pushStateDebounced();
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
      pushStateDebounced();
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

  const tabs = ["arch", "fastapi", "docker", "standard", "prodready"];
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

    if (tabName === "arch" && window.mermaid) {
      setTimeout(() => {
        try {
          // Force Mermaid rendering on modal tab activation
          window.mermaid.init(undefined, document.querySelectorAll('.mermaid'));
        } catch (e) {
          console.error("Mermaid live render error:", e);
        }
      }, 50);
    }
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

/* ---------------------------------------------------------------- Autosave Handler */
function checkAndPromptAutosave() {
  try {
    const savedStr = localStorage.getItem(AUTOSAVE_KEY);
    if (!savedStr) return;
    
    const savedModel = JSON.parse(savedStr);
    // Zeige das Modal nicht, wenn der Entwurf leer ist
    if (!savedModel || !Array.isArray(savedModel.nodes) || savedModel.nodes.length === 0) {
      return;
    }

    const modal = document.getElementById("autosave-modal");
    const nameSpan = document.getElementById("autosave-pipeline-name");
    const metaDiv = document.getElementById("autosave-meta");
    const btnRestore = document.getElementById("autosave-restore");
    const btnDiscard = document.getElementById("autosave-discard");

    if (!modal || !nameSpan || !metaDiv || !btnRestore || !btnDiscard) return;

    nameSpan.textContent = `"${savedModel.name || DEFAULT_NAME}"`;
    
    const nodeCount = savedModel.nodes.length;
    const connCount = (savedModel.connections || []).length;
    const nodeTypes = [...new Set(savedModel.nodes.map(n => n.type))];
    const nodeTypesStr = nodeTypes.slice(0, 3).join(", ") + (nodeTypes.length > 3 ? "..." : "");

    metaDiv.innerHTML = `
      <div style="font-weight: 600; margin-bottom: 6px; color: #0f172a; font-size: 13px;">Details zum Entwurf:</div>
      <ul style="margin: 0; padding-left: 16px; list-style-type: disc; color: #475569; display: flex; flex-direction: column; gap: 4px;">
        <li>Komponenten: <strong>${nodeCount}</strong> (${nodeTypesStr})</li>
        <li>Verbindungen: <strong>${connCount}</strong></li>
      </ul>
    `;

    modal.classList.remove("hidden");

    const restoreHandler = () => {
      try {
        fromModel(savedModel);
        UNDO_STACK.length = 0;
        REDO_STACK.length = 0;
        pushState();
        fitView();
        
        const status = document.getElementById("status");
        if (status) {
          status.textContent = "✓ Sitzung wiederhergestellt.";
          status.className = "status ok";
        }
      } catch (err) {
        console.error("Failed to restore saved state:", err);
        alert("Fehler beim Wiederherstellen der Sitzung.");
      }
      modal.classList.add("hidden");
      cleanup();
    };

    const discardHandler = () => {
      if (confirm("Möchtest du diesen automatisch gespeicherten Entwurf wirklich löschen?")) {
        try {
          localStorage.removeItem(AUTOSAVE_KEY);
        } catch (err) {
          console.error(err);
        }
        modal.classList.add("hidden");
        cleanup();
      }
    };

    function cleanup() {
      btnRestore.removeEventListener("click", restoreHandler);
      btnDiscard.removeEventListener("click", discardHandler);
    }

    btnRestore.addEventListener("click", restoreHandler);
    btnDiscard.addEventListener("click", discardHandler);

  } catch (err) {
    console.error("Error reading/parsing autosaved state:", err);
  }
}

/* ---------------------------------------------------------------- Onboarding Tutorial */
let currentTutorialStep = 0;
const tutorialSteps = [
  {
    title: "Die Komponenten-Palette 🛠️",
    body: "Auf der linken Seite befindet sich die <strong>Komponenten-Palette</strong>. Hier findest du alle verfügbaren Haystack v2 Bausteine: <em>Log-Loader, Filter, LLM-Generatoren</em> und <em>Exporteure</em>. Du kannst die Liste filtern oder aufklappen, um den passenden Knoten für dein Lasttest-Szenario zu finden.",
    targetId: "palette",
    position: (targetRect, cardWidth, cardHeight) => {
      return {
        top: Math.max(20, targetRect.top + 60),
        left: targetRect.right + 20
      };
    }
  },
  {
    title: "Komponenten hinzufügen 🖱️",
    body: "Um eine neue Komponente auf das Canvas zu bringen, ziehe sie einfach mit <strong>Drag & Drop</strong> auf die freie Fläche.<br/><br/>Alternativ kannst du auch einfach auf ein beliebiges Element in der Liste <strong>klicken</strong> – der Builder platziert es dann automatisch für dich auf dem Canvas!",
    targetId: "palette-groups",
    position: (targetRect, cardWidth, cardHeight) => {
      return {
        top: Math.max(20, targetRect.top + 120),
        left: targetRect.right + 20
      };
    }
  },
  {
    title: "Interaktives Canvas & Zoom 🎨",
    body: "Das zentrale <strong>Canvas</strong> ist deine Arbeitsfläche. Du kannst:<br/>" +
          "• Es verschieben (<strong>Pan</strong>) mit gedrückter <em>Leertaste + Mausziehen</em> oder Klick mit dem Mausrad.<br/>" +
          "• Hinein- und herauszoomen mit dem <em>Mausrad</em> oder den <strong>Zoom-Tasten</strong> unten links.<br/>" +
          "• Die Knoten sauber aneinander ausrichten lassen per <strong>Auto-Layout</strong>.",
    targetId: "canvas-wrap",
    position: (targetRect, cardWidth, cardHeight) => {
      return {
        top: targetRect.bottom - cardHeight - 80,
        left: targetRect.left + (targetRect.width - cardWidth) / 2
      };
    }
  },
  {
    title: "Parameter-Inspector ⚙️",
    body: "Wählst du eine Komponente auf dem Canvas aus, öffnet sich rechts der <strong>Inspector</strong>.<br/><br/>Hier kannst du alle Parameter im Detail einstellen. Für hochentwickelte Knoten (wie den Python-Code-Filter) kannst du den Code sogar in einem großen Editor bearbeiten und die Syntax live prüfen lassen!",
    targetId: "inspector",
    position: (targetRect, cardWidth, cardHeight) => {
      return {
        top: Math.max(20, targetRect.top + 60),
        left: targetRect.left - cardWidth - 20
      };
    }
  },
  {
    title: "Validieren & Generieren ⚡",
    body: "Nachdem du die Ports per Drag von Output zu Input verbunden hast, kannst du deine Pipeline über <strong>Validieren</strong> auf Fehler oder isolierte Knoten prüfen.<br/><br/>Ein Klick auf <strong>Pipeline generieren</strong> erzeugt die fertigen Python-Scripte und das deklarative v2 YAML für deine Container-Laufzeit!",
    targetId: "btn-generate",
    position: (targetRect, cardWidth, cardHeight) => {
      return {
        top: targetRect.bottom + 15,
        left: Math.max(20, targetRect.left - cardWidth / 2)
      };
    }
  }
];

function bindTutorial() {
  const btnTutorial = document.getElementById("btn-tutorial");
  if (!btnTutorial) return;

  btnTutorial.addEventListener("click", () => {
    startTutorial();
  });
}

function startTutorial() {
  currentTutorialStep = 0;
  const backdrop = document.getElementById("tutorial-backdrop");
  if (backdrop) backdrop.classList.add("active");
  showTutorialStep(currentTutorialStep);
}

function stopTutorial() {
  const backdrop = document.getElementById("tutorial-backdrop");
  if (backdrop) backdrop.classList.remove("active");
  
  // Remove card
  const oldCard = document.getElementById("tutorial-active-card");
  if (oldCard) oldCard.remove();

  // Remove highlight classes
  document.querySelectorAll(".tutorial-highlight").forEach(el => {
    el.classList.remove("tutorial-highlight");
  });
}

function showTutorialStep(index) {
  // Clear any existing highlight
  document.querySelectorAll(".tutorial-highlight").forEach(el => {
    el.classList.remove("tutorial-highlight");
  });

  const step = tutorialSteps[index];
  const targetEl = document.getElementById(step.targetId) || document.querySelector("." + step.targetId);
  
  if (targetEl) {
    targetEl.classList.add("tutorial-highlight");
    if (step.targetId === "canvas-wrap") {
      const zoomCtrls = document.getElementById("zoom-controls");
      if (zoomCtrls) zoomCtrls.classList.add("tutorial-highlight");
    }
  }

  // Remove old card if exists
  let card = document.getElementById("tutorial-active-card");
  if (!card) {
    card = document.createElement("div");
    card.id = "tutorial-active-card";
    card.className = "tutorial-card";
    document.body.appendChild(card);
  }

  // Build dots
  const dotsHtml = tutorialSteps.map((_, i) => `
    <span class="tutorial-dot ${i === index ? 'active' : ''}"></span>
  `).join("");

  card.innerHTML = `
    <div class="tutorial-card-header">
      <span class="tutorial-card-title">${step.title}</span>
      <button class="tutorial-card-close" onclick="stopTutorial()">✕</button>
    </div>
    <div class="tutorial-card-body">
      ${step.body}
    </div>
    <div class="tutorial-card-footer">
      <div style="display: flex; flex-direction: column; gap: 4px;">
        <span class="tutorial-steps-indicator">Schritt ${index + 1} von ${tutorialSteps.length}</span>
        <div class="tutorial-steps-dots">${dotsHtml}</div>
      </div>
      <div class="tutorial-actions">
        ${index > 0 ? `<button class="tutorial-btn tutorial-btn-sec" id="tut-prev">Zurück</button>` : ''}
        <button class="tutorial-btn tutorial-btn-pri" id="tut-next">
          ${index === tutorialSteps.length - 1 ? 'Fertigstellen 🎉' : 'Weiter'}
        </button>
      </div>
    </div>
  `;

  // Position card
  setTimeout(() => {
    const cardRect = card.getBoundingClientRect();
    let targetRect = { 
      top: window.innerHeight / 2 - cardRect.height / 2, 
      left: window.innerWidth / 2 - cardRect.width / 2, 
      right: window.innerWidth / 2 + cardRect.width / 2, 
      bottom: window.innerHeight / 2 + cardRect.height / 2, 
      width: 0, 
      height: 0 
    };
    
    if (targetEl) {
      targetRect = targetEl.getBoundingClientRect();
    }

    const pos = step.position(targetRect, cardRect.width, cardRect.height);
    
    // Boundary check
    let top = pos.top;
    let left = pos.left;

    if (top + cardRect.height > window.innerHeight) {
      top = window.innerHeight - cardRect.height - 20;
    }
    if (top < 10) top = 10;
    
    if (left + cardRect.width > window.innerWidth) {
      left = window.innerWidth - cardRect.width - 20;
    }
    if (left < 10) left = 10;

    card.style.top = `${top}px`;
    card.style.left = `${left}px`;
  }, 30);

  // Bind actions
  const prevBtn = card.querySelector("#tut-prev");
  if (prevBtn) {
    prevBtn.addEventListener("click", () => {
      currentTutorialStep--;
      showTutorialStep(currentTutorialStep);
    });
  }

  const nextBtn = card.querySelector("#tut-next");
  if (nextBtn) {
    nextBtn.addEventListener("click", () => {
      if (index === tutorialSteps.length - 1) {
        stopTutorial();
        const status = document.getElementById("status");
        if (status) {
          status.textContent = "🎉 Onboarding abgeschlossen! Du bist startklar.";
          status.className = "status ok";
        }
      } else {
        currentTutorialStep++;
        showTutorialStep(currentTutorialStep);
      }
    });
  }
}

// Make globally accessible since card close uses inline onclick="stopTutorial()"
window.stopTutorial = stopTutorial;

/* ---------------------------------------------------------------- Init */
buildPalette();
bindPaletteSearch();
bindGenModal();
bindDeployModal();
bindTutorial();
applyTransform();
pushState();
checkAndPromptAutosave();

// Auto-start onboarding for first-time visitors who don't have anything configured
setTimeout(() => {
  const completed = localStorage.getItem("haystack_onboarding_completed");
  if (!completed && APP.nodes.length === 0) {
    startTutorial();
    localStorage.setItem("haystack_onboarding_completed", "true");
  }
}, 1200);