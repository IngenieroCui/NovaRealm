const configuredApiUrl = process.env.NEXT_PUBLIC_API_URL?.trim();
const apiBaseUrl = (configuredApiUrl || "http://localhost:3001/api").replace(
  /\/+$/,
  "",
);

export const API_URL = apiBaseUrl.endsWith("/api")
  ? apiBaseUrl
  : `${apiBaseUrl}/api`;

export class ApiError extends Error {
  constructor(public readonly status: number, message: string, public readonly technicalMessage?: string) {
    super(message);
    this.name = "ApiError";
  }
}

function friendlyApiMessage(status: number, path: string) {
  if (status === 409) return "Esa pieza no encaja con lo que ya seleccionaste.";
  if (status === 400 && path.includes("/builder/")) return "No pude aplicar ese cambio a la configuración.";
  if (status >= 500) return "Nova tuvo un problema al procesar esto. Intenta nuevamente.";
  if (status === 404) return "No encontré ese recurso. Intenta nuevamente.";
  return "No pude completar la solicitud. Intenta nuevamente.";
}

export async function apiFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const headers = new Headers(init?.headers);
  if (init?.body && !headers.has("Content-Type")) headers.set("Content-Type", "application/json");
  let response: Response;
  try {
    response = await fetch(`${API_URL}${path}`, { ...init, headers });
  } catch (reason) {
    if (process.env.NODE_ENV === "development") console.error("API request failed", path, reason);
    throw new ApiError(0, "No pude conectarme con Nova. Revisa tu conexión e intenta nuevamente.", reason instanceof Error ? reason.message : String(reason));
  }
  if (!response.ok) {
    const body = (await response.json().catch(() => null)) as
      | { message?: string | string[] }
      | null;
    const message = Array.isArray(body?.message)
      ? body.message.join(" · ")
      : body?.message;
    if (process.env.NODE_ENV === "development") console.error("API response failed", path, response.status, message);
    throw new ApiError(response.status, friendlyApiMessage(response.status, path), message);
  }
  return response.json() as Promise<T>;
}

export function formatMoney(value: number) {
  return new Intl.NumberFormat("es-CO", {
    style: "currency",
    currency: "COP",
    maximumFractionDigits: 0,
  }).format(value);
}

export const PRODUCT_TYPE_LABELS: Record<string, string> = {
  PREBUILT_PC: "Computadores",
  CPU: "Procesadores",
  GPU: "Tarjetas gráficas",
  RAM: "Memoria RAM",
  MOTHERBOARD: "Boards",
  STORAGE: "Almacenamiento",
  PSU: "Fuentes",
  CASE: "Chasis",
  COOLING: "Refrigeración",
  MONITOR: "Monitores",
  KEYBOARD: "Teclados",
  MOUSE: "Mouse",
  HEADSET: "Headsets",
};
