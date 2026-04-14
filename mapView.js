import L from "leaflet";
import "leaflet/dist/leaflet.css";

function mapIcon(type) {
  return L.divIcon({
    className: `map-pin ${type}`,
    html: `<span>${type === "pickup" ? "P" : "D"}</span>`,
    iconSize: [28, 28],
    iconAnchor: [14, 14],
  });
}

export function createMapView({
  mapId,
  center,
  onOrderPoints,
}) {
  const map = L.map(mapId).setView([center.lat, center.lng], 13);
  L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
    attribution: "© OpenStreetMap contributors",
  }).addTo(map);

  let polyline = null;
  let clickBuffer = [];

  function createAgentMarker(agent) {
    return L.marker([agent.lat, agent.lng], { title: agent.label || agent.id }).addTo(map);
  }

  function updateAgentMarker(agent) {
    agent.marker?.setLatLng([agent.lat, agent.lng]);
  }

  function pickupMarker(point) {
    return L.marker(point, { icon: mapIcon("pickup") }).addTo(map);
  }

  function dropMarker(point) {
    return L.marker(point, { icon: mapIcon("drop") }).addTo(map);
  }

  function drawRoute(coords) {
    if (polyline) map.removeLayer(polyline);
    if (coords.length === 0) {
      polyline = null;
      return;
    }

    polyline = L.polyline(
      coords.map(([lng, lat]) => [lat, lng]),
      { color: "#2563eb", weight: 4 }
    ).addTo(map);
  }

  function clearRoute() {
    if (polyline) map.removeLayer(polyline);
    polyline = null;
  }

  map.on("click", event => {
    clickBuffer.push(event.latlng);
    if (clickBuffer.length === 2) {
      onOrderPoints(clickBuffer[0], clickBuffer[1]);
      clickBuffer = [];
      return;
    }
    onOrderPoints(clickBuffer[0], null);
  });

  return {
    createAgentMarker,
    updateAgentMarker,
    pickupMarker,
    dropMarker,
    drawRoute,
    clearRoute,
  };
}
