const configuredApiUrl = process.env.NEXT_PUBLIC_API_URL?.trim();

export const API_URL = (configuredApiUrl || "http://localhost:3001/api").replace(
  /\/$/,
  "",
);

export async function apiFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${API_URL}${path}`, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...init?.headers,
    },
  });
  if (!response.ok) {
    const body = (await response.json().catch(() => null)) as
      | { message?: string | string[] }
      | null;
    const message = Array.isArray(body?.message)
      ? body.message.join(" · ")
      : body?.message;
    throw new Error(message ?? `La API respondió ${response.status}`);
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
};
