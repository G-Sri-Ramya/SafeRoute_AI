# Voice-Enabled Smart SafeRoute 🗺️🎙️

An intelligent, voice-activated navigation application that prioritizes user safety without compromising on usability. This project upgrades traditional routing by introducing dynamic interactions, clear logic-driven insights, and seamless voice search capabilities.

---

## 🌟 Key Features

**Interactive Route Selection**
Explore multiple pathways with a highly responsive UI. Selecting a route via the sidebar cards or clicking directly on the map dynamically highlights the active path in bright green while fading alternatives. The map automatically smooth-scrolls (`flyToBounds`) to focus precisely on your chosen journey.

**Smart "Recommended" Routing**
Safety comes first. The system evaluates all generated routes and automatically pins the highest-scoring, safest option to the top of your list with a dedicated `⭐ Recommended` badge and elevated visual styling.

**Dynamic Route Insights ("Why this route?")**
Understand exactly *why* a route is suggested. A dynamic insight block breaks down the active route's real-time metrics in a clear, logical format, detailing traffic density, road conditions, waterlogging reports, and precise ETAs.

**Safety vs. Speed Comparisons**
Make informed transit decisions. If a significantly faster but riskier route exists, the application generates a smart amber alert. This explicitly compares the safety scores and time differences between the fastest path and the safest path, empowering you to choose what matters most.

**Seamless Voice Integration**
Hands-free navigation powered by robust speech recognition. Visual feedback guides you through intuitive "Listening" and "Processing" phases. The upgraded NLP logic accurately parses complex conversational commands (e.g., "Could you please find a route to X from Y?"), stripping away filler words for accurate routing.

---

## 🛠️ Technical Architecture

The frontend is built on a streamlined architecture prioritizing performance and clear state management across three core files. No backend or schema changes are required to support this interactivity layer.

* `src/components/SafeRouteApp.tsx`: The central hub managing route selection state (`selectedRouteId`), voice integration phases (`idle` | `listening` | `processing`), and dynamic UI rendering for route cards and safety comparisons.
* `src/components/RouteMap.tsx`: Handles the interactive mapping layer. Manages dynamic polyline styling (Z-index sorting, opacity, stroke weight) based on selection state and implements data-driven map recentering to keep the user's focus on the active path.
* `src/lib/voice.ts`: Contains the speech recognition logic, ensuring optimal configuration for single-shot commands alongside advanced regex parsing for natural language location extraction.

---
⚙️ Tech Stack
- React
- Next.js
- TypeScript
- Tailwind CSS
- Leaflet
- OpenStreetMap
- OSRM Routing API
- Browser Geolocation API
- Speech Synthesis

---

## 🚀 Getting Started

**Prerequisites**
Ensure you have Node.js and npm (or your preferred package manager) installed on your machine.

**Installation**
1. Clone the repository to your local machine.
2. Navigate to the project directory.
3. Run `npm install` to install all necessary dependencies.
4. Run `npm run dev` to start the local development server.

---

## ✅ Acceptance & Testing Criteria

When contributing or testing the application, ensure the following core interaction flows operate correctly:
* Executing a search successfully renders up to 5 distinct polylines on the map.
* Bidirectional selection works seamlessly: clicking a sidebar card highlights the map polyline, and clicking a map polyline updates the sidebar selection.
* The "Why this route?" insight block dynamically updates its data points based on the currently selected route.
* Voice controls accurately trigger visual phase UI updates and successfully parse source and destination variables.
* The header dynamically updates to display "Routes from [Source] → [Destination]".
* The safety-over-speed comparison alert triggers appropriately when route scores diverge.
