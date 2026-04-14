import { haversine } from "./routePlanner.js";

export function selectAgentForOrder(order, agents, assignments = new Map(), constraints = {}) {
  const maxActiveOrders = constraints.maxActiveOrdersPerAgent || 2;
  const candidates = agents
    .map(agent => {
      const assigned = assignments.get(agent.id) || [];
      const load = assigned.filter(activeOrder => !activeOrder.delivered).length;
      return {
        agent,
        load,
        distanceToPickup: haversine(agent, order.pickup),
      };
    })
    .sort((a, b) => {
      const aHasCapacity = a.load < (a.agent.maxActiveOrders || maxActiveOrders);
      const bHasCapacity = b.load < (b.agent.maxActiveOrders || maxActiveOrders);
      if (aHasCapacity !== bHasCapacity) return aHasCapacity ? -1 : 1;
      const loadDelta = a.load - b.load;
      if (loadDelta !== 0) return loadDelta;
      return a.distanceToPickup - b.distanceToPickup;
    });

  return candidates[0]?.agent || null;
}

export function acceptOrQueueOrder({
  order,
  agent,
  activeGroup,
  holdQueue,
  constraints = {},
}) {
  const maxActiveOrders = constraints.maxActiveOrdersPerAgent || agent.maxActiveOrders || 2;
  order.agentId = agent.id;

  if (activeGroup.length < maxActiveOrders) {
    order.statusText = "Accepted";
    order.statusKey = "accepted";
    activeGroup.push(order);
    return { accepted: true, order };
  }

  order.statusText = "Queued";
  order.statusKey = "queued";
  holdQueue.push(order);
  return { accepted: false, order };
}

export function promoteQueuedOrders({
  activeGroup,
  holdQueue,
  agent,
  constraints = {},
}) {
  const maxActiveOrders = constraints.maxActiveOrdersPerAgent || agent.maxActiveOrders || 2;
  const promoted = [];

  while (activeGroup.length < maxActiveOrders && holdQueue.length > 0) {
    const next = holdQueue.shift();
    next.statusText = "Accepted";
    next.statusKey = "accepted";
    next.agentId = agent.id;
    activeGroup.push(next);
    promoted.push(next);
  }

  return promoted;
}
