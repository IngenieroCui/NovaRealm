"use client";

import { FormEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";
import { apiFetch, ApiError, formatMoney, PRODUCT_TYPE_LABELS } from "@/lib/api";
import { useNova, type NovaSession } from "@/lib/nova-context";
import type { AssistantAction, BuildSummary, BuilderFlow, ChatResponse, Product, ProductType, QuickReply, Recommendation, RecommendationFilters, ShoppingIntent, SystemInfoGuide } from "@/lib/types";
import { RecommendationCard } from "./recommendation-card";
import { WhatsAppBuyButton } from "./whatsapp-buy-button";

interface ChatMessage { id: number; role: "user" | "assistant"; content: string; recommendations?: Recommendation[]; componentRecommendations?: Product[]; build?: BuildSummary; flow?: BuilderFlow; currentPc?: ChatResponse["currentPc"]; actions?: AssistantAction[]; quickReplies?: QuickReply[]; upgradeAnalysis?: ChatResponse["upgradeAnalysis"]; systemInfoGuide?: SystemInfoGuide; error?: boolean; retryText?: string; actionableConsumed?: boolean; }
const suggestions = ["Tengo 5 millones. Juego Warzone y Valorant a 1440p y uso Blender.", "Quiero el PC más barato que sirva para Valorant. Máximo 3 millones.", "Uso Docker y máquinas virtuales. Mi presupuesto es 4.5 millones."];
const intentLabels: Record<ShoppingIntent, string> = { PREBUILT_PC: "PC completo", CUSTOM_PC: "Armar mi PC", UPGRADE_PC: "Mejorar mi PC", COMPONENT: "Un componente", PC_WITH_PERIPHERALS: "PC + periféricos" };
const initialIntentReplies: Record<ShoppingIntent, QuickReply> = {
  PREBUILT_PC: { id: "intent-prebuilt", label: "Comprar PC listo", kind: "SET_INTENT", value: "PREBUILT_PC" },
  CUSTOM_PC: { id: "intent-custom", label: "Armar por componentes", kind: "SET_INTENT", value: "CUSTOM_PC" },
  UPGRADE_PC: { id: "intent-upgrade", label: "Mejorar mi PC", kind: "SET_INTENT", value: "UPGRADE_PC" },
  COMPONENT: { id: "intent-component", label: "Buscar componente", kind: "SET_INTENT", value: "COMPONENT" },
  PC_WITH_PERIPHERALS: { id: "intent-peripherals", label: "PC + periféricos", kind: "SET_INTENT", value: "PC_WITH_PERIPHERALS" },
};
const openingReplies: QuickReply[] = Object.values(initialIntentReplies).filter((reply) => reply.value !== "PC_WITH_PERIPHERALS");

export function NovaChat({ compact = false, context }: { compact?: boolean; context?: NovaSession }) {
  const searchParams = useSearchParams();
  const nova = useNova();
  const activeContext = context ?? nova.session;
  const initialSent = useRef(false);
  const nextId = useRef(2);
  const [messages, setMessages] = useState<ChatMessage[]>([{ id: 1, role: "assistant", content: "¡Hola! Soy Nova. Cuéntame qué quieres conseguir y lo vemos juntos.", quickReplies: activeContext.shoppingIntent ? undefined : openingReplies }]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [filters, setFilters] = useState<RecommendationFilters | null>(activeContext.filters);
  const [selected, setSelected] = useState<string[]>([]);
  const requestBusy = useRef(false);
  const actionBusy = useRef(false);

  const send = useCallback(async (text: string, showUser = true, quickReply?: QuickReply) => {
    const clean = text.trim();
    if (!clean || requestBusy.current) return;
    initialSent.current = true;
    requestBusy.current = true;
    const history = messages.filter((message) => !message.error).slice(-8).map(({ role, content }) => ({ role, content }));
    if (showUser) setMessages((current) => [...current.map((message) => message.actions?.length || message.quickReplies?.length || message.componentRecommendations?.length ? { ...message, actionableConsumed: true } : message), { id: nextId.current++, role: "user", content: clean }]);
    setInput(""); setLoading(true);
    try {
      if (!showUser) setMessages((current) => current.filter((message) => !(message.error && message.retryText === clean)));
      const response = await apiFetch<ChatResponse>("/assistant/chat", { method: "POST", body: JSON.stringify({ message: clean, conversation: history, ...(filters ? { criteria: filters } : {}), ...(quickReply ? { quickReply } : {}), ...(activeContext.shoppingIntent ? { shoppingIntent: activeContext.shoppingIntent } : {}), context: assistantContext(activeContext) }) });
      if (response.criteria ?? response.filters) setFilters(response.criteria ?? response.filters);
      setSelected([]);
      const responseBuild = response.build;
      const newMessage: ChatMessage = { id: nextId.current++, role: "assistant", content: response.message, recommendations: response.recommendations, componentRecommendations: [...(response.componentRecommendations ?? response.upgradeRecommendations ?? []), ...(response.peripheralRecommendations ?? [])], currentPc: response.currentPc, build: responseBuild, flow: response.flow, actions: response.actions, quickReplies: response.quickReplies, upgradeAnalysis: response.upgradeAnalysis, systemInfoGuide: response.systemInfoGuide };
      setMessages((current) => [...current, newMessage]);
      const changedIntent = response.shoppingIntent && response.shoppingIntent !== activeContext.shoppingIntent;
      nova.patchSession({ shoppingIntent: response.shoppingIntent ?? activeContext.shoppingIntent, ...(changedIntent ? { selectedComponentType: undefined, builderMode: undefined, builderFlow: undefined, currentPc: undefined, upgradeGoal: undefined, lastRecommendedProductSlug: undefined, lastComparedProductSlugs: undefined, lastBuilderAdviceTopic: undefined, builderPreference: undefined } : {}), ...(response.componentType ? { selectedComponentType: response.componentType as ProductType } : {}), ...(response.currentPc ? { currentPc: response.currentPc } : {}), ...(response.upgradeGoal ? { upgradeGoal: response.upgradeGoal } : {}), ...(responseBuild ? { currentBuild: responseBuild.products.filter((product) => product.type !== "PREBUILT_PC").map((product) => product.slug), assemblySelected: responseBuild.assembly > 0 } : {}), ...(response.flow ? { builderFlow: response.flow, builderMode: response.flow.mode } : {}), lastRecommendedProductSlug: response.lastRecommendedProductSlug, lastComparedProductSlugs: response.lastComparedProductSlugs, lastBuilderAdviceTopic: response.lastBuilderAdviceTopic, builderPreference: response.builderPreference, filters: response.criteria ?? response.filters ?? filters, conversation: [...activeContext.conversation, { role: "user", content: clean }, { role: "assistant", content: response.message }] });
    } catch (reason) {
      const apiError = reason instanceof ApiError;
      const networkError = !apiError || reason.status === 0;
      const detail = reason instanceof Error ? reason.message : "Intenta nuevamente.";
      setMessages((current) => [...current, { id: nextId.current++, role: "assistant", content: networkError ? "Revisa tu conexión e intenta nuevamente." : detail, error: true, retryText: networkError ? clean : undefined }]);
    }
    finally { requestBusy.current = false; setLoading(false); }
  }, [activeContext, filters, messages, nova]);

  const applyAction = useCallback(async (action: AssistantAction, messageId?: number) => {
    if (actionBusy.current || requestBusy.current) return;
    actionBusy.current = true;
    if (messageId) setMessages((current) => current.map((message) => message.id === messageId ? { ...message, actionableConsumed: true } : message));
    setLoading(true);
    try {
      const payload = { action: action.action, currentSlugs: activeContext.currentBuild, ...(action.productSlug ? { productSlug: action.productSlug } : {}), ...(action.productId ? { productId: action.productId } : {}), ...(action.componentType ? { componentType: action.componentType } : {}), ...(filters?.budgetMax ? { budgetMax: filters.budgetMax } : {}), ...(filters?.workloads ? { workloads: filters.workloads } : {}), ...(activeContext.builderMode ? { mode: activeContext.builderMode } : {}), assemblySelected: activeContext.assemblySelected };
      const response = await apiFetch<ChatResponse>("/assistant/action", { method: "POST", body: JSON.stringify({ builderAction: payload, ...(filters ? { criteria: filters } : {}), context: assistantContext(activeContext), conversation: activeContext.conversation.slice(-8) }) });
      const responseBuild = response.build;
      setMessages((current) => [...current, { id: nextId.current++, role: "assistant", content: response.message, componentRecommendations: response.componentRecommendations, build: responseBuild, flow: response.flow, actions: response.actions, quickReplies: response.quickReplies }]);
      nova.patchSession({ ...(responseBuild ? { currentBuild: responseBuild.products.filter((product) => product.type !== "PREBUILT_PC").map((product) => product.slug), assemblySelected: responseBuild.assembly > 0 } : {}), ...(response.flow ? { builderFlow: response.flow, builderMode: response.flow.mode } : {}), lastRecommendedProductSlug: response.lastRecommendedProductSlug, lastComparedProductSlugs: response.lastComparedProductSlugs, lastBuilderAdviceTopic: response.lastBuilderAdviceTopic, builderPreference: response.builderPreference, conversation: [...activeContext.conversation, { role: "user", content: action.label ?? action.action }, { role: "assistant", content: response.message }] });
    } catch (reason) {
      setMessages((current) => [...current, { id: nextId.current++, role: "assistant", content: reason instanceof Error ? reason.message : "No pude aplicar ese cambio a la configuración.", error: true }]);
    } finally { actionBusy.current = false; setLoading(false); }
  }, [activeContext, filters, nova]);

  const markActionableConsumed = useCallback((messageId: number) => setMessages((current) => current.map((message) => message.id === messageId ? { ...message, actionableConsumed: true } : message)), []);
  const handleQuickReply = useCallback((reply: QuickReply, messageId: number) => {
    if (reply.kind === "BUILDER_ACTION") { const action = typeof reply.payload?.action === "string" ? reply.payload.action : ""; if (action) void applyAction({ action, label: reply.label }, messageId); return; }
    markActionableConsumed(messageId);
    void send(typeof reply.value === "string" && reply.kind === "SEND_MESSAGE" ? reply.value : reply.label, true, reply);
  }, [applyAction, markActionableConsumed, send]);

  useEffect(() => { const query = searchParams.get("q"); if (query && !initialSent.current) { initialSent.current = true; void send(query); } }, [searchParams, send]);
  useEffect(() => { if (!searchParams.get("q") && activeContext.shoppingIntent && !initialSent.current) { initialSent.current = true; const reply = initialIntentReplies[activeContext.shoppingIntent]; void send(reply.label, false, reply); } }, [activeContext.shoppingIntent, searchParams, send]);
  const available = useMemo(() => { const map = new Map<string, Recommendation>(); messages.forEach((message) => message.recommendations?.forEach((item) => map.set(item.product.slug, item))); return [...map.values()]; }, [messages]);
  const selectedRecommendations = available.filter((item) => selected.includes(item.product.slug));
  const lastActionableId = [...messages].reverse().find((message) => message.actions?.length || message.quickReplies?.length || message.componentRecommendations?.length)?.id;
  function toggle(slug: string) { setSelected((current) => current.includes(slug) ? current.filter((item) => item !== slug) : current.length < 3 ? [...current, slug] : current); }
  function submit(event: FormEvent) { event.preventDefault(); void send(input); }
  return <div className={compact ? "nova-chat nova-chat-compact" : "nova-page"}>
    {!compact && <section className="nova-intro"><div className="nova-avatar" aria-hidden="true">N</div><div><span className="eyebrow">ASISTENTE DE COMPRA</span><h1>Hablemos de tu próximo computador.</h1><p>Productos reales y recomendaciones claras para decidir.</p></div></section>}
    <div className={compact ? "nova-chat-inner" : "nova-shell"}>
      <section className="chat-panel">
        <div className="chat-status"><span><i /> Nova en línea</span><small>Precios, stock y compatibilidad salen del backend.</small></div>
        <div className="messages" aria-live="polite">{messages.map((message) => message.error ? <div key={message.id} className="message-row connection-error"><div className="connection-error-card"><strong>{message.retryText ? "No pude conectarme con Nova." : "No pude completar ese cambio."}</strong><p>{message.content}</p>{message.retryText ? <button onClick={() => message.retryText && void send(message.retryText, false)} disabled={loading}>Reintentar</button> : null}</div></div> : <div key={message.id} className={`message-row ${message.role}`}>
          {message.role === "assistant" && <div className="mini-avatar" aria-hidden="true">N</div>}
          <div className="message-content"><MarkdownMessage content={message.content} />
            {message.flow ? <BuilderProgress flow={message.flow} /> : null}
            {message.actions?.length ? <div className="nova-action-chips">{message.actions.map((action) => <button key={`${action.action}-${action.productSlug ?? action.componentType ?? ""}`} onClick={() => void applyAction(action, message.id)} disabled={loading || message.actionableConsumed || lastActionableId !== message.id}>{action.label ?? action.action}</button>)}</div> : null}
            {message.quickReplies?.length ? <div className="nova-action-chips">{message.quickReplies.map((reply) => <button key={reply.id} onClick={() => handleQuickReply(reply, message.id)} disabled={loading || message.actionableConsumed || lastActionableId !== message.id}>{reply.label}</button>)}</div> : null}
            {message.recommendations?.length ? <div className="recommendations-grid">{message.recommendations.map((item) => <RecommendationCard key={item.product.slug} recommendation={item} selected={selected.includes(item.product.slug)} onToggle={() => toggle(item.product.slug)} />)}</div> : null}
            {message.componentRecommendations?.length ? <div className="component-recommendations">{message.componentRecommendations.map((product) => <ComponentRecommendation key={product.slug} product={product} disabled={loading || message.actionableConsumed || lastActionableId !== message.id} onChoose={() => void applyAction({ action: "ADD_TO_BUILD", productSlug: product.slug }, message.id)} />)}</div> : null}
            {message.currentPc ? <div className="current-pc"><span>PC ACTUAL</span><strong>{message.currentPc.cpu ?? "CPU por confirmar"}</strong><strong>{message.currentPc.gpu ?? "GPU por confirmar"}</strong>{message.currentPc.ramGb ? <strong>{message.currentPc.ramGb} GB RAM</strong> : null}</div> : null}
            {message.systemInfoGuide ? <SystemInfoCard guide={message.systemInfoGuide} /> : null}
            {message.upgradeAnalysis ? <UpgradePanel analysis={message.upgradeAnalysis} /> : null}
            {message.build ? <BuildPanel build={message.build} /> : null}
          </div>
        </div>)}{loading && <div className="message-row assistant"><div className="mini-avatar">✦</div><div className="message-bubble typing"><i /><i /><i /><span>Nova está revisando el catálogo</span></div></div>}</div>
        {messages.length === 1 && !compact && <div className="chat-suggestions">{suggestions.map((suggestion) => <button key={suggestion} onClick={() => void send(suggestion)}>{suggestion}<span>→</span></button>)}</div>}
        <form className="chat-composer" onSubmit={submit}><textarea rows={2} maxLength={2000} value={input} onChange={(event) => setInput(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter" && !event.shiftKey) { event.preventDefault(); void send(input); } }} placeholder="Ej: Quiero una GPU para jugar a 1440p…" /><button type="submit" disabled={!input.trim() || loading} aria-label="Enviar mensaje">↑</button><small>Enter para enviar · Shift + Enter para nueva línea</small></form>
      </section>
      {!compact && <aside className="criteria-panel"><div className="criteria-title"><span>⌁</span><div><h2>Lo que entendí</h2><p>Se actualiza con la conversación</p></div></div>{filters ? <div className="criteria-list"><div><span>Intención</span><strong>{activeContext.shoppingIntent ? intentLabels[activeContext.shoppingIntent] : "Por definir"}</strong></div><div><span>Presupuesto máximo</span><strong>{filters.budgetMax ? formatMoney(filters.budgetMax) : "Por definir"}</strong></div><div><span>Usos principales</span><div className="criteria-tags">{(filters.workloads ?? []).map((item) => <span key={item.slug}>{item.slug.replaceAll("-", " ")}</span>)}</div></div></div> : <div className="criteria-empty"><span>✦</span><p>Cuéntame qué quieres hacer y te acompaño.</p></div>}<div className="privacy-note"><span>◇</span><p><strong>IA segura</strong>Nova no recibe datos sensibles; catálogo, stock, precios y compatibilidad salen del backend.</p></div></aside>}
    </div>
    {selectedRecommendations.length > 0 && !compact && <section className="comparison-dock shell"><div className="comparison-heading"><div><span className="eyebrow">COMPARADOR</span><h2>{selectedRecommendations.length} equipos seleccionados</h2></div><button onClick={() => setSelected([])}>Limpiar</button></div><div className="comparison-purchase-actions">{selectedRecommendations.map((item) => <WhatsAppBuyButton key={item.product.slug} className="comparison-buy-button" productName={item.product.name} price={item.product.price} fitScore={item.fitScore} />)}</div></section>}
  </div>;
}

function assistantContext(context: NovaSession) {
  return { page: typeof window !== "undefined" ? window.location.pathname : undefined, productSlug: context.selectedProduct?.slug, buildSlugs: context.currentBuild, selectedComponentType: context.selectedComponentType, shoppingIntent: context.shoppingIntent, builderMode: context.builderMode, builderStep: context.builderFlow?.currentStep, assemblySelected: context.assemblySelected, currentPc: context.currentPc, upgradeGoal: context.upgradeGoal, lastRecommendedProductSlug: context.lastRecommendedProductSlug, lastComparedProductSlugs: context.lastComparedProductSlugs, lastBuilderAdviceTopic: context.lastBuilderAdviceTopic, builderPreference: context.builderPreference };
}

function ComponentRecommendation({ product, onChoose, disabled }: { product: Product; onChoose: () => void; disabled: boolean }) { return <article className="component-result"><div><span className="type-chip">{product.type === "MOTHERBOARD" ? "Motherboard" : product.type === "GPU" ? "Tarjeta gráfica" : product.type === "CPU" ? "Procesador" : product.type === "RAM" ? "Memoria RAM" : product.type === "PSU" ? "Fuente" : product.type === "STORAGE" ? "Almacenamiento" : product.type === "MONITOR" ? "Monitor" : product.type}</span><h3>{product.name}</h3><p>{product.features.slice(0, 3).join(" · ")}</p></div><div><strong>{formatMoney(product.price)}</strong><button className="button button-small button-dark" onClick={onChoose} disabled={disabled}>Elegir</button><Link className="button button-small button-outline" href={`/productos/${product.slug}`}>Ver detalle</Link><WhatsAppBuyButton className="whatsapp-buy-button-compact" productName={product.name} price={product.price} /></div></article>; }
function SystemInfoCard({ guide }: { guide: SystemInfoGuide }) { const [copied, setCopied] = useState(false); async function copy() { await navigator.clipboard.writeText(guide.command); setCopied(true); window.setTimeout(() => setCopied(false), 1800); } return <section className="system-info-guide"><div className="system-info-heading"><div><span>WINDOWS · SOLO LECTURA</span><strong>{guide.title}</strong></div><button onClick={() => void copy()}>{copied ? "Copiado ✓" : "Copiar comando"}</button></div><pre><code>{guide.command}</code></pre><ol>{guide.steps.map((step) => <li key={step}>{step}</li>)}</ol><p>{guide.note}</p></section>; }
function UpgradePanel({ analysis }: { analysis: NonNullable<ChatResponse["upgradeAnalysis"]> }) { return <section className="upgrade-panel"><p className="upgrade-bottleneck"><b>Diagnóstico:</b> {analysis.bottleneck}</p><div><span>MEJOR PRIMER UPGRADE</span><strong>{analysis.bestFirstUpgrade?.name ?? "Por definir"}</strong></div><div><span>MEJOR PRECIO/RENDIMIENTO</span><strong>{analysis.bestValue?.name ?? "Por definir"}</strong></div><div><span>OPCIÓN PREMIUM</span><strong>{analysis.premium?.name ?? "Por definir"}</strong></div><p><b>Esto puede esperar:</b> {analysis.noNeedToChange}</p>{analysis.compatibilityChecks?.map((check) => <p className="upgrade-check" key={check.label}><b>{check.label}:</b> {check.detail}</p>)}</section>; }
function MarkdownMessage({ content, error }: { content: string; error?: boolean }) { const blocks = content.trim().split(/\n\s*\n/).filter(Boolean); return <div className={`message-bubble message-markdown ${error ? "message-error" : ""}`}>{blocks.map((block, index) => { const lines = block.split("\n"); const isList = lines.every((line) => /^\s*[-*]\s+/.test(line)); return isList ? <ul key={index}>{lines.map((line) => <li key={line}>{inlineMarkdown(line.replace(/^\s*[-*]\s+/, ""))}</li>)}</ul> : <p key={index}>{lines.map((line, lineIndex) => <span key={lineIndex}>{lineIndex ? <br /> : null}{inlineMarkdown(line)}</span>)}</p>; })}</div>; }
function inlineMarkdown(value: string) { const tokens = value.split(/(\*\*[^*]+\*\*|\[[^\]]+\]\([^\s)]+\))/g); return tokens.map((token, index) => { const bold = token.match(/^\*\*(.+)\*\*$/); const link = token.match(/^\[([^\]]+)\]\(([^\s)]+)\)$/); if (bold) return <strong key={index}>{bold[1]}</strong>; if (link && /^(https?:\/\/|\/)/i.test(link[2])) return <a key={index} href={link[2]} target={link[2].startsWith("http") ? "_blank" : undefined} rel={link[2].startsWith("http") ? "noreferrer" : undefined}>{link[1]}</a>; return <span key={index}>{token.replace(/[*_`]/g, "")}</span>; }); }
function BuilderProgress({ flow }: { flow: BuilderFlow }) { if (flow.currentStep === "DONE") return <div className="builder-progress is-done"><strong>Configuración lista</strong><span>{flow.progress}% completado</span></div>; return <div className="builder-progress"><div><strong>Armando tu PC</strong><span>Paso {flow.completedSteps.length + 1} de {flow.totalSteps} · {flow.currentStepLabel}</span></div><div className="builder-progress-track"><i style={{ width: `${flow.progress}%` }} /></div></div>; }
function BuildPanel({ build }: { build: BuildSummary }) { const group = (title: string, products: Product[]) => <div className="build-summary-group"><div className="build-summary-group-title">{title}</div>{products.length ? products.map((product) => <div className="build-line" key={product.slug}><span>{PRODUCT_TYPE_LABELS[product.type] ?? product.type}</span><strong>{product.name}</strong><span>{formatMoney(product.price)}</span></div>) : <p className="summary-empty">Aún no hay productos.</p>}</div>; return <section className="build-panel"><div className="build-panel-heading"><div><span className="eyebrow">CONFIGURACIÓN ACTUAL</span><h3>{build.products.length ? "Tu PC por componentes" : "Aún no hay componentes"}</h3></div><strong>{formatMoney(build.total)}</strong></div>{group("Componentes", build.components)}{group("Periféricos", build.peripherals)}{build.assembly ? <div className="build-summary-group"><div className="build-summary-group-title">Servicios</div><div className="build-line"><span>Ensamble</span><strong>Entrega ensamblada</strong><span>{formatMoney(build.assembly)}</span></div></div> : null}<div className="build-total"><span>Total</span><strong>{formatMoney(build.total)}</strong></div><div className="budget-result"><span>Presupuesto restante</span><strong>{build.budgetRemaining === null ? "—" : formatMoney(build.budgetRemaining)}</strong></div><p className={`build-compatibility ${build.compatible ? "is-ok" : "is-error"}`}>{build.complete ? "✓ Configuración completa y compatible" : build.compatible ? "✓ Sin incompatibilidades detectadas hasta ahora" : `! Hay que corregir ${(build.compatibilityIssues ?? []).filter((item) => item.severity === "ERROR").length || 1} incompatibilidad`}</p>{(build.compatibilityIssues ?? []).filter((issue) => issue.severity === "ERROR").slice(0, 1).map((issue) => <p className="build-warning" key={issue.code}>{issue.message}</p>)}<WhatsAppBuyButton className="chat-build-quote" productName="configuración personalizada" price={build.total} buildLines={build.products.map((product) => `${PRODUCT_TYPE_LABELS[product.type] ?? product.type}: ${product.name} · ${formatMoney(product.price)}`)} assembly={Boolean(build.assembly)}>{build.products.length === 1 ? "Cotizar este producto" : "Cotizar por WhatsApp"}</WhatsAppBuyButton></section>; }
