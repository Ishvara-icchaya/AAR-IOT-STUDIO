export const SCRUBBER2_STEPS = [
  { id: "drop", label: "Drop / Keep", hint: "Filter raw fields" },
  { id: "normalize", label: "Normalize", hint: "Flatten & Rename" },
  { id: "attributes", label: "Attributes", hint: "Add static or copy" },
  { id: "derived", label: "Derived", hint: "Calculated fields" },
  { id: "semantics", label: "Semantics", hint: "Field roles" },
  { id: "health", label: "Health", hint: "Health rules" },
  { id: "kpi", label: "KPI", hint: "Time-series" },
  { id: "location", label: "Location", hint: "Geo mapping" },
  { id: "preview", label: "Preview", hint: "Review & publish" },
] as const;

export type Scrubber2StepId = (typeof SCRUBBER2_STEPS)[number]["id"];

type Props = {
  activeIndex: number;
  onSelect: (index: number) => void;
};

export function PipelineStepper({ activeIndex, onSelect }: Props) {
  return (
    <div className="scrubber2-stepper" role="tablist" aria-label="Pipeline steps">
      {SCRUBBER2_STEPS.map((s, i) => (
        <button
          key={s.id}
          type="button"
          role="tab"
          aria-selected={i === activeIndex}
          className={`scrubber2-step-pill${i === activeIndex ? " scrubber2-step-pill--active" : ""}`}
          onClick={() => onSelect(i)}
        >
          <span className="scrubber2-step-pill__n">{i + 1}</span>
          <span className="scrubber2-step-pill__t">{s.label}</span>
          <span className="scrubber2-step-pill__h">{s.hint}</span>
        </button>
      ))}
    </div>
  );
}
