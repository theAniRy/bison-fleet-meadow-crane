import { createFileRoute } from "@tanstack/react-router";
import { CatalogBrowser } from "@/components/iss/browser";

export const Route = createFileRoute("/")({ component: Home });

function Home() {
  return <CatalogBrowser />;
}
