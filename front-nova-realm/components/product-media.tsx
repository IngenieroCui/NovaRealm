"use client";

/* eslint-disable @next/next/no-img-element -- Las URLs vienen del catálogo y el fallback debe funcionar también con dominios externos. */
import { getProductImageSource, siteConfig } from "@/lib/site-config";

type ProductMediaProps = {
  src?: string | null;
  alt: string;
  isPc?: boolean;
  className?: string;
  eager?: boolean;
};

/** Imagen de producto con fallback visual para URL vacía o una carga fallida. */
export function ProductMedia({ src, alt, isPc = false, className, eager = false }: ProductMediaProps) {
  const fallback = isPc ? siteConfig.assets.pcFallback : siteConfig.assets.productFallback;
  const currentSrc = getProductImageSource(src, isPc);

  return (
    <img
      className={className}
      src={currentSrc}
      alt={alt}
      loading={eager ? "eager" : "lazy"}
      onError={(event) => {
        if (event.currentTarget.src.endsWith(fallback)) return;
        event.currentTarget.src = fallback;
      }}
    />
  );
}
