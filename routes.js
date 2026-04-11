export async function fetchRoute(startLngLat, endLngLat) {
  const url = `http://localhost:5000/route/v1/driving/${startLngLat};${endLngLat}?overview=full&geometries=geojson`;

  const res = await fetch(url);
  const data = await res.json();

  if (!data.routes || data.routes.length === 0) {
    throw new Error("No route found");
  }

  return data.routes[0].geometry.coordinates;
}
