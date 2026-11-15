type PageNode = {
  textContent?: string | null;
  innerText?: string;
  getAttribute(name: string): string | null;
};
type CacheDocument = {
  title?: string;
  querySelector(selector: string): PageNode | null;
  querySelectorAll(selector: string): ArrayLike<PageNode>;
};

// Keep this function self-contained: it is serialized into the on-device browser.
// It reads page content only, never cookies, local storage, passwords, or tokens.
export function captureMysteryDocument(document: CacheDocument, href: string) {
  const url = new URL(href);
  if (url.protocol !== "https:" || !["www.geocaching.com", "geocaching.com"].includes(url.hostname)) return null;
  const gcCode = (url.pathname.match(/\/geocache\/(GC[A-Z0-9]+)/i)?.[1] || url.searchParams.get("wp") || "").toUpperCase();
  if (!/^GC[A-Z0-9]+$/.test(gcCode)) return null;
  const read = (selector: string) => {
    const node = document.querySelector(selector);
    return (node?.innerText ?? node?.textContent ?? "").trim();
  };
  const name = read("#ctl00_ContentBody_CacheName") || read("[data-testid='cache-name']") || read("h1");
  const coordinate = read("[data-testid='original-coordinates']") || read("#uxLatLon") || read("[data-testid='coordinates']");
  const dmm = coordinate.match(/([NS])\s*(\d{1,2})[^\d]+(\d{1,2}(?:[.,]\d+)?)\D+([EW])\s*(\d{1,3})[^\d]+(\d{1,2}(?:[.,]\d+)?)/i);
  const decimal = coordinate.match(/^\s*(-?\d+(?:\.\d+)?)\s*[,;]\s*(-?\d+(?:\.\d+)?)\s*$/);
  const latitude = dmm ? (Number(dmm[2]) + Number(dmm[3].replace(",", ".")) / 60) * (dmm[1].toUpperCase() === "S" ? -1 : 1) : decimal ? Number(decimal[1]) : NaN;
  const longitude = dmm ? (Number(dmm[5]) + Number(dmm[6].replace(",", ".")) / 60) * (dmm[4].toUpperCase() === "W" ? -1 : 1) : decimal ? Number(decimal[2]) : NaN;
  if (!name || name.length > 300 || !Number.isFinite(latitude) || !Number.isFinite(longitude) || Math.abs(latitude) > 90 || Math.abs(longitude) > 180 || (dmm && (Number(dmm[3].replace(",", ".")) >= 60 || Number(dmm[6].replace(",", ".")) >= 60))) return null;
  const short = read("#ctl00_ContentBody_ShortDescription") || read("[data-testid='cache-short-description']");
  const long = read("#ctl00_ContentBody_LongDescription") || read("[data-testid='cache-long-description']");
  if (!short && !long) return null;
  const hint = read("#div_hint") || read("[data-testid='cache-hint']");
  const images: string[] = [];
  for (const node of Array.from(document.querySelectorAll("#ctl00_ContentBody_ShortDescription img, #ctl00_ContentBody_LongDescription img, [data-testid='cache-long-description'] img"))) {
    try {
      const src = node.getAttribute("src");
      if (!src) continue;
      const image = new URL(src, href);
      if (image.protocol === "https:" && !image.username && !image.password && !images.includes(image.href) && images.length < 30) images.push(image.href);
    } catch { /* Ignore malformed image sources. */ }
  }
  return {
    gcCode, name, latitude, longitude, area: read("[data-testid='cache-location']"), country: "",
    clues: [short ? `Short description:\n${short}` : "", long ? `Puzzle listing:\n${long}` : "", hint ? `Listing hint as shown on Geocaching:\n${hint}` : "", images.length ? `Puzzle images:\n${images.join("\n")}` : ""].filter(Boolean),
    listingImageUrls: images
  };
}

export function mysteryBrowserCaptureScript() {
  return `(function(){try{var data=(${captureMysteryDocument.toString()})(document,location.href);window.ReactNativeWebView.postMessage(JSON.stringify({type:"geostats-mystery-page",data:data}));}catch(e){window.ReactNativeWebView.postMessage(JSON.stringify({type:"geostats-mystery-page",data:null}));}})();true;`;
}
