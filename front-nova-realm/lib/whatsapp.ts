import { formatMoney } from "@/lib/api";
import { getWhatsAppUrl } from "@/lib/site-config";

export interface WhatsAppPurchaseDetails {
  productName: string;
  price?: number;
  priceLabel?: string;
  fitScore?: number;
}

export function buildPurchaseMessage({ productName, price, priceLabel, fitScore }: WhatsAppPurchaseDetails) {
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
