export function serializeOrder(order) {
  return {
    id: order.id,
    pickup: order.pickup,
    drop: order.drop,
    picked: order.picked,
    delivered: order.delivered,
    statusText: order.statusText,
    statusKey: order.statusKey,
    agentId: order.agentId,
    priority: order.priority || "normal",
    createdAt: order.createdAt,
  };
}

export function saveDashboardState(key, state) {
  const payload = {
    allOrders: state.allOrders.map(serializeOrder),
    orderLogs: state.orderLogs,
    deliveryLogs: state.deliveryLogs,
  };
  localStorage.setItem(key, JSON.stringify(payload));
}

export function loadDashboardState(key) {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return { allOrders: [], orderLogs: [], deliveryLogs: [] };
    const payload = JSON.parse(raw);
    return {
      allOrders: Array.isArray(payload.allOrders) ? payload.allOrders : [],
      orderLogs: Array.isArray(payload.orderLogs) ? payload.orderLogs : [],
      deliveryLogs: Array.isArray(payload.deliveryLogs) ? payload.deliveryLogs : [],
    };
  } catch {
    localStorage.removeItem(key);
    return { allOrders: [], orderLogs: [], deliveryLogs: [] };
  }
}
