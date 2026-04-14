import assert from "node:assert/strict";
import { acceptOrQueueOrder, promoteQueuedOrders, selectAgentForOrder } from "../dispatchEngine.js";

const agents = [
  { id: "near", lat: 0, lng: 0, maxActiveOrders: 2 },
  { id: "far", lat: 5, lng: 5, maxActiveOrders: 2 },
];

{
  const order = { id: 1, pickup: { lat: 0.1, lng: 0.1 }, drop: { lat: 1, lng: 1 } };
  const selected = selectAgentForOrder(order, agents, new Map(), { maxActiveOrdersPerAgent: 2 });
  assert.equal(selected.id, "near");
}

{
  const order = { id: 2, pickup: { lat: 0.1, lng: 0.1 }, drop: { lat: 1, lng: 1 } };
  const activeGroup = [];
  const holdQueue = [];
  const result = acceptOrQueueOrder({
    order,
    agent: agents[0],
    activeGroup,
    holdQueue,
    constraints: { maxActiveOrdersPerAgent: 1 },
  });

  assert.equal(result.accepted, true);
  assert.equal(activeGroup.length, 1);
  assert.equal(order.agentId, "near");
}

{
  const activeGroup = [{ id: 3, delivered: false }];
  const holdQueue = [{ id: 4 }, { id: 5 }];
  const promoted = promoteQueuedOrders({
    activeGroup,
    holdQueue,
    agent: agents[0],
    constraints: { maxActiveOrdersPerAgent: 2 },
  });

  assert.equal(promoted.length, 1);
  assert.equal(activeGroup.length, 2);
  assert.equal(holdQueue.length, 1);
}

console.log("dispatchEngine tests passed");
