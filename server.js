import { createServer } from "node:http";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const DATA_DIR = join(__dirname, "data");
const STORE_FILE = join(DATA_DIR, "store.json");
const PORT = Number(process.env.PORT || 3001);
const OSRM_URL = process.env.OSRM_URL || "http://localhost:5000";

const defaultStore = {
  orders: [],
  agents: [
    { id: "agent-1", label: "Agent 1", lat: 12.9716, lng: 77.5946, status: "idle" },
    { id: "agent-2", label: "Agent 2", lat: 12.9352, lng: 77.6245, status: "idle" },
    { id: "agent-3", label: "Agent 3", lat: 13.0031, lng: 77.5643, status: "idle" },
  ],
  logs: [],
};

async function readStore() {
  try {
    const raw = await readFile(STORE_FILE, "utf8");
    return JSON.parse(raw);
  } catch {
    await mkdir(DATA_DIR, { recursive: true });
    await writeFile(STORE_FILE, JSON.stringify(defaultStore, null, 2));
    return structuredClone(defaultStore);
  }
}

async function writeStore(store) {
  await mkdir(DATA_DIR, { recursive: true });
  await writeFile(STORE_FILE, JSON.stringify(store, null, 2));
}

function send(res, status, body) {
  res.writeHead(status, {
    "content-type": "application/json",
    "access-control-allow-origin": "*",
    "access-control-allow-methods": "GET,POST,OPTIONS",
    "access-control-allow-headers": "content-type",
  });
  res.end(JSON.stringify(body));
}

async function readJson(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  if (chunks.length === 0) return {};
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

function validPoint(point) {
  return point &&
    Number.isFinite(Number(point.lat)) &&
    Number.isFinite(Number(point.lng));
}

async function proxyRoute(req, res, url) {
  const start = url.searchParams.get("start");
  const end = url.searchParams.get("end");
  if (!start || !end) {
    send(res, 400, { error: "start and end query params are required" });
    return;
  }

  const target = `${OSRM_URL}/route/v1/driving/${start};${end}?overview=full&geometries=geojson`;
  const routeRes = await fetch(target);
  const data = await routeRes.json();
  send(res, routeRes.ok ? 200 : routeRes.status, data);
}

createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://${req.headers.host}`);

    if (req.method === "OPTIONS") {
      send(res, 204, {});
      return;
    }

    if (req.method === "GET" && url.pathname === "/api/health") {
      send(res, 200, { ok: true, service: "delivery-routing-api" });
      return;
    }

    if (req.method === "GET" && url.pathname === "/api/orders") {
      const store = await readStore();
      send(res, 200, { orders: store.orders });
      return;
    }

    if (req.method === "POST" && url.pathname === "/api/orders") {
      const body = await readJson(req);
      if (!validPoint(body.pickup) || !validPoint(body.drop)) {
        send(res, 400, { error: "pickup and drop must include numeric lat/lng" });
        return;
      }

      const store = await readStore();
      const order = {
        id: Date.now(),
        pickup: body.pickup,
        drop: body.drop,
        status: "created",
        priority: body.priority || "normal",
        createdAt: new Date().toISOString(),
      };
      store.orders.push(order);
      store.logs.push({ type: "order", message: "Order created", orderId: order.id, time: order.createdAt });
      await writeStore(store);
      send(res, 201, { order });
      return;
    }

    if (req.method === "GET" && url.pathname === "/api/agents") {
      const store = await readStore();
      send(res, 200, { agents: store.agents });
      return;
    }

    if (req.method === "GET" && url.pathname === "/api/logs") {
      const store = await readStore();
      send(res, 200, { logs: store.logs });
      return;
    }

    if (req.method === "POST" && url.pathname === "/api/dispatch/recompute") {
      const store = await readStore();
      send(res, 200, {
        ok: true,
        message: "Dispatch recompute endpoint reserved for backend-owned routing.",
        activeOrders: store.orders.filter(order => order.status !== "delivered").length,
      });
      return;
    }

    if (req.method === "GET" && url.pathname === "/api/route") {
      await proxyRoute(req, res, url);
      return;
    }

    send(res, 404, { error: "Not found" });
  } catch (error) {
    send(res, 500, { error: error.message || "Server error" });
  }
}).listen(PORT, () => {
  console.log(`Delivery routing API listening on http://localhost:${PORT}`);
});
