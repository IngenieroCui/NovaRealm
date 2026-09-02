"use client";

import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import { apiFetch, formatMoney, PRODUCT_TYPE_LABELS } from "@/lib/api";
import type { BuildSummary, Product, ProductType } from "@/lib/types";
import { WhatsAppBuyButton } from "./whatsapp-buy-button";
import { useNova } from "@/lib/nova-context";

const componentSteps: ProductType[] = ["CPU", "MOTHERBOARD", "RAM", "GPU", "STORAGE", "PSU", "COOLING", "CASE"];
const peripheralSteps: ProductType[] = ["MONITOR", "KEYBOARD", "MOUSE", "HEADSET"];

export function PcBuilder() {
  const searchParams = useSearchParams();
  const [products, setProducts] = useState<Product[]>([]);
  const [selected, setSelected] = useState<Record<string, string>>({});
  const [budget, setBudget] = useState("5000000");
  const [assembly, setAssembly] = useState(true);
  const [summary, setSummary] = useState<BuildSummary | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const { patchSession, openNova } = useNova();

  useEffect(() => {
    apiFetch<Product[]>("/products?inStock=true").then((items) => {
      setProducts(items);
      const add = searchParams.get("add");
      const product = items.find((item) => item.slug === add);
      if (product) setSelected((current) => ({ ...current, [product.type]: product.slug }));
    }).catch(() => setError("No pude cargar las piezas. Intenta nuevamente."));
  }, [searchParams]);

  const selectedSlugs = useMemo(() => Object.values(selected).filter(Boolean), [selected]);
  const selectedProducts = useMemo(() => selectedSlugs.map((slug) => products.find((product) => product.slug === slug)).filter((product): product is Product => Boolean(product)), [products, selectedSlugs]);
  const components = selectedProducts.filter((product) => componentSteps.includes(product.type));
  const peripherals = selectedProducts.filter((product) => peripheralSteps.includes(product.type));
  const componentSubtotal = components.reduce((total, product) => total + product.price, 0);
  const peripheralSubtotal = peripherals.reduce((total, product) => total + product.price, 0);
  const groups = useMemo(() => [...componentSteps, ...peripheralSteps].map((type) => ({ type, options: products.filter((product) => product.type === type) })), [products]);
  useEffect(() => { patchSession({ currentBuild: selectedSlugs }); }, [patchSession, selectedSlugs]);

  async function refresh(nextSelected = selectedSlugs, nextAssembly = assembly) {
    setError(""); setBusy(true);
    try {
      const next = await apiFetch<BuildSummary>("/builder/summary", { method: "POST", body: JSON.stringify({ itemSlugs: nextSelected, budgetMax: Number(budget) || undefined, assembly: nextAssembly, complete: true }) });
      setSummary(next); patchSession({ currentBuild: next.products.map((product) => product.slug), assemblySelected: next.assembly > 0 });
    } catch (reason) { setError(reason instanceof Error ? reason.message : "No pude validar la configuración. Revisa las piezas e intenta nuevamente."); }
    finally { setBusy(false); }
  }

  async function autoBuild() {
    setError(""); setBusy(true);
    try {
      const next = await apiFetch<BuildSummary>("/builder/autobuild", { method: "POST", body: JSON.stringify({ budgetMax: Number(budget), assembly: false }) });
      setSelected(Object.fromEntries(next.products.filter((product) => componentSteps.includes(product.type)).map((product) => [product.type, product.slug])));
      setSummary(next); patchSession({ currentBuild: next.products.map((product) => product.slug), assemblySelected: next.assembly > 0 });
    } catch { setError("No pude armar una base con ese presupuesto. Prueba con un monto mayor."); }
    finally { setBusy(false); }
  }

  function select(type: ProductType, slug: string) {
    setSelected((current) => { const next = { ...current }; if (slug) next[type] = slug; else delete next[type]; return next; });
    setSummary(null);
  }

  const issues = summary?.compatibilityIssues ?? [];
  return <section className="builder-page">
    <div className="shell builder-header"><span className="eyebrow">NOVA PC BUILDER</span><h1>Arma tu PC con piezas compatibles.</h1><p>El sistema valida socket, memoria, potencia y stock. Tú decides cada pieza; Nova te ayuda a encontrarla.</p><div className="builder-header-actions"><button className="button button-accent" onClick={() => void autoBuild()} disabled={busy}>Armar por presupuesto</button><button className="button button-ghost" onClick={() => openNova("CUSTOM_PC")}>Preguntarle a Nova</button></div></div>
    <div className="shell builder-layout"><div className="builder-options"><div className="builder-section-title"><span>COMPONENTES</span><small>La base de tu equipo</small></div>{groups.filter(({ type }) => componentSteps.includes(type)).map(({ type, options }) => <BuilderSlot key={type} type={type} value={selected[type] ?? ""} options={options} onChange={(slug) => select(type, slug)} />)}<div className="builder-section-title peripheral-title"><span>PERIFÉRICOS</span><small>Completa tu estación si lo necesitas</small></div><div className="peripheral-builder-grid">{groups.filter(({ type }) => peripheralSteps.includes(type)).map(({ type, options }) => <BuilderSlot key={type} type={type} value={selected[type] ?? ""} options={options} onChange={(slug) => select(type, slug)} />)}</div><div className="builder-budget"><label>Presupuesto global <input type="number" min="500000" value={budget} onChange={(event) => { setBudget(event.target.value); setSummary(null); }} /></label><label className="builder-check"><input type="checkbox" checked={assembly} onChange={(event) => { setAssembly(event.target.checked); setSummary(null); }} /> Agregar ensamble</label></div><button className="button button-dark" onClick={() => void refresh()} disabled={busy}>{busy ? "Validando…" : "Validar configuración"}</button>{error && <p className="form-error">{error}</p>}</div>
      <aside className="builder-summary"><div className="summary-top"><div><span className="eyebrow">CONFIGURACIÓN ACTUAL</span><h2>{selectedProducts.length ? `${selectedProducts.length} productos` : "Empieza por una pieza"}</h2></div><span className={`compatibility-pill ${summary?.compatible ? "is-ok" : summary ? "is-error" : ""}`}>{summary ? summary.compatible ? "Compatible" : "Revisar build" : "Sin validar"}</span></div><SummaryGroup title="Componentes" products={components} subtotal={componentSubtotal} /><SummaryGroup title="Periféricos" products={peripherals} subtotal={peripheralSubtotal} />{summary ? <><div className="build-line"><span>Ensamble</span><strong>{summary.assembly ? "Incluido" : "No incluido"}</strong><span>{summary.assembly ? formatMoney(summary.assembly) : "—"}</span></div><div className="build-total"><span>Total</span><strong>{formatMoney(summary.total)}</strong></div><div className={`budget-result ${summary.budgetRemaining !== null && summary.budgetRemaining < 0 ? "over-budget" : ""}`}><span>{summary.budgetRemaining !== null && summary.budgetRemaining < 0 ? "Excedido" : "Restante"}</span><strong>{summary.budgetRemaining === null ? "—" : formatMoney(Math.abs(summary.budgetRemaining))}</strong></div>{issues.map((issue) => <p className={`build-warning severity-${issue.severity.toLowerCase()}`} key={issue.code}>{issue.severity === "ERROR" ? "!" : "i"} {issue.message}</p>)}<WhatsAppBuyButton productName="configuración personalizada" price={summary.total} buildLines={selectedProducts.map((product) => `${PRODUCT_TYPE_LABELS[product.type]}: ${product.name} · ${formatMoney(product.price)}`)} assembly={Boolean(summary.assembly)}>{summary.compatible ? "Cotizar por WhatsApp" : "Consultar configuración"}</WhatsAppBuyButton></> : <p className="summary-hint">Valida la configuración para conocer compatibilidad, total y presupuesto restante.</p>}</aside>
    </div>
  </section>;
}

function BuilderSlot({ type, value, options, onChange }: { type: ProductType; value: string; options: Product[]; onChange: (slug: string) => void }) { const product = options.find((item) => item.slug === value); return <label className="builder-step"><span>{PRODUCT_TYPE_LABELS[type]}</span><select value={value} onChange={(event) => onChange(event.target.value)}><option value="">Elegir {PRODUCT_TYPE_LABELS[type].toLowerCase()}</option>{options.map((item) => <option key={item.slug} value={item.slug}>{item.name} · {formatMoney(item.price)}</option>)}</select>{product ? <small className="slot-selected">{formatMoney(product.price)} · {product.stock} disponibles</small> : null}</label>; }
function SummaryGroup({ title, products, subtotal }: { title: string; products: Product[]; subtotal: number }) { return <div className="summary-group"><div className="summary-group-heading"><span>{title}</span><strong>{formatMoney(subtotal)}</strong></div>{products.length ? products.map((product) => <div className="build-line" key={product.slug}><span>{PRODUCT_TYPE_LABELS[product.type]}</span><strong>{product.name}</strong><span>{formatMoney(product.price)}</span></div>) : <p className="summary-empty">Aún no agregas {title.toLowerCase()}.</p>}</div>; }
