# API Contract

The backend is optional and runs on `http://localhost:3001` by default.

## Endpoints

### `GET /api/health`

Returns service health.

### `GET /api/orders`

Returns stored orders.

### `POST /api/orders`

Creates an order.

```json
{
  "pickup": { "lat": 12.9759, "lng": 77.6057 },
  "drop": { "lat": 12.9719, "lng": 77.6412 },
  "priority": "normal"
}
```

### `GET /api/agents`

Returns available agents.

### `GET /api/logs`

Returns backend event logs.

### `POST /api/dispatch/recompute`

Reserved endpoint for moving dispatch recomputation to the backend later.

### `GET /api/route?start=lng,lat&end=lng,lat`

Proxies an OSRM route request through the backend.

Example:

```text
/api/route?start=77.5946,12.9716&end=77.6200,12.9800
```
