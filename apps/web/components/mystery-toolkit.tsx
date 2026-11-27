"use client";

import { useMemo, useState } from "react";
import { Compass, Copy, KeyRound, Plus, Wrench } from "lucide-react";
import { copyText } from "../lib/copy-text";
import {
  a1z26Decode,
  a1z26Encode,
  atbash,
  base64Decode,
  base64Encode,
  caesarShift,
  formatCoordinateDd,
  formatCoordinateDdm,
  formatCoordinateDms,
  morseDecode,
  morseEncode,
  parseAnyCoordinate,
  projectCoordinate,
  reverseText,
  rot13,
  type ProjectionUnit
} from "@geostats/shared";

type ToolkitTab = "ciphers" | "project" | "convert";

export function MysteryToolkit({
  publishedLatitude,
  publishedLongitude,
  onUseCoordinate
}: {
  publishedLatitude: number;
  publishedLongitude: number;
  onUseCoordinate?: (latitude: number, longitude: number, label: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState<ToolkitTab>("ciphers");

  const [cipherInput, setCipherInput] = useState("");
  const [caesarAmount, setCaesarAmount] = useState(13);

  const [distance, setDistance] = useState("150");
  const [unit, setUnit] = useState<ProjectionUnit>("m");
  const [bearing, setBearing] = useState("90");

  const [convertInput, setConvertInput] = useState(() => formatCoordinateDdm(publishedLatitude, publishedLongitude));
  const [copiedText, setCopiedText] = useState<string | null>(null);

  const a1 = useMemo(() => a1z26Encode(cipherInput), [cipherInput]);
  const b64Decoded = useMemo(() => base64Decode(cipherInput), [cipherInput]);

  const projected = useMemo(() => {
    const parsedDistance = Number(distance);
    const parsedBearing = Number(bearing);
    if (!Number.isFinite(parsedDistance) || parsedDistance < 0 || !Number.isFinite(parsedBearing)) {
      return null;
    }
    return projectCoordinate(publishedLatitude, publishedLongitude, parsedDistance, parsedBearing, unit);
  }, [publishedLatitude, publishedLongitude, distance, bearing, unit]);

  const converted = useMemo(() => parseAnyCoordinate(convertInput), [convertInput]);

  async function copy(value: string) {
    if (!value) return;
    const ok = await copyText(value).catch(() => false);
    if (!ok) return;
    setCopiedText(value);
    window.setTimeout(() => setCopiedText((current) => (current === value ? null : current)), 1500);
  }

  return (
    <section className="mystery-toolkit">
      <button type="button" className="mystery-toolkit-toggle" aria-expanded={open} onClick={() => setOpen((value) => !value)}>
        <span>
          <Wrench size={16} />
          <strong>Solver toolkit</strong>
          <small className="muted">ROT13, Caesar, A1Z26, Morse, Base64, coordinate projection & converter</small>
        </span>
        <span>{open ? "Hide" : "Open"}</span>
      </button>

      {open ? (
        <div className="mystery-toolkit-body">
          <div className="mystery-toolkit-tabs">
            <button type="button" className={tab === "ciphers" ? "active" : ""} onClick={() => setTab("ciphers")}>
              <KeyRound size={14} /> Ciphers & text
            </button>
            <button type="button" className={tab === "project" ? "active" : ""} onClick={() => setTab("project")}>
              <Compass size={14} /> Project waypoint
            </button>
            <button type="button" className={tab === "convert" ? "active" : ""} onClick={() => setTab("convert")}>
              Convert coords
            </button>
          </div>

          {tab === "ciphers" ? (
            <div className="mystery-toolkit-panel">
              <textarea
                rows={3}
                placeholder="Paste puzzle text, numbers (1-26), Morse (.- / -...), or Base64…"
                value={cipherInput}
                onChange={(event) => setCipherInput(event.target.value)}
              />
              <div className="mystery-toolkit-caesar">
                <label>
                  <span>Caesar shift: {caesarAmount}</span>
                  <input type="range" min={1} max={25} value={caesarAmount} onChange={(event) => setCaesarAmount(Number(event.target.value))} />
                </label>
              </div>
              {cipherInput.trim() ? (
                <div className="mystery-toolkit-results">
                  {[
                    { label: "ROT13", value: rot13(cipherInput) },
                    { label: `Caesar (+${caesarAmount})`, value: caesarShift(cipherInput, caesarAmount) },
                    { label: "Atbash", value: atbash(cipherInput) },
                    { label: "Reversed", value: reverseText(cipherInput) },
                    { label: `A1Z26 (sum ${a1.wordValue}, root ${a1.digitalRoot})`, value: a1.encoded },
                    { label: "A1Z26 → Text", value: a1z26Decode(cipherInput) },
                    { label: "Morse → Text", value: morseDecode(cipherInput) },
                    { label: "Text → Morse", value: morseEncode(cipherInput) },
                    { label: "Base64 → Text", value: b64Decoded ?? "Invalid Base64" },
                    { label: "Text → Base64", value: base64Encode(cipherInput) }
                  ].map((row) => (
                    <div key={row.label} className="mystery-toolkit-row">
                      <span>{row.label}</span>
                      <code>{row.value}</code>
                      <button type="button" className="text-button" onClick={() => copy(row.value)} aria-label={`Copy ${row.label}`}>
                        <Copy size={13} /> {copiedText === row.value ? "Copied" : "Copy"}
                      </button>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="muted">Enter text above to see instant cipher decodings and letter-value sums.</p>
              )}
            </div>
          ) : null}

          {tab === "project" ? (
            <div className="mystery-toolkit-panel">
              <p className="muted">
                Starting from published coordinates: <strong>{formatCoordinateDdm(publishedLatitude, publishedLongitude)}</strong>
              </p>
              <div className="mystery-toolkit-inline">
                <label>
                  <span>Distance</span>
                  <input type="number" min={0} step="any" value={distance} onChange={(event) => setDistance(event.target.value)} />
                </label>
                <label>
                  <span>Unit</span>
                  <select value={unit} onChange={(event) => setUnit(event.target.value as ProjectionUnit)}>
                    <option value="m">Meters (m)</option>
                    <option value="km">Kilometers (km)</option>
                    <option value="ft">Feet (ft)</option>
                    <option value="mi">Miles (mi)</option>
                  </select>
                </label>
                <label>
                  <span>Bearing (°)</span>
                  <input type="number" min={0} max={360} step="any" value={bearing} onChange={(event) => setBearing(event.target.value)} />
                </label>
              </div>
              {projected ? (
                <div className="mystery-toolkit-results">
                  <div className="mystery-toolkit-row">
                    <span>DDM</span>
                    <code>{formatCoordinateDdm(projected.latitude, projected.longitude)}</code>
                    <button type="button" className="text-button" onClick={() => copy(formatCoordinateDdm(projected.latitude, projected.longitude))}>
                      <Copy size={13} /> Copy
                    </button>
                  </div>
                  <div className="mystery-toolkit-row">
                    <span>Decimal</span>
                    <code>{formatCoordinateDd(projected.latitude, projected.longitude)}</code>
                    <button type="button" className="text-button" onClick={() => copy(formatCoordinateDd(projected.latitude, projected.longitude))}>
                      <Copy size={13} /> Copy
                    </button>
                  </div>
                  {onUseCoordinate ? (
                    <button
                      type="button"
                      className="primary-button"
                      onClick={() => onUseCoordinate(projected.latitude, projected.longitude, `Projected ${distance}${unit} @ ${bearing}°`)}
                    >
                      <Plus size={15} /> Add as coordinate attempt
                    </button>
                  ) : null}
                </div>
              ) : null}
            </div>
          ) : null}

          {tab === "convert" ? (
            <div className="mystery-toolkit-panel">
              <label>
                <span>Coordinate (DDM, DD, or DMS)</span>
                <input
                  value={convertInput}
                  onChange={(event) => setConvertInput(event.target.value)}
                  placeholder="N 56° 10.500 E 015° 35.250"
                />
              </label>
              {converted ? (
                <div className="mystery-toolkit-results">
                  {[
                    { label: "DDM (Geocaching)", value: formatCoordinateDdm(converted.latitude, converted.longitude) },
                    { label: "Decimal (DD)", value: formatCoordinateDd(converted.latitude, converted.longitude) },
                    { label: "DMS", value: formatCoordinateDms(converted.latitude, converted.longitude) }
                  ].map((row) => (
                    <div key={row.label} className="mystery-toolkit-row">
                      <span>{row.label}</span>
                      <code>{row.value}</code>
                      <button type="button" className="text-button" onClick={() => copy(row.value)}>
                        <Copy size={13} /> {copiedText === row.value ? "Copied" : "Copy"}
                      </button>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="muted">Enter valid coordinates in DDM, decimal degrees, or DMS format.</p>
              )}
            </div>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}
