# Delivery Routing Dashboard

A Vite + Leaflet simulator for rolling-pair delivery dispatch in Bangalore. The browser app uses a local OSRM server on port 5000 for route geometry, distance, and ETA.

## Run

1. Install dependencies: `npm install`
2. Start OSRM with the prepared Bangalore data: `npm run osrm:start`
3. In another terminal, start the app: `npm run dev`
4. Open the local Vite URL and click the map twice to create an order.

## Scripts

- `npm run dev` starts the Vite dev server.
- `npm run build` creates the production build.
- `npm test` runs route-planner unit tests.
- `npm run osrm:start` starts `osrm-routed` against `osrm-data/bangalore.osrm`.
- Windows direct command: `docker run --rm -t -i -p 5000:5000 -v "%cd%/osrm-data:/data" osrm/osrm-backend osrm-routed --algorithm mld /data/bangalore.osrm`

## Notes

`osrm-data/`, `node_modules/`, and `dist/` are ignored because they are generated or too large for normal source control. The dashboard keeps recent order and delivery logs in browser local storage.
