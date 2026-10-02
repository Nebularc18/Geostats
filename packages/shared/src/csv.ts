/** Parse delimited records, preserving quoted whitespace and embedded line endings. */
export function parseCsvRows(content: string, delimiter = ",", options: { maxRows?: number } = {}): string[][] {
  const { maxRows } = options;
  if (maxRows !== undefined && (!Number.isSafeInteger(maxRows) || maxRows < 0)) {
    throw new Error("CSV maxRows must be a non-negative safe integer");
  }
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;

  for (let index = 0; index < content.length; index += 1) {
    // Stop before scanning or allocating any part of the next record.
    if (maxRows !== undefined && rows.length >= maxRows) {
      throw new Error("CSV row limit exceeded");
    }
    const character = content[index];
    if (quoted) {
      if (character === '"' && content[index + 1] === '"') {
        field += '"';
        index += 1;
      } else if (character === '"') {
        quoted = false;
      } else {
        field += character;
      }
    } else if (character === '"') {
      quoted = true;
    } else if (character === delimiter) {
      row.push(field);
      field = "";
    } else if (character === "\n" || character === "\r") {
      if (character === "\r" && content[index + 1] === "\n") index += 1;
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else {
      field += character;
    }
  }
  if (quoted) throw new Error("CSV contains an unclosed quoted field");
  if (field || row.length) {
    row.push(field);
    rows.push(row);
  }
  return rows;
}
