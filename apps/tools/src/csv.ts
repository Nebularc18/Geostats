const FORMULA_PREFIX = /^[\uFEFF\s]*[=+\-@]/u;

export function csvEscape(value: string | null | undefined): string {
  const text = value ?? "";
  const neutralized = FORMULA_PREFIX.test(text) ? `'${text}` : text;
  return /[",\r\n]/.test(neutralized) ? `"${neutralized.replace(/"/g, '""')}"` : neutralized;
}

export function csvRow(values: string[]): string {
  return values.map(csvEscape).join(",");
}
