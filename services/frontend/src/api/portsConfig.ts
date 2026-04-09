import { apiFetch } from "./client";
import type {
  PlatformPortsConfigDTO,
  PlatformPortsConfigUpdateDTO,
  PlatformPortsRestartResponse,
  PlatformPortsTestResponse,
} from "@/types/portsConfig";

export async function fetchPortsConfig(): Promise<PlatformPortsConfigDTO | null> {
  return apiFetch<PlatformPortsConfigDTO>("/admin/ports");
}

export async function putPortsConfig(body: PlatformPortsConfigUpdateDTO): Promise<PlatformPortsConfigDTO | null> {
  return apiFetch<PlatformPortsConfigDTO>("/admin/ports", {
    method: "PUT",
    json: body,
  });
}

export async function testPortsConfig(): Promise<PlatformPortsTestResponse | null> {
  return apiFetch<PlatformPortsTestResponse>("/admin/ports/test", { method: "POST" });
}

export async function restartPortsServices(): Promise<PlatformPortsRestartResponse | null> {
  return apiFetch<PlatformPortsRestartResponse>("/admin/ports/restart", { method: "POST" });
}
