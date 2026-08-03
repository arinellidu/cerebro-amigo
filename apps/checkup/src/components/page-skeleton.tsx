/** Skeleton compartilhado — loading.tsx raiz e Suspense do /resultado. */
export function PageSkeleton({ label = "Carregando…" }: { label?: string }) {
  return (
    <main className="mx-auto min-h-[50vh] w-full max-w-lg px-4 py-12 sm:px-6">
      <p className="sr-only">{label}</p>
      <div className="glass-noir-deep mb-8 animate-pulse rounded-3xl p-6 sm:p-7">
        <div className="mb-4 h-3 w-32 rounded bg-muted" />
        <div className="mx-auto h-[124px] w-[124px] rounded-full bg-muted" />
        <div className="mx-auto mt-4 h-7 w-40 rounded-full bg-muted" />
      </div>
      <div className="animate-pulse space-y-3">
        <div className="h-5 w-3/4 rounded-lg bg-muted" />
        <div className="h-4 w-full rounded-lg bg-muted" />
        <div className="h-4 w-full rounded-lg bg-muted" />
        <div className="h-4 w-2/3 rounded-lg bg-muted" />
      </div>
    </main>
  );
}
