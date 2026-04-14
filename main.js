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

const agentStates = AGENTS.map(agentConfig => ({
  agent: { ...agentConfig, marker: null },
  activeGroup: [],
  holdQueue: [],
  routePlan: [],
  legIndex: 0,
  legCursor: 0,
  lastPairingPassed: null,
  currentMetrics: routeMetrics([]),
  isPaused: false,
  isRouting: false,
  recomputeQueued: false,
  timer: null,
}));

const state = {
  agentStates,
  allOrders: stored.allOrders,
  orderLogs: stored.orderLogs,
  deliveryLogs: stored.deliveryLogs,
  osrmState: "Unknown",
  isPaused: false,
};

const mapView = createMapView({
  mapId: "map",
  center: agentStates[0].agent,
  onOrderPoints(pickup, drop) {
    if (!drop) {
      dashboard.toast("Pickup selected. Click a drop point.", "active");
      return;
    }
    dashboard.toast("Drop selected.", "active");
    createOrder(pickup, drop);
  },
});

for (const agentState of agentStates) {
  agentState.agent.marker = mapView.createAgentMarker(agentState.agent);
}

const osrm = createOsrmClient({
  onHealthChange(nextState) {
    state.osrmState = nextState;
    render();
  },
});

function persist() {
  saveDashboardState(STORAGE_KEY, state);
}

function render() {
  dashboard.render(state);
}

function allActiveAssignments() {
  return new Map(agentStates.map(agentState => [
    agentState.agent.id,
    agentState.activeGroup,
  ]));
}

function agentStateById(agentId) {
  return agentStates.find(agentState => agentState.agent.id === agentId);
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
  const selectedAgent = selectAgentForOrder(
    order,
    agentStates.map(agentState => agentState.agent),
    allActiveAssignments(),
    DISPATCH_CONSTRAINTS
  ) || agentStates[0].agent;
  const selectedState = agentStateById(selectedAgent.id);

  const result = acceptOrQueueOrder({
    order,
    agent: selectedAgent,
    activeGroup: selectedState.activeGroup,
    holdQueue: selectedState.holdQueue,
    constraints: DISPATCH_CONSTRAINTS,
  });

  if (result.accepted) {
    addOrderLog(`Accepted order ${orderLabel(order)} for ${selectedAgent.label}`, order, "accepted");
    dashboard.toast(`Order ${orderLabel(order)} accepted by ${selectedAgent.label}`, "accepted");
    recomputeAgent(selectedState);
  } else {
    addOrderLog(`Queued order ${orderLabel(order)} for ${selectedAgent.label}`, order, "queued");
    dashboard.toast(`Order ${orderLabel(order)} queued for ${selectedAgent.label}`, "queued");
    render();
  }
}

async function recomputeAgent(agentState) {
  if (agentState.isRouting) {
    agentState.recomputeQueued = true;
    return;
  }

  if (agentState.activeGroup.length === 0) {
    mapView.clearRoute(agentState.agent.id);
    render();
    return;
  }

  agentState.isRouting = true;
  dashboard.setStatus(`${agentState.agent.label} routing...`);
  dashboard.setRouteLeg(`${agentState.agent.label}: calculating route`);
  addDeliveryLog(`${agentState.agent.label} route recalculation started`, null, "routing");

  try {
    const result = await buildRoutePlan({
      agent: agentState.agent,
      activeGroup: agentState.activeGroup,
      routeFn: osrm.route,
      pickupThreshold: PICKUP_THRESHOLD,
      deliveryThreshold: DELIVERY_THRESHOLD,
    });

    agentState.routePlan = result.plan;
    agentState.currentMetrics = result.metrics;
    agentState.lastPairingPassed = result.pairingPassed;
    agentState.legIndex = 0;
    agentState.legCursor = 0;

    for (const message of result.messages) {
      addDeliveryLog(`${agentState.agent.label}: ${message.text}`, message.order, message.badge);
    }

    mapView.drawRoute(agentState.agent.id, flatten(agentState.routePlan), agentState.agent.routeColor);
    render();
    startAgentExecution(agentState);
  } catch (error) {
    clearInterval(agentState.timer);
    dashboard.setStatus(`${agentState.agent.label} routing failed. Check OSRM.`);
    dashboard.setRouteLeg(error.message || "OSRM route failed");
    addDeliveryLog(`${agentState.agent.label} routing failed: ${error.message || "OSRM unavailable"}`, null, "error");
    dashboard.toast(`${agentState.agent.label} routing failed. Check OSRM Docker.`, "error");
  } finally {
    agentState.isRouting = false;
    if (agentState.recomputeQueued) {
      agentState.recomputeQueued = false;
      recomputeAgent(agentState);
    }
  }
}

function startAgentExecution(agentState) {
  clearInterval(agentState.timer);
  if (agentState.routePlan.length === 0) {
    finishAgentRoute(agentState);
    return;
  }
  agentState.legIndex = 0;
  agentState.legCursor = 0;
  executeAgentLeg(agentState);
}

function executeAgentLeg(agentState) {
  if (agentState.isPaused) {
    dashboard.setStatus(`${agentState.agent.label} paused`);
    return;
  }

  if (agentState.legIndex >= agentState.routePlan.length) {
    finishAgentRoute(agentState);
    return;
  }

  const leg = agentState.routePlan[agentState.legIndex];
  dashboard.setStatus(`${agentState.agent.label}: ${leg.type.toUpperCase()} Order ${leg.order.id}`);
  leg.order.statusText = leg.type === "pickup" ? "To pickup" : "To drop";
  leg.order.statusKey = leg.type === "pickup" ? "active" : "picked";
  dashboard.setRouteLeg(`${agentState.agent.label}: ${leg.type.toUpperCase()} ${orderLabel(leg.order)} (${agentState.legIndex + 1}/${agentState.routePlan.length})`);
  render();

  agentState.timer = setInterval(() => {
    if (agentState.isPaused) {
      clearInterval(agentState.timer);
      return;
    }

    if (agentState.legCursor >= leg.coords.length) {
      clearInterval(agentState.timer);
      completeAgentLeg(agentState);
      return;
    }

    const [lng, lat] = leg.coords[agentState.legCursor];
    agentState.agent.lat = lat;
    agentState.agent.lng = lng;
    mapView.updateAgentMarker(agentState.agent);
    agentState.legCursor += STEP;
  }, SPEED);
}

function completeAgentLeg(agentState) {
  const leg = agentState.routePlan[agentState.legIndex];
  const order = leg.order;

  if (leg.type === "pickup") {
    order.picked = true;
    order.statusText = "Picked";
    order.statusKey = "picked";
    addDeliveryLog(`${agentState.agent.label} picked up order ${orderLabel(order)}`, order, "picked");
    dashboard.toast(`${agentState.agent.label} picked up ${orderLabel(order)}`, "picked");
  }

  if (leg.type === "drop") {
    order.delivered = true;
    order.statusText = "Delivered";
    order.statusKey = "delivered";
    addDeliveryLog(`${agentState.agent.label} delivered order ${orderLabel(order)}`, order, "delivered");
    dashboard.toast(`${agentState.agent.label} delivered ${orderLabel(order)}`, "delivered");
    order.pm?.remove();
    order.dm?.remove();
  }

  persist();
  agentState.legIndex++;
  agentState.legCursor = 0;
  render();
  executeAgentLeg(agentState);
}

function finishAgentRoute(agentState) {
  addDeliveryLog(`${agentState.agent.label} route finished`, null, "delivered");
  agentState.activeGroup = agentState.activeGroup.filter(order => !order.delivered);

  if (agentState.activeGroup.length === 0) {
    const promoted = promoteQueuedOrders({
      activeGroup: agentState.activeGroup,
      holdQueue: agentState.holdQueue,
      agent: agentState.agent,
      constraints: DISPATCH_CONSTRAINTS,
    });

    for (const order of promoted) {
      addOrderLog(`Promoted order ${orderLabel(order)} for ${agentState.agent.label}`, order, "accepted");
    }
  }

  if (agentState.activeGroup.length === 0) {
    agentState.routePlan = [];
    agentState.currentMetrics = routeMetrics([]);
    agentState.lastPairingPassed = null;
    mapView.clearRoute(agentState.agent.id);
    dashboard.setStatus("Idle");
    dashboard.setRouteLeg("No active route");
    render();
    return;
  }

  recomputeAgent(agentState);
}

function togglePauseAll() {
  const shouldPause = !state.isPaused;
  state.isPaused = shouldPause;
  for (const agentState of agentStates) {
    agentState.isPaused = shouldPause;
    if (!shouldPause && agentState.routePlan.length > 0) {
      executeAgentLeg(agentState);
    }
  }
  render();
}

function resetSimulation() {
  for (const agentState of agentStates) {
    clearInterval(agentState.timer);
    agentState.timer = null;
    agentState.routePlan = [];
    agentState.activeGroup.forEach(order => {
      order.pm?.remove();
      order.dm?.remove();
    });
    agentState.holdQueue.forEach(order => {
      order.pm?.remove();
      order.dm?.remove();
    });
    agentState.activeGroup = [];
    agentState.holdQueue = [];
    agentState.legIndex = 0;
    agentState.legCursor = 0;
    agentState.isPaused = false;
    agentState.lastPairingPassed = null;
    agentState.currentMetrics = routeMetrics([]);
    mapView.clearRoute(agentState.agent.id);
  }

  state.isPaused = false;
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
dashboard.els.pauseButton.addEventListener("click", togglePauseAll);
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
