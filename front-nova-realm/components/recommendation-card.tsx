import Link from "next/link";
import { formatMoney } from "@/lib/api";
import type { Recommendation } from "@/lib/types";
import { ProductMedia } from "./product-media";
import { WhatsAppBuyButton } from "./whatsapp-buy-button";

export function RecommendationCard({ recommendation, selected, onToggle }: { recommendation: Recommendation; selected: boolean; onToggle: () => void }) {
  const { product } = recommendation;
  return (
    <article className={`recommendation-card category-${recommendation.category.toLowerCase()}`}>
      <div className="recommendation-label"><span>{recommendation.categoryLabel}</span><strong title="Qué tan bien encaja este producto con tu presupuesto, rendimiento y usos seleccionados.">{recommendation.fitScore}% <small>de ajuste ⓘ</small></strong></div>
      <div className="rec-product-main"><div className="rec-image"><ProductMedia src={product.imageUrl} alt={product.name} isPc={product.type === "PREBUILT_PC"} /></div><div><h3>{product.name}</h3><p>{product.cpu}</p><p>{product.gpu}</p><div className="rec-memory"><span>{product.ramGb} GB RAM</span><span>{product.storageGb} GB SSD</span></div></div></div>
      <div className="workload-score-list">{recommendation.workloadScores.map((score) => <div key={score.slug}><p><span>{score.workload}</span><strong>{score.score}%</strong></p><div><i style={{ width: `${score.score}%` }} /></div></div>)}</div>
      <div className="rec-reason"><span>✓</span><p>{recommendation.strengths[0] ?? "Buena coincidencia con tus criterios"}</p></div>
      <div className="rec-footer"><div><small>Precio</small><strong>{formatMoney(product.price)}</strong></div><div className="rec-actions"><button className={selected ? "compare-toggle selected" : "compare-toggle"} onClick={onToggle}>{selected ? "✓ Comparando" : "+ Comparar"}</button><Link className="round-arrow" href={`/productos/${product.slug}`}>→</Link></div></div>
      <div className="rec-purchase"><WhatsAppBuyButton className="whatsapp-buy-button-compact" productName={product.name} productType={product.type} price={product.price} fitScore={recommendation.fitScore} /></div>
    </article>
  );
}
