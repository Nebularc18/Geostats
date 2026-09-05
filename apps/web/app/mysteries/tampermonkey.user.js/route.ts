import { NextRequest, NextResponse } from "next/server";
import { userscript } from "../../../lib/mystery-userscript";

export async function GET(request: NextRequest) {
  const requestUrl = new URL(request.url);
  const forwardedHost = request.headers.get("x-forwarded-host")?.split(",")[0]?.trim();
  const host = forwardedHost || request.headers.get("host") || requestUrl.host;
  const forwardedProtocol = request.headers.get("x-forwarded-proto")?.split(",")[0]?.trim();
  const protocol = forwardedProtocol === "https" ? "https" : requestUrl.protocol === "https:" ? "https" : "http";
  const origin = `${protocol}://${host}`;
  return new NextResponse(userscript(origin), {
    headers: {
      "Content-Type": "text/javascript; charset=utf-8",
      "Content-Disposition": "inline; filename=geostats-mystery-importer.user.js",
      "Cache-Control": "no-store"
    }
  });
}
