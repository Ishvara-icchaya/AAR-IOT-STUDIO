type Props = {
  page: number;
  totalPages: number;
  totalItems: number;
  pageSize: number;
  onPrev: () => void;
  onNext: () => void;
  ariaLabel?: string;
};

export function OpsListPager({ page, totalPages, totalItems, pageSize, onPrev, onNext, ariaLabel }: Props) {
  if (totalItems === 0) return null;
  const start = totalItems === 0 ? 0 : (page - 1) * pageSize + 1;
  const end = Math.min(totalItems, page * pageSize);
  return (
    <div className="dash-ops-pager" role="navigation" aria-label={ariaLabel ?? "List pages"}>
      <span className="dash-ops-pager__meta">
        {start}–{end} of {totalItems}
      </span>
      <div className="dash-ops-pager__controls">
        <button type="button" className="dash-ops-pager__btn" disabled={page <= 1} onClick={onPrev}>
          Previous
        </button>
        <span className="dash-ops-pager__page">
          Page {page} / {totalPages}
        </span>
        <button type="button" className="dash-ops-pager__btn" disabled={page >= totalPages} onClick={onNext}>
          Next
        </button>
      </div>
    </div>
  );
}
