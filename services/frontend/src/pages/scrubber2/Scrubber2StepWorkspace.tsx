import { PipelineStepper, SCRUBBER2_STEPS } from "@/pages/scrubber2/PipelineStepper";
import { Scrubber2StepContent } from "@/pages/scrubber2/Scrubber2StepContent";
import type { Scrubber2FieldMeta } from "@/lib/scrubber2Fields";
import type { Scrubber2Model } from "@/types/scrubber2Model";

export type Scrubber2ExplorerBindings = {
  fieldSearch: string;
  setFieldSearch: (s: string) => void;
  keepSet: Set<string>;
  toggleKeep: (path: string, v: boolean) => void;
  selectAll: () => void;
  clearAll: () => void;
  setFieldDescription: (path: string, v: string) => void;
};

type Props = {
  activeStep: number;
  onStepChange: (i: number) => void;
  model: Scrubber2Model;
  setModel: (fn: (m: Scrubber2Model) => Scrubber2Model) => void;
  /** Raw archive JSON — Drop/Keep explorer and field counts. */
  fields: Scrubber2FieldMeta[];
  /** After Drop/Keep (+ optional Flatten): Normalize & Attributes pickers. */
  fieldsEarlyPipeline: Scrubber2FieldMeta[];
  /** After full server preview (includes derived, excludes dropped); Semantics+ pickers. */
  fieldsFromPreview: Scrubber2FieldMeta[] | null;
  pathSampleEarly: Record<string, unknown> | null;
  pathSamplePreview: Record<string, unknown> | null;
  samplePayload: Record<string, unknown> | null;
  rawId: string | null;
  onRequestPreview: () => void;
  explorer: Scrubber2ExplorerBindings | null;
  /** Last step primary: validate (preview), save draft, exit (e.g. to Manage Devices). */
  onFinish?: () => void | Promise<void>;
};

export function Scrubber2StepWorkspace({
  activeStep,
  onStepChange,
  model,
  setModel,
  fields,
  fieldsEarlyPipeline,
  fieldsFromPreview,
  pathSampleEarly,
  pathSamplePreview,
  samplePayload,
  rawId,
  onRequestPreview,
  explorer,
  onFinish,
}: Props) {
  const step = SCRUBBER2_STEPS[activeStep];
  const atLast = activeStep === SCRUBBER2_STEPS.length - 1;
  const next = () => onStepChange(Math.min(SCRUBBER2_STEPS.length - 1, activeStep + 1));
  const prev = () => onStepChange(Math.max(0, activeStep - 1));
  const nextLabel =
    activeStep < SCRUBBER2_STEPS.length - 1
      ? `Next: ${SCRUBBER2_STEPS[activeStep + 1].label} →`
      : "Done";

  function onPrimaryClick() {
    if (atLast && onFinish) void onFinish();
    else next();
  }

  return (
    <div className="scrubber2-panel">
      <div className="scrubber2-panel__head">
        <h3 className="scrubber2-panel__title">Pipeline</h3>
      </div>
      <div className="scrubber2-panel-body" style={{ paddingTop: "0.35rem" }}>
        <div className="scrubber2-center-stack">
          <PipelineStepper activeIndex={activeStep} onSelect={onStepChange} />
          <div className="scrubber2-step-card">
            <div className="scrubber2-step-card__head">
              <h2>
                {activeStep + 1}. {step.label}
                {activeStep === 0 ? " Fields" : ""}
              </h2>
              <p>{activeStep === 0 ? "Select which fields to include in the transformed payload." : step.hint}</p>
            </div>
            <div className="scrubber2-step-card__body">
              {activeStep === 0 && explorer ? (
                <>
                  <div className="scrubber2-toolbar">
                    <input
                      className="scrubber2-input"
                      placeholder="Search fields…"
                      value={explorer.fieldSearch}
                      onChange={(e) => explorer.setFieldSearch(e.target.value)}
                    />
                    <button type="button" className="scrubber2-btn scrubber2-btn--ghost" onClick={explorer.selectAll}>
                      Select all
                    </button>
                    <button type="button" className="scrubber2-btn scrubber2-btn--ghost" onClick={explorer.clearAll}>
                      Clear all
                    </button>
                    <span className="scrubber2-muted">
                      {fields.filter((f) => explorer.keepSet.has(f.path)).length} of {fields.length} selected
                    </span>
                  </div>
                  <div className="scrubber2-table-scroll">
                    <table className="scrubber2-table">
                      <thead>
                        <tr>
                          <th style={{ width: 36 }}>Include</th>
                          <th>Field path</th>
                          <th>Type</th>
                          <th>Sample</th>
                          <th>Description</th>
                        </tr>
                      </thead>
                      <tbody>
                        {fields
                          .filter((f) => {
                            const q = explorer.fieldSearch.trim().toLowerCase();
                            if (!q) return true;
                            return f.path.toLowerCase().includes(q) || f.type.toLowerCase().includes(q);
                          })
                          .map((f) => (
                            <tr key={f.path}>
                              <td>
                                <input
                                  type="checkbox"
                                  checked={explorer.keepSet.has(f.path)}
                                  onChange={(e) => explorer.toggleKeep(f.path, e.target.checked)}
                                />
                              </td>
                              <td>
                                <code>{f.path}</code>
                              </td>
                              <td>{f.type}</td>
                              <td className="scrubber2-muted" style={{ maxWidth: 140 }}>
                                {f.sample}
                              </td>
                              <td>
                                <input
                                  className="scrubber2-input"
                                  value={model.fieldDescriptions[f.path] ?? ""}
                                  placeholder="optional"
                                  onChange={(e) => explorer.setFieldDescription(f.path, e.target.value)}
                                />
                              </td>
                            </tr>
                          ))}
                      </tbody>
                    </table>
                  </div>
                </>
              ) : null}
              {activeStep !== 0 ? (
                <Scrubber2StepContent
                  stepIndex={activeStep}
                  model={model}
                  setModel={setModel}
                  fieldsEarlyPipeline={fieldsEarlyPipeline}
                  fieldsFromPreview={fieldsFromPreview}
                  pathSampleEarly={pathSampleEarly}
                  pathSamplePreview={pathSamplePreview}
                  samplePayload={samplePayload}
                  rawId={rawId}
                  onRequestPreview={onRequestPreview}
                />
              ) : null}
            </div>
          </div>
          <div className="scrubber2-footer-row">
            <button type="button" className="scrubber2-btn scrubber2-btn--ghost" onClick={prev} disabled={activeStep === 0}>
              ← Back
            </button>
            <button type="button" className="scrubber2-btn scrubber2-btn--primary" onClick={onPrimaryClick}>
              {nextLabel}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
