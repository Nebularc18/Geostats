const SPREADSHEET_FORMULA_PREFIX = /^[\p{Cc}\s]*[=+@-]/u;

export function csvEscape(value: string | null | undefined): string {
  const text = value ?? "";
  const safeText = SPREADSHEET_FORMULA_PREFIX.test(text) ? `'${text}` : text;
  return /[",\r\n]/.test(safeText) ? `"${safeText.replace(/"/g, '""')}"` : safeText;
}

export function csvRow(values: Array<string | null | undefined>): string {
  return values.map(csvEscape).join(",");
}
