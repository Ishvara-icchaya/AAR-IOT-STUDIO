import { useLayoutEffect, useRef } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { useAlertsModal } from "@/contexts/AlertsModalContext";

/** Route bridge: opens alert detail in the unified modal and returns to the previous screen (or dashboard). */
export function AlertDetailPage() {
  const { alertId } = useParams<{ alertId: string }>();
  const { openDetail } = useAlertsModal();
  const navigate = useNavigate();
  const didPop = useRef(false);

  useLayoutEffect(() => {
    if (!alertId) return;
    openDetail(alertId);
  }, [alertId, openDetail]);

  useLayoutEffect(() => {
    if (!alertId || didPop.current) return;
    didPop.current = true;
    if (window.history.length > 2) {
      navigate(-1);
    } else {
      navigate("/enterprise-dashboard", { replace: true });
    }
  }, [alertId, navigate]);

  return null;
}
