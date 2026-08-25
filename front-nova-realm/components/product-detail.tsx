"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { apiFetch, formatMoney, PRODUCT_TYPE_LABELS } from "@/lib/api";
import type { Product } from "@/lib/types";
import { PageLoading } from "./loading";
import { ProductMedia } from "./product-media";
import { WhatsAppBuyButton } from "./whatsapp-buy-button";

export function ProductDetail({ slug }: { slug: string }) {
  const [product, setProduct] = useState<Product | null>(null);
  const [error, setError] = useState("");
  useEffect(() => { apiFetch<Product>(`/products/${slug}`).then(setProduct).catch((reason: Error) => setError(reason.message)); }, [slug]);
  if (error) return <div className="shell section"><div className="empty-state"><span>!</span><h2>Equipo no disponible</h2><p>{error}</p><Link className="button button-dark" href="/productos">Volver al catálogo</Link></div></div>;
  if (!product) return <PageLoading label="Cargando producto" />;

  const isPc = product.type === "PREBUILT_PC";
  const indicators = [
    ["CPU", product.cpuScore], ["GPU", product.gpuScore],
    ["Productividad", product.productivityScore], ["Actualización", product.upgradeabilityScore],
  ] as const;
  return (
    <div className="detail-page">
      <div className="shell breadcrumbs"><Link href="/">Inicio</Link><span>›</span><Link href="/productos">Catálogo</Link><span>›</span><strong>{product.name}</strong></div>
      <section className="shell detail-grid">
        <div className="detail-image"><span className="product-badge">{PRODUCT_TYPE_LABELS[product.type]}</span><ProductMedia src={product.imageUrl} alt={product.name} isPc={isPc} eager /></div>
        <div className="detail-info">
          <div className="stock-line"><span className={product.stock ? "stock-dot" : "stock-dot out"} />{product.stock ? `En stock · ${product.stock} unidades` : "Agotado"}</div>
          <h1>{product.name}</h1><p className="detail-description">{product.description}</p>
          <div className="detail-price"><small>Precio</small><strong>{formatMoney(product.price)}</strong><span>IVA incluido · Envío calculado al comprar</span></div>
          {isPc && <div className="key-specs"><div><span>Procesador</span><strong>{product.cpu}</strong></div><div><span>Tarjeta gráfica</span><strong>{product.gpu}</strong></div><div><span>Memoria</span><strong>{product.ramGb} GB RAM</strong></div><div><span>Almacenamiento</span><strong>{product.storageGb} GB NVMe</strong></div></div>}
          <WhatsAppBuyButton className="button button-full" productName={product.name} price={product.price} />
          <Link className="button button-accent button-full" href={`/nova?q=${encodeURIComponent(`Quiero saber si el ${product.name} me sirve. Mi presupuesto máximo es ${product.price}.`)}`}><span>✦</span> Preguntarle a Nova sobre este equipo</Link>
          <p className="safe-note">✓ Nova comparará este equipo con alternativas reales del catálogo.</p>
        </div>
      </section>
      {isPc && <section className="shell detail-lower">
        <div className="detail-panel"><span className="eyebrow">CAPACIDAD RELATIVA</span><h2>Un vistazo a su equilibrio</h2><p>Indicadores de 0 a 100 calculados a partir de las características del equipo.</p><div className="indicator-list">{indicators.map(([label, score]) => <div key={label}><p><span>{label}</span><strong>{score ?? 0}%</strong></p><div><i style={{ width: `${score ?? 0}%` }} /></div></div>)}</div></div>
        <div className="detail-panel"><span className="eyebrow">INCLUYE</span><h2>Listo para empezar</h2><ul className="feature-list">{product.features.map((feature) => <li key={feature}><span>✓</span>{feature}</li>)}<li><span>✓</span>{product.vramGb} GB de memoria de video</li><li><span>✓</span>Componentes y stock administrados desde NovaRealm</li></ul></div>
      </section>}
    </div>
  );
}
