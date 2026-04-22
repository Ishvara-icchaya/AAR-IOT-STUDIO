export function AppTabs<T extends string>({
  tabs,
  active,
  onChange,
  plain,
  ariaLabel,
}: {
  tabs: readonly { id: T; label: string; disabled?: boolean }[];
  active: T;
  onChange: (id: T) => void;
  plain?: boolean;
  ariaLabel?: string;
}) {
  const cls = ["app-tabs", plain && "app-tabs--plain"].filter(Boolean).join(" ");
  return (
    <div className={cls} role="tablist" aria-label={ariaLabel}>
      {tabs.map((t) => (
        <button
          key={t.id}
          type="button"
          role="tab"
          aria-selected={active === t.id}
          disabled={t.disabled}
          className="app-tab"
          onClick={() => onChange(t.id)}
        >
          {t.label}
        </button>
      ))}
    </div>
  );
}
