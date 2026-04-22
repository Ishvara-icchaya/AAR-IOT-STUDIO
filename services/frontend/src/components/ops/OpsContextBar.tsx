import { OpsScopeControls } from "@/components/ops/OpsScopeControls";
import { useDefaultDashboardReferenceActive } from "@/stores/defaultDashboardShellStore";

export function OpsContextBar() {
  const hideForDefaultDashboard = useDefaultDashboardReferenceActive();
  if (hideForDefaultDashboard) {
    return null;
  }
  return (
    <div className="ops-context-bar-wrap">
      <OpsScopeControls variant="bar" timeRangeLabel="Range" />
    </div>
  );
}
