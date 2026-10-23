/** CSV for human-opened spreadsheets. Formula-like text is prefixed with a tab
 * inside a quoted cell; machine-import formats should use a separate schema. */
export function csvCell(value: unknown): string {
  const text = value == null ? "" : String(value);
  const plainNumber = /^-?(?:0|[1-9]\d*)(?:\.\d+)?$/.test(text);
  const formulaLike = /^[\s\uFEFF]*[=+\-@＝＋－＠]/u.test(text);
  const leadingControl = /^[\u0000-\u001F]/.test(text);
  const safe = (formulaLike && !plainNumber) || leadingControl ? `\t${text}` : text;
  return /[",\r\n\t]/.test(safe) ? `"${safe.replaceAll('"', '""')}"` : safe;
}

export function csvRows(rows: unknown[][]): string {
  return rows.map((row) => row.map(csvCell).join(",")).join("\r\n");
}
