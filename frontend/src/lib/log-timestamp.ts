/**
 * Formats a log message's Unix-seconds timestamp as HH:MM:SS.mmm. Built by
 * hand (not Intl.DateTimeFormat's fractionalSecondDigits) because de-DE
 * renders the fractional separator as a comma, not the dot this format
 * needs regardless of locale.
 */
export function formatLogTimestamp(unixSeconds: number): string {
  const d = new Date(unixSeconds * 1000);
  const hh = String(d.getHours()).padStart(2, "0");
  const mm = String(d.getMinutes()).padStart(2, "0");
  const ss = String(d.getSeconds()).padStart(2, "0");
  const ms = String(d.getMilliseconds()).padStart(3, "0");
  return `${hh}:${mm}:${ss}.${ms}`;
}
