"use client";

import { FormEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";
import { apiFetch, formatMoney, PRODUCT_TYPE_LABELS } from "@/lib/api";
import { useNova, type NovaSession } from "@/lib/nova-context";
import type { AssistantAction, BuildSummary, BuilderFlow, ChatResponse, Product, ProductType, Recommendation, RecommendationFilters, ShoppingIntent } from "@/lib/types";
import { RecommendationCard } from "./recommendation-card";
import { WhatsAppBuyButton } from "./whatsapp-buy-button";

interface ChatMessage { id: number; role: "user" | "assistant"; content: string; recommendations?: Recommendation[]; componentRecommendations?: Product[]; build?: BuildSummary; flow?: BuilderFlow; currentPc?: ChatResponse["currentPc"]; actions?: AssistantAction[]; quickActions?: string[]; upgradeAnalysis?: ChatResponse["upgradeAnalysis"]; error?: boolean; }
const suggestions = ["Tengo 5 millones. Juego Warzone y Valorant a 1440p y uso Blender.", "Quiero el PC más barato que sirva para Valorant. Máximo 3 millones.", "Uso Docker y máquinas virtuales. Mi presupuesto es 4.5 millones."];
const intentLabels: Record<ShoppingIntent, string> = { PREBUILT_PC: "PC completo", CUSTOM_PC: "Armar mi PC", UPGRADE_PC: "Mejorar mi PC", COMPONENT: "Un componente", PC_WITH_PERIPHERALS: "PC + periféricos" };

export function NovaChat({ compact = false, context }: { compact?: boolean; context?: NovaSession }) {
  const searchParams = useSearchParams();
  const nova = useNova();
  const activeContext = context ?? nova.session;
  const initialSent = useRef(false);
  const nextId = useRef(2);
  const [messages, setMessages] = useState<ChatMessage[]>([{ id: 1, role: "assistant", content: activeContext.shoppingIntent ? `Perfecto: te ayudaré con ${intentLabels[activeContext.shoppingIntent]}. ¿Qué necesitas exactamente?` : "¡Hola! Soy Nova. ¿Qué estás buscando hoy? Puedo recomendarte un equipo, armarlo por componentes o mejorar el que ya tienes." }]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [filters, setFilters] = useState<RecommendationFilters | null>(activeContext.filters);
  const [selected, setSelected] = useState<string[]>([]);

  const send = useCallback(async (text: string) => {
    const clean = text.trim();
    if (!clean || loading) return;
    const history = messages.slice(-8).map(({ role, content }) => ({ role, content }));
    setMessages((current) => [...current, { id: nextId.current++, role: "user", content: clean }]);
    setInput(""); setLoading(true);
    try {
      const response = await apiFetch<ChatResponse>("/assistant/chat", { method: "POST", body: JSON.stringify({ message: clean, conversation: history, ...(filters ? { filters } : {}), ...(activeContext.shoppingIntent ? { shoppingIntent: activeContext.shoppingIntent } : {}), context: { page: typeof window !== "undefined" ? window.location.pathname : undefined, productSlug: activeContext.selectedProduct?.slug, buildSlugs: activeContext.currentBuild, selectedComponentType: activeContext.selectedComponentType, builderMode: activeContext.builderMode } }) });
      if (response.filters) setFilters(response.filters);
      setSelected([]);
      const responseBuild = response.build;
      const newMessage: ChatMessage = { id: nextId.current++, role: "assistant", content: response.message, recommendations: response.recommendations, componentRecommendations: [...(response.componentRecommendations ?? response.upgradeRecommendations ?? []), ...(response.peripheralRecommendations ?? [])], currentPc: response.currentPc, build: responseBuild, flow: response.flow, actions: response.actions, quickActions: response.quickActions, upgradeAnalysis: response.upgradeAnalysis };
      setMessages((current) => [...current, newMessage]);
      nova.patchSession({ shoppingIntent: response.shoppingIntent ?? activeContext.shoppingIntent, ...(response.componentType ? { selectedComponentType: response.componentType as ProductType } : {}), ...(responseBuild ? { currentBuild: responseBuild.products.filter((product) => product.type !== "PREBUILT_PC").map((product) => product.slug) } : {}), ...(response.flow ? { builderFlow: response.flow, builderMode: response.flow.mode } : {}), filters: response.filters ?? filters, conversation: [...activeContext.conversation, { role: "user", content: clean }, { role: "assistant", content: response.message }] });
    } catch (reason) { setMessages((current) => [...current, { id: nextId.current++, role: "assistant", content: (reason as Error).message, error: true }]); }
    finally { setLoading(false); }
  }, [activeContext, filters, loading, messages, nova]);

  const applyAction = useCallback(async (action: AssistantAction) => {
    if (loading) return;
    setLoading(true);
    try {
      const result = await apiFetch<{ summary: BuildSummary; product?: Product | null; flow?: BuilderFlow; recommendations?: Product[] }>("/builder/action", { method: "POST", body: JSON.stringify({ ...action, currentSlugs: activeContext.currentBuild, budgetMax: filters?.budgetMax, mode: activeContext.builderMode }) });
      const slugs = result.summary.products.filter((product) => product.type !== "PREBUILT_PC").map((product) => product.slug);
      const productName = result.product?.name;
      const isBuilder = activeContext.builderMode || action.action === "START_GUIDED" || action.action === "AUTO_BUILD";
      const recommendations = isBuilder ? result.recommendations ?? [] : [];
      const nextMessage = action.action === "START_GUIDED" ? "Perfecto. Vamos paso a paso." : action.action === "AUTO_BUILD" ? "Listo, te armé una base equilibrada con productos disponibles." : productName ? `Listo, ${productName} quedó agregado a tu configuración.` : action.action === "ADD_ASSEMBLY" ? "Listo, agregué el servicio de ensamble." : "Listo, actualicé tu configuración.";
      setMessages((current) => [...current, { id: nextId.current++, role: "assistant", content: nextMessage, componentRecommendations: recommendations, build: result.summary, flow: isBuilder ? result.flow : undefined, quickActions: isBuilder ? (result.flow?.currentStep === "DONE" ? ["Agregar periféricos", "Agregar ensamble", "Cotizar"] : undefined) : ["Buscar otro componente", "Revisar compatibilidad", "Comprar por WhatsApp", "Hasta ahí"] }]);
      nova.patchSession({ currentBuild: slugs, ...(isBuilder && result.flow ? { builderFlow: result.flow, builderMode: result.flow.mode } : {}) });
    } catch (reason) {
      setMessages((current) => [...current, { id: nextId.current++, role: "assistant", content: (reason as Error).message, error: true }]);
    } finally { setLoading(false); }
  }, [activeContext, filters, loading, nova]);

  useEffect(() => { const query = searchParams.get("q"); if (query && !initialSent.current) { initialSent.current = true; void send(query); } }, [searchParams, send]);
  const available = useMemo(() => { const map = new Map<string, Recommendation>(); messages.forEach((message) => message.recommendations?.forEach((item) => map.set(item.product.slug, item))); return [...map.values()]; }, [messages]);
  const selectedRecommendations = available.filter((item) => selected.includes(item.product.slug));
  function toggle(slug: string) { setSelected((current) => current.includes(slug) ? current.filter((item) => item !== slug) : current.length < 3 ? [...current, slug] : current); }
  function submit(event: FormEvent) { event.preventDefault(); void send(input); }
  return <div className={compact ? "nova-chat nova-chat-compact" : "nova-page"}>
    {!compact && <section className="nova-intro"><div className="nova-avatar" aria-hidden="true">N</div><div><span className="eyebrow">ASISTENTE DE COMPRA</span><h1>Hablemos de tu próximo computador.</h1><p>Productos reales y recomendaciones claras para decidir.</p></div></section>}
    <div className={compact ? "nova-chat-inner" : "nova-shell"}>
      <section className="chat-panel">
        <div className="chat-status"><span><i /> Nova en línea</span><small>Precios, stock y compatibilidad salen del backend.</small></div>
        <div className="messages" aria-live="polite">{messages.map((message) => <div key={message.id} className={`message-row ${message.role}`}>
          {message.role === "assistant" && <div className="mini-avatar" aria-hidden="true">N</div>}
          <div className="message-content"><MarkdownMessage content={message.content} error={message.error} />
            {message.flow ? <BuilderProgress flow={message.flow} /> : null}
            {message.actions?.length ? <div className="nova-action-chips">{message.actions.map((action) => <button key={`${action.action}-${action.productSlug ?? action.componentType ?? ""}`} onClick={() => void applyAction(action)}>{action.label ?? action.action}</button>)}</div> : null}
            {message.quickActions?.length ? <div className="nova-action-chips">{message.quickActions.map((action) => <button key={action} onClick={() => void send(action)}>{action}</button>)}</div> : null}
            {message.recommendations?.length ? <div className="recommendations-grid">{message.recommendations.map((item) => <RecommendationCard key={item.product.slug} recommendation={item} selected={selected.includes(item.product.slug)} onToggle={() => toggle(item.product.slug)} />)}</div> : null}
            {message.componentRecommendations?.length ? <div className="component-recommendations">{message.componentRecommendations.map((product) => <ComponentRecommendation key={product.slug} product={product} onChoose={() => void applyAction({ action: "ADD_TO_BUILD", productSlug: product.slug, label: `Elegir ${product.name}` })} />)}</div> : null}
            {message.currentPc ? <div className="current-pc"><span>PC ACTUAL</span><strong>{message.currentPc.cpu ?? "CPU por confirmar"}</strong><strong>{message.currentPc.gpu ?? "GPU por confirmar"}</strong>{message.currentPc.ramGb ? <strong>{message.currentPc.ramGb} GB RAM</strong> : null}</div> : null}
            {message.upgradeAnalysis ? <UpgradePanel analysis={message.upgradeAnalysis} /> : null}
            {message.build ? <BuildPanel build={message.build} /> : null}
          </div>
        </div>)}{loading && <div className="message-row assistant"><div className="mini-avatar">✦</div><div className="message-bubble typing"><i /><i /><i /><span>Nova está revisando el catálogo</span></div></div>}</div>
        {messages.length === 1 && !compact && <div className="chat-suggestions">{suggestions.map((suggestion) => <button key={suggestion} onClick={() => void send(suggestion)}>{suggestion}<span>→</span></button>)}</div>}
        <form className="chat-composer" onSubmit={submit}><textarea rows={2} maxLength={2000} value={input} onChange={(event) => setInput(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter" && !event.shiftKey) { event.preventDefault(); void send(input); } }} placeholder="Ej: Quiero una GPU para jugar a 1440p…" /><button type="submit" disabled={!input.trim() || loading} aria-label="Enviar mensaje">↑</button><small>Enter para enviar · Shift + Enter para nueva línea</small></form>
      </section>
      {!compact && <aside className="criteria-panel"><div className="criteria-title"><span>⌁</span><div><h2>Lo que entendí</h2><p>Se actualiza con la conversación</p></div></div>{filters ? <div className="criteria-list"><div><span>Intención</span><strong>{activeContext.shoppingIntent ? intentLabels[activeContext.shoppingIntent] : "Por definir"}</strong></div><div><span>Presupuesto máximo</span><strong>{filters.budgetMax ? formatMoney(filters.budgetMax) : "Por definir"}</strong></div><div><span>Usos principales</span><div className="criteria-tags">{filters.workloads.map((item) => <span key={item.slug}>{item.slug.replaceAll("-", " ")}</span>)}</div></div></div> : <div className="criteria-empty"><span>✦</span><p>Cuéntame qué quieres hacer y te acompaño.</p></div>}<div className="privacy-note"><span>◇</span><p><strong>IA segura</strong>Nova no recibe datos sensibles; catálogo, stock, precios y compatibilidad salen del backend.</p></div></aside>}
    </div>
    {selectedRecommendations.length > 0 && !compact && <section className="comparison-dock shell"><div className="comparison-heading"><div><span className="eyebrow">COMPARADOR</span><h2>{selectedRecommendations.length} equipos seleccionados</h2></div><button onClick={() => setSelected([])}>Limpiar</button></div><div className="comparison-purchase-actions">{selectedRecommendations.map((item) => <WhatsAppBuyButton key={item.product.slug} className="comparison-buy-button" productName={item.product.name} price={item.product.price} fitScore={item.fitScore} />)}</div></section>}
  </div>;
}

function ComponentRecommendation({ product, onChoose }: { product: Product; onChoose: () => void }) { return <article className="component-result"><div><span className="type-chip">{product.type === "MOTHERBOARD" ? "Motherboard" : product.type === "GPU" ? "Tarjeta gráfica" : product.type === "CPU" ? "Procesador" : product.type === "RAM" ? "Memoria RAM" : product.type === "PSU" ? "Fuente" : product.type === "STORAGE" ? "Almacenamiento" : product.type === "MONITOR" ? "Monitor" : product.type}</span><h3>{product.name}</h3><p>{product.features.slice(0, 3).join(" · ")}</p></div><div><strong>{formatMoney(product.price)}</strong><button className="button button-small button-dark" onClick={onChoose}>Elegir</button><Link className="button button-small button-outline" href={`/productos/${product.slug}`}>Ver detalle</Link><WhatsAppBuyButton className="whatsapp-buy-button-compact" productName={product.name} price={product.price} /></div></article>; }
function UpgradePanel({ analysis }: { analysis: NonNullable<ChatResponse["upgradeAnalysis"]> }) { return <section className="upgrade-panel"><div><span>MEJOR PRIMER UPGRADE</span><strong>{analysis.bestFirstUpgrade?.name ?? "Por definir"}</strong></div><div><span>MEJOR PRECIO/RENDIMIENTO</span><strong>{analysis.bestValue?.name ?? "Por definir"}</strong></div><div><span>OPCIÓN PREMIUM</span><strong>{analysis.premium?.name ?? "Por definir"}</strong></div><p><b>Esto puede esperar:</b> {analysis.noNeedToChange}</p></section>; }
function MarkdownMessage({ content, error }: { content: string; error?: boolean }) { const blocks = content.trim().split(/\n\s*\n/).filter(Boolean); return <div className={`message-bubble message-markdown ${error ? "message-error" : ""}`}>{blocks.map((block, index) => { const lines = block.split("\n"); const isList = lines.every((line) => /^\s*[-*]\s+/.test(line)); return isList ? <ul key={index}>{lines.map((line) => <li key={line}>{inlineMarkdown(line.replace(/^\s*[-*]\s+/, ""))}</li>)}</ul> : <p key={index}>{lines.map((line, lineIndex) => <span key={lineIndex}>{lineIndex ? <br /> : null}{inlineMarkdown(line)}</span>)}</p>; })}</div>; }
function inlineMarkdown(value: string) { const tokens = value.split(/(\*\*[^*]+\*\*|\[[^\]]+\]\([^\s)]+\))/g); return tokens.map((token, index) => { const bold = token.match(/^\*\*(.+)\*\*$/); const link = token.match(/^\[([^\]]+)\]\(([^\s)]+)\)$/); if (bold) return <strong key={index}>{bold[1]}</strong>; if (link && /^(https?:\/\/|\/)/i.test(link[2])) return <a key={index} href={link[2]} target={link[2].startsWith("http") ? "_blank" : undefined} rel={link[2].startsWith("http") ? "noreferrer" : undefined}>{link[1]}</a>; return <span key={index}>{token.replace(/[*_`]/g, "")}</span>; }); }
function BuilderProgress({ flow }: { flow: BuilderFlow }) { if (flow.currentStep === "DONE") return <div className="builder-progress is-done"><strong>Configuración lista</strong><span>{flow.progress}% completado</span></div>; return <div className="builder-progress"><div><strong>Armando tu PC</strong><span>Paso {flow.completedSteps.length + 1} de {flow.totalSteps} · {flow.currentStepLabel}</span></div><div className="builder-progress-track"><i style={{ width: `${flow.progress}%` }} /></div></div>; }
function BuildPanel({ build }: { build: BuildSummary }) { const group = (title: string, products: Product[]) => <div className="build-summary-group"><div className="build-summary-group-title">{title}</div>{products.length ? products.map((product) => <div className="build-line" key={product.slug}><span>{PRODUCT_TYPE_LABELS[product.type] ?? product.type}</span><strong>{product.name}</strong><span>{formatMoney(product.price)}</span></div>) : <p className="summary-empty">Aún no hay productos.</p>}</div>; return <section className="build-panel"><div className="build-panel-heading"><div><span className="eyebrow">CONFIGURACIÓN ACTUAL</span><h3>{build.products.length ? "Tu PC por componentes" : "Aún no hay componentes"}</h3></div><strong>{formatMoney(build.total)}</strong></div>{group("Componentes", build.components)}{group("Periféricos", build.peripherals)}{build.assembly ? <div className="build-summary-group"><div className="build-summary-group-title">Servicios</div><div className="build-line"><span>Ensamble</span><strong>Entrega ensamblada</strong><span>{formatMoney(build.assembly)}</span></div></div> : null}<div className="build-total"><span>Total</span><strong>{formatMoney(build.total)}</strong></div><div className="budget-result"><span>Presupuesto restante</span><strong>{build.budgetRemaining === null ? "—" : formatMoney(build.budgetRemaining)}</strong></div><p className={`build-compatibility ${build.compatible ? "is-ok" : "is-error"}`}>{build.compatible ? "✓ Configuración compatible" : `! Hay que corregir ${(build.compatibilityIssues ?? []).filter((item) => item.severity === "ERROR").length || 1} incompatibilidad`}</p>{(build.compatibilityIssues ?? []).filter((issue) => issue.severity === "ERROR").slice(0, 1).map((issue) => <p className="build-warning" key={issue.code}>{issue.message}</p>)}<WhatsAppBuyButton className="chat-build-quote" productName="configuración personalizada" price={build.total} buildLines={build.products.map((product) => `${PRODUCT_TYPE_LABELS[product.type] ?? product.type}: ${product.name} · ${formatMoney(product.price)}`)} assembly={Boolean(build.assembly)}>{build.products.length === 1 ? "Cotizar este producto" : "Cotizar por WhatsApp"}</WhatsAppBuyButton></section>; }
