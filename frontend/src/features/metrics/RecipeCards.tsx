import { useT } from "../../lib/i18n";
import type { Recipe } from "./recipes";

/**
 * Rezept-Karten (Vorschlag A) für den leeren Zustand: klickbare Einstiege, die
 * Query + Auswahl direkt befüllen. Inhalte kommen aus echten Daten (siehe
 * buildRecipes); hier nur die Darstellung + i18n je Rezept-Art.
 */
export function RecipeCards({ recipes, onApply }: { recipes: Recipe[]; onApply: (recipe: Recipe) => void }) {
  const t = useT();

  function titleFor(recipe: Recipe): string {
    if (recipe.kind === "load") return t("metrics.recipes.loadTitle", recipe.arg ?? "");
    if (recipe.kind === "crossHost") return t("metrics.recipes.crossHostTitle");
    return recipe.arg || t("metrics.recipes.recentFallback");
  }

  function descFor(recipe: Recipe): string {
    if (recipe.kind === "load") return t("metrics.recipes.loadDesc");
    if (recipe.kind === "crossHost") return t("metrics.recipes.crossHostDesc");
    return t("metrics.recipes.recentDesc");
  }

  return (
    <div>
      <div className="mb-3 text-center">
        <div className="text-[15px] font-semibold text-ink">{t("metrics.recipes.heading")}</div>
        <div className="mt-1 text-[13px] text-ink-2">{t("metrics.recipes.subheading")}</div>
      </div>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {recipes.map((recipe) => (
          <button
            key={recipe.id}
            type="button"
            onClick={() => onApply(recipe)}
            className="flex flex-col items-start gap-1.5 rounded-lg border border-line bg-surface p-3 text-left transition-colors hover:border-accent/60 hover:bg-surface-2"
          >
            <span className="rounded bg-accent-soft px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-wider text-accent">
              {t(`metrics.recipes.badge.${recipe.kind}`)}
            </span>
            <span className="text-[13px] font-semibold text-ink">{titleFor(recipe)}</span>
            <span className="text-[12px] text-ink-2">{descFor(recipe)}</span>
          </button>
        ))}
      </div>
    </div>
  );
}
