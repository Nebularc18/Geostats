import { NextRequest, NextResponse } from "next/server";
import { cachePageShowsCoordinate } from "../../../lib/mystery-coordinate-confirmation";
import { solvedCoordinateEditorFromPage } from "../../../lib/mystery-coordinate-editor";
import { locationFromCachePageMetadata } from "../../../lib/mystery-area";
import { locationFromPageSources } from "../../../lib/mystery-page-location";
import { personalCacheNoteEditorFromPage, personalCacheNoteFromPage } from "../../../lib/mystery-personal-note";
import { MYSTERY_USERSCRIPT_VERSION } from "../../../lib/mystery-userscript";

function userscript(appOrigin: string) {
  return `// ==UserScript==
// @name         Geostats Mystery Importer
// @namespace    ${appOrigin}
// @version      ${MYSTERY_USERSCRIPT_VERSION}
// @description  Import mystery caches and sync corrected coordinates and personal cache notes with Geostats.
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
// @run-at       document-idle
// ==/UserScript==

(function () {
  "use strict";

  const GEOSTATS_ORIGIN = ${JSON.stringify(appOrigin)};
  const GEOSTATS_URL = ${JSON.stringify(`${appOrigin}/mysteries`)};
  const PENDING_SYNC_KEY = "geostats-pending-coordinate-sync";
  const SYNC_RECEIPT_KEY = "geostats-coordinate-sync-receipt";
  const SYNC_RECEIPT_PREFIX = SYNC_RECEIPT_KEY + ":";
  const PENDING_NOTE_SYNC_KEY = "geostats-pending-note-sync";
  const NOTE_SYNC_RECEIPT_PREFIX = "geostats-note-sync-receipt:";
  const MAX_SYNC_AGE_MS = 10 * 60 * 1000;
  const MAX_COORDINATE_EDITOR_ATTEMPTS = 4;
  const MAX_COORDINATE_PAGE_RELOADS = 1;
  const cachePageShowsCoordinate = ${cachePageShowsCoordinate.toString()};
  const solvedCoordinateEditorFromPage = ${solvedCoordinateEditorFromPage.toString()};
  const personalCacheNoteFromPage = ${personalCacheNoteFromPage.toString()};
  const personalCacheNoteEditorFromPage = ${personalCacheNoteEditorFromPage.toString()};

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
    document.addEventListener("geostats-note-sync-request", () => {
      try {
        const request = document.documentElement.getAttribute("data-geostats-note-sync-request");
        const value = JSON.parse(request || "null");
        const valid = value &&
          typeof value.cacheId === "string" &&
          /^GC[A-Z0-9]+$/i.test(value.gcCode || "") &&
          typeof value.notes === "string" &&
          value.notes.length <= 100000 &&
          Number.isFinite(value.issuedAt);
        const acknowledgement = value?.cacheId + ":" + value?.issuedAt;
        if (valid && acknowledgement) {
          GM_setValue(PENDING_NOTE_SYNC_KEY, JSON.stringify(value));
          document.documentElement.setAttribute("data-geostats-note-sync-ready", acknowledgement);
          document.dispatchEvent(new Event("geostats-note-sync-ready"));
        }
      } catch {
        // Ignore malformed requests.
      }
    });
    const deliverSyncReceipt = () => {
      const keys = GM_listValues().filter((key) => key === SYNC_RECEIPT_KEY || key.startsWith(SYNC_RECEIPT_PREFIX) || key.startsWith(NOTE_SYNC_RECEIPT_PREFIX));
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
  const hasNoteSyncRequest = new URLSearchParams(location.hash.replace(/^#/, "")).has("geostats-note-sync");
  const syncPayload = readSyncPayload();
  const noteSyncPayload = readNoteSyncPayload();
  let syncSubmissionStarted = false;
  let syncReceiptReturned = false;
  let directSyncStarted = false;
  let useCoordinateEditor = false;
  let noteSubmissionStarted = false;
  let noteReceiptReturned = false;
  let noteEditorReady = false;

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

  function readNoteSyncPayload() {
    const encoded = new URLSearchParams(location.hash.replace(/^#/, "")).get("geostats-note-sync");
    if (!encoded) return null;
    try {
      const value = JSON.parse(encoded);
      const pending = JSON.parse(GM_getValue(PENDING_NOTE_SYNC_KEY, "null"));
      const pageCode = (location.pathname.match(/\\/geocache\\/(GC[A-Z0-9]+)/i)?.[1] || new URLSearchParams(location.search).get("wp") || "").toUpperCase();
      if (
        !pending ||
        typeof value.cacheId !== "string" ||
        typeof value.gcCode !== "string" ||
        value.gcCode.toUpperCase() !== pageCode ||
        typeof value.notes !== "string" ||
        value.notes.length > 100000 ||
        !Number.isFinite(value.issuedAt) ||
        Date.now() - value.issuedAt > MAX_SYNC_AGE_MS ||
        Date.now() - value.issuedAt < -30000 ||
        pending.cacheId !== value.cacheId ||
        pending.gcCode !== value.gcCode ||
        pending.notes !== value.notes ||
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
      "[class*='CacheLocation']"
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
    const personalNote = personalCacheNoteFromPage(document);
    const notes = personalNote.available ? { notes: personalNote.note } : {};
    return coordinates ? { gcCode, name, ...pageLocationData, ...coordinates, ...notes } : { gcCode, name, ...pageLocationData, ...notes };
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

  function syncStorageKey() {
    return syncPayload ? "geostats-synced:" + syncPayload.gcCode + ":" + syncPayload.attemptId : "";
  }

  function syncReloadStorageKey() {
    return syncPayload ? "geostats-sync-reloads:" + syncPayload.gcCode + ":" + syncPayload.attemptId : "";
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

  function setSyncPanelState(message, state) {
    const instructions = document.getElementById("geostats-sync-instructions");
    const retry = document.getElementById("geostats-sync-save");
    if (instructions) instructions.textContent = message;
    if (retry) {
      retry.style.display = state === "error" || state === "editor" ? "block" : "none";
      retry.disabled = false;
      retry.textContent = state === "editor" ? "Save on Geocaching" : "Retry coordinate sync";
    }
  }

  function markCoordinateSynced() {
    if (!syncPayload || syncReceiptReturned) return;
    window.localStorage.setItem(syncStorageKey(), new Date().toISOString());
    window.sessionStorage.removeItem(syncReloadStorageKey());
    removePendingSyncPayload();
    setSyncPanelState("Corrected coordinate saved. Returning to Geostats…", "success");
    toast("Corrected coordinate saved on Geocaching", false);
    window.setTimeout(returnSyncReceipt, 700);
  }

  function waitForSyncedCoordinate(timeoutMs) {
    return new Promise((resolve) => {
      const started = Date.now();
      const timer = window.setInterval(() => {
        if (cachePageShowsCoordinate(document, syncPayload)) {
          window.clearInterval(timer);
          resolve(true);
          return;
        }
        if (Date.now() - started >= timeoutMs) {
          window.clearInterval(timer);
          resolve(false);
        }
      }, 250);
    });
  }

  async function performDirectSync() {
    if (!syncPayload || directSyncStarted || syncReceiptReturned) return;
    directSyncStarted = true;
    setSyncPanelState("Opening Geocaching's solved-coordinate editor…", "loading");

    if (window.localStorage.getItem(syncStorageKey())) {
      removePendingSyncPayload();
      setSyncPanelState("This coordinate was already accepted by Geocaching. Returning to Geostats…", "success");
      window.setTimeout(returnSyncReceipt, 500);
      return;
    }

    if (cachePageShowsCoordinate(document, syncPayload)) {
      markCoordinateSynced();
      return;
    }

    const editorOpened = await openAndFillCoordinateEditor();
    if (editorOpened && findSolvedCoordinateEditor()) {
      useCoordinateEditor = true;
      directSyncStarted = false;
      setSyncPanelState("The coordinate is filled. Saving it on Geocaching...", "loading");
      submitSolvedCoordinate();
      return;
    }

    directSyncStarted = false;
    const reloadKey = syncReloadStorageKey();
    const reloadCount = Number(window.sessionStorage.getItem(reloadKey) || "0");
    if (reloadCount < MAX_COORDINATE_PAGE_RELOADS) {
      window.sessionStorage.setItem(reloadKey, String(reloadCount + 1));
      setSyncPanelState("Geocaching's editor was not ready. Reloading once and continuing automatically...", "loading");
      window.setTimeout(() => window.location.reload(), 500);
      return;
    }

    const message = "Geocaching did not make its coordinate editor available. The sync will remain pending so it can be retried.";
    setSyncPanelState(message, "error");
    toast(message, true);
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

  function findPersonalNoteEditor() {
    return personalCacheNoteEditorFromPage(document, isVisible);
  }

  function setNoteSyncPanelState(message, state) {
    const instructions = document.getElementById("geostats-note-sync-instructions");
    const useGeostats = document.getElementById("geostats-note-use-geostats");
    if (instructions) instructions.textContent = message;
    if (useGeostats) {
      useGeostats.disabled = state === "loading";
      useGeostats.textContent = state === "editor" ? "Save on Geocaching" : "Use Geostats note";
    }
  }

  function noteEditorTriggers() {
    const candidates = [];
    const add = (candidate) => {
      if (candidate && isVisible(candidate) && !candidate.closest("#geostats-note-sync-panel") && !candidates.includes(candidate)) candidates.push(candidate);
    };
    add(document.getElementById("viewCacheNote"));
    add(document.getElementById("cache_note"));
    const noteArea = document.querySelector(".PersonalCacheNote");
    if (noteArea) {
      [...noteArea.querySelectorAll("button, a, [role='button']")].forEach((control) => {
        const label = [control.textContent, control.getAttribute("aria-label"), control.getAttribute("title")].filter(Boolean).join(" ");
        if (/edit|add|enter|note/i.test(label)) add(control);
      });
      add(noteArea);
    }
    return candidates.slice(0, 2);
  }

  function fillPersonalNoteEditor() {
    if (!noteSyncPayload) return false;
    const editor = findPersonalNoteEditor();
    if (!editor) return false;
    const maxLength = Number(editor.field.getAttribute("maxlength") || -1);
    if (maxLength > -1 && noteSyncPayload.notes.length > maxLength) {
      setNoteSyncPanelState("This note is longer than Geocaching allows. Shorten it in Geostats, then try again.", "error");
      return false;
    }
    setInputValue(editor.field, noteSyncPayload.notes);
    editor.field.focus();
    noteEditorReady = true;
    setNoteSyncPanelState("Review the filled personal cache note, then save it on Geocaching.", "editor");
    return true;
  }

  function waitForPersonalNoteEditor(timeoutMs) {
    return new Promise((resolve) => {
      const started = Date.now();
      const timer = window.setInterval(() => {
        if (fillPersonalNoteEditor()) {
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

  async function openPersonalNoteEditor() {
    if (fillPersonalNoteEditor()) return true;
    const triggers = noteEditorTriggers();
    for (const trigger of triggers) {
      trigger.click?.();
      if (await waitForPersonalNoteEditor(2500)) return true;
    }
    return false;
  }

  function waitForPersonalNote(value, timeoutMs) {
    return new Promise((resolve) => {
      const started = Date.now();
      const timer = window.setInterval(() => {
        const current = personalCacheNoteFromPage(document);
        if (current.available && current.note === value) {
          window.clearInterval(timer);
          resolve(true);
          return;
        }
        if (Date.now() - started >= timeoutMs) {
          window.clearInterval(timer);
          resolve(false);
        }
      }, 250);
    });
  }

  function returnNoteSyncReceipt(direction, notes) {
    if (!noteSyncPayload || noteReceiptReturned) return;
    noteReceiptReturned = true;
    const receipt = {
      type: "notes",
      cacheId: noteSyncPayload.cacheId,
      gcCode: noteSyncPayload.gcCode,
      notes,
      geostatsNotes: noteSyncPayload.notes,
      direction,
      syncedAt: new Date().toISOString()
    };
    GM_setValue(NOTE_SYNC_RECEIPT_PREFIX + noteSyncPayload.cacheId, JSON.stringify(receipt));
    GM_deleteValue(PENDING_NOTE_SYNC_KEY);
    setNoteSyncPanelState("Notes synced. Returning to Geostats…", "success");
    toast("Personal cache note synced", false);
    window.setTimeout(() => window.close(), 700);
  }

  async function useGeostatsPersonalNote() {
    if (!noteSyncPayload || noteSubmissionStarted) return;
    if (!noteEditorReady) {
      setNoteSyncPanelState("Opening Geocaching's personal cache note editor…", "loading");
      if (!await openPersonalNoteEditor()) {
        setNoteSyncPanelState("Geocaching's note editor did not open. Open the personal cache note manually, then try again.", "error");
      }
      return;
    }
    const editor = findPersonalNoteEditor();
    if (!editor?.save) {
      setNoteSyncPanelState("The Geocaching Save button was not found. Save the filled note manually, then retry.", "error");
      return;
    }
    noteSubmissionStarted = true;
    setNoteSyncPanelState("Waiting for Geocaching to save the personal cache note…", "loading");
    editor.save.click?.();
    const saved = await waitForPersonalNote(noteSyncPayload.notes, 15000);
    if (saved) {
      returnNoteSyncReceipt("to-geocaching", noteSyncPayload.notes);
      return;
    }
    noteSubmissionStarted = false;
    noteEditorReady = false;
    setNoteSyncPanelState("Geocaching did not confirm the saved note. Check the page, then retry.", "error");
  }

  function addNoteSyncPanel() {
    if (!noteSyncPayload || document.getElementById("geostats-note-sync-panel")) return;
    const current = personalCacheNoteFromPage(document);
    const panel = document.createElement("section");
    panel.id = "geostats-note-sync-panel";
    Object.assign(panel.style, { position: "fixed", right: "22px", bottom: "82px", zIndex: "2147483646", width: "min(390px, calc(100vw - 44px))", padding: "16px", border: "1px solid #79d99d", borderRadius: "10px", color: "#f4f7f2", background: "#15261d", boxShadow: "0 16px 45px rgba(0,0,0,.45)", font: "14px/1.4 system-ui" });
    const title = document.createElement("strong");
    title.textContent = "Personal cache note sync · v${MYSTERY_USERSCRIPT_VERSION}";
    title.style.display = "block";
    title.style.marginBottom = "10px";
    const comparison = document.createElement("div");
    Object.assign(comparison.style, { display: "grid", gridTemplateColumns: "1fr 1fr", gap: "8px" });
    [["Geostats", noteSyncPayload.notes], ["Geocaching", current.note]].forEach(([label, value]) => {
      const box = document.createElement("div");
      const heading = document.createElement("small");
      heading.textContent = label;
      Object.assign(heading.style, { display: "block", marginBottom: "4px", color: "#b9f5cf", fontWeight: "700" });
      const preview = document.createElement("div");
      preview.textContent = value || "No note";
      Object.assign(preview.style, { minHeight: "56px", maxHeight: "110px", overflow: "auto", padding: "8px", borderRadius: "6px", color: value ? "#f4f7f2" : "#9caaa0", background: "rgba(0,0,0,.25)", fontSize: "12px", whiteSpace: "pre-wrap", overflowWrap: "anywhere" });
      box.append(heading, preview);
      comparison.appendChild(box);
    });
    const instructions = document.createElement("span");
    instructions.id = "geostats-note-sync-instructions";
    instructions.textContent = current.available ? "Choose which note to keep." : "Personal cache notes require a signed-in Premium Geocaching account.";
    Object.assign(instructions.style, { display: "block", marginTop: "10px", color: "#d5ddd7", fontSize: "12px" });
    const actions = document.createElement("div");
    Object.assign(actions.style, { display: "flex", flexWrap: "wrap", gap: "8px", marginTop: "12px" });
    const useGeostats = document.createElement("button");
    useGeostats.id = "geostats-note-use-geostats";
    useGeostats.type = "button";
    useGeostats.textContent = "Use Geostats note";
    useGeostats.disabled = !current.available;
    useGeostats.addEventListener("click", () => void useGeostatsPersonalNote());
    Object.assign(useGeostats.style, { flex: "1", padding: "8px 10px", border: "0", borderRadius: "6px", color: "#07110b", background: "#5fbf85", cursor: current.available ? "pointer" : "not-allowed", fontWeight: "700" });
    const useGeocaching = document.createElement("button");
    useGeocaching.type = "button";
    useGeocaching.textContent = "Use Geocaching note";
    useGeocaching.disabled = !current.available;
    useGeocaching.addEventListener("click", () => returnNoteSyncReceipt("from-geocaching", current.note));
    Object.assign(useGeocaching.style, { flex: "1", padding: "8px 10px", border: "1px solid #557363", borderRadius: "6px", color: "white", background: "transparent", cursor: current.available ? "pointer" : "not-allowed", fontWeight: "700" });
    actions.append(useGeostats, useGeocaching);
    panel.append(title, comparison, instructions, actions);
    document.body.appendChild(panel);
    if (current.available && current.note === noteSyncPayload.notes) {
      setNoteSyncPanelState("The notes already match. Returning to Geostats…", "success");
      window.setTimeout(() => returnNoteSyncReceipt("matched", current.note), 500);
    }
  }

  function findSolvedCoordinateEditor() {
    return solvedCoordinateEditorFromPage(document, isVisible);
  }

  function hasVisibleSolvedCoordinatePopup() {
    return Boolean(findSolvedCoordinateEditor());
  }

  function findCoordinateEditorTriggers() {
    const candidates = [];
    const add = (candidate) => {
      if (
        candidate &&
        candidate.matches?.("a, button, [role='button']") &&
        isVisible(candidate) &&
        !candidate.closest("#geostats-sync-panel") &&
        !candidates.includes(candidate)
      ) candidates.push(candidate);
    };
    const selectors = [
      "#uxLatLonLink",
      ".edit-cache-coordinates",
      "button[aria-label*='coordinate' i][aria-label*='edit' i]",
      "a[aria-label*='coordinate' i][aria-label*='edit' i]",
      "button[aria-label*='coordinate' i][aria-label*='correct' i]",
      "a[aria-label*='coordinate' i][aria-label*='correct' i]",
      "button[title*='edit coordinate' i]",
      "a[title*='edit coordinate' i]",
      "button[title*='corrected coordinate' i]",
      "a[title*='corrected coordinate' i]",
      "button[data-testid*='coordinate-edit' i]",
      "a[data-testid*='coordinate-edit' i]",
      "button[data-testid*='edit-coordinate' i]",
      "a[data-testid*='edit-coordinate' i]"
    ];
    for (const selector of selectors) {
      add(document.querySelector(selector));
    }

    return candidates.slice(0, 1);
  }

  function fillCoordinateEditor() {
    if (!syncPayload) return false;
    const editor = findSolvedCoordinateEditor();
    if (!editor) return false;
    const input = editor.field;
    if (input.value !== syncPayload.coordinateText) {
      setInputValue(input, syncPayload.coordinateText);
      input.focus();
    }
    input.dataset.geostatsFilled = "true";
    const instructions = document.getElementById("geostats-sync-instructions");
    if (instructions && !syncSubmissionStarted) instructions.textContent = "The Change To field is filled. Saving it on Geocaching...";
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
    for (let index = 0; index < MAX_COORDINATE_EDITOR_ATTEMPTS; index += 1) {
      if (fillCoordinateEditor() || hasVisibleSolvedCoordinatePopup()) return true;
      const trigger = findCoordinateEditorTriggers()[0];
      if (instructions) instructions.textContent = "Opening Geocaching's coordinate editor (attempt " + (index + 1) + " of " + MAX_COORDINATE_EDITOR_ATTEMPTS + ")...";
      if (typeof trigger?.click === "function") trigger.click();
      else trigger?.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, view: window }));
      if (await waitForCoordinateEditor(2500)) return true;
    }
    return false;
  }

  function adoptManuallyOpenedEditor() {
    if (!syncPayload || syncReceiptReturned || syncSubmissionStarted) return false;
    const existingEditor = findSolvedCoordinateEditor();
    if (useCoordinateEditor && existingEditor?.field.dataset.geostatsFilled === "true") return true;
    if (!fillCoordinateEditor()) return false;
    useCoordinateEditor = true;
    directSyncStarted = false;
    setSyncPanelState("The coordinate is filled. Saving it on Geocaching...", "loading");
    submitSolvedCoordinate();
    return true;
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
      if (cachePageShowsCoordinate(document, syncPayload)) {
        window.clearInterval(acceptTimer);
        markCoordinateSynced();
        return;
      }
      const accept = [...document.querySelectorAll("button, input[type='button'], input[type='submit']")].find((control) => {
        const label = (control.textContent || control.value || "").trim();
        return /^accept$/i.test(label) && isVisible(control);
      });
      if (accept) {
        window.clearInterval(acceptTimer);
        accept.click();
        toast("Coordinate submitted. Waiting for Geocaching to confirm it.", false);
        setSyncPanelState("Waiting for Geocaching to confirm the corrected coordinate…", "loading");
        void waitForSyncedCoordinate(15000).then((synced) => {
          if (synced) {
            markCoordinateSynced();
            return;
          }
          syncSubmissionStarted = false;
          useCoordinateEditor = false;
          setSyncPanelState("Geocaching did not confirm the saved coordinate. Check the page, then retry the sync.", "error");
        });
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
    title.textContent = "Coordinate sync · v${MYSTERY_USERSCRIPT_VERSION}";
    title.style.display = "block";
    title.style.marginBottom = "7px";

    const coordinate = document.createElement("code");
    coordinate.textContent = syncPayload.coordinateText;
    Object.assign(coordinate.style, { display: "block", margin: "8px 0", padding: "8px", borderRadius: "6px", color: "#b9f5cf", background: "rgba(0,0,0,.25)", font: "600 13px monospace" });

    const instructions = document.createElement("span");
    instructions.id = "geostats-sync-instructions";
    instructions.textContent = "Preparing coordinate sync…";
    Object.assign(instructions.style, { display: "block", color: "#d5ddd7", fontSize: "12px" });

    const actions = document.createElement("div");
    Object.assign(actions.style, { display: "flex", flexWrap: "wrap", gap: "8px", marginTop: "12px" });
    const save = document.createElement("button");
    save.id = "geostats-sync-save";
    save.type = "button";
    save.textContent = "Retry coordinate sync";
    save.addEventListener("click", () => {
      if (useCoordinateEditor) {
        submitSolvedCoordinate();
        return;
      }
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
  addNoteSyncPanel();
  if (hasSyncRequest && !syncPayload) {
    toast("Geostats could not read this sync request. Update the helper and try again.", true);
  }
  if (hasNoteSyncRequest && !noteSyncPayload) {
    toast("Geostats could not read this note sync request. Update the helper and try again.", true);
  }
  new MutationObserver(() => {
    addButton();
    addSyncPanel();
    addNoteSyncPanel();
    adoptManuallyOpenedEditor();
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
