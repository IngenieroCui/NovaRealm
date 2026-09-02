"use client";

import { FormEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import { apiFetch, formatMoney } from "@/lib/api";
import { useNova, type NovaSession } from "@/lib/nova-context";
import type { AssistantAction, BuildSummary, ChatResponse, Product, ProductType, Recommendation, RecommendationFilters, ShoppingIntent } from "@/lib/types";
import { RecommendationCard } from "./recommendation-card";
import { WhatsAppBuyButton } from "./whatsapp-buy-button";

interface ChatMessage { id: number; role: "user" | "assistant"; content: string; recommendations?: Recommendation[]; componentRecommendations?: Product[]; build?: BuildSummary; currentPc?: ChatResponse["currentPc"]; actions?: AssistantAction[]; quickActions?: string[]; upgradeAnalysis?: ChatResponse["upgradeAnalysis"]; error?: boolean; }
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
      const response = await apiFetch<ChatResponse>("/assistant/chat", { method: "POST", body: JSON.stringify({ message: clean, conversation: history, ...(filters ? { filters } : {}), ...(activeContext.shoppingIntent ? { shoppingIntent: activeContext.shoppingIntent } : {}), context: { page: typeof window !== "undefined" ? window.location.pathname : undefined, productSlug: activeContext.selectedProduct?.slug, buildSlugs: activeContext.currentBuild, selectedComponentType: activeContext.selectedComponentType } }) });
      if (response.filters) setFilters(response.filters);
      setSelected([]);
      let responseBuild = response.build;
      if (response.actions?.length && activeContext.currentBuild.length) {
        try {
          const actionResult = await apiFetch<{ summary: BuildSummary }>("/builder/action", { method: "POST", body: JSON.stringify({ ...response.actions[0], currentSlugs: activeContext.currentBuild }) });
          responseBuild = actionResult.summary;
          nova.patchSession({ currentBuild: responseBuild.products.filter((product) => product.type !== "PREBUILT_PC").map((product) => product.slug) });
        } catch (reason) {
          setMessages((current) => [...current, { id: nextId.current++, role: "assistant", content: (reason as Error).message, error: true }]);
        }
      }
      const newMessage: ChatMessage = { id: nextId.current++, role: "assistant", content: response.message, recommendations: response.recommendations, componentRecommendations: [...(response.componentRecommendations ?? response.upgradeRecommendations ?? []), ...(response.peripheralRecommendations ?? [])], currentPc: response.currentPc, build: responseBuild, actions: response.actions, quickActions: response.quickActions, upgradeAnalysis: response.upgradeAnalysis };
      setMessages((current) => [...current, newMessage]);
      nova.patchSession({ shoppingIntent: response.shoppingIntent ?? activeContext.shoppingIntent, ...(response.componentType ? { selectedComponentType: response.componentType as ProductType } : {}), ...(responseBuild ? { currentBuild: responseBuild.products.filter((product) => product.type !== "PREBUILT_PC").map((product) => product.slug) } : {}), filters: response.filters ?? filters, conversation: [...activeContext.conversation, { role: "user", content: clean }, { role: "assistant", content: response.message }] });
    } catch (reason) { setMessages((current) => [...current, { id: nextId.current++, role: "assistant", content: (reason as Error).message, error: true }]); }
    finally { setLoading(false); }
  }, [activeContext, filters, loading, messages, nova]);

  useEffect(() => { const query = searchParams.get("q"); if (query && !initialSent.current) { initialSent.current = true; void send(query); } }, [searchParams, send]);
  const available = useMemo(() => { const map = new Map<string, Recommendation>(); messages.forEach((message) => message.recommendations?.forEach((item) => map.set(item.product.slug, item))); return [...map.values()]; }, [messages]);
  const selectedRecommendations = available.filter((item) => selected.includes(item.product.slug));
  function toggle(slug: string) { setSelected((current) => current.includes(slug) ? current.filter((item) => item !== slug) : current.length < 3 ? [...current, slug] : current); }
  function submit(event: FormEvent) { event.preventDefault(); void send(input); }
  return <div className={compact ? "nova-chat nova-chat-compact" : "nova-page"}>
    {!compact && <section className="nova-intro"><div className="nova-avatar">✦</div><div><span className="eyebrow">ASISTENTE DE COMPRA</span><h1>Hablemos de tu próximo computador.</h1><p>Respuestas cortas, productos reales y criterios calculados por NovaRealm.</p></div></section>}
    <div className={compact ? "nova-chat-inner" : "nova-shell"}>
      <section className="chat-panel">
        <div className="chat-status"><span><i /> Nova en línea</span><small>Precios, stock y compatibilidad salen del backend.</small></div>
        <div className="messages" aria-live="polite">{messages.map((message) => <div key={message.id} className={`message-row ${message.role}`}>
          {message.role === "assistant" && <div className="mini-avatar">✦</div>}
          <div className="message-content"><div className={`message-bubble ${message.error ? "message-error" : ""}`}>{message.content}</div>
            {message.actions?.length ? <div className="nova-action-chips">{message.actions.map((action) => <button key={`${action.action}-${action.productSlug}`} onClick={() => void send(action.label ?? action.action)}>{action.label ?? action.action}</button>)}</div> : null}
            {message.quickActions?.length ? <div className="nova-action-chips">{message.quickActions.map((action) => <button key={action} onClick={() => void send(action)}>{action}</button>)}</div> : null}
            {message.recommendations?.length ? <div className="recommendations-grid">{message.recommendations.map((item) => <RecommendationCard key={item.product.slug} recommendation={item} selected={selected.includes(item.product.slug)} onToggle={() => toggle(item.product.slug)} />)}</div> : null}
            {message.componentRecommendations?.length ? <div className="component-recommendations">{message.componentRecommendations.map((product) => <ComponentRecommendation key={product.slug} product={product} />)}</div> : null}
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

function ComponentRecommendation({ product }: { product: Product }) { return <article className="component-result"><div><span className="type-chip">{product.type}</span><h3>{product.name}</h3><p>{product.features.slice(0, 3).join(" · ")}</p></div><div><strong>{formatMoney(product.price)}</strong><a className="button button-small button-dark" href={`/configurador?add=${encodeURIComponent(product.slug)}`}>Agregar</a><WhatsAppBuyButton className="whatsapp-buy-button-compact" productName={product.name} price={product.price} /></div></article>; }
function UpgradePanel({ analysis }: { analysis: NonNullable<ChatResponse["upgradeAnalysis"]> }) { return <section className="upgrade-panel"><div><span>MEJOR PRIMER UPGRADE</span><strong>{analysis.bestFirstUpgrade?.name ?? "Por definir"}</strong></div><div><span>MEJOR PRECIO/RENDIMIENTO</span><strong>{analysis.bestValue?.name ?? "Por definir"}</strong></div><div><span>OPCIÓN PREMIUM</span><strong>{analysis.premium?.name ?? "Por definir"}</strong></div><p><b>Esto puede esperar:</b> {analysis.noNeedToChange}</p></section>; }
function BuildPanel({ build }: { build: BuildSummary }) { return <section className="build-panel"><div className="build-panel-heading"><div><span className="eyebrow">CONFIGURACIÓN ACTUAL</span><h3>{build.products.length ? "Tu PC por componentes" : "Aún no hay componentes"}</h3></div><strong>{formatMoney(build.total)}</strong></div>{build.products.map((product) => <div className="build-line" key={product.slug}><span>{product.type}</span><strong>{product.name}</strong><span>{formatMoney(product.price)}</span></div>)}{build.assembly ? <div className="build-line"><span>Servicio</span><strong>Ensamble</strong><span>{formatMoney(build.assembly)}</span></div> : null}<div className="build-total"><span>Presupuesto restante</span><strong>{build.budgetRemaining === null ? "—" : formatMoney(build.budgetRemaining)}</strong></div>{build.warnings.map((warning) => <p className="build-warning" key={warning}>⚠ {warning}</p>)}</section>; }
