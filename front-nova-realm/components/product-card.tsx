import Link from "next/link";
import { formatMoney, PRODUCT_TYPE_LABELS } from "@/lib/api";
import type { Product } from "@/lib/types";
import { ProductMedia } from "@/components/product-media";

export function ProductCard({ product }: { product: Product }) {
  const isPc = product.type === "PREBUILT_PC";
  return (
    <article className="product-card">
      <Link className="product-image" href={`/productos/${product.slug}`}>
        <span className="product-badge">{isPc ? "PC ARMADO" : PRODUCT_TYPE_LABELS[product.type]}</span>
        <ProductMedia src={product.imageUrl} alt={product.name} isPc={isPc} />
      </Link>
      <div className="product-card-body">
        <div className="stock-line">
          <span className={product.stock > 0 ? "stock-dot" : "stock-dot out"} />
          {product.stock > 0 ? `${product.stock} disponibles` : "Agotado"}
        </div>
        <Link href={`/productos/${product.slug}`}><h3>{product.name}</h3></Link>
        {isPc ? (
          <ul className="spec-mini-list">
            <li><span>CPU</span><strong>{product.cpu}</strong></li>
            <li><span>GPU</span><strong>{product.gpu}</strong></li>
            <li><span>RAM</span><strong>{product.ramGb} GB</strong></li>
          </ul>
        ) : (
          <p className="component-description">{product.description}</p>
        )}
        <div className="product-price-row">
          <div><small>Desde</small><strong>{formatMoney(product.price)}</strong></div>
          <Link className="round-arrow" href={`/productos/${product.slug}`} aria-label={`Ver ${product.name}`}>→</Link>
        </div>
      </div>
    </article>
  );
}
