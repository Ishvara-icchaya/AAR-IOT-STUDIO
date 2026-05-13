import { useNavigate } from "react-router-dom";
import { AppModalShell } from "@/components/app/AppModalShell";
import { OtaCampaignNewWizard } from "@/components/ota/OtaCampaignNewWizard";
import { PageShell } from "@/layouts/PageShell";
import { useOpsShell } from "@/contexts/OpsShellContext";

import "./ota-campaigns-page.css";

export function OtaCampaignNewPage() {
  const navigate = useNavigate();
  const { siteId } = useOpsShell();

  return (
    <PageShell variant="list" className="device-manage-page ota-campaigns-route-page">
      <AppModalShell
        open
        onClose={() => navigate("/devices/register")}
        title="New OTA Campaign"
        subtitle="Choose a firmware artifact, pick device targets, review, then create the draft and submit or launch when you are ready."
        titleId="ota-campaign-new-route-modal-title"
        size="xl"
        dialogClassName="device-endpoint-config-modal ota-campaign-new-modal"
      >
        <div className="ota-campaigns-page device-register-page__ota-wizard-wrap">
          <OtaCampaignNewWizard
            initialSiteId={siteId ?? null}
            onCancel={() => navigate("/devices/register")}
            onSuccess={(id) => navigate(`/devices/ota/${encodeURIComponent(id)}`)}
          />
        </div>
      </AppModalShell>
    </PageShell>
  );
}
