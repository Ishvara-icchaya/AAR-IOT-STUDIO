import { useSyncExternalStore } from "react";

let referenceActive = false;
const listeners = new Set<() => void>();

function emit() {
  listeners.forEach((l) => l());
}

/** When true, shell hides the global Ops context bar (default dashboard shows scope in-page). */
export function setDefaultDashboardReferenceActive(active: boolean) {
  if (referenceActive === active) return;
  referenceActive = active;
  emit();
}

export function subscribeDefaultDashboardReference(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function getDefaultDashboardReferenceActive() {
  return referenceActive;
}

export function useDefaultDashboardReferenceActive() {
  return useSyncExternalStore(
    subscribeDefaultDashboardReference,
    getDefaultDashboardReferenceActive,
    getDefaultDashboardReferenceActive,
  );
}
