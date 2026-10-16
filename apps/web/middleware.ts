import { clerkMiddleware } from "@clerk/nextjs/server";
import { getPublicRuntimeConfig, isClerkEnabled } from "./lib/runtime-config";
import { NextResponse, type NextMiddleware } from "next/server";

const middleware: NextMiddleware = (request, event) => {
  const runtimeConfig = getPublicRuntimeConfig();
  if (!isClerkEnabled(runtimeConfig)) return NextResponse.next();
  return clerkMiddleware({ publishableKey: runtimeConfig.clerkPublishableKey })(request, event);
};

export default middleware;

export const config = {
  matcher: [
    "/((?!_next|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|webp|png|gif|svg|ttf|woff2?|ico|csv|docx?|xlsx?|zip|webmanifest)).*)",
    "/(api|trpc)(.*)",
    "/__clerk/:path*"
  ]
};
