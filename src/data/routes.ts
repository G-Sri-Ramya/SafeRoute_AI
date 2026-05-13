// Shared types for the dynamic route generator.

export type TrafficLevel = "low" | "medium" | "high";
export type RoadCondition = "good" | "moderate" | "bad";

export type Coord = [number, number]; // [lat, lng]

export interface RouteData {
  id: string;
  name: string;
  from: string;
  to: string;
  baseTraffic: TrafficLevel;
  road: RoadCondition;
  waterlogging: boolean;
  distanceKm: number;
  etaMin: number;
  path: Coord[];
}

export interface RouteOption {
  id: string;
  name: string;
  from: string;
  to: string;
  traffic: TrafficLevel;
  road: RoadCondition;
  waterlogging: boolean;
  distanceKm: number;
  etaMin: number;
  path: Coord[];
  trafficScore: number;
  roadScore: number;
  waterScore: number;
  totalScore: number;
  reasons: string[];
}

export interface EvaluateResponse {
  best: RouteOption;
  routes: RouteOption[];
  timeOfDay: "morning" | "afternoon" | "evening" | "night";
  spokenSummary: string;
  fromLabel: string;
  toLabel: string;
}

export function getRoutesKey(from: string, to: string) {
  return `${from.trim().toLowerCase()}->${to.trim().toLowerCase()}`;
}
