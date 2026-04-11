import assert from "node:assert/strict";
import { buildRoutePlan } from "../routePlanner.js";

function parseLngLat(value) {
  const [lng, lat] = value.split(",").map(Number);
  return { lat, lng };
}

function distance(a, b) {
  return Math.hypot(a.lat - b.lat, a.lng - b.lng) * 100000;
}

async function mockRoute(start, end) {
  const a = parseLngLat(start);
  const b = parseLngLat(end);
  return {
    distance: distance(a, b),
    duration: distance(a, b) / 10,
    geometry: {
      coordinates: [
        [a.lng, a.lat],
        [b.lng, b.lat],
      ],
    },
  };
}

function order(id, pickup, drop, state = {}) {
  return {
    id,
    pickup,
    drop,
    picked: false,
    delivered: false,
    ...state,
  };
}

const agent = { lat: 0, lng: 0 };

{
  const first = order(100001, { lat: 1, lng: 0 }, { lat: 2, lng: 0 });
  const result = await buildRoutePlan({
    agent,
    activeGroup: [first],
    routeFn: mockRoute,
    pickupThreshold: 1000000,
    deliveryThreshold: 1000000,
  });

  assert.deepEqual(result.plan.map(leg => leg.type), ["pickup", "drop"]);
  assert.equal(result.plan[0].order.id, first.id);
}

{
  const picked = order(100002, { lat: 1, lng: 0 }, { lat: 2, lng: 0 }, { picked: true });
  const result = await buildRoutePlan({
    agent,
    activeGroup: [picked],
    routeFn: mockRoute,
    pickupThreshold: 1000000,
    deliveryThreshold: 1000000,
  });

  assert.deepEqual(result.plan.map(leg => leg.type), ["drop"]);
  assert.equal(result.plan[0].order.id, picked.id);
}

{
  const picked = order(100003, { lat: 1, lng: 0 }, { lat: 2, lng: 0 }, { picked: true });
  const incoming = order(100004, { lat: 0.5, lng: 0 }, { lat: 1.5, lng: 0 });
  const result = await buildRoutePlan({
    agent,
    activeGroup: [picked, incoming],
    routeFn: mockRoute,
    pickupThreshold: 1000000,
    deliveryThreshold: 1000000,
  });

  assert.deepEqual(result.plan.map(leg => `${leg.type}:${leg.order.id}`), [
    "pickup:100004",
    "drop:100004",
    "drop:100003",
  ]);
}

console.log("routePlanner tests passed");
