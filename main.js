/* ================= CONFIG ================= */

const PICKUP_THRESHOLD = 3000;   // meters
const DELIVERY_THRESHOLD = 3000; // meters
const SPEED = 50;
const STEP = 2;

/* ================= MAP ================= */

const map = L.map("map").setView([12.9716, 77.5946], 13);
L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
  attribution: "© OpenStreetMap contributors",
}).addTo(map);

/* ================= AGENT ================= */

const agent = {
  lat: 12.9716,
  lng: 77.5946,
  marker: L.marker([12.9716, 77.5946]).addTo(map),
};

let timer = null;
let polyline = null;

/* ================= DISPATCH STATE ================= */

let activeGroup = [];   // max 2
let holdQueue = [];
let lastPairingPassed = null;
let allOrders = [];
let orderLogs = [];
let deliveryLogs = [];

/* ================= EXECUTION STATE ================= */

let routePlan = [];
let legIndex = 0;
let legCursor = 0;

/* ================= UI ================= */

const dashboard = {
  clock: document.getElementById("dashboardClock"),
  metricOrders: document.getElementById("metricOrders"),
  metricDelivered: document.getElementById("metricDelivered"),
  metricActive: document.getElementById("metricActive"),
  metricQueue: document.getElementById("metricQueue"),
  pairingStatus: document.getElementById("pairingStatus"),
  agentStatus: document.getElementById("agentStatus"),
  routeLeg: document.getElementById("routeLeg"),
  agentPosition: document.getElementById("agentPosition"),
  orderBoard: document.getElementById("orderBoard"),
  orderLogs: document.getElementById("orderLogs"),
  deliveryLogs: document.getElementById("deliveryLogs"),
  orderLogCount: document.getElementById("orderLogCount"),
  deliveryLogCount: document.getElementById("deliveryLogCount"),
};

function status(msg) {
  document.getElementById("status").innerText = msg;
  dashboard.agentStatus.innerText = msg;
}
function popup(msg) {
  alert(msg);
}

function orderLabel(order) {
  return `#${String(order.id).slice(-6)}`;
}

function formatTime(date) {
  return new Intl.DateTimeFormat("en-IN", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).format(date);
}

function formatPoint(point) {
  return `${point.lat.toFixed(4)}, ${point.lng.toFixed(4)}`;
}

function addOrderLog(message, order, badge = "active") {
  orderLogs.unshift({
    time: new Date(),
    message,
    orderId: order?.id,
    badge,
  });
  orderLogs = orderLogs.slice(0, 12);
  renderDashboard();
}

function addDeliveryLog(message, order, badge = "routing") {
  deliveryLogs.unshift({
    time: new Date(),
    message,
    orderId: order?.id,
    badge,
  });
  deliveryLogs = deliveryLogs.slice(0, 12);
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
    dashboard.orderBoard.innerHTML = `<div class="empty">Click the map twice to create an order.</div>`;
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
  dashboard.agentPosition.innerText = formatPoint(agent);

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

function pickupMarker(p) {
  return L.marker(p, {
    icon: L.icon({
      iconUrl: "https://maps.google.com/mapfiles/ms/icons/green-dot.png",
      iconSize: [32, 32],
    }),
  }).addTo(map);
}
function dropMarker(p) {
  return L.marker(p, {
    icon: L.icon({
      iconUrl: "https://maps.google.com/mapfiles/ms/icons/red-dot.png",
      iconSize: [32, 32],
    }),
  }).addTo(map);
}

/* ================= OSRM ================= */

async function route(a, b) {
  const url = `http://localhost:5000/route/v1/driving/${a};${b}?overview=full&geometries=geojson`;
  const res = await fetch(url);
  return (await res.json()).routes[0];
}

/* ================= DISTANCE ================= */

function hav(a, b) {
  const R = 6371000;
  const dLat = (b.lat - a.lat) * Math.PI / 180;
  const dLng = (b.lng - a.lng) * Math.PI / 180;
  const x =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(a.lat * Math.PI / 180) *
    Math.cos(b.lat * Math.PI / 180) *
    Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.atan2(Math.sqrt(x), Math.sqrt(1 - x));
}

function distToRoute(p, coords) {
  let min = Infinity;
  for (const [lng, lat] of coords) {
    min = Math.min(min, hav(p, { lat, lng }));
  }
  return min;
}

/* ================= INPUT ================= */

let clickBuf = [];

map.on("click", e => {
  clickBuf.push(e.latlng);
  if (clickBuf.length !== 2) return;

  const order = {
    id: Date.now(),
    pickup: clickBuf[0],
    drop: clickBuf[1],
    picked: false,
    delivered: false,
    statusText: "New",
    statusKey: "accepted",
  };

  order.pm = pickupMarker(order.pickup);
  order.dm = dropMarker(order.drop);

  clickBuf = [];
  allOrders.push(order);
  onNewOrder(order);
});

/* ================= DISPATCH ================= */

function onNewOrder(order) {
  console.log(`📥 New order ${order.id}`);

  if (activeGroup.length < 2) {
    order.statusText = "Accepted";
    order.statusKey = "accepted";
    activeGroup.push(order);
    addOrderLog(`Accepted order ${orderLabel(order)}`, order, "accepted");
    popup(`📦 Order ${order.id} accepted`);
    recompute();
  } else {
    order.statusText = "Queued";
    order.statusKey = "queued";
    holdQueue.push(order);
    addOrderLog(`Queued order ${orderLabel(order)}`, order, "queued");
    popup(`🕓 Order ${order.id} on hold`);
    renderDashboard();
  }
}

/* ================= ROUTE PLANNING ================= */

async function recompute() {
  if (activeGroup.length === 0) {
    dashboard.routeLeg.innerText = "No active route";
    renderDashboard();
    return;
  }

  console.group("🧠 Routing");
  console.log("Active:", activeGroup.map(o => o.id));
  console.log("Hold:", holdQueue.map(o => o.id));
  status("Routing...");
  dashboard.routeLeg.innerText = "Calculating route";
  addDeliveryLog("Route recalculation started", null, "routing");

  routePlan = [];
  legIndex = 0;

  const start = `${agent.lng},${agent.lat}`;

  /* ---------- SINGLE ORDER ---------- */
  if (activeGroup.length === 1) {
    const o = activeGroup[0];
    o.statusText = o.picked ? "Dropping" : "Active";
    o.statusKey = "active";

    const r1 = await route(start, `${o.pickup.lng},${o.pickup.lat}`);
    const r2 = await route(
      `${o.pickup.lng},${o.pickup.lat}`,
      `${o.drop.lng},${o.drop.lat}`
    );

    routePlan.push({ type: "pickup", order: o, coords: r1.geometry.coordinates });
    routePlan.push({ type: "drop", order: o, coords: r2.geometry.coordinates });
  }

  /* ---------- TWO ORDERS (ACTIVE + INCOMING) ---------- */
  if (activeGroup.length === 2) {
    const [o1, o2] = activeGroup;
    o1.statusText = o1.picked ? "Dropping" : "Active";
    o1.statusKey = "active";
    o2.statusText = o2.picked ? "Dropping" : "Active";
    o2.statusKey = "active";

    const rA1 = await route(start, `${o1.pickup.lng},${o1.pickup.lat}`);
    const rA2 = await route(
      `${o1.pickup.lng},${o1.pickup.lat}`,
      `${o1.drop.lng},${o1.drop.lat}`
    );

    const baseCoords = [...rA1.geometry.coordinates, ...rA2.geometry.coordinates];
    const dP2 = distToRoute(o2.pickup, baseCoords);

    console.log(`Pickup constraint: ${dP2.toFixed(0)} m`);

    if (dP2 <= PICKUP_THRESHOLD) {
      lastPairingPassed = true;
      addDeliveryLog(`Pickup pairing passed for ${orderLabel(o2)}`, o2, "pairing");

      const rP1P2 = await route(
        `${o1.pickup.lng},${o1.pickup.lat}`,
        `${o2.pickup.lng},${o2.pickup.lat}`
      );

      const rP2D1 = await route(
        `${o2.pickup.lng},${o2.pickup.lat}`,
        `${o1.drop.lng},${o1.drop.lat}`
      );

      const testCoords = [
        ...rP1P2.geometry.coordinates,
        ...rP2D1.geometry.coordinates,
      ];

      const dD2 = distToRoute(o2.drop, testCoords);
      console.log(`Delivery constraint: ${dD2.toFixed(0)} m`);

      if (dD2 <= DELIVERY_THRESHOLD) {
        addDeliveryLog(`Delivery pairing passed for ${orderLabel(o2)}`, o2, "pairing");
        const rP2D2 = await route(
          `${o2.pickup.lng},${o2.pickup.lat}`,
          `${o2.drop.lng},${o2.drop.lat}`
        );
        const rD2D1 = await route(
          `${o2.drop.lng},${o2.drop.lat}`,
          `${o1.drop.lng},${o1.drop.lat}`
        );

        routePlan.push({ type: "pickup", order: o1, coords: rA1.geometry.coordinates });
        routePlan.push({ type: "pickup", order: o2, coords: rP1P2.geometry.coordinates });
        routePlan.push({ type: "drop", order: o2, coords: rP2D2.geometry.coordinates });
        routePlan.push({ type: "drop", order: o1, coords: rD2D1.geometry.coordinates });
      } else {
        addDeliveryLog(`Delivery pairing skipped for ${orderLabel(o2)}`, o2, "routing");
        const rD1D2 = await route(
          `${o1.drop.lng},${o1.drop.lat}`,
          `${o2.drop.lng},${o2.drop.lat}`
        );

        routePlan.push({ type: "pickup", order: o1, coords: rA1.geometry.coordinates });
        routePlan.push({ type: "pickup", order: o2, coords: rP1P2.geometry.coordinates });
        routePlan.push({ type: "drop", order: o1, coords: rP2D1.geometry.coordinates });
        routePlan.push({ type: "drop", order: o2, coords: rD1D2.geometry.coordinates });
      }
    } else {
      lastPairingPassed = false;
      addDeliveryLog(`Pickup pairing skipped for ${orderLabel(o2)}`, o2, "routing");

      const rD1P2 = await route(
        `${o1.drop.lng},${o1.drop.lat}`,
        `${o2.pickup.lng},${o2.pickup.lat}`
      );
      const rP2D2 = await route(
        `${o2.pickup.lng},${o2.pickup.lat}`,
        `${o2.drop.lng},${o2.drop.lat}`
      );

      routePlan.push({ type: "pickup", order: o1, coords: rA1.geometry.coordinates });
      routePlan.push({ type: "drop", order: o1, coords: rA2.geometry.coordinates });
      routePlan.push({ type: "pickup", order: o2, coords: rD1P2.geometry.coordinates });
      routePlan.push({ type: "drop", order: o2, coords: rP2D2.geometry.coordinates });
    }
  }

  console.groupEnd();
  renderDashboard();
  draw(flatten(routePlan));
  startExecution();
}

/* ================= EXECUTION ================= */

function startExecution() {
  clearInterval(timer);
  legIndex = 0;
  legCursor = 0;
  executeLeg();
}

function executeLeg() {
  if (legIndex >= routePlan.length) {
    finishRoute();
    return;
  }

  const leg = routePlan[legIndex];
  status(`${leg.type.toUpperCase()} Order ${leg.order.id}`);
  leg.order.statusText = leg.type === "pickup" ? "To pickup" : "To drop";
  leg.order.statusKey = leg.type === "pickup" ? "active" : "picked";
  dashboard.routeLeg.innerText = `${leg.type.toUpperCase()} ${orderLabel(leg.order)} (${legIndex + 1}/${routePlan.length})`;
  renderDashboard();

  timer = setInterval(() => {
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
  const o = leg.order;

  if (leg.type === "pickup") {
    o.picked = true;
    o.statusText = "Picked";
    o.statusKey = "picked";
    addDeliveryLog(`Picked up order ${orderLabel(o)}`, o, "picked");
    popup(`📦 Order ${o.id} picked up`);
  }

  if (leg.type === "drop") {
    o.delivered = true;
    o.statusText = "Delivered";
    o.statusKey = "delivered";
    addDeliveryLog(`Delivered order ${orderLabel(o)}`, o, "delivered");
    popup(`✅ Order ${o.id} delivered`);
    o.pm.remove();
    o.dm.remove();
  }

  legIndex++;
  legCursor = 0;
  renderDashboard();
  executeLeg();
}

/* ================= FINISH / HOLD PROMOTION ================= */

function finishRoute() {
  console.log("🧹 Route finished");
  addDeliveryLog("Route finished", null, "delivered");

  // Remove delivered orders
  activeGroup = activeGroup.filter(o => !o.delivered);

  // If something is still active, do nothing
  if (activeGroup.length > 0) {
    renderDashboard();
    return;
  }

  // No held orders → idle
  if (holdQueue.length === 0) {
    status("Idle");
    dashboard.routeLeg.innerText = "No active route";
    renderDashboard();
    return;
  }

  // Promote first hold as new base order
  const base = holdQueue.shift();
  base.statusText = "Accepted";
  base.statusKey = "accepted";
  activeGroup = [base];
  console.log(`⬆ Promoted ${base.id} as solo active order`);
  addOrderLog(`Promoted order ${orderLabel(base)} from queue`, base, "accepted");

  // If another held order exists, treat it as incoming
  if (holdQueue.length > 0) {
    const incoming = holdQueue.shift();
    incoming.statusText = "Accepted";
    incoming.statusKey = "accepted";
    console.log(`➕ Inserting ${incoming.id} as incoming`);
    activeGroup.push(incoming);
    addOrderLog(`Inserted order ${orderLabel(incoming)} into route`, incoming, "accepted");
  }

  // Always recompute after promotion
  recompute();
}


/* ================= DRAW ================= */

function flatten(plan) {
  return plan.flatMap(l => l.coords);
}

function draw(coords) {
  if (polyline) map.removeLayer(polyline);
  polyline = L.polyline(
    coords.map(([lng, lat]) => [lat, lng]),
    { color: "blue", weight: 4 }
  ).addTo(map);
}

updateClock();
renderDashboard();
setInterval(updateClock, 30000);
