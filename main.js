import {
  AGENTS,
  DELIVERY_THRESHOLD,
  DISPATCH_CONSTRAINTS,
  PICKUP_THRESHOLD,
  SAMPLE_ORDERS,
  SPEED,
  STEP,
  STORAGE_KEY,
} from "./config.js";
import { createDashboard, orderLabel } from "./dashboard.js";
import { acceptOrQueueOrder, promoteQueuedOrders, selectAgentForOrder } from "./dispatchEngine.js";
import { createMapView } from "./mapView.js";
import { createOsrmClient } from "./osrmClient.js";
import { buildRoutePlan, routeMetrics } from "./routePlanner.js";
import { loadDashboardState, saveDashboardState } from "./storage.js";

const dashboard = createDashboard();
const stored = loadDashboardState(STORAGE_KEY);

const agent = {
  ...AGENTS[0],
  marker: null,
};

const state = {
  agent,
  agents: [agent],
  activeGroup: [],
  holdQueue: [],
  allOrders: stored.allOrders,
  orderLogs: stored.orderLogs,
  deliveryLogs: stored.deliveryLogs,
  routePlan: [],
  legIndex: 0,
  legCursor: 0,
  lastPairingPassed: null,
  currentMetrics: routeMetrics([]),
  osrmState: "Unknown",
  isPaused: false,
  isRouting: false,
  recomputeQueued: false,
};

let timer = null;

function persist() {
  saveDashboardState(STORAGE_KEY, state);
}

function render() {
  dashboard.render(state);
}

function addOrderLog(message, order, badge = "active") {
  state.orderLogs.unshift({ time: new Date().toISOString(), message, orderId: order?.id, badge });
  state.orderLogs = state.orderLogs.slice(0, 24);
  persist();
  render();
}

function addDeliveryLog(message, order, badge = "routing") {
  state.deliveryLogs.unshift({ time: new Date().toISOString(), message, orderId: order?.id, badge });
  state.deliveryLogs = state.deliveryLogs.slice(0, 24);
  persist();
  render();
}

const mapView = createMapView({
  mapId: "map",
  center: agent,
  onOrderPoints(pickup, drop) {
    if (!drop) {
      dashboard.toast("Pickup selected. Click a drop point.", "active");
      return;
    }
    dashboard.toast("Drop selected.", "active");
    createOrder(pickup, drop);
  },
});

agent.marker = mapView.createAgentMarker(agent);

const osrm = createOsrmClient({
  onHealthChange(nextState) {
    state.osrmState = nextState;
    render();
  },
});

function createOrder(pickup, drop, options = {}) {
  const order = {
    id: Date.now(),
    pickup,
    drop,
    picked: false,
    delivered: false,
    priority: options.priority || "normal",
    createdAt: new Date().toISOString(),
    statusText: "New",
    statusKey: "accepted",
  };

  order.pm = mapView.pickupMarker(order.pickup);
  order.dm = mapView.dropMarker(order.drop);
  state.allOrders.push(order);
  persist();
  onNewOrder(order);
}

function onNewOrder(order) {
  const assignments = new Map([[agent.id, state.activeGroup]]);
  const selectedAgent = selectAgentForOrder(
    order,
    state.agents,
    assignments,
    DISPATCH_CONSTRAINTS
  ) || agent;

  const result = acceptOrQueueOrder({
    order,
    agent: selectedAgent,
    activeGroup: state.activeGroup,
    holdQueue: state.holdQueue,
    constraints: DISPATCH_CONSTRAINTS,
  });

  if (result.accepted) {
    addOrderLog(`Accepted order ${orderLabel(order)} for ${selectedAgent.label}`, order, "accepted");
    dashboard.toast(`Order ${orderLabel(order)} accepted`, "accepted");
    recompute();
  } else {
    addOrderLog(`Queued order ${orderLabel(order)} for ${selectedAgent.label}`, order, "queued");
    dashboard.toast(`Order ${orderLabel(order)} queued`, "queued");
    render();
  }
}

async function recompute() {
  if (state.isRouting) {
    state.recomputeQueued = true;
    return;
  }

  if (state.activeGroup.length === 0) {
    dashboard.setRouteLeg("No active route");
    render();
    return;
  }

  state.isRouting = true;
  dashboard.setStatus("Routing...");
  dashboard.setRouteLeg("Calculating route");
  addDeliveryLog("Route recalculation started", null, "routing");

  try {
    const result = await buildRoutePlan({
      agent,
      activeGroup: state.activeGroup,
      routeFn: osrm.route,
      pickupThreshold: PICKUP_THRESHOLD,
      deliveryThreshold: DELIVERY_THRESHOLD,
    });

    state.routePlan = result.plan;
    state.currentMetrics = result.metrics;
    state.lastPairingPassed = result.pairingPassed;
    state.legIndex = 0;
    state.legCursor = 0;

    for (const message of result.messages) {
      addDeliveryLog(message.text, message.order, message.badge);
    }

    mapView.drawRoute(flatten(state.routePlan));
    render();
    startExecution();
  } catch (error) {
    clearInterval(timer);
    dashboard.setStatus("Routing failed. Check OSRM.");
    dashboard.setRouteLeg(error.message || "OSRM route failed");
    addDeliveryLog(`Routing failed: ${error.message || "OSRM unavailable"}`, null, "error");
    dashboard.toast("Routing failed. Check OSRM Docker.", "error");
  } finally {
    state.isRouting = false;
    if (state.recomputeQueued) {
      state.recomputeQueued = false;
      recompute();
    }
  }
}

function startExecution() {
  clearInterval(timer);
  if (state.routePlan.length === 0) {
    finishRoute();
    return;
  }
  state.legIndex = 0;
  state.legCursor = 0;
  executeLeg();
}

function executeLeg() {
  if (state.isPaused) {
    dashboard.setStatus("Paused");
    return;
  }

  if (state.legIndex >= state.routePlan.length) {
    finishRoute();
    return;
  }

  const leg = state.routePlan[state.legIndex];
  dashboard.setStatus(`${leg.type.toUpperCase()} Order ${leg.order.id}`);
  leg.order.statusText = leg.type === "pickup" ? "To pickup" : "To drop";
  leg.order.statusKey = leg.type === "pickup" ? "active" : "picked";
  dashboard.setRouteLeg(`${leg.type.toUpperCase()} ${orderLabel(leg.order)} (${state.legIndex + 1}/${state.routePlan.length})`);
  render();

  timer = setInterval(() => {
    if (state.isPaused) {
      clearInterval(timer);
      return;
    }

    if (state.legCursor >= leg.coords.length) {
      clearInterval(timer);
      completeLeg();
      return;
    }

    const [lng, lat] = leg.coords[state.legCursor];
    agent.lat = lat;
    agent.lng = lng;
    mapView.updateAgentMarker(agent);
    dashboard.els.agentPosition.innerText = `${lat.toFixed(4)}, ${lng.toFixed(4)}`;
    state.legCursor += STEP;
  }, SPEED);
}

function completeLeg() {
  const leg = state.routePlan[state.legIndex];
  const order = leg.order;

  if (leg.type === "pickup") {
    order.picked = true;
    order.statusText = "Picked";
    order.statusKey = "picked";
    addDeliveryLog(`Picked up order ${orderLabel(order)}`, order, "picked");
    dashboard.toast(`Order ${orderLabel(order)} picked up`, "picked");
  }

  if (leg.type === "drop") {
    order.delivered = true;
    order.statusText = "Delivered";
    order.statusKey = "delivered";
    addDeliveryLog(`Delivered order ${orderLabel(order)}`, order, "delivered");
    dashboard.toast(`Order ${orderLabel(order)} delivered`, "delivered");
    order.pm?.remove();
    order.dm?.remove();
  }

  persist();
  state.legIndex++;
  state.legCursor = 0;
  render();
  executeLeg();
}

function finishRoute() {
  addDeliveryLog("Route finished", null, "delivered");
  state.activeGroup = state.activeGroup.filter(order => !order.delivered);

  if (state.activeGroup.length === 0) {
    const promoted = promoteQueuedOrders({
      activeGroup: state.activeGroup,
      holdQueue: state.holdQueue,
      agent,
      constraints: DISPATCH_CONSTRAINTS,
    });

    for (const order of promoted) {
      addOrderLog(`Promoted order ${orderLabel(order)} from queue`, order, "accepted");
    }
  }

  if (state.activeGroup.length === 0) {
    dashboard.setStatus("Idle");
    dashboard.setRouteLeg("No active route");
    state.currentMetrics = routeMetrics([]);
    render();
    return;
  }

  recompute();
}

function togglePause() {
  if (state.routePlan.length === 0) return;
  state.isPaused = !state.isPaused;
  if (!state.isPaused) executeLeg();
  render();
}

function resetSimulation() {
  clearInterval(timer);
  timer = null;
  state.routePlan = [];
  state.activeGroup.forEach(order => {
    order.pm?.remove();
    order.dm?.remove();
  });
  state.holdQueue.forEach(order => {
    order.pm?.remove();
    order.dm?.remove();
  });
  state.activeGroup = [];
  state.holdQueue = [];
  state.legIndex = 0;
  state.legCursor = 0;
  state.isPaused = false;
  state.lastPairingPassed = null;
  state.currentMetrics = routeMetrics([]);
  mapView.clearRoute();
  dashboard.setStatus("Idle");
  dashboard.setRouteLeg("No active route");
  addDeliveryLog("Simulation reset", null, "routing");
  render();
}

function clearLogs() {
  state.orderLogs = [];
  state.deliveryLogs = [];
  persist();
  render();
}

function exportLogs() {
  const rows = [
    ["type", "time", "order", "status", "message"],
    ...state.orderLogs.map(log => ["order", log.time, log.orderId || "", log.badge, log.message]),
    ...state.deliveryLogs.map(log => ["delivery", log.time, log.orderId || "", log.badge, log.message]),
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

function loadSampleOrder(index) {
  const sample = SAMPLE_ORDERS[index];
  if (!sample) return;
  createOrder(sample.pickup, sample.drop);
  dashboard.toast(sample.name, "accepted");
}

function flatten(plan) {
  return plan.flatMap(leg => leg.coords);
}

async function checkOsrmHealth() {
  try {
    await osrm.healthCheck();
  } catch {
    dashboard.setStatus("OSRM is down. Start Docker on port 5000.");
  }
}

dashboard.renderSampleButtons(SAMPLE_ORDERS);
dashboard.els.pauseButton.addEventListener("click", togglePause);
dashboard.els.resetButton.addEventListener("click", resetSimulation);
dashboard.els.clearLogsButton.addEventListener("click", clearLogs);
dashboard.els.exportLogsButton.addEventListener("click", exportLogs);
dashboard.els.sampleOrders.addEventListener("click", event => {
  const button = event.target.closest("[data-sample]");
  if (!button) return;
  loadSampleOrder(Number(button.dataset.sample));
});

dashboard.updateClock();
render();
checkOsrmHealth();
setInterval(dashboard.updateClock, 30000);
