"use client";

import { useEffect, useState } from "react";
import { ExternalLink } from "lucide-react";
import { helperUpdateAvailable } from "../lib/mystery-sync-policy";
import { MYSTERY_USERSCRIPT_VERSION } from "../lib/mystery-userscript";

export function MysteryHelperUpdateBanner() {
  const [installedVersion, setInstalledVersion] = useState<string | null>(null);

  useEffect(() => {
    const root = document.documentElement;
    const readVersion = () => {
      const version = root.getAttribute("data-geostats-helper-version");
      // Helpers released before version reporting still advertise note support.
      const legacyHelper = root.hasAttribute("data-geostats-note-batch-support");
      setInstalledVersion(version || (legacyHelper ? "unknown" : null));
    };
    const observer = new MutationObserver(readVersion);
    observer.observe(root, {
      attributes: true,
      attributeFilter: ["data-geostats-helper-version", "data-geostats-note-batch-support"],
    });
    readVersion();
    return () => observer.disconnect();
  }, []);

  if (!helperUpdateAvailable(installedVersion, MYSTERY_USERSCRIPT_VERSION)) return null;

  return (
    <section className="mystery-helper-update-banner" role="status" aria-label="Geocaching helper update">
      <div>
        <strong>Geocaching browser script update available</strong>
        <p>
          {installedVersion === "unknown"
            ? "Your helper does not report its version. Install the latest version to keep Geocaching imports and sync up to date."
            : `Your helper is version ${installedVersion}. Version ${MYSTERY_USERSCRIPT_VERSION} is available.`}{" "}
          Confirm the update in Tampermonkey, then reload this page.
        </p>
      </div>
      <a className="secondary-button icon-button" href={`/mysteries/tampermonkey.user.js?v=${MYSTERY_USERSCRIPT_VERSION}`} target="_blank" rel="noreferrer">
        <ExternalLink size={17} /> Update browser script
      </a>
    </section>
  );
}
