import Link from "next/link";
import { FeaturedProducts } from "@/components/featured-products";
import { HomeHero } from "@/components/home-hero";

export default function Home() {
  return (
    <div className="home-page">
      <HomeHero />
      <section className="section shell" id="equipos">
        <div className="section-heading split-heading">
          <div><span className="eyebrow">SELECCIÓN NOVAREALM</span><h2>Equipos para cada forma de crear y jugar.</h2></div>
          <Link className="text-link" href="/productos">Ver todo el catálogo <span>→</span></Link>
        </div>
        <FeaturedProducts />
      </section>
      <section className="how-section" id="como-funciona">
        <div className="shell">
          <div className="section-heading centered">
            <span className="eyebrow">ASÍ DE SIMPLE</span><h2>Menos fichas técnicas. Mejores decisiones.</h2>
            <p>Nova traduce lo que necesitas a criterios comparables y busca únicamente dentro de nuestro catálogo.</p>
          </div>
          <div className="steps-grid">
            <article><span className="step-number">01</span><div className="step-icon">⌁</div><h3>Cuéntanos tu idea</h3><p>Juegos, programas, resolución y presupuesto. Escríbelo como se lo contarías a alguien.</p></article>
            <article><span className="step-number">02</span><div className="step-icon">✦</div><h3>Nova entiende y compara</h3><p>Nova estructura tu necesidad y nuestro algoritmo evalúa todos los equipos compatibles.</p></article>
            <article><span className="step-number">03</span><div className="step-icon">◫</div><h3>Elige con claridad</h3><p>Recibe varias alternativas, porcentajes verificables y diferencias explicadas sin jerga.</p></article>
          </div>
        </div>
      </section>
      <section className="section shell">
        <div className="nova-banner">
          <div className="banner-orb">✦</div>
          <div><span className="eyebrow light">TU ASESORA PERSONAL</span><h2>¿Ya sabes qué quieres hacer?</h2><p>En menos de un minuto puedes tener una lista corta de equipos que sí encajan contigo.</p></div>
          <Link className="button button-light" href="/nova">Comenzar con Nova <span>→</span></Link>
        </div>
      </section>
    </div>
  );
}
