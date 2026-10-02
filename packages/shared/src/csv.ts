/** Parse delimited records, preserving quoted whitespace and embedded line endings. */
export function parseCsvRows(content: string, delimiter = ",", options: { maxRows?: number; skipBlankRows?: boolean } = {}): string[][] {
  const { maxRows, skipBlankRows = false } = options;
  if (maxRows !== undefined && (!Number.isSafeInteger(maxRows) || maxRows < 0)) {
    throw new Error("CSV maxRows must be a non-negative safe integer");
  }
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  let nonblank = false;
  const append = (character: string) => {
    if (/\S/u.test(character)) {
      nonblank = true;
      if (maxRows !== undefined && rows.length >= maxRows) throw new Error("CSV row limit exceeded");
    }
    // Once the budget is full, scan blank records without retaining their fields.
    if (maxRows === undefined || rows.length < maxRows) field += character;
  };
  const finishRow = () => {
    if (!skipBlankRows || nonblank) {
      row.push(field);
      rows.push(row);
    }
    row = [];
    field = "";
    nonblank = false;
  };

  for (let index = 0; index < content.length; index += 1) {
    // Stop before scanning or allocating any part of the next record.
    if (!skipBlankRows && maxRows !== undefined && rows.length >= maxRows) {
      throw new Error("CSV row limit exceeded");
    }
    const character = content[index];
    if (quoted) {
      if (character === '"' && content[index + 1] === '"') {
        append('"');
        index += 1;
      } else if (character === '"') {
        quoted = false;
      } else {
        append(character);
      }
    } else if (character === '"') {
      quoted = true;
    } else if (character === delimiter) {
      if (maxRows === undefined || rows.length < maxRows) row.push(field);
      field = "";
    } else if (character === "\n" || character === "\r") {
      if (character === "\r" && content[index + 1] === "\n") index += 1;
      finishRow();
    } else {
      append(character);
    }
  }
  if (quoted) throw new Error("CSV contains an unclosed quoted field");
  if (field || row.length) {
    finishRow();
  }
  return rows;
}
