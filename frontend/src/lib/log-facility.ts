/**
 * Syslog-Facility-Namen (RFC 5424 Tabelle 7). Graylog liefert teils die
 * bereits aufgelöste Zeichenkette im `facility`-Feld (ältere Syslog-Inputs),
 * teils nur die Nummer als `facility_num` (GELF/rohe Extractor-Setups) — hier
 * wird bevorzugt die Nummer aufgelöst und nur bei fehlender Nummer auf den
 * rohen String zurückgefallen.
 */
const SYSLOG_FACILITIES: Record<number, string> = {
  0: "kern",
  1: "user",
  2: "mail",
  3: "daemon",
  4: "auth",
  5: "syslog",
  6: "lpr",
  7: "news",
  8: "uucp",
  9: "cron",
  10: "authpriv",
  11: "ftp",
  16: "local0",
  17: "local1",
  18: "local2",
  19: "local3",
  20: "local4",
  21: "local5",
  22: "local6",
  23: "local7",
};

/** Löst die Facility für die Anzeige auf; `undefined`, wenn nichts bekannt ist. */
export function resolveFacilityName(
  facilityNum: number | undefined,
  facilityRaw: string | undefined,
): string | undefined {
  if (facilityNum !== undefined && SYSLOG_FACILITIES[facilityNum] !== undefined) {
    return SYSLOG_FACILITIES[facilityNum];
  }
  return facilityRaw;
}
