export const agents = [
  {
    id: "agent-1",
    lat: 12.9716,
    lng: 77.5946,
    status: "idle",
    marker: null,
  },
];

export function renderAgents(map) {
  agents.forEach(agent => {
    agent.marker = L.marker([agent.lat, agent.lng], {
      title: agent.id,
    }).addTo(map);
  });
}
