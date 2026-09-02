"use client";

import { FormEvent, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { apiFetch } from "@/lib/api";
import type { Recommendation } from "@/lib/types";
import { useNova } from "@/lib/nova-context";
import type { ShoppingIntent } from "@/lib/types";

const examples = [
  "Warzone a 1440p y Blender, máximo $5.000.000",
  "Valorant a 240 Hz por menos de $3.500.000",
  "Programación, Docker y máquinas virtuales",
];

export function HomeHero() {
  const router = useRouter();
  const { openNova } = useNova();
  const [query, setQuery] = useState("");
  const [preview, setPreview] = useState<Recommendation | null>(null);

  useEffect(() => {
    apiFetch<{ recommendations: Recommendation[] }>("/recommendations", {
      method: "POST",
      body: JSON.stringify({
        budgetMax: 4_200_000,
        resolution: "1440p",
        workloads: [
          { slug: "valorant", importance: 0.5 },
          { slug: "adobe-premiere", importance: 0.5 },
        ],
      }),
    })
      .then((result) => setPreview(result.recommendations[0] ?? null))
      .catch(() => setPreview(null));
  }, []);

  function submit(event: FormEvent) {
    event.preventDefault();
    if (!query.trim()) return;
    router.push(`/nova?q=${encodeURIComponent(query.trim())}`);
  }

  const intents: Array<{ icon: string; label: string; intent: ShoppingIntent }> = [
    { icon: "🖥️", label: "Quiero un PC completo", intent: "PREBUILT_PC" },
    { icon: "🧩", label: "Quiero armar mi PC", intent: "CUSTOM_PC" },
    { icon: "🔧", label: "Quiero mejorar mi PC", intent: "UPGRADE_PC" },
    { icon: "🎮", label: "Busco un componente", intent: "COMPONENT" },
    { icon: "⌨️", label: "Quiero PC + periféricos", intent: "PC_WITH_PERIPHERALS" },
  ];

  return (
    <section className="hero">
      <div className="hero-grid shell">
        <div className="hero-copy">
          <div className="status-pill">
            <span /> NOVA ESTÁ LISTA PARA AYUDARTE
          </div>
          <h1>
            Encuentra el computador <em>perfecto para ti.</em>
          </h1>
          <p>
            Cuéntale a Nova qué quieres jugar, qué programas utilizas y cuánto
            quieres gastar. Nosotros hacemos el resto.
          </p>
          <div className="intent-picker"><span className="intent-question">¿Qué estás buscando hoy?</span><div className="intent-grid">{intents.map((item) => <button key={item.intent} type="button" onClick={() => openNova(item.intent)}><span>{item.icon}</span>{item.label}<b>→</b></button>)}</div></div>
          <form
            className="nova-prompt"
            action="/nova"
            method="get"
            onSubmit={submit}
          >
            <label htmlFor="hero-query">¿Qué necesitas?</label>
            <textarea
              id="hero-query"
              name="q"
              rows={3}
              maxLength={2000}
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Ej: Quiero armar mi computador por partes; Tengo mi computador y quiero mejorar los componentes..."
            />
            <div className="prompt-footer">
              <span>
                <kbd>↵</kbd> Escribe como hablas normalmente
              </span>
              <button className="button button-accent" type="submit">
                <span>✦</span> Preguntarle a Nova
              </button>
            </div>
          </form>
          <div className="example-list">
            <span>PRUEBA CON</span>
            {examples.map((example) => (
              <button
                key={example}
                type="button"
                onClick={() => setQuery(example)}
              >
                {example}
              </button>
            ))}
          </div>
        </div>
        <div
          className="hero-visual"
          aria-label="Vista previa no interactiva de una recomendación de Nova"
        >
          <div className="orbit orbit-one" />
          <div className="orbit orbit-two" />
          <div className="nova-avatar large">✦</div>
          <div className="chat-preview user-preview">
            Busco algo para jugar y editar video. Tengo 4 millones.
          </div>
          <div className="chat-preview nova-preview">
            <span className="mini-avatar">✦</span>
            <p>
              <strong>Entendido.</strong> Encontré varias opciones que
              equilibran bien tus dos prioridades.
            </p>
          </div>
          <div className="result-preview">
            <div>
              <span>{preview?.categoryLabel ?? "CATÁLOGO VERIFICADO"}</span>
              <strong>{preview ? `${preview.fitScore}%` : "—"}</strong>
            </div>
            <h3>{preview?.product.name ?? "Buscando la mejor opción"}</h3>
            <p>
              {preview
                ? `${preview.product.gpu} · ${preview.product.ramGb} GB RAM`
                : "Datos servidos por NovaRealm"}
            </p>
            <div className="preview-bar">
              <i style={{ width: `${preview?.fitScore ?? 0}%` }} />
            </div>
          </div>
          <span className="floating-chip chip-one">1440p</span>
          <span className="floating-chip chip-two">Blender</span>
        </div>
      </div>
    </section>
  );
}
