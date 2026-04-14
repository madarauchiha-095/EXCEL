# Delivery Routing Dashboard

A Vite + Leaflet multi-agent simulator for rolling-pair delivery dispatch in Bangalore. The browser app uses a local OSRM server on port 5000 for route geometry, distance, and ETA.

## Run

1. Install dependencies: `npm install`
2. Start OSRM with the prepared Bangalore data: `npm run osrm:start`
3. In another terminal, start the app: `npm run dev`
4. Open the local Vite URL and click the map twice to create an order.

The simulator starts with three delivery agents. Each agent has its own marker, route, active order group, queue, and execution timer.

The optional backend API can be started with `npm run backend`.

## Scripts

- `npm run dev` starts the Vite dev server.
- `npm run build` creates the production build.
- `npm test` runs route-planner unit tests.
- `npm run backend` starts the optional Node API on port 3001.
- `npm run osrm:start` starts `osrm-routed` against `osrm-data/bangalore.osrm`.
- Windows direct command: `docker run --rm -t -i -p 5000:5000 -v "%cd%/osrm-data:/data" osrm/osrm-backend osrm-routed --algorithm mld /data/bangalore.osrm`

## Notes

`osrm-data/`, `node_modules/`, and `dist/` are ignored because they are generated or too large for normal source control. The dashboard keeps recent order and delivery logs in browser local storage.

Architecture notes are in `docs/architecture.md`; the optional API contract is in `docs/api.md`.
