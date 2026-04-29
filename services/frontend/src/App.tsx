import { lazy, Suspense, useEffect } from "react";
import { Navigate, Route, Routes, useLocation } from "react-router-dom";
import { UnifiedAlertsModal } from "./components/alerts/UnifiedAlertsModal";
import { AlertsModalProvider } from "./contexts/AlertsModalContext";
import { ConfirmActionProvider } from "./contexts/ConfirmActionContext";
import { PlatformShell } from "./layouts/PlatformShell";
import { dbg } from "./lib/debug";
import { AdminSitesPage } from "./pages/AdminSitesPage";
import { AdminUsersPage } from "./pages/AdminUsersPage";
import { DeviceManagePage } from "./pages/DeviceManagePage";
import { DeviceRawDataPage } from "./pages/DeviceRawDataPage";
import { DeviceRegisterPage } from "./pages/DeviceRegisterPage";
import { IngestDevicesPage } from "./pages/IngestDevicesPage";
import { EndpointIdentityPage } from "./pages/EndpointIdentityPage";
import { LoginPage } from "./pages/LoginPage";
import { ScrubberCreatePage } from "./pages/ScrubberCreatePage";
import { ScrubberRawSelectPage } from "./pages/ScrubberRawSelectPage";
import { Scrubber2Page } from "./pages/scrubber2/Scrubber2Page";
import { ScrubberPipelinesPage } from "./pages/scrubber2/ScrubberPipelinesPage";
import { RestorePage } from "./pages/RestorePage";
import { AdminClearOperationalDataPage } from "./pages/AdminClearOperationalDataPage";
import { WorkflowCreatePage } from "./pages/workflow/WorkflowCreatePage";
import { WorkflowEditorPage } from "./pages/workflow/WorkflowEditorPage";
import { WorkflowListPage } from "./pages/workflow/WorkflowListPage";
import { WorkflowLivePage } from "./pages/workflow/WorkflowLivePage";
import { WorkflowTestPage } from "./pages/workflow/WorkflowTestPage";
import { DashboardCreatePage } from "./pages/dashboard/DashboardCreatePage";
import { DashboardBuilderPage } from "./pages/dashboard/DashboardBuilderPage";
import { DashboardListPage } from "./pages/dashboard/DashboardListPage";
import { DashboardLivePage } from "./pages/dashboard/DashboardLivePage";
import { EnterpriseDashboardPage } from "./pages/dashboard/EnterpriseDashboardPage";
import { DashboardResolvedPage } from "./pages/dashboard/DashboardResolvedPage";
import { Dashboard2EditPage } from "./pages/dashboard2/Dashboard2EditPage";
import { Dashboard2LivePage } from "./pages/dashboard2/Dashboard2LivePage";
import { Dashboard2PreviewPage } from "./pages/dashboard2/Dashboard2PreviewPage";
import { Dashboard2ReviewPage } from "./pages/dashboard2/Dashboard2ReviewPage";
import { DASHBOARD2_ENABLED } from "./lib/featureFlags";
const IotOperationsDashboardPage = lazy(() =>
  import("./features/iot-dashboard/IotOperationsDashboardPage").then((m) => ({ default: m.IotOperationsDashboardPage })),
);
import { AlertDetailPage } from "./pages/alerts/AlertDetailPage";
import { AlertsNotificationsPage } from "./pages/alerts/AlertsNotificationsPage";
import { PublishedServiceDetailPage } from "./pages/published/PublishedServiceDetailPage";
import { PublishedServiceFormPage } from "./pages/published/PublishedServiceFormPage";
import { PublishedServicesListPage } from "./pages/published/PublishedServicesListPage";
import { PublishedServiceTestPage } from "./pages/published/PublishedServiceTestPage";
import { LlmConfigPage } from "./pages/administration/LlmConfigPage";
import { MonitoringPage } from "./pages/administration/MonitoringPage";
import { PortsConfigPage } from "./pages/administration/PortsConfigPage";
import { EnterpriseAiPage } from "./pages/enterprise/EnterpriseAiPage";
import { OnboardingChangePasswordPage } from "./pages/onboarding/OnboardingChangePasswordPage";
import { OnboardingCustomerPage } from "./pages/onboarding/OnboardingCustomerPage";
import { ProtectedRoute } from "./routes/ProtectedRoute";
import { RequireAdmin } from "./routes/RequireAdmin";
import { RequireOnboardingComplete } from "./routes/RequireOnboardingComplete";

function NavigationLogger() {
  const loc = useLocation();
  useEffect(() => {
    dbg("route", loc.pathname);
  }, [loc.pathname]);
  return null;
}

export default function App() {
  return (
    <ConfirmActionProvider>
      <AlertsModalProvider>
        <>
        <NavigationLogger />
        <Routes>
        <Route path="/login" element={<LoginPage />} />
        <Route element={<ProtectedRoute />}>
          <Route path="/onboarding/change-password" element={<OnboardingChangePasswordPage />} />
          <Route path="/onboarding/customer" element={<OnboardingCustomerPage />} />
          <Route element={<RequireOnboardingComplete />}>
            <Route
              path="/iot-dashboard"
              element={
                <Suspense
                  fallback={
                    <div className="login-page flex min-h-[40vh] items-center justify-center">
                      <p style={{ color: "var(--color-text-muted)" }}>Loading operations console…</p>
                    </div>
                  }
                >
                  <IotOperationsDashboardPage />
                </Suspense>
              }
            />
            <Route element={<PlatformShell />}>
              <Route path="/" element={<Navigate to="/dashboard" replace />} />
              <Route path="/devices/register" element={<DeviceRegisterPage />} />
              <Route path="/devices/manage" element={<DeviceManagePage />} />
              <Route path="/devices/raw" element={<DeviceRawDataPage />} />
              <Route path="/devices/ingest" element={<IngestDevicesPage />} />
              <Route path="/devices/ingest/:endpointId/identity" element={<EndpointIdentityPage />} />
              <Route path="/administration/monitoring" element={<MonitoringPage />} />
              <Route element={<RequireAdmin />}>
                <Route path="/administration/users" element={<AdminUsersPage />} />
                <Route path="/administration/sites" element={<AdminSitesPage />} />
                <Route path="/administration/restore" element={<RestorePage />} />
                <Route path="/administration/clear-data" element={<AdminClearOperationalDataPage />} />
                <Route path="/administration/llm-config" element={<LlmConfigPage />} />
                <Route path="/administration/ports" element={<PortsConfigPage />} />
              </Route>
              <Route path="/scrubber/data-objects" element={<Navigate to="/scrubber/raw-select" replace />} />
              <Route path="/scrubber/stale-ingestion" element={<Navigate to="/scrubber/raw-select" replace />} />
              <Route path="/scrubber/raw-select" element={<ScrubberRawSelectPage />} />
              <Route path="/scrubber/create" element={<ScrubberCreatePage />} />
              <Route path="/scrubber/v2" element={<Navigate to="/scrubber/v2/pipelines" replace />} />
              <Route path="/scrubber/v2/pipelines" element={<ScrubberPipelinesPage />} />
              <Route path="/scrubber/v2/create" element={<Scrubber2Page />} />
              <Route path="/workflow" element={<Navigate to="/workflow/list" replace />} />
              <Route path="/workflow/list" element={<WorkflowListPage />} />
              <Route path="/workflow/create" element={<WorkflowCreatePage />} />
              <Route path="/workflow/:workflowId/edit" element={<WorkflowEditorPage />} />
              <Route path="/workflow/:workflowId/test" element={<WorkflowTestPage />} />
              <Route path="/workflow/:workflowId/live" element={<WorkflowLivePage />} />
              <Route path="/dashboard" element={<DashboardResolvedPage />} />
              <Route path="/dashboard/list" element={<DashboardListPage />} />
              <Route path="/dashboard/create" element={<DashboardCreatePage />} />
              {/* Legacy dashboard builder & live (unchanged); Dashboard2 uses /dashboard2/... when flag enabled. */}
              <Route path="/dashboard/:dashboardId/edit" element={<DashboardBuilderPage />} />
              <Route path="/dashboard/:dashboardId/live" element={<DashboardLivePage />} />
              {DASHBOARD2_ENABLED ? (
                <>
                  <Route path="/dashboard2/review" element={<Dashboard2ReviewPage />} />
                  <Route path="/dashboard2/:dashboardId/edit" element={<Dashboard2EditPage />} />
                  <Route path="/dashboard2/:dashboardId/live" element={<Dashboard2LivePage />} />
                  <Route path="/dashboard2/:dashboardId/preview" element={<Dashboard2PreviewPage />} />
                </>
              ) : null}
              <Route path="/enterprise-dashboard" element={<EnterpriseDashboardPage />} />
              <Route path="/alerts" element={<AlertsNotificationsPage />} />
              <Route path="/alerts/:alertId" element={<AlertDetailPage />} />
              <Route path="/enterprise-ai" element={<EnterpriseAiPage />} />
              <Route path="/published-services" element={<PublishedServicesListPage />} />
              <Route path="/published-services/create" element={<PublishedServiceFormPage mode="create" />} />
              <Route path="/published-services/:serviceId" element={<PublishedServiceDetailPage />} />
              <Route path="/published-services/:serviceId/edit" element={<PublishedServiceFormPage mode="edit" />} />
              <Route path="/published-services/:serviceId/test" element={<PublishedServiceTestPage />} />
            </Route>
          </Route>
        </Route>
        <Route path="*" element={<Navigate to="/dashboard" replace />} />
        </Routes>
        <UnifiedAlertsModal />
        </>
      </AlertsModalProvider>
    </ConfirmActionProvider>
  );
}
