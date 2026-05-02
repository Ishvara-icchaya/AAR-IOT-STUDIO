import { Navigate, useParams } from "react-router-dom";

/** Identity mapping opens as a modal on `/devices/ingest` (see `?identity=`). */
export function EndpointIdentityPage() {
  const { endpointId } = useParams<{ endpointId: string }>();
  if (!endpointId?.trim()) return <Navigate to="/devices/ingest" replace />;
  return <Navigate to={`/devices/ingest?identity=${encodeURIComponent(endpointId.trim())}`} replace />;
}
