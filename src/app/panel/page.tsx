import type { Metadata } from "next";
import { HipnoPanelRoot } from "@/components/panel/root";

export const metadata: Metadata = {
  title: "Panel",
  description: "HipnoType Panel — log in to manage this server.",
  robots: { index: false, follow: false },
};

/**
 * The panel SPA lives at /panel in the development workspace.
 * In the production VPS build the same component is served at "/" (the relay
 * strips the /server/panel/<token> prefix) — see scripts/make-dist.mjs.
 */
export default function PanelPage() {
  return <HipnoPanelRoot />;
}
