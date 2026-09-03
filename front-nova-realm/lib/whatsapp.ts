import { formatMoney } from "@/lib/api";
import { getWhatsAppUrl } from "@/lib/site-config";
import type { ProductType } from "@/lib/types";

export interface WhatsAppPurchaseDetails {
  productName: string;
  price?: number;
  priceLabel?: string;
  fitScore?: number;
  buildLines?: string[];
  assembly?: boolean;
  productType?: ProductType;
}

export function buildPurchaseMessage({ productName, price, priceLabel, fitScore, buildLines, assembly, productType }: WhatsAppPurchaseDetails) {
  if (buildLines?.length) {
    const lines = ["Hola, quiero cotizar esta configuración.", "", ...buildLines];
    if (assembly !== undefined) lines.push("", `Ensamble: ${assembly ? "Sí" : "No"}`);
    if (price !== undefined || priceLabel) lines.push(`Total mostrado: ${priceLabel ?? formatMoney(price as number)}.`);
    lines.push("", "Quisiera confirmar disponibilidad y compra.");
    return lines.join("\n");
  }
  const subject = productType === "PREBUILT_PC" ? `por el equipo ${productName}` : ["CPU", "GPU", "RAM", "MOTHERBOARD", "STORAGE", "PSU", "CASE", "COOLING"].includes(productType ?? "") ? `por el componente ${productName}` : `por ${productName}`;
  const lines = [`Hola, quiero consultar ${subject}.`];

  if (price !== undefined || priceLabel) {
    lines.push(`Precio mostrado: ${priceLabel ?? formatMoney(price as number)}.`);
  }
  if (fitScore !== undefined) {
    lines.push(`Ajuste calculado por Nova: ${fitScore}%.`);
  }

  lines.push("¿Podrían confirmar disponibilidad y explicarme el proceso de compra?");
  return lines.join("\n");
}

export function getPurchaseWhatsAppUrl(details: WhatsAppPurchaseDetails) {
  return getWhatsAppUrl(buildPurchaseMessage(details));
}
