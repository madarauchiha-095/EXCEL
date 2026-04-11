import L from "leaflet";
import "leaflet/dist/leaflet.css";
import { buildRoutePlan, routeMetrics } from "./routePlanner.js";

/* ================= CONFIG ================= */

const PICKUP_THRESHOLD = 3000;
const DELIVERY_THRESHOLD = 3000;
const SPEED = 50;
const STEP = 2;
const STORAGE_KEY = "delivery-routing-dashboard-v2";

const SAMPLE_ORDERS = [
  {
    name: "MG Road to Indiranagar",
    pickup: { lat: 12.9759, lng: 77.6057 },
    drop: { lat: 12.9719, lng: 77.6412 },
  },
  {
    name: "Koramangala to HSR",
    pickup: { lat: 12.9352, lng: 77.6245 },
    drop: { lat: 12.9121, lng: 77.6446 },
  },
  {
    name: "Malleshwaram to Hebbal",
    pickup: { lat: 13.0031, lng: 77.5643 },
    drop: { lat: 13.0358, lng: 77.5970 },
  },
];

/* ================= MAP ================= */

const map = L.map("map").setView([12.9716, 77.5946], 13);
L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
  attribution: "© OpenStreetMap contributors",
}).addTo(map);

/* ================= STATE ================= */

const agent = {
  lat: 12.9716,
  lng: 77.5946,
  marker: L.marker([12.9716, 77.5946]).addTo(map),
};

let timer = null;
let polyline = null;
let activeGroup = [];
let holdQueue = [];
let allOrders = [];
let orderLogs = [];
let deliveryLogs = [];
let routePlan = [];
let legIndex = 0;
let legCursor = 0;
let lastPairingPassed = null;
let currentMetrics = { distance: 0, duration: 0 };
let osrmState = "Unknown";
let isPaused = false;
let isRouting = false;
let recomputeQueued = false;

/* ================= UI ================= */

const dashboard = {
  clock: document.getElementById("dashboardClock"),
  metricOrders: document.getElementById("metricOrders"),
  metricDelivered: document.getElementById("metricDelivered"),
  metricActive: document.getElementById("metricActive"),
  metricQueue: document.getElementById("metricQueue"),
  metricDistance: document.getElementById("metricDistance"),
  metricEta: document.getElementById("metricEta"),
  pairingStatus: document.getElementById("pairingStatus"),
  agentStatus: document.getElementById("agentStatus"),
  routeLeg: document.getElementById("routeLeg"),
  agentPosition: document.getElementById("agentPosition"),
  osrmStatus: document.getElementById("osrmStatus"),
  orderBoard: document.getElementById("orderBoard"),
  orderLogs: document.getElementById("orderLogs"),
  deliveryLogs: document.getElementById("deliveryLogs"),
  orderLogCount: document.getElementById("orderLogCount"),
  deliveryLogCount: document.getElementById("deliveryLogCount"),
  toastHost: document.getElementById("toastHost"),
  pauseButton: document.getElementById("pauseButton"),
  resetButton: document.getElementById("resetButton"),
  clearLogsButton: document.getElementById("clearLogsButton"),
  exportLogsButton: document.getElementById("exportLogsButton"),
  sampleOrders: document.getElementById("sampleOrders"),
};

function setStatus(msg) {
  document.getElementById("status").innerText = msg;
  dashboard.agentStatus.innerText = msg;
}

function toast(message, badge = "active") {
  const node = document.createElement("div");
  node.className = `toast ${badge}`;
  node.textContent = message;
  dashboard.toastHost.appendChild(node);
  setTimeout(() => node.remove(), 3200);
}

function orderLabel(order) {
  return `#${String(order.id).slice(-6)}`;
}

function formatTime(date) {
  return new Intl.DateTimeFormat("en-IN", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).format(new Date(date));
}

function formatPoint(point) {
  return `${point.lat.toFixed(4)}, ${point.lng.toFixed(4)}`;
}

function formatDistance(meters) {
  if (!meters) return "0 km";
  return `${(meters / 1000).toFixed(1)} km`;
}

function formatEta(seconds) {
  if (!seconds) return "0 min";
  return `${Math.max(1, Math.round(seconds / 60))} min`;
}

function persistDashboard() {
  const payload = {
    allOrders: allOrders.map(order => ({
      id: order.id,
      pickup: order.pickup,
      drop: order.drop,
      picked: order.picked,
      delivered: order.delivered,
      statusText: order.statusText,
      statusKey: order.statusKey,
    })),
    orderLogs,
    deliveryLogs,
  };
  localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
}

function restoreDashboard() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return;
    const payload = JSON.parse(raw);
    allOrders = Array.isArray(payload.allOrders) ? payload.allOrders : [];
    orderLogs = Array.isArray(payload.orderLogs) ? payload.orderLogs : [];
    deliveryLogs = Array.isArray(payload.deliveryLogs) ? payload.deliveryLogs : [];
  } catch {
    localStorage.removeItem(STORAGE_KEY);
  }
}

function addOrderLog(message, order, badge = "active") {
  orderLogs.unshift({ time: new Date().toISOString(), message, orderId: order?.id, badge });
  orderLogs = orderLogs.slice(0, 24);
  persistDashboard();
  renderDashboard();
}

function addDeliveryLog(message, order, badge = "routing") {
  deliveryLogs.unshift({ time: new Date().toISOString(), message, orderId: order?.id, badge });
  deliveryLogs = deliveryLogs.slice(0, 24);
  persistDashboard();
  renderDashboard();
}

function renderLogRows(logs, emptyText) {
  if (logs.length === 0) {
    return `<div class="empty">${emptyText}</div>`;
  }

  return logs.map(log => `
    <div class="log-row">
      <div class="log-main">
        <span class="log-message">${log.message}</span>
        <span class="badge ${log.badge}">${log.badge}</span>
      </div>
      <div class="log-meta">
        ${formatTime(log.time)}${log.orderId ? ` · Order #${String(log.orderId).slice(-6)}` : ""}
      </div>
    </div>
  `).join("");
}

function renderOrderBoard() {
  const visibleOrders = [
    ...activeGroup.map(order => ({ order, lane: "Active" })),
    ...holdQueue.map(order => ({ order, lane: "Queued" })),
  ];

  if (visibleOrders.length === 0) {
    dashboard.orderBoard.innerHTML = `<div class="empty">Click the map twice or load a sample order.</div>`;
    return;
  }

  dashboard.orderBoard.innerHTML = visibleOrders.map(({ order, lane }) => `
    <div class="order-row">
      <div class="order-main">
        <span class="order-id">Order ${orderLabel(order)}</span>
        <span class="badge ${order.statusKey || "active"}">${order.statusText || lane}</span>
      </div>
      <div class="order-meta">
        ${lane} · Pickup ${formatPoint(order.pickup)} · Drop ${formatPoint(order.drop)}
      </div>
    </div>
  `).join("");
}

function renderDashboard() {
  const delivered = allOrders.filter(order => order.delivered).length;
  const active = activeGroup.filter(order => !order.delivered).length;

  dashboard.metricOrders.innerText = allOrders.length;
  dashboard.metricDelivered.innerText = delivered;
  dashboard.metricActive.innerText = active;
  dashboard.metricQueue.innerText = holdQueue.length;
  dashboard.metricDistance.innerText = formatDistance(currentMetrics.distance);
  dashboard.metricEta.innerText = formatEta(currentMetrics.duration);
  dashboard.agentPosition.innerText = formatPoint(agent);
  dashboard.osrmStatus.innerText = osrmState;
  dashboard.osrmStatus.className = `value health ${osrmState.toLowerCase()}`;
  dashboard.pauseButton.innerText = isPaused ? "Resume" : "Pause";

  if (lastPairingPassed === true) {
    dashboard.pairingStatus.innerText = "Pairing passed";
  } else if (lastPairingPassed === false) {
    dashboard.pairingStatus.innerText = "Pairing skipped";
  } else {
    dashboard.pairingStatus.innerText = "Pairing idle";
  }

  renderOrderBoard();
  dashboard.orderLogs.innerHTML = renderLogRows(orderLogs, "No order events yet.");
  dashboard.deliveryLogs.innerHTML = renderLogRows(deliveryLogs, "No delivery events yet.");
  dashboard.orderLogCount.innerText = `${orderLogs.length} events`;
  dashboard.deliveryLogCount.innerText = `${deliveryLogs.length} events`;
}

function updateClock() {
  dashboard.clock.innerText = new Intl.DateTimeFormat("en-IN", {
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date());
}

/* ================= MARKERS ================= */

function mapIcon(type) {
  return L.divIcon({
    className: `map-pin ${type}`,
    html: `<span>${type === "pickup" ? "P" : "D"}</span>`,
    iconSize: [28, 28],
    iconAnchor: [14, 14],
  });
}

function pickupMarker(p) {
  return L.marker(p, { icon: mapIcon("pickup") }).addTo(map);
}

function dropMarker(p) {
  return L.marker(p, { icon: mapIcon("drop") }).addTo(map);
}

/* ================= OSRM ================= */

function setOsrmState(state) {
  osrmState = state;
  renderDashboard();
}

async function route(a, b) {
  const url = `http://localhost:5000/route/v1/driving/${a};${b}?overview=full&geometries=geojson`;
  try {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`OSRM responded with ${res.status}`);
    const data = await res.json();
    if (!data.routes || data.routes.length === 0) throw new Error("No route found");
    setOsrmState("Connected");
    return data.routes[0];
  } catch (error) {
    setOsrmState("Down");
    throw error;
  }
}

async function checkOsrmHealth() {
  try {
    await route("77.5946,12.9716", "77.6200,12.9800");
  } catch {
    setStatus("OSRM is down. Start Docker on port 5000.");
  }
}

/* ================= INPUT ================= */

let clickBuf = [];

function createOrder(pickup, drop) {
  const order = {
    id: Date.now(),
    pickup,
    drop,
    picked: false,
    delivered: false,
    statusText: "New",
    statusKey: "accepted",
  };

  order.pm = pickupMarker(order.pickup);
  order.dm = dropMarker(order.drop);
  allOrders.push(order);
  persistDashboard();
  onNewOrder(order);
}

map.on("click", e => {
  clickBuf.push(e.latlng);
  toast(clickBuf.length === 1 ? "Pickup selected. Click a drop point." : "Drop selected.", "active");
  if (clickBuf.length !== 2) return;

  createOrder(clickBuf[0], clickBuf[1]);
  clickBuf = [];
});

function loadSampleOrder(index) {
  const sample = SAMPLE_ORDERS[index];
  if (!sample) return;
  createOrder(sample.pickup, sample.drop);
  toast(sample.name, "accepted");
}

/* ================= DISPATCH ================= */

function onNewOrder(order) {
  if (activeGroup.length < 2) {
    order.statusText = "Accepted";
    order.statusKey = "accepted";
    activeGroup.push(order);
    addOrderLog(`Accepted order ${orderLabel(order)}`, order, "accepted");
    toast(`Order ${orderLabel(order)} accepted`, "accepted");
    recompute();
  } else {
    order.statusText = "Queued";
    order.statusKey = "queued";
    holdQueue.push(order);
    addOrderLog(`Queued order ${orderLabel(order)}`, order, "queued");
    toast(`Order ${orderLabel(order)} queued`, "queued");
    renderDashboard();
  }
}

/* ================= ROUTE PLANNING ================= */

async function recompute() {
  if (isRouting) {
    recomputeQueued = true;
    return;
  }
  if (activeGroup.length === 0) {
    dashboard.routeLeg.innerText = "No active route";
    renderDashboard();
    return;
  }

  isRouting = true;
  setStatus("Routing...");
  dashboard.routeLeg.innerText = "Calculating route";
  addDeliveryLog("Route recalculation started", null, "routing");

  try {
    const result = await buildRoutePlan({
      agent,
      activeGroup,
      routeFn: route,
      pickupThreshold: PICKUP_THRESHOLD,
      deliveryThreshold: DELIVERY_THRESHOLD,
    });

    routePlan = result.plan;
    currentMetrics = result.metrics;
    lastPairingPassed = result.pairingPassed;
    legIndex = 0;
    legCursor = 0;

    for (const message of result.messages) {
      addDeliveryLog(message.text, message.order, message.badge);
    }

    draw(flatten(routePlan));
    renderDashboard();
    startExecution();
  } catch (error) {
    clearInterval(timer);
    setStatus("Routing failed. Check OSRM.");
    dashboard.routeLeg.innerText = error.message || "OSRM route failed";
    addDeliveryLog(`Routing failed: ${error.message || "OSRM unavailable"}`, null, "error");
    toast("Routing failed. Check OSRM Docker.", "error");
  } finally {
    isRouting = false;
    if (recomputeQueued) {
      recomputeQueued = false;
      recompute();
    }
  }
}

/* ================= EXECUTION ================= */

function startExecution() {
  clearInterval(timer);
  if (routePlan.length === 0) {
    finishRoute();
    return;
  }
  legIndex = 0;
  legCursor = 0;
  executeLeg();
}

function executeLeg() {
  if (isPaused) {
    setStatus("Paused");
    return;
  }

  if (legIndex >= routePlan.length) {
    finishRoute();
    return;
  }

  const leg = routePlan[legIndex];
  setStatus(`${leg.type.toUpperCase()} Order ${leg.order.id}`);
  leg.order.statusText = leg.type === "pickup" ? "To pickup" : "To drop";
  leg.order.statusKey = leg.type === "pickup" ? "active" : "picked";
  dashboard.routeLeg.innerText = `${leg.type.toUpperCase()} ${orderLabel(leg.order)} (${legIndex + 1}/${routePlan.length})`;
  renderDashboard();

  timer = setInterval(() => {
    if (isPaused) {
      clearInterval(timer);
      return;
    }

    if (legCursor >= leg.coords.length) {
      clearInterval(timer);
      completeLeg();
      return;
    }

    const [lng, lat] = leg.coords[legCursor];
    agent.lat = lat;
    agent.lng = lng;
    agent.marker.setLatLng([lat, lng]);
    dashboard.agentPosition.innerText = formatPoint(agent);
    legCursor += STEP;
  }, SPEED);
}

function completeLeg() {
  const leg = routePlan[legIndex];
  const order = leg.order;

  if (leg.type === "pickup") {
    order.picked = true;
    order.statusText = "Picked";
    order.statusKey = "picked";
    addDeliveryLog(`Picked up order ${orderLabel(order)}`, order, "picked");
    toast(`Order ${orderLabel(order)} picked up`, "picked");
  }

  if (leg.type === "drop") {
    order.delivered = true;
    order.statusText = "Delivered";
    order.statusKey = "delivered";
    addDeliveryLog(`Delivered order ${orderLabel(order)}`, order, "delivered");
    toast(`Order ${orderLabel(order)} delivered`, "delivered");
    order.pm?.remove();
    order.dm?.remove();
  }

  persistDashboard();
  legIndex++;
  legCursor = 0;
  renderDashboard();
  executeLeg();
}

/* ================= FINISH / HOLD PROMOTION ================= */

function finishRoute() {
  addDeliveryLog("Route finished", null, "delivered");
  activeGroup = activeGroup.filter(order => !order.delivered);

  if (activeGroup.length > 0) {
    renderDashboard();
    return;
  }

  if (holdQueue.length === 0) {
    setStatus("Idle");
    dashboard.routeLeg.innerText = "No active route";
    currentMetrics = routeMetrics([]);
    renderDashboard();
    return;
  }

  const base = holdQueue.shift();
  base.statusText = "Accepted";
  base.statusKey = "accepted";
  activeGroup = [base];
  addOrderLog(`Promoted order ${orderLabel(base)} from queue`, base, "accepted");

  if (holdQueue.length > 0) {
    const incoming = holdQueue.shift();
    incoming.statusText = "Accepted";
    incoming.statusKey = "accepted";
    activeGroup.push(incoming);
    addOrderLog(`Inserted order ${orderLabel(incoming)} into route`, incoming, "accepted");
  }

  recompute();
}

/* ================= CONTROLS ================= */

function togglePause() {
  if (routePlan.length === 0) return;
  isPaused = !isPaused;
  if (!isPaused) executeLeg();
  renderDashboard();
}

function resetSimulation() {
  clearInterval(timer);
  timer = null;
  routePlan = [];
  activeGroup.forEach(order => {
    order.pm?.remove();
    order.dm?.remove();
  });
  holdQueue.forEach(order => {
    order.pm?.remove();
    order.dm?.remove();
  });
  activeGroup = [];
  holdQueue = [];
  legIndex = 0;
  legCursor = 0;
  isPaused = false;
  lastPairingPassed = null;
  currentMetrics = routeMetrics([]);
  if (polyline) map.removeLayer(polyline);
  polyline = null;
  setStatus("Idle");
  dashboard.routeLeg.innerText = "No active route";
  addDeliveryLog("Simulation reset", null, "routing");
  renderDashboard();
}

function clearLogs() {
  orderLogs = [];
  deliveryLogs = [];
  persistDashboard();
  renderDashboard();
}

function exportLogs() {
  const rows = [
    ["type", "time", "order", "status", "message"],
    ...orderLogs.map(log => ["order", log.time, log.orderId || "", log.badge, log.message]),
    ...deliveryLogs.map(log => ["delivery", log.time, log.orderId || "", log.badge, log.message]),
  ];
  const csv = rows.map(row => row.map(cell => `"${String(cell).replaceAll('"', '""')}"`).join(",")).join("\n");
  const blob = new Blob([csv], { type: "text/csv" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = "delivery-logs.csv";
  link.click();
  URL.revokeObjectURL(url);
}

function renderSampleButtons() {
  dashboard.sampleOrders.innerHTML = SAMPLE_ORDERS.map((sample, index) => `
    <button type="button" data-sample="${index}">${sample.name}</button>
  `).join("");
}

/* ================= DRAW ================= */

function flatten(plan) {
  return plan.flatMap(leg => leg.coords);
}

function draw(coords) {
  if (polyline) map.removeLayer(polyline);
  if (coords.length === 0) return;
  polyline = L.polyline(
    coords.map(([lng, lat]) => [lat, lng]),
    { color: "#2563eb", weight: 4 }
  ).addTo(map);
}

/* ================= INIT ================= */

restoreDashboard();
renderSampleButtons();
dashboard.pauseButton.addEventListener("click", togglePause);
dashboard.resetButton.addEventListener("click", resetSimulation);
dashboard.clearLogsButton.addEventListener("click", clearLogs);
dashboard.exportLogsButton.addEventListener("click", exportLogs);
dashboard.sampleOrders.addEventListener("click", event => {
  const button = event.target.closest("[data-sample]");
  if (!button) return;
  loadSampleOrder(Number(button.dataset.sample));
});

updateClock();
renderDashboard();
checkOsrmHealth();
setInterval(updateClock, 30000);
