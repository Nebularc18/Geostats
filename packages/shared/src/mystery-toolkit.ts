import { parseCoordinate, type ParsedCoordinate } from "./index";

const MORSE_BY_CHAR: Record<string, string> = {
  A: ".-", B: "-...", C: "-.-.", D: "-..", E: ".", F: "..-.", G: "--.", H: "....",
  I: "..", J: ".---", K: "-.-", L: ".-..", M: "--", N: "-.", O: "---", P: ".--.",
  Q: "--.-", R: ".-.", S: "...", T: "-", U: "..-", V: "...-", W: ".--", X: "-..-",
  Y: "-.--", Z: "--..",
  "0": "-----", "1": ".----", "2": "..---", "3": "...--", "4": "....-",
  "5": ".....", "6": "-....", "7": "--...", "8": "---..", "9": "----."
};

const CHAR_BY_MORSE: Record<string, string> = Object.fromEntries(
  Object.entries(MORSE_BY_CHAR).map(([char, code]) => [code, char])
);

export function caesarShift(text: string, shift: number): string {
  const normalized = ((shift % 26) + 26) % 26;
  return text.replace(/[a-zA-Z]/g, (char) => {
    const base = char <= "Z" ? 65 : 97;
    return String.fromCharCode(((char.charCodeAt(0) - base + normalized) % 26) + base);
  });
}

export function rot13(text: string): string {
  return caesarShift(text, 13);
}

export function atbash(text: string): string {
  return text.replace(/[a-zA-Z]/g, (char) => {
    const base = char <= "Z" ? 65 : 97;
    return String.fromCharCode(base + (25 - (char.charCodeAt(0) - base)));
  });
}

export function reverseText(text: string): string {
  return Array.from(text).reverse().join("");
}

export function a1z26Encode(text: string): { encoded: string; wordValue: number; digitalRoot: number } {
  const values: number[] = [];
  const encoded = text
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .map((word) =>
      Array.from(word)
        .map((char) => {
          const upper = char.toUpperCase();
          const code = upper.charCodeAt(0);
          if (code >= 65 && code <= 90) {
            const value = code - 64;
            values.push(value);
            return String(value);
          }
          return char;
        })
        .join("-")
    )
    .join(" / ");
  const wordValue = values.reduce((sum, value) => sum + value, 0);
  let digitalRoot = wordValue;
  while (digitalRoot >= 10) {
    digitalRoot = String(digitalRoot)
      .split("")
      .reduce((sum, digit) => sum + Number(digit), 0);
  }
  return { encoded, wordValue, digitalRoot };
}

export function a1z26Decode(text: string): string {
  return text
    .trim()
    .split("/")
    .map((word) =>
      word
        .trim()
        .split(/[\s,;-]+/)
        .filter(Boolean)
        .map((token) => {
          const value = Number(token);
          if (Number.isInteger(value) && value >= 1 && value <= 26) {
            return String.fromCharCode(64 + value);
          }
          return token;
        })
        .join("")
    )
    .join(" ");
}

export function morseEncode(text: string): string {
  return text
    .toUpperCase()
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .map((word) =>
      Array.from(word)
        .map((char) => MORSE_BY_CHAR[char] ?? char)
        .join(" ")
    )
    .join(" / ");
}

export function morseDecode(text: string): string {
  return text
    .trim()
    .split(/\s*\/\s*|\s{3,}/)
    .map((word) =>
      word
        .trim()
        .split(/\s+/)
        .filter(Boolean)
        .map((token) => CHAR_BY_MORSE[token] ?? "?")
        .join("")
    )
    .join(" ");
}

export function base64Encode(text: string): string {
  if (typeof Buffer !== "undefined") {
    return Buffer.from(text, "utf8").toString("base64");
  }
  const bytes = new TextEncoder().encode(text);
  let binary = "";
  bytes.forEach((byte) => {
    binary += String.fromCharCode(byte);
  });
  return btoa(binary);
}

export function base64Decode(text: string): string | null {
  try {
    const cleaned = text.trim().replace(/\s+/g, "");
    if (!cleaned) return "";
    if (typeof Buffer !== "undefined") {
      return Buffer.from(cleaned, "base64").toString("utf8");
    }
    const binary = atob(cleaned);
    const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
    return new TextDecoder().decode(bytes);
  } catch {
    return null;
  }
}

export function parseAnyCoordinate(value: string): ParsedCoordinate | null {
  const direct = parseCoordinate(value);
  if (direct) return direct;

  const dms = value.match(
    /^\s*([NS])\s*(\d{1,2})\s*°?\s*(\d{1,2})\s*['’′]?\s*(\d{1,2}(?:\.\d+)?)\s*["”″]?\s*[,;]?\s*([EW])\s*(\d{1,3})\s*°?\s*(\d{1,2})\s*['’′]?\s*(\d{1,2}(?:\.\d+)?)\s*["”″]?\s*$/i
  );
  if (!dms) return null;

  const latDeg = Number(dms[2]);
  const latMin = Number(dms[3]);
  const latSec = Number(dms[4]);
  const lonDeg = Number(dms[6]);
  const lonMin = Number(dms[7]);
  const lonSec = Number(dms[8]);
  if (latMin >= 60 || latSec >= 60 || lonMin >= 60 || lonSec >= 60) return null;

  const latitude = (latDeg + latMin / 60 + latSec / 3600) * (dms[1]!.toUpperCase() === "S" ? -1 : 1);
  const longitude = (lonDeg + lonMin / 60 + lonSec / 3600) * (dms[5]!.toUpperCase() === "W" ? -1 : 1);
  if (Math.abs(latitude) > 90 || Math.abs(longitude) > 180) return null;
  return { latitude, longitude };
}

export function formatCoordinateDdm(latitude: number, longitude: number): string {
  const formatAxis = (value: number, positive: string, negative: string, degreeWidth: number) => {
    const hemisphere = value < 0 ? negative : positive;
    const abs = Math.abs(value);
    let degrees = Math.floor(abs);
    let minutes = (abs - degrees) * 60;
    if (minutes >= 59.9995) {
      degrees += 1;
      minutes = 0;
    }
    return `${hemisphere} ${String(degrees).padStart(degreeWidth, "0")}° ${minutes.toFixed(3).padStart(6, "0")}`;
  };
  return `${formatAxis(latitude, "N", "S", 2)} ${formatAxis(longitude, "E", "W", 3)}`;
}

export function formatCoordinateDms(latitude: number, longitude: number): string {
  const formatAxis = (value: number, positive: string, negative: string, degreeWidth: number) => {
    const hemisphere = value < 0 ? negative : positive;
    const abs = Math.abs(value);
    let degrees = Math.floor(abs);
    const totalMinutes = (abs - degrees) * 60;
    let minutes = Math.floor(totalMinutes);
    let seconds = (totalMinutes - minutes) * 60;
    if (seconds >= 59.95) {
      seconds = 0;
      minutes += 1;
      if (minutes >= 60) {
        minutes = 0;
        degrees += 1;
      }
    }
    return `${hemisphere} ${String(degrees).padStart(degreeWidth, "0")}° ${String(minutes).padStart(2, "0")}' ${seconds.toFixed(1).padStart(4, "0")}"`;
  };
  return `${formatAxis(latitude, "N", "S", 2)} ${formatAxis(longitude, "E", "W", 3)}`;
}

export function formatCoordinateDd(latitude: number, longitude: number): string {
  return `${latitude.toFixed(6)}, ${longitude.toFixed(6)}`;
}

export type ProjectionUnit = "m" | "km" | "ft" | "mi";

const METERS_PER_UNIT: Record<ProjectionUnit, number> = {
  m: 1,
  km: 1000,
  ft: 0.3048,
  mi: 1609.344
};

const EARTH_RADIUS_METERS = 6_371_000;

export function projectCoordinate(
  latitude: number,
  longitude: number,
  distance: number,
  bearingDegrees: number,
  unit: ProjectionUnit = "m"
): ParsedCoordinate {
  const distanceMeters = distance * (METERS_PER_UNIT[unit] ?? 1);
  const angularDistance = distanceMeters / EARTH_RADIUS_METERS;
  const bearing = (bearingDegrees * Math.PI) / 180;
  const lat1 = (latitude * Math.PI) / 180;
  const lon1 = (longitude * Math.PI) / 180;

  const lat2 = Math.asin(
    Math.sin(lat1) * Math.cos(angularDistance) +
      Math.cos(lat1) * Math.sin(angularDistance) * Math.cos(bearing)
  );
  const lon2 =
    lon1 +
    Math.atan2(
      Math.sin(bearing) * Math.sin(angularDistance) * Math.cos(lat1),
      Math.cos(angularDistance) - Math.sin(lat1) * Math.sin(lat2)
    );

  const normalizedLon = ((((lon2 * 180) / Math.PI) + 540) % 360) - 180;
  return {
    latitude: Number(((lat2 * 180) / Math.PI).toFixed(6)),
    longitude: Number(normalizedLon.toFixed(6))
  };
}
