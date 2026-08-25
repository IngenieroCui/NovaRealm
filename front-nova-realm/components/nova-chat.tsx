"use client";

import { FormEvent, useCallback, useMemo, useRef, useState, useEffect } from "react";
import { useSearchParams } from "next/navigation";
import { apiFetch, formatMoney } from "@/lib/api";
import type { ChatResponse, Recommendation, RecommendationFilters } from "@/lib/types";
import { RecommendationCard } from "./recommendation-card";
import { WhatsAppBuyButton } from "./whatsapp-buy-button";

interface ChatMessage {
  id: number;
  role: "user" | "assistant";
  content: string;
  recommendations?: Recommendation[];
  error?: boolean;
}

const suggestions = [
  "Tengo 5 millones. Juego Warzone y Valorant a 1440p y uso Blender.",
  "Quiero el PC más barato que sirva para Valorant. Máximo 3 millones.",
  "Uso Docker y máquinas virtuales. Mi presupuesto es 4.5 millones.",
];

export function NovaChat() {
  const searchParams = useSearchParams();
  const initialSent = useRef(false);
  const nextId = useRef(2);
  const [messages, setMessages] = useState<ChatMessage[]>([{ id: 1, role: "assistant", content: "¡Hola! Soy Nova. Cuéntame qué quieres jugar o qué programas utilizas y cuánto quieres invertir. Buscaré varias opciones reales para ti." }]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [filters, setFilters] = useState<RecommendationFilters | null>(null);
  const [selected, setSelected] = useState<string[]>([]);

  const send = useCallback(async (text: string) => {
    const clean = text.trim();
    if (!clean || loading) return;
    const history = messages.slice(-8).map(({ role, content }) => ({ role, content }));
    setMessages((current) => [...current, { id: nextId.current++, role: "user", content: clean }]);
    setInput(""); setLoading(true);
    try {
      const response = await apiFetch<ChatResponse>("/assistant/chat", { method: "POST", body: JSON.stringify({ message: clean, conversation: history, ...(filters ? { filters } : {}) }) });
      if (response.filters) setFilters(response.filters);
      setSelected([]);
      setMessages((current) => [...current, { id: nextId.current++, role: "assistant", content: response.message, recommendations: response.recommendations }]);
    } catch (reason) {
      setMessages((current) => [...current, { id: nextId.current++, role: "assistant", content: (reason as Error).message, error: true }]);
    } finally { setLoading(false); }
  }, [filters, loading, messages]);

  useEffect(() => {
    const query = searchParams.get("q");
    if (query && !initialSent.current) { initialSent.current = true; void send(query); }
  }, [searchParams, send]);

  const available = useMemo(() => {
    const map = new Map<string, Recommendation>();
    messages.forEach((message) => message.recommendations?.forEach((item) => map.set(item.product.slug, item)));
    return [...map.values()];
  }, [messages]);
  const selectedRecommendations = available.filter((item) => selected.includes(item.product.slug));

  function toggle(slug: string) {
    setSelected((current) => current.includes(slug) ? current.filter((item) => item !== slug) : current.length < 3 ? [...current, slug] : current);
  }
  function submit(event: FormEvent) { event.preventDefault(); void send(input); }

  async function askComparison() {
    if (!filters || selected.length < 2 || loading) return;
    setLoading(true);
    try {
      const response = await apiFetch<{ message: string }>("/assistant/compare", { method: "POST", body: JSON.stringify({ question: "¿Cuál de estos equipos debería elegir y qué sacrifico con cada uno?", slugs: selected, filters }) });
      setMessages((current) => [...current, { id: nextId.current++, role: "assistant", content: response.message }]);
    } catch (reason) {
      setMessages((current) => [...current, { id: nextId.current++, role: "assistant", content: (reason as Error).message, error: true }]);
    } finally { setLoading(false); }
  }

  return (
    <div className="nova-page">
      <section className="nova-intro"><div className="nova-avatar">✦</div><div><span className="eyebrow">ASISTENTE DE COMPRA</span><h1>Hablemos de tu próximo computador.</h1><p>Cuéntame lo que necesitas. Puedes ajustar la búsqueda en cualquier momento.</p></div></section>
      <div className="nova-shell">
        <section className="chat-panel">
          <div className="chat-status"><span><i /> Nova en línea</span><small>Impulsada por Ollama · Los scores los calcula NovaRealm</small></div>
          <div className="messages" aria-live="polite">
            {messages.map((message) => <div key={message.id} className={`message-row ${message.role}`}>
              {message.role === "assistant" && <div className="mini-avatar">✦</div>}
              <div className="message-content"><div className={`message-bubble ${message.error ? "message-error" : ""}`}>{message.content}</div>
                {message.recommendations?.length ? <div className="recommendations-grid">{message.recommendations.map((item) => <RecommendationCard key={item.product.slug} recommendation={item} selected={selected.includes(item.product.slug)} onToggle={() => toggle(item.product.slug)} />)}</div> : null}
              </div>
            </div>)}
            {loading && <div className="message-row assistant"><div className="mini-avatar">✦</div><div className="message-bubble typing"><i /><i /><i /><span>Nova está revisando el catálogo</span></div></div>}
          </div>
          {messages.length === 1 && <div className="chat-suggestions">{suggestions.map((suggestion) => <button key={suggestion} onClick={() => void send(suggestion)}>{suggestion}<span>→</span></button>)}</div>}
          <form className="chat-composer" onSubmit={submit}><textarea rows={2} maxLength={2000} value={input} onChange={(event) => setInput(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter" && !event.shiftKey) { event.preventDefault(); void send(input); } }} placeholder="Ej: Juego Valorant a 240 Hz y también uso Blender. Tengo 4 millones..." /><button type="submit" disabled={!input.trim() || loading} aria-label="Enviar mensaje">↑</button><small>Enter para enviar · Shift + Enter para nueva línea</small></form>
        </section>
        <aside className="criteria-panel">
          <div className="criteria-title"><span>⌁</span><div><h2>Lo que entendí</h2><p>Se actualiza con la conversación</p></div></div>
          {filters ? <div className="criteria-list"><div><span>Presupuesto máximo</span><strong>{filters.budgetMax ? formatMoney(filters.budgetMax) : "Por definir"}</strong></div><div><span>Resolución / FPS</span><strong>{filters.resolution ?? "Flexible"}{filters.targetFps ? ` · ${filters.targetFps} FPS` : ""}</strong></div><div><span>Usos principales</span><div className="criteria-tags">{filters.workloads.map((item) => <span key={item.slug}>{item.slug.replaceAll("-", " ")}</span>)}</div></div></div> : <div className="criteria-empty"><span>✦</span><p>Cuando me cuentes tu idea, aquí verás los criterios que usaré.</p></div>}
          <div className="privacy-note"><span>◇</span><p><strong>IA segura</strong>Nova procesa el texto. Productos, stock, precios y porcentajes salen del backend.</p></div>
        </aside>
      </div>
      {selectedRecommendations.length > 0 && <section className="comparison-dock shell"><div className="comparison-heading"><div><span className="eyebrow">COMPARADOR</span><h2>{selectedRecommendations.length} de 3 equipos seleccionados</h2></div><button onClick={() => setSelected([])}>Limpiar</button></div><div className="comparison-table"><div className="comparison-row heading"><span>Característica</span>{selectedRecommendations.map((item) => <strong key={item.product.slug}>{item.product.name}</strong>)}</div>{[["Precio", (r: Recommendation) => formatMoney(r.product.price)], ["Ajuste", (r: Recommendation) => `${r.fitScore}%`], ["CPU", (r: Recommendation) => r.product.cpu ?? "—"], ["GPU", (r: Recommendation) => r.product.gpu ?? "—"], ["RAM", (r: Recommendation) => `${r.product.ramGb} GB`], ["Almacenamiento", (r: Recommendation) => `${r.product.storageGb} GB`]].map(([label, getter]) => <div className="comparison-row" key={label as string}><span>{label as string}</span>{selectedRecommendations.map((item) => <p key={item.product.slug}>{(getter as (r: Recommendation) => string)(item)}</p>)}</div>)}</div><div className="comparison-purchase-actions">{selectedRecommendations.map((item) => <WhatsAppBuyButton key={item.product.slug} className="comparison-buy-button" productName={item.product.name} price={item.product.price} fitScore={item.fitScore} />)}</div><button className="button button-accent" disabled={selected.length < 2 || loading} onClick={() => void askComparison()}><span>✦</span> Preguntarle a Nova cuál elegir</button></section>}
    </div>
  );
}
