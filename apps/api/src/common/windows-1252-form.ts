const windows1252 = new TextDecoder("windows-1252");

function hexValue(byte: number) {
  if (byte >= 48 && byte <= 57) return byte - 48;
  if (byte >= 65 && byte <= 70) return byte - 55;
  if (byte >= 97 && byte <= 102) return byte - 87;
  return -1;
}

function decodeComponent(input: Buffer) {
  const decoded: number[] = [];
  for (let index = 0; index < input.length; index += 1) {
    const byte = input[index];
    if (byte === 43) {
      decoded.push(32);
      continue;
    }
    if (byte === 37 && index + 2 < input.length) {
      const high = hexValue(input[index + 1]);
      const low = hexValue(input[index + 2]);
      if (high >= 0 && low >= 0) {
        decoded.push(high * 16 + low);
        index += 2;
        continue;
      }
    }
    decoded.push(byte);
  }
  return windows1252.decode(Uint8Array.from(decoded));
}

export function parseWindows1252Form(body: Buffer): Record<string, string | string[]> {
  const result: Record<string, string | string[]> = {};
  for (const pair of body.toString("latin1").split("&")) {
    if (!pair) continue;
    const separator = pair.indexOf("=");
    const keyBytes = Buffer.from(separator < 0 ? pair : pair.slice(0, separator), "latin1");
    const valueBytes = Buffer.from(separator < 0 ? "" : pair.slice(separator + 1), "latin1");
    const key = decodeComponent(keyBytes);
    const value = decodeComponent(valueBytes);
    const current = result[key];
    if (current === undefined) result[key] = value;
    else if (Array.isArray(current)) current.push(value);
    else result[key] = [current, value];
  }
  return result;
}
