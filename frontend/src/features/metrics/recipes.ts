/**
 * Rezept-Einstieg (Vorschlag A) — reine Ableitung der Einstiegs-Karten für den
 * leeren Zustand. Dynamisch aus echten Daten: eine passende Hostgruppe, ein
 * "eine Metrik auf allen Hosts"-Muster und die zuletzt verwendeten Auswahl-Sets.
 */
import { serializeMetricQuery } from "../../lib/metric-query";
import type { RecentSet } from "./recent-sets";

/** Zabbix-Standardschlüssel für die 1-Minuten-Load (überall vorhanden). */
export const LOAD_KEY = "system.cpu.load[all,avg1]";

/** Wie viele Karten insgesamt maximal gezeigt werden. */
export const MAX_RECIPES = 4;

export type RecipeKind = "load" | "crossHost" | "recent";

export interface Recipe {
  /** Stabiler React-Key. */
  id: string;
  kind: RecipeKind;
  /** Für "load": Gruppenname; für "recent": gespeicherter Titel; sonst undefined. */
  arg?: string;
  /** Query-Bar-Text, den ein Klick setzt. */
  query: string;
  /** itemids, die ein Klick auswählt (nur "recent" befüllt das). */
  items: string[];
}

export interface GroupHostCount {
  name: string;
  hostCount: number;
}

/**
 * Rein: wählt aus den Kandidaten die Gruppe mit den meisten Hosts (≥2). Ohne
 * geeignete Gruppe → null. Sortierung: Hostzahl absteigend, dann Name.
 */
export function pickLoadRecipeGroup(groups: GroupHostCount[]): string | null {
  const eligible = groups
    .filter((g) => g.hostCount >= 2)
    .sort((a, b) => b.hostCount - a.hostCount || a.name.localeCompare(b.name));
  return eligible[0]?.name ?? null;
}

/**
 * Rein: baut die Rezept-Liste. Reihenfolge: Load-über-Gruppe (falls vorhanden),
 * dann "eine Metrik auf allen Hosts", dann die zuletzt verwendeten Sets — auf
 * MAX_RECIPES gekappt.
 */
export function buildRecipes(loadGroupName: string | null, recentSets: RecentSet[]): Recipe[] {
  const recipes: Recipe[] = [];

  if (loadGroupName) {
    recipes.push({
      id: "load",
      kind: "load",
      arg: loadGroupName,
      query: serializeMetricQuery({
        tokens: [
          { field: "group", value: loadGroupName },
          { field: "key", value: LOAD_KEY },
        ],
        text: "",
      }),
      items: [],
    });
  }

  recipes.push({
    id: "cross-host",
    kind: "crossHost",
    query: serializeMetricQuery({ tokens: [{ field: "key", value: LOAD_KEY }], text: "" }),
    items: [],
  });

  for (const set of recentSets) {
    if (recipes.length >= MAX_RECIPES) break;
    recipes.push({
      id: `recent-${set.ts}`,
      kind: "recent",
      arg: set.title,
      query: set.query,
      items: set.items,
    });
  }

  return recipes.slice(0, MAX_RECIPES);
}
