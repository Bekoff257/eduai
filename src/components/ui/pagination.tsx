import Link from "next/link";

export function Pagination({
  page,
  pageSize,
  totalCount,
  buildHref,
}: {
  page: number;
  pageSize: number;
  totalCount: number;
  buildHref: (page: number) => string;
}) {
  const totalPages = Math.max(1, Math.ceil(totalCount / pageSize));
  if (totalPages <= 1) return null;

  const from = totalCount === 0 ? 0 : (page - 1) * pageSize + 1;
  const to = Math.min(page * pageSize, totalCount);

  return (
    <div className="flex items-center justify-between border-t border-border pt-3">
      <p className="text-xs text-muted">
        {from}–{to} of {totalCount}
      </p>
      <div className="flex items-center gap-1.5">
        <Link
          href={buildHref(Math.max(1, page - 1))}
          aria-disabled={page <= 1}
          className={`rounded-md border border-border px-2.5 py-1 text-xs font-medium ${
            page <= 1
              ? "pointer-events-none text-muted/50"
              : "text-foreground hover:bg-surface-hover"
          }`}
        >
          Previous
        </Link>
        <span className="text-xs text-muted">
          {page} / {totalPages}
        </span>
        <Link
          href={buildHref(Math.min(totalPages, page + 1))}
          aria-disabled={page >= totalPages}
          className={`rounded-md border border-border px-2.5 py-1 text-xs font-medium ${
            page >= totalPages
              ? "pointer-events-none text-muted/50"
              : "text-foreground hover:bg-surface-hover"
          }`}
        >
          Next
        </Link>
      </div>
    </div>
  );
}
