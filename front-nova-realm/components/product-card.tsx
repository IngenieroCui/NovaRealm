import Link from "next/link";
import { formatMoney, PRODUCT_TYPE_LABELS } from "@/lib/api";
import type { Product } from "@/lib/types";
import { ProductMedia } from "@/components/product-media";

export function ProductCard({ product }: { product: Product }) {
  if (product.type === "PREBUILT_PC") return <PrebuiltPcCard product={product} />;
  if (["MONITOR", "KEYBOARD", "MOUSE", "HEADSET"].includes(product.type)) return <PeripheralCard product={product} />;
  return <ComponentCard product={product} />;
}

function CardFrame({ product, children, badge }: { product: Product; children: React.ReactNode; badge?: string }) {
  return <article className="product-card"><Link className="product-image" href={`/productos/${product.slug}`}><span className="product-badge">{badge ?? PRODUCT_TYPE_LABELS[product.type]}</span><ProductMedia src={product.imageUrl} alt={product.name} isPc={product.type === "PREBUILT_PC"} /></Link><div className="product-card-body"><div className="stock-line"><span className={product.stock > 0 ? "stock-dot" : "stock-dot out"} />{product.stock > 0 ? `${product.stock} disponibles` : "Agotado"}</div><Link href={`/productos/${product.slug}`}><h3>{product.name}</h3></Link>{children}<div className="product-price-row"><div><small>{product.type === "PREBUILT_PC" ? "Desde" : "Precio"}</small><strong>{formatMoney(product.price)}</strong></div><Link className="round-arrow" href={`/productos/${product.slug}`} aria-label={`Ver ${product.name}`}>→</Link></div></div></article>;
}

export function PrebuiltPcCard({ product }: { product: Product }) {
  return <CardFrame product={product} badge="PC ARMADO"><ul className="spec-mini-list"><li><span>CPU</span><strong>{product.cpu}</strong></li><li><span>GPU</span><strong>{product.gpu}</strong></li><li><span>RAM</span><strong>{product.ramGb} GB</strong></li><li><span>SSD</span><strong>{product.storageGb} GB</strong></li></ul></CardFrame>;
}

export function ComponentCard({ product }: { product: Product }) {
  return <CardFrame product={product}><div className="component-specs">{product.type === "GPU" && <><strong>{product.vramGb ?? "—"} GB VRAM</strong><span>Rendimiento {product.gpuScore ?? "—"}/100</span></>}{product.type === "CPU" && <><strong>{product.cpu ?? product.name}</strong><span>Rendimiento {product.cpuScore ?? "—"}/100</span></>}{product.type === "RAM" && <><strong>{product.ramGb ?? "—"} GB</strong><span>{String(product.technicalSpecs?.memoryType ?? "RAM")} · {String(product.technicalSpecs?.speedMt ?? "—")} MT/s</span></>}{product.type === "STORAGE" && <><strong>{product.storageGb ?? "—"} GB</strong><span>{String(product.technicalSpecs?.interface ?? "SSD NVMe")}</span></>}{!["GPU", "CPU", "RAM", "STORAGE"].includes(product.type) && <p className="component-description">{product.description}</p>}</div></CardFrame>;
}

export function PeripheralCard({ product }: { product: Product }) {
  const specs = product.technicalSpecs ?? {};
  return <CardFrame product={product}><div className="component-specs"><strong>{product.features[0] ?? PRODUCT_TYPE_LABELS[product.type]}</strong><span>{product.type === "MONITOR" ? `${String(specs.resolution ?? "")} · ${String(specs.refreshHz ?? "")} Hz` : product.features.slice(1, 3).join(" · ")}</span></div></CardFrame>;
}
