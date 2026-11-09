import { NextRequest, NextResponse } from "next/server";
import { guard } from "@/lib/auth/guard";
import { handle } from "@/lib/api-error";
import { getPublicIps } from "@/lib/sysinfo";
import { VERIFY_RESOLVERS } from "@/lib/dns-verify";
import os from "os";

export const runtime = "nodejs";

/**
 * GET /api/websites/dns-context — everything the "Add domain" wizard needs to
 * show the user's required DNS records: the server's real public IPv4/IPv6
 * and the resolvers verification will query.
 */
export const GET = handle(async (req: NextRequest) => {
  await guard(req, { permission: "websites:read" });
  const ips = await getPublicIps();
  return NextResponse.json({
    publicIpv4: ips.v4,
    publicIpv6: ips.v6,
    hostname: os.hostname(),
    resolvers: VERIFY_RESOLVERS,
    ipv6Only: !ips.v4 && !!ips.v6,
  });
});
