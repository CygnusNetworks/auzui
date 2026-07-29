export function ComingSoon({ title }: { title: string }) {
  return (
    <div className="mx-auto max-w-[1400px] px-3 min-[700px]:px-5 pb-16 pt-4.5">
      <h1 className="mb-2 text-[19px] font-bold tracking-tight">{title}</h1>
      <div className="rounded-lg border border-line bg-surface p-10 text-center text-sm text-ink-2">
        coming soon
      </div>
    </div>
  );
}
