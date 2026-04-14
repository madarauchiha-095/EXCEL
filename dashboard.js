export function orderLabel(order) {
  return `#${String(order.id).slice(-6)}`;
}

export function formatPoint(point) {
  return `${point.lat.toFixed(4)}, ${point.lng.toFixed(4)}`;
}

function formatTime(date) {
  return new Intl.DateTimeFormat("en-IN", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).format(new Date(date));
}

function formatDistance(meters) {
  if (!meters) return "0 km";
  return `${(meters / 1000).toFixed(1)} km`;
}

function formatEta(seconds) {
  if (!seconds) return "0 min";
  return `${Math.max(1, Math.round(seconds / 60))} min`;
}

function renderLogRows(logs, emptyText) {
  if (logs.length === 0) return `<div class="empty">${emptyText}</div>`;

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

function flattenActive(agentStates) {
  return agentStates.flatMap(agentState => agentState.activeGroup);
}

function flattenQueue(agentStates) {
  return agentStates.flatMap(agentState => agentState.holdQueue);
}

function sumMetrics(agentStates) {
  return agentStates.reduce((metrics, agentState) => {
    metrics.distance += agentState.currentMetrics.distance || 0;
    metrics.duration += agentState.currentMetrics.duration || 0;
    return metrics;
  }, { distance: 0, duration: 0 });
}

function latestPairing(agentStates) {
  const agentState = agentStates.find(item => item.lastPairingPassed !== null);
  return agentState?.lastPairingPassed ?? null;
}

export function createDashboard(documentRef = document) {
  const els = {
    status: documentRef.getElementById("status"),
    clock: documentRef.getElementById("dashboardClock"),
    metricOrders: documentRef.getElementById("metricOrders"),
    metricDelivered: documentRef.getElementById("metricDelivered"),
    metricActive: documentRef.getElementById("metricActive"),
    metricQueue: documentRef.getElementById("metricQueue"),
    metricDistance: documentRef.getElementById("metricDistance"),
    metricEta: documentRef.getElementById("metricEta"),
    pairingStatus: documentRef.getElementById("pairingStatus"),
    agentStatus: documentRef.getElementById("agentStatus"),
    routeLeg: documentRef.getElementById("routeLeg"),
    agentPosition: documentRef.getElementById("agentPosition"),
    osrmStatus: documentRef.getElementById("osrmStatus"),
    agentBoard: documentRef.getElementById("agentBoard"),
    orderBoard: documentRef.getElementById("orderBoard"),
    orderLogs: documentRef.getElementById("orderLogs"),
    deliveryLogs: documentRef.getElementById("deliveryLogs"),
    orderLogCount: documentRef.getElementById("orderLogCount"),
    deliveryLogCount: documentRef.getElementById("deliveryLogCount"),
    toastHost: documentRef.getElementById("toastHost"),
    pauseButton: documentRef.getElementById("pauseButton"),
    resetButton: documentRef.getElementById("resetButton"),
    clearLogsButton: documentRef.getElementById("clearLogsButton"),
    exportLogsButton: documentRef.getElementById("exportLogsButton"),
    sampleOrders: documentRef.getElementById("sampleOrders"),
  };

  function setStatus(message) {
    els.status.innerText = message;
    els.agentStatus.innerText = message;
  }

  function setRouteLeg(message) {
    els.routeLeg.innerText = message;
  }

  function toast(message, badge = "active") {
    const node = documentRef.createElement("div");
    node.className = `toast ${badge}`;
    node.textContent = message;
    els.toastHost.appendChild(node);
    setTimeout(() => node.remove(), 3200);
  }

  function renderAgentBoard(agentStates) {
    if (!els.agentBoard) return;

    if (agentStates.length === 0) {
      els.agentBoard.innerHTML = `<div class="empty">No agents configured.</div>`;
      return;
    }

    els.agentBoard.innerHTML = agentStates.map(agentState => {
      const active = agentState.activeGroup.filter(order => !order.delivered).length;
      const routeLeg = agentState.routePlan[agentState.legIndex];
      const legText = routeLeg
        ? `${routeLeg.type.toUpperCase()} ${orderLabel(routeLeg.order)}`
        : "No active route";
      const status = agentState.isPaused ? "Paused" : active > 0 ? "Moving" : "Idle";
      const badge = agentState.isPaused ? "queued" : active > 0 ? "active" : "delivered";

      return `
        <div class="order-row">
          <div class="order-main">
            <span class="order-id">${agentState.agent.label}</span>
            <span class="badge ${badge}">${status}</span>
          </div>
          <div class="order-meta">
            Active ${active} · Queue ${agentState.holdQueue.length} · ${legText}
          </div>
        </div>
      `;
    }).join("");
  }

  function renderOrderBoard(agentStates) {
    const visibleOrders = agentStates.flatMap(agentState => [
      ...agentState.activeGroup.map(order => ({ order, lane: "Active", agent: agentState.agent })),
      ...agentState.holdQueue.map(order => ({ order, lane: "Queued", agent: agentState.agent })),
    ]);

    if (visibleOrders.length === 0) {
      els.orderBoard.innerHTML = `<div class="empty">Click the map twice or load a sample order.</div>`;
      return;
    }

    els.orderBoard.innerHTML = visibleOrders.map(({ order, lane, agent }) => `
      <div class="order-row">
        <div class="order-main">
          <span class="order-id">Order ${orderLabel(order)}</span>
          <span class="badge ${order.statusKey || "active"}">${order.statusText || lane}</span>
        </div>
        <div class="order-meta">
          ${lane} · ${agent.label} · Pickup ${formatPoint(order.pickup)} · Drop ${formatPoint(order.drop)}
        </div>
      </div>
    `).join("");
  }

  function render(state) {
    const agentStates = state.agentStates || [];
    const activeGroup = flattenActive(agentStates);
    const holdQueue = flattenQueue(agentStates);
    const metrics = sumMetrics(agentStates);
    const displayAgent = agentStates[0]?.agent;
    const delivered = state.allOrders.filter(order => order.delivered).length;
    const active = activeGroup.filter(order => !order.delivered).length;
    const pairingPassed = latestPairing(agentStates);

    els.metricOrders.innerText = state.allOrders.length;
    els.metricDelivered.innerText = delivered;
    els.metricActive.innerText = active;
    els.metricQueue.innerText = holdQueue.length;
    els.metricDistance.innerText = formatDistance(metrics.distance);
    els.metricEta.innerText = formatEta(metrics.duration);
    els.agentPosition.innerText = displayAgent ? formatPoint(displayAgent) : "--";
    els.osrmStatus.innerText = state.osrmState;
    els.osrmStatus.className = `value health ${state.osrmState.toLowerCase()}`;
    els.pauseButton.innerText = state.isPaused ? "Resume all" : "Pause all";

    if (pairingPassed === true) {
      els.pairingStatus.innerText = "Pairing passed";
    } else if (pairingPassed === false) {
      els.pairingStatus.innerText = "Pairing skipped";
    } else {
      els.pairingStatus.innerText = "Pairing idle";
    }

    renderAgentBoard(agentStates);
    renderOrderBoard(agentStates);
    els.orderLogs.innerHTML = renderLogRows(state.orderLogs, "No order events yet.");
    els.deliveryLogs.innerHTML = renderLogRows(state.deliveryLogs, "No delivery events yet.");
    els.orderLogCount.innerText = `${state.orderLogs.length} events`;
    els.deliveryLogCount.innerText = `${state.deliveryLogs.length} events`;
  }

  function updateClock() {
    els.clock.innerText = new Intl.DateTimeFormat("en-IN", {
      weekday: "short",
      hour: "2-digit",
      minute: "2-digit",
    }).format(new Date());
  }

  function renderSampleButtons(samples) {
    els.sampleOrders.innerHTML = samples.map((sample, index) => `
      <button type="button" data-sample="${index}">${sample.name}</button>
    `).join("");
  }

  return {
    els,
    setStatus,
    setRouteLeg,
    toast,
    render,
    updateClock,
    renderSampleButtons,
  };
}
