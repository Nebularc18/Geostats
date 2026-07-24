import { NextRequest, NextResponse } from "next/server";
import { locationFromCachePageMetadata } from "../../../lib/mystery-area";
import { locationFromPageSources } from "../../../lib/mystery-page-location";
import { MYSTERY_USERSCRIPT_VERSION } from "../../../lib/mystery-userscript";

function userscript(appOrigin: string) {
  return `// ==UserScript==
// @name         Geostats Mystery Importer
// @namespace    ${appOrigin}
// @version      ${MYSTERY_USERSCRIPT_VERSION}
// @description  Import mystery caches and automatically sync corrected coordinates from Geostats.
// @match        https://www.geocaching.com/geocache/*
// @match        https://www.geocaching.com/seek/cache_details.aspx*
// @match        ${appOrigin}/mysteries*
// @include      ${appOrigin}/mysteries*
// @icon         ${appOrigin}/geostats-icon.svg
// @downloadURL  ${appOrigin}/mysteries/tampermonkey.user.js
// @updateURL    ${appOrigin}/mysteries/tampermonkey.user.js
// @grant        GM_registerMenuCommand
// @grant        GM_setClipboard
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_deleteValue
// @grant        GM_listValues
// @grant        unsafeWindow
// @run-at       document-idle
// ==/UserScript==

(function () {
  "use strict";

  const GEOSTATS_ORIGIN = ${JSON.stringify(appOrigin)};
  const GEOSTATS_URL = ${JSON.stringify(`${appOrigin}/mysteries`)};
  const PENDING_SYNC_KEY = "geostats-pending-coordinate-sync";
  const SYNC_RECEIPT_KEY = "geostats-coordinate-sync-receipt";
  const SYNC_RECEIPT_PREFIX = SYNC_RECEIPT_KEY + ":";
  const MAX_SYNC_AGE_MS = 10 * 60 * 1000;

  if (location.origin === GEOSTATS_ORIGIN) {
    document.addEventListener("geostats-sync-request", () => {
      try {
        const request = document.documentElement.getAttribute("data-geostats-sync-request");
        const value = JSON.parse(request || "null");
        const values = value && Array.isArray(value.requests) ? value.requests : [value];
        const valid = values.length > 0 && values.length <= 100 && values.every((item) =>
          item &&
          typeof item.cacheId === "string" &&
          typeof item.attemptId === "string" &&
          /^GC[A-Z0-9]+$/i.test(item.gcCode || "") &&
          Number.isFinite(item.latitude) &&
          Math.abs(item.latitude) <= 90 &&
          Number.isFinite(item.longitude) &&
          Math.abs(item.longitude) <= 180 &&
          typeof item.coordinateText === "string" &&
          item.solved === true &&
          Number.isFinite(item.issuedAt)
        );
        const acknowledgement = Array.isArray(value?.requests) ? value.batchId : value?.attemptId + ":" + value?.issuedAt;
        if (valid && typeof acknowledgement === "string" && acknowledgement) {
          GM_setValue(PENDING_SYNC_KEY, JSON.stringify(values));
          document.documentElement.setAttribute("data-geostats-sync-ready", acknowledgement);
          document.dispatchEvent(new Event("geostats-sync-ready"));
        }
      } catch {
        // Ignore malformed requests.
      }
    });
    const deliverSyncReceipt = () => {
      const keys = GM_listValues().filter((key) => key === SYNC_RECEIPT_KEY || key.startsWith(SYNC_RECEIPT_PREFIX));
      keys.forEach((key) => {
        const receipt = GM_getValue(key, "");
        if (!receipt) return;
        document.documentElement.setAttribute("data-geostats-sync-receipt", receipt);
        GM_deleteValue(key);
        document.dispatchEvent(new Event("geostats-sync-receipt"));
      });
    };
    deliverSyncReceipt();
    window.setInterval(deliverSyncReceipt, 400);
    return;
  }

  const hasSyncRequest = new URLSearchParams(location.hash.replace(/^#/, "")).has("geostats-sync");
  const syncPayload = readSyncPayload();
  let syncSubmissionStarted = false;
  let syncReceiptReturned = false;
  let directSyncStarted = false;

  function readSyncPayload() {
    const encoded = new URLSearchParams(location.hash.replace(/^#/, "")).get("geostats-sync");
    if (!encoded) return null;
    try {
      const value = JSON.parse(encoded);
      const storedPending = JSON.parse(GM_getValue(PENDING_SYNC_KEY, "null"));
      const pendingValues = Array.isArray(storedPending) ? storedPending : [storedPending];
      const pending = pendingValues.find((item) => item?.attemptId === value.attemptId);
      const pageCode = (location.pathname.match(/\\/geocache\\/(GC[A-Z0-9]+)/i)?.[1] || new URLSearchParams(location.search).get("wp") || "").toUpperCase();
      if (
        !pending ||
        typeof value.cacheId !== "string" ||
        typeof value.attemptId !== "string" ||
        typeof value.gcCode !== "string" ||
        value.gcCode.toUpperCase() !== pageCode ||
        !Number.isFinite(value.latitude) ||
        Math.abs(value.latitude) > 90 ||
        !Number.isFinite(value.longitude) ||
        Math.abs(value.longitude) > 180 ||
        typeof value.coordinateText !== "string" ||
        value.solved !== true ||
        !Number.isFinite(value.issuedAt) ||
        Date.now() - value.issuedAt > MAX_SYNC_AGE_MS ||
        Date.now() - value.issuedAt < -30000 ||
        pending.cacheId !== value.cacheId ||
        pending.attemptId !== value.attemptId ||
        pending.gcCode !== value.gcCode ||
        pending.latitude !== value.latitude ||
        pending.longitude !== value.longitude ||
        pending.coordinateText !== value.coordinateText ||
        pending.issuedAt !== value.issuedAt
      ) return null;
      return value;
    } catch {
      return null;
    }
  }

  function textFrom(selectors) {
    for (const selector of selectors) {
      const value = document.querySelector(selector)?.textContent?.trim();
      if (value) return value;
    }
    return "";
  }

  function parseCoordinates(value) {
    const normalized = String(value || "").replace(/(\\d),(\\d)/g, "$1.$2");
    const dmm = normalized.match(/([NS])\\s*(\\d{1,2})[^\\d]+(\\d{1,2}(?:\\.\\d+)?)\\s*['’′]?\\s+([EW])\\s*(\\d{1,3})[^\\d]+(\\d{1,2}(?:\\.\\d+)?)/i);
    if (dmm) {
      const latitude = (Number(dmm[2]) + Number(dmm[3]) / 60) * (dmm[1].toUpperCase() === "S" ? -1 : 1);
      const longitude = (Number(dmm[5]) + Number(dmm[6]) / 60) * (dmm[4].toUpperCase() === "W" ? -1 : 1);
      return { latitude, longitude };
    }
    const decimal = normalized.match(/(-?\\d{1,2}\\.\\d+)\\s*[,; ]\\s*(-?\\d{1,3}\\.\\d+)/);
    return decimal ? { latitude: Number(decimal[1]), longitude: Number(decimal[2]) } : null;
  }

  function pageLocation() {
    const locationFromMetadata = ${locationFromCachePageMetadata.toString()};
    const locationFromSources = ${locationFromPageSources.toString()};
    const jsonLd = [];
    for (const script of document.querySelectorAll("script[type='application/ld+json']")) {
      try {
        jsonLd.push(JSON.parse(script.textContent || "null"));
      } catch {
        // Ignore unrelated or malformed structured data.
      }
    }

    const locationNodes = document.querySelectorAll([
      "[data-testid='cache-location']",
      "[data-testid='cache-region']",
      ".CacheLocation",
      ".cache-location",
      "[class*='cacheLocation']",
      "[class*='CacheLocation']",
      "#ctl00_ContentBody_mcd1"
    ].join(","));
    const description = document.querySelector("meta[name='description']")?.getAttribute("content") || "";
    const metadata = locationFromMetadata(document.title, description);
    return locationFromSources({
      jsonLd,
      breadcrumbs: [...locationNodes].map((node) =>
        [...node.querySelectorAll("a")].map((link) => link.textContent || "")
      ),
      locationTexts: [...locationNodes].map((node) => node.textContent || ""),
      metaRegion: document.querySelector("meta[property='place:region']")?.getAttribute("content") || "",
      metadata
    });
  }

  function pageData() {
    const gcCode = (location.pathname.match(/\\/geocache\\/(GC[A-Z0-9]+)/i)?.[1] || new URLSearchParams(location.search).get("wp") || textFrom([".CoordInfoCode", "[data-testid='gccode']"])).toUpperCase();
    const rawTitle = textFrom(["h1", "#ctl00_ContentBody_CacheName", "[data-testid='cache-name']"]) || document.querySelector("meta[property='og:title']")?.content || document.title;
    const name = rawTitle.replace(/\\s*[-|]\\s*Geocaching.*$/i, "").trim();
    const coordinateText = textFrom(["#uxLatLon", "[data-testid='coordinates']", ".coordinates", "[class*='Coordinates']", "[class*='coordinates']"]);
    const coordinates = parseCoordinates(coordinateText);
    const pageLocationData = pageLocation();
    return coordinates ? { gcCode, name, ...pageLocationData, ...coordinates } : { gcCode, name, ...pageLocationData };
  }

  function toast(message, error) {
    const old = document.getElementById("geostats-import-toast");
    if (old) old.remove();
    const node = document.createElement("div");
    node.id = "geostats-import-toast";
    node.textContent = message;
    Object.assign(node.style, { position: "fixed", right: "22px", bottom: "82px", zIndex: "2147483647", padding: "12px 16px", borderRadius: "8px", color: "white", background: error ? "#9d302c" : "#245c3d", boxShadow: "0 12px 35px rgba(0,0,0,.35)", font: "600 14px system-ui" });
    document.body.appendChild(node);
    setTimeout(() => node.remove(), 4200);
  }

  function copyText(value) {
    if (typeof GM_setClipboard === "function") {
      GM_setClipboard(value, "text");
      return true;
    }
    const field = document.createElement("textarea");
    field.value = value;
    Object.assign(field.style, { position: "fixed", opacity: "0", pointerEvents: "none" });
    document.body.appendChild(field);
    field.select();
    const copied = document.execCommand("copy");
    field.remove();
    return copied;
  }

  function sameCoordinates(first, second) {
    return Boolean(first && second) && Math.abs(first.latitude - second.latitude) < 0.00001 && Math.abs(first.longitude - second.longitude) < 0.00001;
  }

  function syncStorageKey() {
    return syncPayload ? "geostats-synced:" + syncPayload.gcCode + ":" + syncPayload.attemptId : "";
  }

  function pendingSyncPayloads() {
    try {
      const stored = JSON.parse(GM_getValue(PENDING_SYNC_KEY, "null"));
      return (Array.isArray(stored) ? stored : [stored]).filter(Boolean);
    } catch {
      return [];
    }
  }

  function removePendingSyncPayload() {
    if (!syncPayload) return;
    const remaining = pendingSyncPayloads().filter((item) => item.attemptId !== syncPayload.attemptId);
    if (remaining.length) GM_setValue(PENDING_SYNC_KEY, JSON.stringify(remaining));
    else GM_deleteValue(PENDING_SYNC_KEY);
  }

  function pageUserToken() {
    try {
      if (typeof unsafeWindow !== "undefined" && typeof unsafeWindow.userToken === "string") {
        return unsafeWindow.userToken;
      }
      if (typeof unsafeWindow !== "undefined" && typeof unsafeWindow.eval === "function") {
        const token = unsafeWindow.eval("typeof userToken === 'string' ? userToken : ''");
        if (typeof token === "string") return token;
      }
    } catch {
      // Tampermonkey may restrict access while the page is still loading.
    }
    for (const script of document.scripts) {
      const match = script.textContent?.match(/(?:var|let|const)\\s+userToken\\s*=\\s*["']([^"']+)["']/);
      if (match?.[1]) return match[1];
    }
    return "";
  }

  function waitForUserToken(timeoutMs) {
    return new Promise((resolve) => {
      const started = Date.now();
      const timer = window.setInterval(() => {
        const token = pageUserToken();
        if (token || Date.now() - started >= timeoutMs) {
          window.clearInterval(timer);
          resolve(token);
        }
      }, 100);
    });
  }

  function setSyncPanelState(message, state) {
    const instructions = document.getElementById("geostats-sync-instructions");
    const retry = document.getElementById("geostats-sync-save");
    if (instructions) instructions.textContent = message;
    if (retry) {
      retry.style.display = state === "error" ? "block" : "none";
      retry.disabled = false;
      retry.textContent = "Retry automatic sync";
    }
  }

  async function performDirectSync() {
    if (!syncPayload || directSyncStarted || syncReceiptReturned) return;
    directSyncStarted = true;
    setSyncPanelState("Saving the corrected coordinate with your signed-in Geocaching session…", "loading");

    if (window.localStorage.getItem(syncStorageKey())) {
      removePendingSyncPayload();
      setSyncPanelState("This coordinate was already accepted by Geocaching. Returning to Geostats…", "success");
      window.setTimeout(returnSyncReceipt, 500);
      return;
    }

    try {
      const token = await waitForUserToken(10000);
      if (!token) throw new Error("The signed-in page token was not available. Reload the cache page and press Sync again.");

      const response = await window.fetch("/seek/cache_details.aspx/SetUserCoordinate", {
        method: "POST",
        credentials: "same-origin",
        headers: {
          "Accept": "application/json",
          "Content-Type": "application/json; charset=UTF-8"
        },
        body: JSON.stringify({
          dto: {
            data: {
              lat: syncPayload.latitude,
              lng: syncPayload.longitude
            },
            ut: token
          }
        })
      });
      const responseText = await response.text();
      if (!response.ok) throw new Error("Geocaching rejected the coordinate (HTTP " + response.status + ").");

      if (responseText) {
        try {
          const parsed = JSON.parse(responseText);
          const result = parsed && Object.prototype.hasOwnProperty.call(parsed, "d") ? parsed.d : parsed;
          if (result && typeof result === "object" && result.status && result.status !== "success") {
            throw new Error(result.message || "Geocaching did not accept the coordinate.");
          }
        } catch (error) {
          if (error instanceof SyntaxError) throw new Error("Geocaching returned an unreadable response.");
          throw error;
        }
      }

      window.localStorage.setItem(syncStorageKey(), new Date().toISOString());
      removePendingSyncPayload();
      setSyncPanelState("Corrected coordinate saved. Returning to Geostats…", "success");
      toast("Corrected coordinate saved on Geocaching", false);
      window.setTimeout(returnSyncReceipt, 700);
    } catch (error) {
      directSyncStarted = false;
      const message = error instanceof Error ? error.message : "Automatic sync failed.";
      setSyncPanelState(message, "error");
      toast(message, true);
    }
  }

  function setInputValue(input, value) {
    const descriptor = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(input), "value");
    if (descriptor?.set) descriptor.set.call(input, value);
    else input.value = value;
    input.dispatchEvent(new Event("input", { bubbles: true }));
    input.dispatchEvent(new Event("change", { bubbles: true }));
  }

  function isVisible(element) {
    if (!element) return false;
    const style = window.getComputedStyle(element);
    const bounds = element.getBoundingClientRect();
    return style.display !== "none" && style.visibility !== "hidden" && bounds.width > 0 && bounds.height > 0;
  }

  function findSolvedCoordinateEditor() {
    const knownField = document.getElementById("newCoordinates");
    if (knownField && isVisible(knownField) && !knownField.disabled && !knownField.readOnly) {
      let knownContainer = knownField.parentElement;
      while (knownContainer?.parentElement && !knownContainer.querySelector(".btn-cc-parse")) {
        knownContainer = knownContainer.parentElement;
      }
      return { field: knownField, container: knownContainer || knownField.parentElement };
    }

    const fields = [...document.querySelectorAll("textarea, input:not([type='hidden']):not([type='submit']):not([type='button'])")];
    for (const field of fields) {
      if (!isVisible(field) || field.disabled || field.readOnly || field.closest("#geostats-sync-panel")) continue;
      let container = field.parentElement;
      for (let depth = 0; container && container !== document.body && depth < 8; depth += 1, container = container.parentElement) {
        const text = (container.textContent || "").replace(/\\s+/g, " ");
        if (/enter solved coordinates/i.test(text) && /change\\s*to/i.test(text)) {
          return { field, container };
        }
      }
    }
    return null;
  }

  function hasVisibleSolvedCoordinatePopup() {
    return [...document.querySelectorAll("form, section, div")].some((element) => {
      if (!isVisible(element)) return false;
      const text = (element.textContent || "").replace(/\\s+/g, " ");
      return /enter solved coordinates/i.test(text) && /change\\s*to/i.test(text) && Boolean(element.querySelector("textarea, input"));
    });
  }

  function findCoordinateEditorTriggers() {
    const candidates = [];
    const add = (candidate) => {
      if (candidate && !candidate.closest?.("#geostats-sync-panel") && !candidates.includes(candidate)) candidates.push(candidate);
    };
    const selectors = [
      "#uxLatLonLink",
      "button[aria-label*='coordinate' i][aria-label*='edit' i]",
      "a[aria-label*='coordinate' i][aria-label*='edit' i]",
      "button[title*='edit coordinate' i]",
      "a[title*='edit coordinate' i]",
      "[title*='corrected coordinate' i]",
      "[data-testid*='coordinate-edit' i]"
    ];
    for (const selector of selectors) {
      add(document.querySelector(selector));
    }

    const coordinateNode = document.querySelector("#uxLatLon, [data-testid='coordinates'], .coordinates, [class*='Coordinates']");
    add(coordinateNode?.closest("a, button, [role='button'], [onclick]"));
    add(coordinateNode);
    let container = coordinateNode?.parentElement;
    for (let depth = 0; container && depth < 4; depth += 1, container = container.parentElement) {
      const controls = [...container.querySelectorAll("button, a, [role='button']")];
      const candidate = controls.find((control) => {
        const icon = control.querySelector("svg, img, [class*='pencil' i], [class*='edit' i]");
        const description = [
          control.textContent,
          control.getAttribute("aria-label"),
          control.getAttribute("title"),
          control.getAttribute("data-testid"),
          icon?.getAttribute("class"),
          icon?.getAttribute("aria-label"),
          icon?.getAttribute("title"),
          icon?.getAttribute("alt"),
          icon?.getAttribute("src")
        ].filter(Boolean).join(" ");
        return /edit|correct|pencil/i.test(description);
      });
      add(candidate);
      if (coordinateNode) {
        const coordinateBounds = coordinateNode.getBoundingClientRect();
        [...container.querySelectorAll("[onclick], img, svg, i")]
          .filter((control) => {
            const bounds = control.getBoundingClientRect();
            const sameRow = bounds.bottom >= coordinateBounds.top - 12 && bounds.top <= coordinateBounds.bottom + 12;
            const nearby = bounds.left >= coordinateBounds.right - 8 && bounds.left <= coordinateBounds.right + 100;
            return isVisible(control) && sameRow && nearby;
          })
          .forEach(add);
      }
    }
    return candidates.slice(0, 6);
  }

  function fillCoordinateEditor() {
    if (!syncPayload) return false;
    const editor = findSolvedCoordinateEditor();
    if (!editor) return false;
    const input = editor.field;
    if (input.value !== syncPayload.coordinateText) {
      setInputValue(input, syncPayload.coordinateText);
      input.focus();
      input.select?.();
      toast("Corrected coordinate filled. Review it, then choose Save on Geocaching.", false);
    }
    input.dataset.geostatsFilled = "true";
    const save = document.getElementById("geostats-sync-save");
    if (save) save.style.display = "block";
    const instructions = document.getElementById("geostats-sync-instructions");
    if (instructions && !syncSubmissionStarted) instructions.textContent = "The Change To field is filled. Review it, then choose Save on Geocaching.";
    return true;
  }

  function waitForCoordinateEditor(timeoutMs) {
    return new Promise((resolve) => {
      const started = Date.now();
      const timer = window.setInterval(() => {
        if (fillCoordinateEditor() || hasVisibleSolvedCoordinatePopup()) {
          window.clearInterval(timer);
          resolve(true);
          return;
        }
        if (Date.now() - started >= timeoutMs) {
          window.clearInterval(timer);
          resolve(false);
        }
      }, 100);
    });
  }

  async function openAndFillCoordinateEditor() {
    if (fillCoordinateEditor()) return true;
    if (hasVisibleSolvedCoordinatePopup()) return true;
    const instructions = document.getElementById("geostats-sync-instructions");
    const triggers = findCoordinateEditorTriggers();
    for (let index = 0; index < triggers.length; index += 1) {
      if (fillCoordinateEditor() || hasVisibleSolvedCoordinatePopup()) return true;
      if (instructions) instructions.textContent = "Opening Geocaching's coordinate editor (attempt " + (index + 1) + " of " + triggers.length + ")…";
      triggers[index].dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, view: window }));
      if (await waitForCoordinateEditor(1500)) return true;
    }
    return false;
  }

  function submitSolvedCoordinate() {
    if (!syncPayload || syncSubmissionStarted) return;
    const editor = findSolvedCoordinateEditor();
    if (!editor || editor.field.value.trim() !== syncPayload.coordinateText.trim()) {
      toast("Open the solved-coordinate popup so Geostats can fill it first.", true);
      return;
    }
    const knownSubmit = document.querySelector(".btn-cc-parse");
    const submit = knownSubmit && isVisible(knownSubmit) ? knownSubmit : [...editor.container.querySelectorAll("button, input[type='button'], input[type='submit']")].find((control) => {
      const label = (control.textContent || control.value || "").trim();
      return /^submit$/i.test(label) && isVisible(control);
    });
    if (!submit) {
      toast("The Geocaching Submit button was not found. Submit the filled value manually.", true);
      return;
    }

    syncSubmissionStarted = true;
    const save = document.getElementById("geostats-sync-save");
    if (save) {
      save.disabled = true;
      save.textContent = "Saving…";
    }
    submit.click();

    let attempts = 0;
    const acceptTimer = window.setInterval(() => {
      attempts += 1;
      const accept = [...document.querySelectorAll("button, input[type='button'], input[type='submit']")].find((control) => {
        const label = (control.textContent || control.value || "").trim();
        return /^accept$/i.test(label) && isVisible(control);
      });
      if (accept) {
        window.clearInterval(acceptTimer);
        accept.click();
        toast("Coordinate submitted. Waiting for Geocaching to confirm it.", false);
        return;
      }
      if (attempts >= 50) {
        window.clearInterval(acceptTimer);
        syncSubmissionStarted = false;
        if (save) {
          save.disabled = false;
          save.textContent = "Save on Geocaching";
        }
        toast("Confirm the coordinate with Geocaching's Accept button.", true);
      }
    }, 100);
  }

  function returnSyncReceipt() {
    if (!syncPayload || syncReceiptReturned) return;
    syncReceiptReturned = true;
    const receipt = {
      cacheId: syncPayload.cacheId,
      attemptId: syncPayload.attemptId,
      gcCode: syncPayload.gcCode,
      latitude: syncPayload.latitude,
      longitude: syncPayload.longitude,
      syncedAt: new Date().toISOString()
    };
    GM_setValue(SYNC_RECEIPT_PREFIX + syncPayload.attemptId, JSON.stringify(receipt));
    removePendingSyncPayload();
    const nextPayload = pendingSyncPayloads()[0];
    if (nextPayload) {
      setSyncPanelState("Sync complete. Moving to the next solved cache…", "success");
      window.setTimeout(() => {
        const target = "https://coord.info/" + encodeURIComponent(nextPayload.gcCode) + "#geostats-sync=" + encodeURIComponent(JSON.stringify(nextPayload));
        window.location.assign(target);
      }, 500);
      return;
    }
    setSyncPanelState("Sync complete. Closing this temporary tab…", "success");
    window.close();
  }

  function addSyncPanel() {
    if (!syncPayload || document.getElementById("geostats-sync-panel")) return;
    const panel = document.createElement("section");
    panel.id = "geostats-sync-panel";
    Object.assign(panel.style, { position: "fixed", right: "22px", bottom: "82px", zIndex: "2147483646", width: "min(360px, calc(100vw - 44px))", padding: "16px", border: "1px solid #79d99d", borderRadius: "10px", color: "#f4f7f2", background: "#15261d", boxShadow: "0 16px 45px rgba(0,0,0,.45)", font: "14px/1.4 system-ui" });

    const title = document.createElement("strong");
    title.textContent = "Automatic coordinate sync · v${MYSTERY_USERSCRIPT_VERSION}";
    title.style.display = "block";
    title.style.marginBottom = "7px";

    const coordinate = document.createElement("code");
    coordinate.textContent = syncPayload.coordinateText;
    Object.assign(coordinate.style, { display: "block", margin: "8px 0", padding: "8px", borderRadius: "6px", color: "#b9f5cf", background: "rgba(0,0,0,.25)", font: "600 13px monospace" });

    const instructions = document.createElement("span");
    instructions.id = "geostats-sync-instructions";
    instructions.textContent = "Preparing automatic sync…";
    Object.assign(instructions.style, { display: "block", color: "#d5ddd7", fontSize: "12px" });

    const actions = document.createElement("div");
    Object.assign(actions.style, { display: "flex", flexWrap: "wrap", gap: "8px", marginTop: "12px" });
    const save = document.createElement("button");
    save.id = "geostats-sync-save";
    save.type = "button";
    save.textContent = "Retry automatic sync";
    save.addEventListener("click", () => {
      directSyncStarted = false;
      void performDirectSync();
    });
    Object.assign(save.style, { display: "none", flex: "1", padding: "8px 10px", border: "0", borderRadius: "6px", color: "#07110b", background: "#5fbf85", cursor: "pointer", fontWeight: "700" });
    const copy = document.createElement("button");
    copy.type = "button";
    copy.textContent = "Copy coordinate";
    copy.addEventListener("click", () => toast(copyText(syncPayload.coordinateText) ? "Coordinate copied" : "Could not copy coordinate", false));
    Object.assign(copy.style, { padding: "8px 10px", border: "1px solid #557363", borderRadius: "6px", color: "white", background: "transparent", cursor: "pointer", fontWeight: "700" });

    const complete = document.createElement("button");
    complete.type = "button";
    complete.disabled = true;
    complete.textContent = "Waiting for save…";
    Object.assign(complete.style, { display: "none", flex: "1", padding: "8px 10px", border: "0", borderRadius: "6px", color: "#07110b", background: "#769182", cursor: "not-allowed", fontWeight: "700" });
    complete.addEventListener("click", returnSyncReceipt);
    actions.append(save, copy, complete);
    panel.append(title, coordinate, instructions, actions);
    document.body.appendChild(panel);
    window.setTimeout(() => void performDirectSync(), 250);
  }

  function importCache() {
    const data = pageData();
    if (!/^GC[A-Z0-9]+$/i.test(data.gcCode || "") || !data.name) {
      toast("Geostats could not identify this cache page.", true);
      return;
    }
    if (!Number.isFinite(data.latitude) || !Number.isFinite(data.longitude)) {
      toast("Open the cache coordinates on the page, then try again.", true);
      return;
    }
    const target = GEOSTATS_URL + "#mystery-import=" + encodeURIComponent(JSON.stringify(data));
    window.open(target, "_blank", "noopener,noreferrer");
    toast(data.gcCode + " sent to Geostats", false);
  }

  function addButton() {
    if (document.getElementById("geostats-mystery-import")) return;
    const button = document.createElement("button");
    button.id = "geostats-mystery-import";
    button.type = "button";
    button.textContent = "Import to Geostats";
    button.addEventListener("click", importCache);
    Object.assign(button.style, { position: "fixed", right: "22px", bottom: "22px", zIndex: "2147483646", padding: "12px 17px", border: "1px solid #79d99d", borderRadius: "9px", color: "#07110b", background: "#5fbf85", boxShadow: "0 12px 35px rgba(0,0,0,.3)", cursor: "pointer", font: "700 14px system-ui" });
    document.body.appendChild(button);
  }

  addButton();
  addSyncPanel();
  if (hasSyncRequest && !syncPayload) {
    toast("Geostats could not read this sync request. Update the helper and try again.", true);
  }
  new MutationObserver(() => {
    addButton();
    addSyncPanel();
  }).observe(document.documentElement, { childList: true, subtree: true });
  if (typeof GM_registerMenuCommand === "function") GM_registerMenuCommand("Import this cache to Geostats", importCache);
})();
`;
}

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
