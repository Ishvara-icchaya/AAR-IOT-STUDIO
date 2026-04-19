import { useLayoutEffect, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { useAlertsModal } from "@/contexts/AlertsModalContext";

/** Route bridge: opens the unified alerts modal and returns to the previous screen (or dashboard). */
export function AlertsNotificationsPage() {
  const { openList } = useAlertsModal();
  const navigate = useNavigate();
  const ran = useRef(false);

  useLayoutEffect(() => {
    if (ran.current) return;
    ran.current = true;
    openList();
    if (window.history.length > 2) {
      navigate(-1);
    } else {
      navigate("/enterprise-dashboard", { replace: true });
    }
  }, [openList, navigate]);

  return null;
}
