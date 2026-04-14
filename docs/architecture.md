# Architecture

The project is now split into focused layers while preserving the browser simulator.

## Frontend Modules

- `main.js` coordinates app state, event handlers, simulation execution, and module wiring.
- `config.js` owns thresholds, sample orders, and agent constraints.
- `dispatchEngine.js` decides whether an order is accepted or queued and selects the best agent.
- `routePlanner.js` builds the pickup/drop leg plan from active order state.
- `osrmClient.js` wraps OSRM route requests and health status.
- `mapView.js` owns Leaflet map, markers, and route drawing.
- `dashboard.js` owns dashboard rendering, logs, buttons, and toast messages.
- `storage.js` persists dashboard history in browser local storage.

## Runtime Flow

1. User clicks pickup/drop or loads a sample order.
2. `dispatchEngine.js` selects an agent and accepts or queues the order.
3. `routePlanner.js` builds route legs using OSRM through `osrmClient.js`.
4. `main.js` animates the selected agent along the current route.
5. `dashboard.js` renders status, metrics, logs, and controls.

## Optional Backend

`server.js` is an optional lightweight Node API. The current frontend still works without it.

Use it when you want backend-owned orders, logs, or OSRM proxying:

```bash
npm run backend
```

The API writes runtime data to `data/store.json`, which is ignored by Git.
