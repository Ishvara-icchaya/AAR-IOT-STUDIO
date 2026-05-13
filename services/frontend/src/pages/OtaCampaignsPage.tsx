import { useNavigate } from "react-router-dom";
import { AppModalShell } from "@/components/app/AppModalShell";
import { OtaCampaignsListPanel } from "@/components/ota/OtaCampaignsListPanel";
import { PageShell } from "@/layouts/PageShell";

export function OtaCampaignsPage() {
  const navigate = useNavigate();

  return (
    <PageShell variant="list" className="device-manage-page ota-campaigns-route-page">
      <AppModalShell
        open
        onClose={() => navigate("/devices/register")}
        title="OTA Campaigns"
        subtitle="Approve, launch, and track targets. Start a new rollout from Manage Devices — use the row Actions menu or open this list from OTA Campaigns."
        titleId="ota-campaigns-modal-title"
        size="xl"
        dialogClassName="device-endpoint-config-modal ota-campaigns-list-modal"
      >
        <OtaCampaignsListPanel />
      </AppModalShell>
    </PageShell>
  );
}
