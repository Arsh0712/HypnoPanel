import { NextRequest, NextResponse } from "next/server";
import { guard } from "@/lib/auth/guard";
import { getTunnelStatus } from "@/lib/tunnel-client";
import { getSetting } from "@/lib/settings";
import { handle } from "@/lib/api-error";

export const runtime = "nodejs";

/** GET /api/system/tunnel — relay tunnel status + access URL info. */
export const GET = handle(async (req: NextRequest) => {
  await guard(req, { permission: "settings:read" });
  const st = getTunnelStatus();
  const token = await getSetting("access.token", null);
  const mode = await getSetting("access.mode", "relay");
  const domain = await getSetting("access.domain", null);
  return NextResponse.json({
    tunnel: st,
    access: {
      mode,
      token,
      relayUrlPath: token ? `/server/panel/${token}/` : null,
      domain,
    },
  });
});
