import { formatMoney } from "@/lib/api";
import { getWhatsAppUrl } from "@/lib/site-config";

export interface WhatsAppPurchaseDetails {
  productName: string;
  price?: number;
  priceLabel?: string;
  fitScore?: number;
  buildLines?: string[];
  assembly?: boolean;
}

export function buildPurchaseMessage({ productName, price, priceLabel, fitScore, buildLines, assembly }: WhatsAppPurchaseDetails) {
  if (buildLines?.length) {
    const lines = ["Hola, armé esta configuración en NovaRealm:", "", ...buildLines];
    if (assembly !== undefined) lines.push("", `Ensamble: ${assembly ? "Sí" : "No"}`);
    if (price !== undefined || priceLabel) lines.push(`Total mostrado: ${priceLabel ?? formatMoney(price as number)}.`);
    lines.push("", "Quisiera confirmar disponibilidad y compra.");
    return lines.join("\n");
  }
  const lines = [`Hola, quiero comprar el equipo ${productName}.`];

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
