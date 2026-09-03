import type { AnchorHTMLAttributes, ReactNode } from "react";
import { getPurchaseWhatsAppUrl, type WhatsAppPurchaseDetails } from "@/lib/whatsapp";

type WhatsAppBuyButtonProps = Omit<AnchorHTMLAttributes<HTMLAnchorElement>, "href" | "rel" | "target"> & WhatsAppPurchaseDetails & {
  children?: ReactNode;
};

export function WhatsAppBuyButton({ productName, price, priceLabel, fitScore, productType, className, children = "Comprar por WhatsApp", ...props }: WhatsAppBuyButtonProps) {
  return (
    <a
      {...props}
      className={`whatsapp-buy-button${className ? ` ${className}` : ""}`}
      href={getPurchaseWhatsAppUrl({ productName, price, priceLabel, fitScore, productType })}
      target="_blank"
      rel="noopener noreferrer"
    >
      <span aria-hidden="true">◉</span> {children}
    </a>
  );
}
