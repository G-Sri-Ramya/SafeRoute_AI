import { createFileRoute } from "@tanstack/react-router";
import { SafeRouteApp } from "@/components/SafeRouteApp";

export const Route = createFileRoute("/")({
  component: Index,
  head: () => ({
    meta: [
      { title: "SafeRoute — Voice-Enabled Smart Navigation" },
      {
        name: "description",
        content:
          "Safety-aware navigation using multi-factor decision modeling instead of traditional shortest-path algorithms. Voice input, explainable AI, live reports.",
      },
      { property: "og:title", content: "SafeRoute — Voice-Enabled Smart Navigation" },
      {
        property: "og:description",
        content: "Pick the safest route using traffic, road, and waterlogging scoring with voice control.",
      },
    ],
  }),
});

function Index() {
  return <SafeRouteApp />;
}
