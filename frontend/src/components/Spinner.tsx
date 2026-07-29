/**
 * Small inline loading indicator — extracted from the Kerberos-check spinner
 * on LoginPage so every "Lade…" text (esp. chart loading states) can use the
 * same dezent animation instead of a text placeholder.
 */
export function Spinner({ className = "" }: { className?: string }) {
  return (
    <span
      aria-hidden
      className={`inline-block h-4 w-4 animate-spin rounded-full border-2 border-line border-t-accent motion-reduce:animate-none ${className}`}
    />
  );
}
