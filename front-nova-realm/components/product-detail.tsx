"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { apiFetch, formatMoney, PRODUCT_TYPE_LABELS } from "@/lib/api";
import type { Product } from "@/lib/types";
import { PageLoading } from "./loading";
import { ProductMedia } from "./product-media";
import { WhatsAppBuyButton } from "./whatsapp-buy-button";
import { useNova } from "@/lib/nova-context";

export function ProductDetail({ slug }: { slug: string }) {
  const [product, setProduct] = useState<Product | null>(null);
  const [similar, setSimilar] = useState<Product[]>([]);
  const [error, setError] = useState("");
  const { setProductContext } = useNova();
  useEffect(() => { apiFetch<Product>(`/products/${slug}`).then((item) => { setProduct(item); return apiFetch<Product[]>(`/products?type=${item.type}`); }).then((items) => setSimilar(items.filter((item) => item.slug !== slug).slice(0, 3))).catch((reason: Error) => setError(reason.message)); }, [slug]);
  useEffect(() => { if (product) setProductContext({ slug: product.slug, name: product.name, type: product.type }); return () => setProductContext(null); }, [product, setProductContext]);
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
          {product.type !== "PREBUILT_PC" && <Link className="button button-outline button-full" href={`/configurador?add=${encodeURIComponent(product.slug)}`}>Agregar al configurador</Link>}
          <Link className="button button-accent button-full" href={`/nova?q=${encodeURIComponent(`Estoy viendo ${product.name}. ¿Me sirve para mi uso?`)}`}><span>✦</span> Preguntarle a Nova sobre este producto</Link>
          <p className="safe-note">✓ Nova comparará este equipo con alternativas reales del catálogo.</p>
        </div>
      </section>
      {!isPc && <section className="shell detail-lower"><div className="detail-panel"><span className="eyebrow">DETALLES DEL PRODUCTO</span><h2>Lo importante para decidir</h2><ul className="feature-list">{product.features.map((feature) => <li key={feature}><span>✓</span>{feature}</li>)}{Object.entries(product.technicalSpecs ?? {}).map(([key, value]) => <li key={key}><span>·</span><strong>{key.replace(/([A-Z])/g, " $1")}: </strong>{String(value)}</li>)}</ul></div><div className="detail-panel"><span className="eyebrow">NOVA</span><h2>¿Te sirve para tu uso?</h2><p>Cuéntale a Nova qué quieres hacer y te dirá si este producto encaja con tu presupuesto y tu equipo actual.</p><Link className="button button-accent" href={`/nova?q=${encodeURIComponent(`Estoy viendo ${product.name}. ¿Vale la pena para mi uso?`)}`}>Hablar con Nova</Link></div></section>}
      {isPc && <section className="shell detail-lower">
        <div className="detail-panel"><span className="eyebrow">CAPACIDAD RELATIVA</span><h2>Un vistazo a su equilibrio</h2><p>Indicadores de 0 a 100 calculados a partir de las características del equipo.</p><div className="indicator-list">{indicators.map(([label, score]) => <div key={label}><p><span>{label}</span><strong>{score ?? 0}%</strong></p><div><i style={{ width: `${score ?? 0}%` }} /></div></div>)}</div></div>
        <div className="detail-panel"><span className="eyebrow">INCLUYE</span><h2>Listo para empezar</h2><ul className="feature-list">{product.features.map((feature) => <li key={feature}><span>✓</span>{feature}</li>)}<li><span>✓</span>{product.vramGb} GB de memoria de video</li><li><span>✓</span>Componentes y stock administrados desde NovaRealm</li></ul></div>
      </section>}
      {similar.length ? <section className="shell similar-products"><div className="section-heading split-heading"><div><span className="eyebrow">TAMBIÉN PUEDE INTERESARTE</span><h2>Productos similares</h2></div><Link className="text-link" href={`/productos?type=${product.type}`}>Ver más <span>→</span></Link></div><div className="product-grid">{similar.map((item) => <Link className="similar-product" href={`/productos/${item.slug}`} key={item.slug}><ProductMedia src={item.imageUrl} alt={item.name} isPc={item.type === "PREBUILT_PC"} /><div><strong>{item.name}</strong><span>{formatMoney(item.price)}</span></div></Link>)}</div></section> : null}
    </div>
  );
}
