export const PICKUP_THRESHOLD = 3000;
export const DELIVERY_THRESHOLD = 3000;
export const SPEED = 50;
export const STEP = 2;
export const STORAGE_KEY = "delivery-routing-dashboard-v3";

export const AGENTS = [
  {
    id: "agent-1",
    label: "Agent 1",
    lat: 12.9716,
    lng: 77.5946,
    maxActiveOrders: 2,
  },
];

export const DISPATCH_CONSTRAINTS = {
  maxActiveOrdersPerAgent: 2,
  pickupThreshold: PICKUP_THRESHOLD,
  deliveryThreshold: DELIVERY_THRESHOLD,
  maxDelayPercent: 0.25,
};

export const SAMPLE_ORDERS = [
  {
    name: "MG Road to Indiranagar",
    pickup: { lat: 12.9759, lng: 77.6057 },
    drop: { lat: 12.9719, lng: 77.6412 },
  },
  {
    name: "Koramangala to HSR",
    pickup: { lat: 12.9352, lng: 77.6245 },
    drop: { lat: 12.9121, lng: 77.6446 },
  },
  {
    name: "Malleshwaram to Hebbal",
    pickup: { lat: 13.0031, lng: 77.5643 },
    drop: { lat: 13.0358, lng: 77.5970 },
  },
];
