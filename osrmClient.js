const DEFAULT_BASE_URL = "http://localhost:5000";

export function createOsrmClient({
  baseUrl = DEFAULT_BASE_URL,
  onHealthChange = () => {},
} = {}) {
  async function route(startLngLat, endLngLat) {
    const url = `${baseUrl}/route/v1/driving/${startLngLat};${endLngLat}?overview=full&geometries=geojson`;
    try {
      const res = await fetch(url);
      if (!res.ok) throw new Error(`OSRM responded with ${res.status}`);
      const data = await res.json();
      if (!data.routes || data.routes.length === 0) throw new Error("No route found");
      onHealthChange("Connected");
      return data.routes[0];
    } catch (error) {
      onHealthChange("Down");
      throw error;
    }
  }

  async function healthCheck() {
    await route("77.5946,12.9716", "77.6200,12.9800");
  }

  return { route, healthCheck };
}
