/* =====================
   CONFIG (REALISTIC)
===================== */

const PICKUP_THRESHOLD_METERS = 500;     // insertion constraint
const MAX_DELAY_PERCENT = 0.25;           // 25% max delay
const SPEED_MS = 100;
const STEP_SKIP = 2;

/* =====================
   MAP SETUP
===================== */

const map = L.map("map").setView([12.9716, 77.5946], 13);

L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
  attribution: "© OpenStreetMap contributors",
}).addTo(map);

/* =====================
   AGENT
===================== */

const agent = {
  lat: 12.9716,
  lng: 77.5946,
  status: "idle",
  marker: L.marker([12.9716, 77.5946]).addTo(map),
};

let movementTimer = null;
let activePolyline = null;

/* =====================
   ORDER STATE
===================== */

let activeOrder = null;   // Order A
let pendingOrder = null;  // Order B
let clickBuffer = [];

/* =====================
   UI HELPERS
===================== */

function setStatus(msg) {
  document.getElementById("status").innerText = msg;
}

function popup(msg) {
  alert(msg);
}

/* =====================
   MARKERS
===================== */

function addPickupMarker(latlng) {
  return L.marker(latlng, {
    icon: L.icon({
      iconUrl: "https://maps.google.com/mapfiles/ms/icons/green-dot.png",
      iconSize: [32, 32],
    }),
  }).addTo(map);
}

function addDropMarker(latlng) {
  return L.marker(latlng, {
    icon: L.icon({
      iconUrl: "https://maps.google.com/mapfiles/ms/icons/red-dot.png",
      iconSize: [32, 32],
    }),
  }).addTo(map);
}

/* =====================
   ROUTING (OSRM)
===================== */

async function fetchRoute(start, end) {
  const url = `http://localhost:5000/route/v1/driving/${start};${end}?overview=full&geometries=geojson`;
  const res = await fetch(url);
  const data = await res.json();
  return data.routes[0];
}

/* =====================
   DISTANCE UTILS
===================== */

function haversine(a, b) {
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

function minDistanceToRoute(point, coords) {
  let min = Infinity;
  for (const [lng, lat] of coords) {
    const d = haversine(point, { lat, lng });
    if (d < min) min = d;
  }
  return min;
}

/* =====================
   CLICK → ORDER INPUT
===================== */

map.on("click", async (e) => {
  clickBuffer.push(e.latlng);

  if (clickBuffer.length === 2) {
    const pickup = clickBuffer[0];
    const drop = clickBuffer[1];
    clickBuffer = [];

    const newOrder = {
      pickup,
      drop,
      pickupMarker: addPickupMarker(pickup),
      dropMarker: addDropMarker(drop),
      status: "pending",
    };

    if (!activeOrder) {
      activeOrder = newOrder;
      popup("📦 Order accepted");
      await routeAndMove();
    } else {
      pendingOrder = newOrder;
      popup("📦 New order received");
      pauseAgent();
      setStatus("Recalculating...");
      await routeAndMove();
    }
  }
});

/* =====================
   CORE DYNAMIC ROUTING
===================== */

async function routeAndMove() {
  const start = `${agent.lng},${agent.lat}`;

  const baseRoute = await fetchRoute(
    start,
    `${activeOrder.pickup.lng},${activeOrder.pickup.lat}`
  );

  const pickupDistance = minDistanceToRoute(
    pendingOrder?.pickup,
    baseRoute.geometry.coordinates
  );

  let finalRoute = [];

  // CASE 1: no pending or too far → finish active
  if (!pendingOrder || pickupDistance > PICKUP_THRESHOLD_METERS) {
    const r1 = await fetchRoute(
      start,
      `${activeOrder.pickup.lng},${activeOrder.pickup.lat}`
    );
    const r2 = await fetchRoute(
      `${activeOrder.pickup.lng},${activeOrder.pickup.lat}`,
      `${activeOrder.drop.lng},${activeOrder.drop.lat}`
    );
    finalRoute = [...r1.geometry.coordinates, ...r2.geometry.coordinates];
  } 
  // CASE 2: pickup insertion allowed
  else {
    const planA = await estimatePlan(
      start,
      [pendingOrder, activeOrder]
    );
    const planB = await estimatePlan(
      start,
      [activeOrder, pendingOrder]
    );

    if (planA.delay <= MAX_DELAY_PERCENT) {
      finalRoute = planA.coords;
    } else {
      finalRoute = planB.coords;
    }
  }

  drawRoute(finalRoute);
  moveAgent(finalRoute);
}

/* =====================
   PLAN EVALUATION
===================== */

async function estimatePlan(start, orderSequence) {
  let curr = start;
  let coords = [];
  let total = 0;

  for (const o of orderSequence) {
    const toP = await fetchRoute(curr, `${o.pickup.lng},${o.pickup.lat}`);
    const toD = await fetchRoute(
      `${o.pickup.lng},${o.pickup.lat}`,
      `${o.drop.lng},${o.drop.lat}`
    );

    coords.push(...toP.geometry.coordinates, ...toD.geometry.coordinates);
    total += toP.distance + toD.distance;
    curr = `${o.drop.lng},${o.drop.lat}`;
  }

  const base = await fetchRoute(
    start,
    `${activeOrder.drop.lng},${activeOrder.drop.lat}`
  );

  return {
    coords,
    delay: (total - base.distance) / base.distance,
  };
}

/* =====================
   MOVEMENT
===================== */

function pauseAgent() {
  clearInterval(movementTimer);
  movementTimer = null;
}

function moveAgent(coords) {
  let i = 0;
  agent.status = "moving";
  setStatus("On delivery");

  movementTimer = setInterval(() => {
    if (i >= coords.length) {
      completeOrder();
      return;
    }

    const [lng, lat] = coords[i];
    agent.lat = lat;
    agent.lng = lng;
    agent.marker.setLatLng([lat, lng]);

    i += STEP_SKIP;
  }, SPEED_MS);
}

function completeOrder() {
  clearInterval(movementTimer);
  movementTimer = null;

  popup("✅ Order delivered");

  activeOrder.pickupMarker.remove();
  activeOrder.dropMarker.remove();

  activeOrder = pendingOrder;
  pendingOrder = null;

  agent.status = "idle";
  setStatus("Idle");

  if (activeOrder) routeAndMove();
}

/* =====================
   DRAW ROUTE
===================== */

function drawRoute(coords) {
  if (activePolyline) map.removeLayer(activePolyline);

  activePolyline = L.polyline(
    coords.map(([lng, lat]) => [lat, lng]),
    { color: "blue" }
  ).addTo(map);
}
