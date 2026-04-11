export function lngLat(point) {
  return `${point.lng},${point.lat}`;
}

export function haversine(a, b) {
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

export function distToRoute(point, coords) {
  let min = Infinity;
  for (const [lng, lat] of coords) {
    min = Math.min(min, haversine(point, { lat, lng }));
  }
  return min;
}

function routeCoords(route) {
  return route.geometry.coordinates;
}

function routeDistance(route) {
  return Number(route.distance || 0);
}

function routeDuration(route) {
  return Number(route.duration || 0);
}

async function fetchLeg(routeFn, from, to) {
  return routeFn(lngLat(from), lngLat(to));
}

function addLeg(plan, type, order, route) {
  plan.push({
    type,
    order,
    coords: routeCoords(route),
    distance: routeDistance(route),
    duration: routeDuration(route),
  });
}

async function addCompletionLegs(plan, routeFn, startPoint, order) {
  let current = startPoint;

  if (!order.picked) {
    const toPickup = await fetchLeg(routeFn, current, order.pickup);
    addLeg(plan, "pickup", order, toPickup);
    current = order.pickup;
  }

  if (!order.delivered) {
    const toDrop = await fetchLeg(routeFn, current, order.drop);
    addLeg(plan, "drop", order, toDrop);
    current = order.drop;
  }

  return current;
}

export function routeMetrics(plan) {
  return plan.reduce((metrics, leg) => {
    metrics.distance += leg.distance || 0;
    metrics.duration += leg.duration || 0;
    return metrics;
  }, { distance: 0, duration: 0 });
}

export async function buildRoutePlan({
  agent,
  activeGroup,
  routeFn,
  pickupThreshold,
  deliveryThreshold,
}) {
  const plan = [];
  const startPoint = { lat: agent.lat, lng: agent.lng };
  const active = activeGroup.filter(order => !order.delivered);

  if (active.length === 0) {
    return { plan, pairingPassed: null, messages: [], metrics: routeMetrics(plan) };
  }

  if (active.length === 1) {
    await addCompletionLegs(plan, routeFn, startPoint, active[0]);
    return { plan, pairingPassed: null, messages: [], metrics: routeMetrics(plan) };
  }

  const [o1, o2] = active;
  const messages = [];

  if (o2.picked) {
    await addCompletionLegs(plan, routeFn, startPoint, o2);
    await addCompletionLegs(plan, routeFn, o2.drop, o1);
    return { plan, pairingPassed: null, messages, metrics: routeMetrics(plan) };
  }

  const basePlan = [];
  await addCompletionLegs(basePlan, routeFn, startPoint, o1);
  const baseCoords = basePlan.flatMap(leg => leg.coords);
  const pickupDistance = distToRoute(o2.pickup, baseCoords);

  if (pickupDistance > pickupThreshold) {
    messages.push({
      text: `Pickup pairing skipped for #${String(o2.id).slice(-6)}`,
      badge: "routing",
      order: o2,
    });
    plan.push(...basePlan);
    const afterBase = o1.delivered ? startPoint : o1.drop;
    await addCompletionLegs(plan, routeFn, afterBase, o2);
    return { plan, pairingPassed: false, messages, metrics: routeMetrics(plan) };
  }

  messages.push({
    text: `Pickup pairing passed for #${String(o2.id).slice(-6)}`,
    badge: "pairing",
    order: o2,
  });

  const currentBeforeO2 = o1.picked ? startPoint : o1.pickup;
  if (!o1.picked) {
    const toO1Pickup = await fetchLeg(routeFn, startPoint, o1.pickup);
    addLeg(plan, "pickup", o1, toO1Pickup);
  }

  const toO2Pickup = await fetchLeg(routeFn, currentBeforeO2, o2.pickup);
  const o2PickupToO1Drop = await fetchLeg(routeFn, o2.pickup, o1.drop);
  const testCoords = [
    ...routeCoords(toO2Pickup),
    ...routeCoords(o2PickupToO1Drop),
  ];
  const deliveryDistance = distToRoute(o2.drop, testCoords);

  addLeg(plan, "pickup", o2, toO2Pickup);

  if (deliveryDistance <= deliveryThreshold) {
    messages.push({
      text: `Delivery pairing passed for #${String(o2.id).slice(-6)}`,
      badge: "pairing",
      order: o2,
    });
    const o2PickupToO2Drop = await fetchLeg(routeFn, o2.pickup, o2.drop);
    const o2DropToO1Drop = await fetchLeg(routeFn, o2.drop, o1.drop);
    addLeg(plan, "drop", o2, o2PickupToO2Drop);
    addLeg(plan, "drop", o1, o2DropToO1Drop);
  } else {
    messages.push({
      text: `Delivery pairing skipped for #${String(o2.id).slice(-6)}`,
      badge: "routing",
      order: o2,
    });
    const o1DropToO2Drop = await fetchLeg(routeFn, o1.drop, o2.drop);
    addLeg(plan, "drop", o1, o2PickupToO1Drop);
    addLeg(plan, "drop", o2, o1DropToO2Drop);
  }

  return { plan, pairingPassed: true, messages, metrics: routeMetrics(plan) };
}
