# auzui — A Usable Zabbix UI (Plan)

**Name**: `auzui` = *A Usable Zabbix UI*. Repo unter **github.com/cygnusnetworks/auzui**, Konventionen wie beim tiqora-Projekt (siehe Abschnitt E).

## Kontext

Das Zabbix-Web-UI (`ui/` im Zabbix-Repo) ist ein ~1.700-Dateien-PHP-Monolith (eigenes MVC, 399 Controller, jQuery + handgerolltes ES6, kein Build-System, serverseitig gerenderte PNG-Graphen). Ziel: Greenfield-Neubau als moderne SPA (lokales Arbeitsverzeichnis `~/git/xibbaz`, Repo-Name auzui) mit **deutlich besserer UI/UX** — schnelle, dichte Monitoring-Ansichten, moderne Navigation/Suche, native Charts, Dark Mode — und dem Leitprinzip **Zero-Config Deep Observability**: so viel wie möglich automatisch aus dem ableiten, was Zabbix ohnehin weiß.

**Entscheidungen (mit Nutzer abgestimmt):**
- Stack: **React + TypeScript**
- Scope: **Monitoring-first** (Problems, Hosts, Latest Data, Auto-Dashboards, Topologie) — Konfiguration/Admin bleibt vorerst im alten UI, beide laufen parallel
- **Zero-Config**: keine eigene Konfiguration, **auch kein Lesen bestehender Zabbix-Dashboards**. Dashboards werden *magisch generiert* (Abschnitt D), nicht importiert.
- Zeitreihen: **Zabbix-API (`history.get` / `trend.get`) ist der Default-Pfad** und funktioniert im Rahmen der History- bzw. History-/Value-Cache-Grenzen einwandfrei. **InfluxDB (effluence) ist optional, aber klar der performantere Zugriff** — besonders für längere Zeiträume, Multi-Charts und dichte Dashboards. Wenn Influx vorhanden: Primärquelle über `auzui-gateway`. Ohne Influx: Zabbix-API mit bewusst kurzen Default-Ranges und `trend.get` für längere Fenster. Netadmin (`~/git/netadmin`) nutzt Influx aus Performance-Gründen — deren Flux-Client bleibt Referenz für den optionalen Pfad. Details und Arbeitshypothese zu Cache vs. Timeouts: Abschnitt „Messung".

## Zentrale Erkenntnisse der Exploration

1. **Die JSON-RPC-API lebt im PHP-Frontend**, nicht im C-Server (`ui/include/classes/api/services/` greift direkt auf die DB zu; `api_jsonrpc.php` ist nur ein HTTP-Wrapper). Konsequenz: Das PHP-UI bleibt als **headless API-Backend** installiert (Container `zabbix-web-nginx-pgsql` läuft ohnehin schon). Wir bauen die API nicht nach.
2. **~70–80 % der Funktionalität ist rein über die API machbar**: alles CRUD, Problems/Events, Latest Data, `history.get`/`trend.get` (Rohdaten), Dashboards, `user.login` (Session-Token als Bearer), CORS offen.
3. **Lücken**: (a) kein serverseitiges Graph-Downsampling in der API; (b) Server-Status/Queue/Item-Test laufen über binäres TCP-Protokoll (`CZabbixServer`); (c) SSO/SAML/MFA sind Redirect-Flows; (d) Map-Zustandsauflösung (`CMapHelper`) nicht in der API; (e) kein Push — Realtime = Polling.
4. **Beispiel-Deployment** (docker-zabbix.example.com): zabbix-server mit effluence-Modul → InfluxDB 2 (Bucket `zabbix`, org `example.com`, 365d, nur numerische Typen dbl/uint), TimescaleDB, nginx-SPNEGO davor, Grafana liest Influx.

## Architektur

```
┌──────────────────────────────────────────────────────────────┐
│  auzui SPA (React + TS, Vite)                                │
│  TanStack Router/Query · shadcn/ui · uPlot                   │
└──────────┬────────────────────┬──────────────────┬───────────┘
           │ JSON-RPC (Bearer)  │ /api/ts          │ /api/logs (opt.)
           ▼                    ▼                  ▼
  api_jsonrpc.php        auzui-gateway (optional, klein)
  (bestehendes PHP-UI,   – Flux aggregateWindow („N Punkte…“)
   headless betrieben)   – versteckt Influx-Token
           │             – optional: Graylog-Proxy (Token, Streams, Search)
           ▼                    │                  │
   PostgreSQL/Timescale     InfluxDB 2         Graylog REST API
                            (effluence)        (Streams + Search)
```

- **Datasource-Abstraktion** im Frontend: Interface `TimeseriesSource` mit zwei Implementierungen:
  - `ZabbixApiSource` (**Default, immer verfügbar**): `history.get` für kurze/aktuelle Zeiträume (innerhalb History-/Value-Cache bzw. „warmer“ History), `trend.get` für längere Fenster; Punktreduktion (LTTB) im Web Worker. UI-Defaults halten sich an sichere Ranges; außerhalb der warmen History drohen auf großen Instanzen Timeouts (siehe Messung).
  - `InfluxSource` (**optional, wenn konfiguriert → Primär**): ruft `auzui-gateway` → Flux `aggregateWindow`, serverseitig heruntergerechnet, bis 365d, <120 ms gemessen. Deutlich performanter als der API-Pfad; empfohlen, sobald dichte Charts oder lange Zeiträume gebraucht werden.
- **auzui-gateway** (nur nötig, sobald Influx und/oder Graylog genutzt wird — versteckt Tokens): bewusst minimal (Go- oder FastAPI-Container). Nimmt das Zabbix-Session-Token, prüft **Item-Permission via `item.get`** (damit Influx keine Rechte-Lücke öffnet), löst dann die **`itemid`** in eine Flux-Query auf. effluence-Schema & Query siehe Abschnitt „Messung/InfluxDB". Kein genereller API-Proxy — CRUD/Problems/Config spricht die SPA direkt gegen `api_jsonrpc.php`.
- **Graylog (optional, Phase 3)**: derselbe Gateway-Pfad (`/api/logs/*`) — versteckt das Graylog-API-Token, mappt Zabbix-Hosts → Log-Quellen, listet Streams und führt host-scoped Searches aus. Siehe Abschnitt H. Ohne Graylog-Config fehlen die Log-Panels einfach; Monitoring bleibt voll nutzbar.
- **Realtime**: Smart-Polling via TanStack Query (`refetchInterval`, sichtbarkeitsabhängig, Delta-Abfragen über `eventid`-Cursor bei Problems). Kein WebSocket-Nachbau im MVP.
- **Auth im MVP**: `user.login` (Username/Passwort) → Session-Token im Memory + Refresh. SPNEGO/SSO später über den bestehenden nginx (X-Forwarded-User-Muster wie bei Grafana im Beispiel-Setup denkbar), nicht im MVP.

## Tech-Stack (konkret)

| Baustein | Wahl | Begründung |
|---|---|---|
| Build | Vite + React 19 + TypeScript strict | Standard, schnell |
| Routing | TanStack Router | typsichere Routen, Search-Params als First-Class (wichtig für Filter-URLs) |
| Data | TanStack Query | Polling, Caching, Deduplizierung — Kern des „Realtime-Gefühls“ |
| UI | Tailwind + shadcn/ui (Radix) | dichte Enterprise-Tabellen/Forms, Dark Mode nativ, volle Design-Kontrolle |
| Tabellen | TanStack Table (virtuell) | 10k+ Zeilen Problems/Latest-Data flüssig |
| Charts | **uPlot** (Zeitreihen) + ECharts (Gauge/Pie/Honeycomb) | uPlot ist die Referenz für hohe Punktzahlen (Grafana-Erfahrung) |
| State | Zustand (nur UI-State) | Server-State liegt komplett in TanStack Query |
| API-Client | eigener typisierter JSON-RPC-Client (`zabbix-client`-Package im Monorepo) | generierte TS-Typen für die genutzten Methoden |
| Tests | Vitest + Playwright (gegen docker-zabbix als Testsystem) | |

Monorepo (pnpm): `frontend/`, `packages/zabbix-client`, `packages/timeseries` (Source-Abstraktion + LTTB), später `packages/logs` (Graylog, optional) und `services/gateway`.

## UX-Leitideen (der eigentliche Punkt des Projekts)

1. **Command Palette (⌘K)** — globale Suche über Hosts/Items/Triggers/Dashboards + Aktionen („Ack problem…“, „Go to host…“). Ersetzt die tiefe Menü-Navigation, größter Einzelgewinn.
2. **Problems als Live-Triage-Board**: virtualisierte Liste, Inline-Ack/Kommentar ohne Modal-Kaskade, Severity-Filter als Chips, Bulk-Aktionen, Detail als Side-Panel statt Popup — URL-adressierbar (teilbare Filter-Links).
3. **Host-Detail als „Single Pane“**: ein Screen mit Verfügbarkeit, aktiven Problemen, Top-Items, Sparklines — und optional **Live-Logs aus Graylog** (gleicher Zeitraum wie die Charts) — statt heute 5 Menüpunkte.
4. **Latest Data mit Instant-Sparklines** und Brush-to-Zoom in den Charts (Zeitraum-Sync über alle Charts einer Seite).
5. **Dashboards magisch generiert** (Abschnitt D) statt manuell konfiguriert; MVP-Widgets: Zeitreihen-Graph, Problems, Top Hosts, Gauge, Single-Value, Clock, URL.
6. **Dark Mode zuerst**, hohe Informationsdichte, konsistente Severity-Farbsemantik, Skeleton-Loading statt Spinner, spürbar „schnell“ durch Query-Cache + optimistic updates.
7. **Escape-Hatch**: Jede Entität verlinkt kontextuell ins alte UI (Konfiguration), bis der jeweilige Bereich portiert ist.

## Meilensteine

- **M0 — Spike ✓ (Risiken validiert, 23.07.2026)**: JSON-RPC-Login + Token-Auth bestätigt; `history.get` auf der großen Instanz gemessen ≈ 50 s/Call (auch bei 1h) bzw. Timeout bei ≥7d, InfluxDB = <120 ms (siehe Messung). **Entscheidung:** Charts laufen **immer** über `ZabbixApiSource`; **Influx + `auzui-gateway` sind optional, aber der performante Pfad** und von Anfang an mitgedacht. Offen für den ersten Code: uPlot-Chart über Zabbix-API (sichere Kurz-Ranges) und parallel Spike/Codepfad für Influx, wenn vorhanden.
- **M1 — Monitoring-Core**: App-Shell (Nav, ⌘K, Dark Mode), Problems-View mit Ack, Hosts-Liste + Host-Detail, Latest Data mit Sparklines (kurze Ranges via `history.get` / Latest Values).
- **M2 — Auto-Dashboards & Charts**: Timeseries-Abstraktion final (`ZabbixApiSource` + optional `InfluxSource`), Auto-Dashboard-Engine (Abschnitt D), Infrastructure Explorer, Host Deep-Dive, Chart-Explorer (Items suchen → ad-hoc-Graph).
- **M3 — Topologie + Polish**: Auto-Topologie (LLDP/Subnetz/Korrelation), Geomap aus Inventar-Koordinaten, robustes Degradieren ohne Influx (Trend-Fallback, Range-Limits, klare UX wenn History kalt/timeoutet), Deployment als Container neben dem bestehenden Stack.
- **M4 — Optional Logs (Graylog)**: Stream-Browser + Host-scoped Log-Search (Abschnitt H). Feature-Flag / Config — Installationen ohne Graylog merken nichts.

## Verifikation

- M0-Spike direkt gegen `docker-zabbix.example.com` (API-Zugang vorhanden, echte Datenmengen) — Messwerte dokumentieren.
- Playwright-E2E gegen dieselbe Instanz für die Kern-Flows (Login, Problem ack, Chart laden).
- Paritäts-Check pro View gegen das alte UI (gleiche Zahlen für Problems/Latest Data).

## Messung: history.get vs. InfluxDB (23.07.2026, gegen zabbix-api.example.com)

### Arbeitshypothese: Cache-/History-Limits vs. kalte History

**Festzuhalten (Plan + später Produktdoku):** Historische Daten über die **Zabbix-API funktionieren im Normalfall einwandfrei**, solange man sich im Limit der **History bzw. des History-/Value-Caches** (und der „warmen“, kürzlich geschriebenen History) bewegt — typisch: Latest Data, Sparklines, kurze Chart-Fenster, Trigger-nahe Werte.

Die **Timeouts und Extrem-Latenzen** treten auf, wenn `history.get` **außerhalb** dieses warmen Bereichs die große History-Tabelle/Hypertable treffen muss (lange Zeiträume, viele Items, volle Scan-/Chunk-Pfade). Das ist **kein genereller API-Defekt**, sondern ein **Zugriffs-/Skalierungsproblem der History-Storage-Schicht** auf großen Instanzen.

| Pfad | Wann gut | Wann problematisch |
|---|---|---|
| Zabbix `history.get` | kurze/aktuelle Ranges, Cache/warme History | lange Ranges, kalte History, große Hypertables |
| Zabbix `trend.get` | längere Zeiträume mit Stunden-Aggregaten | feine Auflösung (Trends sind grob) |
| InfluxDB (effluence) | praktisch alle Chart-Ranges, Multi-Item, Downsampling | nur wenn Pipeline (effluence) vorhanden |

**InfluxDB ist optional, aber klar der performantere Zugriff** (serverseitiges `aggregateWindow`, stabile Sub-Sekunden-Latenz). auzui muss **ohne Influx voll nutzbar** bleiben (sichere Defaults, `trend.get`, Timeouts graceful) und **mit Influx spürbar besser** werden.

> Doku-Pflicht später (`docs/` / README / Operator-Notes): genau diese Unterscheidung erklären — wann der API-Pfad reicht, ab wann Influx empfohlen ist, und dass gemessene 50‑s-Calls kein „history.get ist kaputt“ bedeuten, sondern „kalte History auf großer Instanz“.

### Messwerte (große Instanz, teils bereits außerhalb des „schnellen“ Fensters)

Gemessen am selben Item (357562, „Interface tiqora: Bits sent", 1-Min-Intervall, value_type uint) auf docker-zabbix / zabbix-api.example.com (~103k Items):

| Zeitraum | Zabbix `history.get` | InfluxDB (effluence) | Faktor |
|---|---|---|---|
| 1h  | **50.216 ms** (61 Pkt, 4 kB)   | **48 ms** (59 Pkt)  | ~1050× |
| 6h  | **50.257 ms** (362 Pkt, 25 kB) | **77 ms**           | ~650×  |
| 24h | **50.392 ms** (1442 Pkt, 99 kB)| **82 ms** (@5m agg) | ~615×  |
| 7d  | Timeout (>50 s)                | **113 ms**          | —      |
| 30d | Timeout                        | **119 ms**          | —      |
| 365d| praktisch unmöglich            | **62 ms** (14 Pkt)  | —      |

**Interpretation der Messung:**
- Auf **dieser** Instanz lieferte `history.get` bereits ab 1h **fixe ~50 s pro Call**, unabhängig von Payload (4 vs. 99 kB → gleiche Zeit). Payload skaliert linear, Latenz nicht — Signatur von teurem History-DB-Pfad (fehlendes/ineffektives Chunk-Pruning bzw. Index-Nutzung auf der Hypertable), nicht von der API-Schicht an sich.
- `item.get` / `problem.get` blieben schnell — das Problem ist **spezifisch History-Abfragen außerhalb des warmen Pfads**.
- Ob 1h hier schon „kalt“ war (Value-Cache vs. History-Table, Housekeeper-Retention, Timescale-Chunking) ist **noch zu verifizieren** (offener Spike-Punkt: Cache-Grenzen und „schnelle“ Max-Range pro Item/Instanz messen; idealerweise Vergleich mit frischem Item / sehr kurzem Fenster, z. B. letzte N Werte / 5–15 min).
- **Fazit für auzui:** API-Pfad = Default und für viele Views ausreichend; **Influx = optionale Performance-Primärquelle**, sobald Charts dichter oder länger werden. Netadmin hat aus dem Performance-Grund bereits auf Influx umgestellt.

### Konsequenzen für die Implementierung

1. **Default-Chart-Ranges** ohne Influx konservativ (z. B. 15m–1h, je nach später kalibrierter Cache-/Warm-Grenze); längere Ranges → `trend.get` oder expliziter Hinweis „kann dauern / Influx empfohlen“.
2. **Timeouts und langsame Calls graceful** behandeln (Abort, Skeleton, Retry, nicht die ganze View blockieren).
3. **Influx feature-gated** wie Graylog: `/api/ts/status` → SPA wählt `InfluxSource` wenn enabled, sonst `ZabbixApiSource`.
4. **Produktdoku** (Operator + Nutzer): Abschnitt „Zeitreihen-Quellen“ mit Cache-Hypothese, wann Influx lohnt, und Verweis auf diese Messung.

### effluence-Schema & Flux-Query (Referenz: netadmin `src/netadminv3/utils/influxdb_client.py`)

- Measurement: `history` (float) bzw. `history_uint` (uint) — effluence exportiert nur numerische Typen (dbl/uint).
- Tag: `itemid` (= Zabbix-Item-ID, String). Feld: der Wert. `_time` = Zeitstempel.
- docker-zabbix: `org=example.com`, `bucket=zabbix`, Retention 365d, URL intern `http://10.0.0.8:8086`.
- Query-Muster (serverseitiges Downsampling — der große Vorteil gegenüber rohem `history.get`):

```flux
from(bucket: "zabbix")
  |> range(start: -{range})
  |> filter(fn: (r) => r._measurement == "history" or r._measurement == "history_uint")
  |> filter(fn: (r) => r.itemid == "{itemid}")     // bzw. OR-Liste für Multi-Item
  |> group(columns: ["itemid"])
  |> aggregateWindow(every: {N}m, fn: last, createEmpty: false)
```

`auzui-gateway` wählt `every` aus (Zeitraum ÷ Ziel-Pixelbreite → „N Punkte für Zeitraum X"), setzt `fn` je nach Metrik (last/mean; min+max für Envelope), und filtert Items, die der eingeloggte Nutzer per `item.get` sehen darf.

## Phase 2 — Zero-Config Deep Observability (Detailplan, 23.07.2026)

Ziel: möglichst tiefes Eintauchen in die Infrastruktur, maximale Metrik-Abdeckung, automatisch
ermittelte Abhängigkeiten/Karten — **ohne Konfiguration**. Alles wird aus dem, was Zabbix ohnehin
weiß, abgeleitet.

### A. Automatische Ableitungen aus dem Zabbix-Datenmodell (alles via JSON-RPC)

**Struktur (wer gehört wohin):**
- `hostgroup.get` — Gruppen; Zabbix-Konvention `Eltern/Kind` in Namen → Hierarchie parsen
- `host.get` + `selectParentTemplates` — Template = Geräterolle (Router, Switch, Linux, Docker …)
- `selectInventory` — Modell, OS, Standort, **location_lat/lon → Geomap ohne Konfiguration**
- `selectInterfaces` — IPs → Subnetz-Clustering (L3-Nachbarschaft)
- `proxyid` — Proxy-Zuordnung = Standort-/Segment-Hinweis

**Komponenten (LLD macht die Arbeit schon):**
- Low-Level-Discovery erzeugt Items mit parametrisierten Keys (`net.if.in[xe-0/0/1]`,
  `vfs.fs.size[/var,pused]`, `sensor.temp[...]`). Key-Parameter = Komponente. Gruppierung aller
  Items nach Key-Parameter ⇒ automatische Komponentenliste je Host (Ports, Filesysteme, Sensoren,
  Container, VMs) — `discoveryrule.get` liefert die Komponentenklassen.

**Metrik-Autoklassifikation (welche Visualisierung ohne Konfig):**
1. **Item-Tags** (moderne Templates taggen konsequent `component:cpu|memory|network|storage|…`) — primäre Quelle
2. **units**: `%`→Gauge/Heatmap · `bps/Bps`→Traffic-Area · `B`→Kapazität · `s/ms`→Latenz · `°C`→Temperatur mit Zonen · `uptime`→Zähler
3. Key-Pattern als Fallback (`system.cpu.*`, `vm.memory.*`, `net.if.*`, `vfs.fs.*`)
4. **Trigger-Expressions parsen** (`trigger.get` + `expandExpression`): `last(/host/item)>60` ⇒ Schwellwert 60 automatisch als Linie/Zone im Chart — Thresholds ohne jede UI-Konfiguration

**Abhängigkeiten/Topologie — geschichtet, mit Konfidenz je Kante:**
| Ebene | Quelle | Konfidenz |
|---|---|---|
| Explizit | Trigger-Dependencies, Services-Baum, vorhandene Maps (`map.get`) | 100 % |
| Physisch | LLDP-/CDP-Items sofern Templates sie sammeln (Interface-Namen-Matching) | hoch |
| L3 | gemeinsame Subnetze aus Host-Interfaces | mittel |
| Logisch | Proxy→Hosts, gemeinsames Template/Gruppe | mittel |
| Statistisch | Ereignis-Korrelation: Probleme, die wiederholt gemeinsam auftreten (`event.get`, Zeitfenster-Clustering) → inferierte Kante | niedrig, wächst mit Evidenz |

Jede Kante trägt ihre Quelle sichtbar (Stil/Legende); Nutzer kann Ebenen ein-/ausblenden. Bestätigen/Verwerfen einer inferierten Kante = einzige (optionale) Konfiguration.

**Kontext & Anomalie ohne Konfiguration:**
- Geisterlinie: gleicher Zeitraum vor 7 Tagen aus `trend.get` hinter jede Zeitreihe
- Baseline-Band: avg ± k·stddev aus Trends (clientseitig, Web Worker)
- Forecast: lineare Regression auf Trends → „/var voll in ~23 d“ (analog `forecast()` in Triggern)
- „Top-Mover“: Items mit größter Abweichung vs. Baseline je Host/Gruppe — beantwortet „was ist anders als sonst?“ automatisch

### B. An echten Daten kalibriert (docker-zabbix.example.com, 23.07.2026)

Über den netadmin-API-Token (`(intern)` → `[zabbix] token`, gegen `https://zabbix-api.example.com`) verifiziert — bestätigt die Heuristik:
- **201 Hosts, 103.252 Items, 32 aktive Probleme** (6 High, 10 Average, 9 Warning, 7 Info).
- **Rollen aus Templates** real: *Cygnus Linux by Zabbix agent* (84), *Brocade/Foundry Stackable by SNMP* (50), *SMART agent2* (34), *Chassis by IPMI* (24), *Docker agent2* (16), *Website certificate* (17), *MD RAID*, *APC UPS by SNMP*, *MySQL agent2*, *Synology*, *DVBStream* … → viele Geräteklassen, ideal für rollen­spezifische Auto-Dashboards.
- **`component`-Tag liegt auf praktisch jedem Item** (in Stichprobe 8052/8000+): Werte `network, system, temperature, cpu, memory, power, fan, ssid, users, internal-process, health …`. → **Tag-basierte Klassifikation ist in dieser Umgebung die verlässlichste Signalquelle.**
- Zusätzlich **`interface`-Tag** je Port → Portmatrix ohne Konfiguration möglich.
- **Units** wie erwartet: `bps` (Traffic), `%`, `°C`, `uptime`, `Bps`, `s`. value_type überwiegend `uint`.
- **Trigger-Schwellwerte extrahierbar**: `expandExpression:true` liefert z.B. `max(/Zabbix server health/zabbix[rcache,buffer,pused],10m)>75`, `min(/…/zabbix[queue,10m],10m)>1000` → Regex `([<>]=?)\s*([\d.]+)` + Fensterfunktion ⇒ Schwellwert-Linien/Zonen automatisch.
- **LLD-Reichtum**: Umweltsensoren (CO2, Humidity, pH, Illuminance, Distance, Battery voltage), Apache-Prozesse, Acronis … → Komponentenlisten je Host aus LLD ableitbar.

Folgerung: Klassifikations-Priorität **`component`-Tag → Unit → Key-Pattern**, Thresholds aus Triggern. Kein Nutzer-Setup nötig.

### C. Die vier Entwürfe (ein Artefakt, Umschalter oben zwischen den Entwürfen)

1. **Infrastructure Explorer** — Heatmap-Drilldown: Gruppen → Host-Kacheln (Farbe = Status | Auslastung umschaltbar) → Komponenten-Kacheln (aus `component`-Tags: Ports, Sensoren, CPU/Mem, Power/Fan) → Item. Seitenleiste: „Top-Mover“ der aktuellen Ebene. Beantwortet: „Wo brennt es / wo ist es voll?“
2. **Auto-Topologie** — Kraftlayout-Graph, Kanten nach Evidenz-Ebene (LLDP durchgezogen, Subnetz gestrichelt, korreliert gepunktet), Layer-Toggles, Live-Status auf Knoten/Links, Problem-Ausbreitung entlang Kanten. Geomap-Modus als Umschalter (Inventar-Koordinaten).
3. **Host Deep-Dive (Auto-Dashboard)** — vollautomatisch generiertes Host-Dashboard: Sektionen je `component`-Klasse, Trigger-Schwellwerte als Zonen, Interface-Matrix (Portgrid aus `interface`-Tag/LLD), Storage/Cert mit Forecast, 7-Tage-Geisterlinien. Optional: **Logs-Sektion** (Graylog, Abschnitt H) im gleichen Zeitraum wie die Charts. Header: „generiert aus N Items · 0 Konfiguration“.
4. **Metrik-Browser** — Facettensuche über *alle* Items (component-Tag / Unit / Template / Gruppe), Wall aus Small-Multiples, Sortierung „Abweichung vs. Baseline“, Mehrfachauswahl → Overlay-Vergleich über Hosts hinweg.

### D. Magic Auto-Dashboard (Kern des Zero-Config-Versprechens, ohne bestehende Dashboards zu lesen)

Pipeline (alles clientseitig / Web Worker, nur Standard-`*.get`):
1. **Rolle erkennen** aus `selectParentTemplates` → Layout-Preset je Rolle (Switch → Port-Matrix zuerst; Linux → CPU/Mem/Disk/Load; Docker → Container-Grid; Cert → Ablauf-Timeline; UPS → Last/Runtime/Batterie).
2. **Items klassifizieren** (`component`-Tag → Unit → Key), zu **Sektionen** gruppieren; je Sektion Visualisierung aus Unit (bps→Area, %→Gauge/Line, °C→Zonen, B→Kapazität+Forecast, uptime→Zähler).
3. **Schwellwerte** aus zugehörigen Triggern (`expandExpression`) als Linien/Zonen in die Charts legen.
4. **Ranking**: pro Sektion die Items mit größter Baseline-Abweichung (aus `trend.get`) nach oben; unwichtige einklappen. Ergebnis: sinnvolle Standard-Dashboards „magisch“, reproduzierbar, ohne je eine gespeicherte Config anzufassen.

### E. Repo-, CI- & Distributions-Konventionen (analog tiqora/`~/git/aurix`)

- **Repo**: `github.com/cygnusnetworks/auzui`, AGPL-3.0, README mit shields.io-Badges (License, React/TS, Docker, Live-Site), Clean-Room-Hinweis (kein Zabbix-Quellcode enthalten).
- **Monorepo** (pnpm): `frontend/` (Vite-SPA), `packages/zabbix-client`, `packages/timeseries`, optional `packages/logs` (Graylog-Client/Abstraktion), optional `services/gateway`; `docker/`, `docs/`, `site/`.
- **GitHub Actions** wie tiqora: `ci.yml` (lint/build/test), `docker.yml` (Multi-Arch-Build → **ghcr.io/cygnusnetworks/auzui** immer, **docker.io/cygnusnetworks/auzui** wenn `DOCKER_USERNAME/DOCKER_TOKEN`-Secrets gesetzt; Tag-Trigger `v*`), `pages.yml` (Produkt-Site + Demo-Build nach **cygnusnetworks.github.io/auzui**).
- **Mock/Website auf github.io**: die hier gebauten Entwürfe später als statische Demo unter `site/` bzw. `/auzui/demo/` (VITE_BASE) — **erst später**, jetzt nur das Entwurf-Artefakt.

### F. Technik-/Performance-Notizen
- Klassifikation & Baselines im Web Worker; `item.get` mit `search`/`tags`-Filtern + Batching; Trends cachen (TanStack Query, hoher staleTime)
- Ereignis-Korrelation: `event.get` ≤ 30 d, Clustering clientseitig, Ergebnis in IndexedDB
- Topologie-Layout: d3-force einmalig, Positionen persistieren (localStorage), nie „springen“
- Roadmap: Auto-Dashboard-Engine + Explorer + Deep-Dive → M2; Metrik-Browser → M2/M3; Topologie (LLDP/Korrelation) → M3 mit eigenem Spike; Graylog Streams + Host-Logs → M4 (Abschnitt H)

### G. Optionaler LLM-Layer (nicht im heißen Pfad, komplett abschaltbar)

Grundsatz: Die Auto-Dashboard-Pipeline (D) bleibt **deterministisch** — schnell, reproduzierbar, offline-fähig. „Zero-Config" darf nie heimlich „braucht-eine-GPU" bedeuten. Ein LLM sitzt nur als optionaler **Kurator** obendrauf und erzeugt nie rohes HTML/Zahlen, sondern eine **Dashboard-Spec (JSON)**, die dieselbe deterministische Render-Engine füllt (validierbar, cachebar, kann nichts „erfinden").

**Kein LLM** in: Klassifikation (Tag→Unit→Key), Schwellwert-Regex, Baseline/Forecast/Top-Mover. 103k Items live durchs Modell wäre latenz-, kosten- und determinismus-schädlich.

**LLM sinnvoll bei:**
1. Semantisches Naming/Gruppieren, wo Tags fehlen (`net.if.in[Gi1/0/24]` + LLDP-Nachbar → „Uplink zu core-sw02")
2. Layout-Kuratierung über die rollenbasierten Presets (Reihenfolge/Auswahl der Sektionen)
3. Natürlichsprachlicher Kontext/Zusammenfassung („erhöhte Retransmits seit 14:00, korreliert mit BGP-Flap")
4. **Chat-zu-Dashboard**: NL-Anfrage → Query-Plan gegen die API (spannendster abgrenzbarer Use-Case)

**Modellwahl — Qwen3 über Nebius Token Factory, EU-Region** (Zabbix-Daten = teils Kundeninfra/IPs/Standorte → Datenschutz):
- Backend über OpenAI-kompatible API: Base-URL `https://api.tokenfactory.nebius.com/v1`. EU-Region = **`eu-north1`** (Finnland). Region wird über die Modellwahl gepinnt (kein Region-Parameter am Request) — Modell muss `eu-north1` in `regions` führen. Verfügbarkeit/Features live prüfen: `GET /v1/models?verbose=true` (liefert `regions` + `supported_features`, die die Doku auslässt).
- **Default `Qwen/Qwen3-30B-A3B-Instruct-2507`** (EU, `tools`+`structured_outputs`, non-thinking, günstig/schnell) für Spec-/Klassifikations-/Naming-Aufgaben. Für schwerere Kuratierung/Summaries `Qwen/Qwen3-235B-A22B-Instruct-2507` (EU, TTFT ~0,4–0,7 s bei ~8k-Prompt, verifiziert).
- Alternativ self-hosted Qwen3 via Ollama/vLLM (dieselbe OpenAI-API), falls komplett on-prem.
- Cloud-LLM (Claude/GPT) nur als **Opt-in-Schalter**, per Config aus.

**Umsetzung** wie tiqora-AI-Surface: ein separater **`auzui-ai`-MCP/Service**, komplett optional, unter derselben Permission-Engine, Modell-Backend austauschbar (Ollama/vLLM/EU-API). Ergebnisse pro Host/Rolle gecacht, nicht pro Laden neu.

**Roadmap:** MVP + M2 **ohne LLM** (deterministische Engine trägt die vier Entwürfe allein). LLM-Layer = **Phase 4**, Open-Weights zuerst, Cloud nur Opt-in.

### H. Optionaler Graylog-Layer (Streams + Host-Logs, Phase 3 / M4)

Grundsatz wie Influx und LLM: **komplett optional**. Ohne `GRAYLOG_URL` + Token im Gateway fehlen die Log-UI-Flächen; Metrics/Problems bleiben unverändert. Logs ergänzen Metriken — sie ersetzen sie nicht. Ziel der Integration: **Zero-Config Deep Observability auch für Logs**, indem Zabbix-Host-Identität und Graylog-`source`/Felder zusammengeführt werden.

#### Was wir bauen (zwei Oberflächen)

1. **Stream-Browser** (globale Logs-Ansicht, z. B. Nav-Eintrag „Logs“ oder ⌘K „Streams…“)
   - Liste der Graylog-Streams (`GET /api/streams`) mit Titel, Beschreibung, Regeln-Kurzinfo, Message-Count (falls verfügbar), Default-Stream markiert.
   - Klick auf Stream → Message-Liste mit Zeitraum-Picker (wie Chart-Brush: 15m / 1h / 6h / 24h / custom), Lucene-Query-Leiste, Severity-Chips falls `level`/`facility` vorhanden.
   - Zeile expandiert: Full Message + Felder (Key/Value), Link „in Graylog öffnen“ (Deep-Link in die native UI als Escape-Hatch).
   - Kein Nachbau von Graylog-Dashboards/Alerts — nur **lesen** von Streams und Search.

2. **Host-scoped Logs** (eingebettet in Host-Detail / Host Deep-Dive)
   - Panel „Logs“ neben Problemen und Charts, **Zeitraum an Chart-Range gekoppelt** (Brush-to-Zoom synchronisiert auch die Log-Query).
   - Automatische Query aus Zabbix-Host-Identität (siehe Mapping unten) — Nutzer sieht sofort die Messages des Systems, ohne Lucene zu kennen.
   - Optional Query-Erweiterung (zusätzliche Filter-Chips: level, facility, stream) und Freitext-Suche *innerhalb* des Host-Scopes.
   - Bei Problem-Side-Panel: Kontextlink „Logs ±15 min um Event“ → öffnet Host-Logs mit Timerange um `clock` des Events.

#### Host → Graylog-Quellen-Mapping (Zero-Config-Heuristik)

Graylog speichert typischerweise den Sender im Feld `source` (Hostname/FQDN aus rsyslog/syslog-ng/Filebeat/sidecar). Zabbix kennt denselben Host unter `host` (technischer Name), `name` (sichtbarer Name), Interfaces (DNS/IP) und Inventar. Mapping-Kandidaten in Priorität:

| Prio | Zabbix-Feld | Graylog-Query-Baustein | Konfidenz |
|---|---|---|---|
| 1 | `host` (technischer Name) | `source:"{host}"` | hoch, wenn Agent/Syslog denselben Namen nutzt |
| 2 | `name` (visible name), falls ≠ `host` | `source:"{name}"` | mittel |
| 3 | Interface `dns` / reverse lookup | `source:"{dns}"` | mittel–hoch |
| 4 | Interface `ip` | `source:"{ip}"` **oder** `gl2_remote_ip:"{ip}"` | mittel (IPs ändern sich) |
| 5 | Inventar `name` / `alias` / custom macros | optional weitere OR-Klauseln | niedrig |

Gateway baut eine OR-Query und cached das Mapping pro `hostid` (TTL z. B. 5–15 min). UI zeigt die **aufgelösten source-Aliases** dezent an („matched: `edge-sw01`, `192.0.2.10`“) und erlaubt manuelles Nachjustieren *nur als Session-Override* — keine persistente auzui-Config-DB. Wenn nichts matched: leere Liste + Hinweis „kein Log-Source gefunden“ statt Fehler.

Optional später: Stream-Regeln / Graylog-Pipelines, die ein Feld `zabbix_host` setzen — dann Mapping 1:1 und Konfidenz 100 %.

#### API-Schnittstelle (über `auzui-gateway`, nie Token im Browser)

Graylog-Token bleibt serverseitig (Analogie Influx). Endpoints bewusst schmal:

| Methode | Pfad | Zweck |
|---|---|---|
| `GET` | `/api/logs/status` | `{ enabled: bool, url?: string }` — Feature-Flag für die SPA |
| `GET` | `/api/logs/streams` | Stream-Liste (id, title, description, disabled, is_default, matching_type) |
| `POST` | `/api/logs/search` | Body: `{ query, stream_ids?, from, to, limit, offset?, sort? }` → Messages + total |
| `POST` | `/api/logs/host/{hostid}` | Body: `{ from, to, limit, extra_query?, stream_ids? }` — Gateway löst Host-Mapping auf, merged Query, prüft Zabbix-Host-Permission via `host.get` |

**Permission-Modell:** Wie bei Influx — der eingeloggte Zabbix-User muss den Host sehen dürfen (`host.get` mit Session-Token). Graylog-seitig läuft ein **Service-Token** mit Read-Only auf Streams/Search (kein Write, keine User-Admin-Rechte). Keine Rechte-Lücke: wer den Host in Zabbix nicht sieht, bekommt auch keine Logs. Stream-Browser setzt voraus, dass der Service-Token nur Streams sieht, die die Instanz sowieso teilen will (Graylog-Rollen am Token).

**Graylog-API-Referenz (Implementierung):**
- Streams: `GET /api/streams` (Header `Accept: application/json`, Auth `Authorization: Bearer <token>` bzw. Session je nach Graylog-Version).
- Search: modernes **Search Scripting API** bzw. Views-Search (`POST /api/views/search` + execute) — Legacy `GET /api/search/universal/relative` nur als Fallback für ältere Instanzen. Query-String = Lucene (Elasticsearch/OpenSearch).
- Timerange relativ (`type: relative, range: Sekunden`) oder absolut (`type: absolute, from/to: ISO-8601`).
- Felder für die UI: `timestamp`, `source`, `message`, `level`, `facility`, plus `fields` als Map; Truncation langer Messages clientseitig mit Expand.

#### UX-Details

- **Dichte Liste** (TanStack Table/virtuell): Zeit · Level-Badge · Source · Message-Preview; Expand-Row für Fulltext + Fields.
- **Live-Tail optional** (später): Polling alle 5–10 s mit `from = last_seen`, Pause wenn Tab unsichtbar (TanStack Query `refetchInterval` + visibility).
- **⌘K**: „Logs: {host}“, „Stream: {name}“, „Logs around problem…“.
- **Deep-Link**: `?hostId=…&logsFrom=…&logsTo=…&q=…` — teilbar wie Problem-Filter.
- **Escape-Hatch**: jeder Stream/Search-Result verlinkt in die native Graylog-UI (gleiche Query/Timerange), bis wir ggf. mehr bauen.
- **Fehlerzustände**: Graylog down → Panel mit Retry, Rest der App unberührt; Timeout/Rate-Limit → klare Meldung, kein Spinner-Endlos.

#### Architektur-Erweiterung Gateway

```
auzui-gateway
  /api/ts/*     → Influx (bestehend)
  /api/logs/*   → Graylog (neu, feature-gated)
```

Config (Env, analog Influx):
- `GRAYLOG_URL` (z. B. `https://graylog.example.de`)
- `GRAYLOG_TOKEN` (API-Token, read-only)
- `GRAYLOG_VERIFY_TLS` (default true)
- optional `GRAYLOG_DEFAULT_STREAMS` (CSV von Stream-IDs — einschränken, was auzui überhaupt anbietet)
- optional `GRAYLOG_SOURCE_FIELD` (default `source`) falls die Pipeline ein anderes Feld nutzt

Frontend: `LogSource`-Interface (ähnlich `TimeseriesSource`) mit `GraylogSource` und `NullLogSource` (no-op, wenn `/api/logs/status.enabled === false`). Package: `packages/logs` oder Erweiterung von `packages/timeseries` → besser eigenes `packages/logs` (andere Domäne).

#### Was wir bewusst *nicht* bauen (MVP-Logs)

- Keine Graylog-Alerts, Extractors, Pipelines, Inputs verwalten
- Kein Log-Write / kein Acknowledge von Graylog-Events
- Keine vollständige Graylog-Dashboard-Parität
- Kein Cross-User-Graylog-Auth-Mapping (ein Service-Token reicht; Zabbix-Permissions sind der Gate)
- Kein Ersatz für die Graylog-UI bei Forensik-Tiefenanalysen — auzui = **Monitoring-Kontext + schneller Host-Log-Blick**

#### Roadmap & Spike

- **Spike (vor M4):** gegen die produktive Graylog-Instanz (falls vorhanden, z. B. cygnusnet): Auth-Variante (Token vs. Session), ob Search Scripting API oder Legacy, typische `source`-Werte vs. Zabbix-`host`-Namen stichprobenartig matchen, Latenz für 15m/1h/24h Queries messen.
- **M4a:** Gateway `/api/logs/*` + Stream-Browser (Read-only).
- **M4b:** Host-Mapping + Logs-Panel in Host-Detail / Deep-Dive + Zeitraum-Sync mit Charts.
- **M4c:** Problem-Kontext („Logs ±15 min“), ⌘K-Aktionen, Deep-Links.
- Danach optional: Live-Tail, Multi-Host-Vergleich („Logs dieser Hostgruppe“), LLM-Summary der Log-Zeilen im Kontext eines Problems (Phase 4, nur wenn LLM ohnehin aktiv).

## Nächster Schritt

**Ein Artefakt mit Umschalter** zwischen den vier Entwürfen aus Abschnitt C — Infrastructure Explorer, Auto-Topologie, Host Deep-Dive (Auto-Dashboard) und Metrik-Browser — Dark/Light, mit realistischen Beispieldaten im Stil der echten Umgebung (Brocade-Switches, Cygnus-Linux, Docker, UPS, Umweltsensoren). Zweck: UX-Richtung der vier Ansätze abstimmen, bevor Code entsteht. Kein echter API-Zugriff im Mock.
