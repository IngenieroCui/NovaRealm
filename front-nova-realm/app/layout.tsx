import type { Metadata } from "next";
import Link from "next/link";
import "./globals.css";
import { Logo } from "@/components/logo";
import { getWhatsAppUrl, siteConfig } from "@/lib/site-config";

export const metadata: Metadata = {
  title: "NovaRealm | Encuentra tu PC ideal",
  description:
    "Computadores y componentes recomendados para lo que juegas, creas y construyes.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="es">
      <body>
        <header className="site-header">
          <div className="shell header-inner">
            <Logo />
            <nav className="main-nav" aria-label="Navegación principal">
              <Link href="/productos?type=PREBUILT_PC">Equipos</Link>
              <Link href="/productos?context=components">Componentes</Link>
              <Link href="/#como-funciona">Cómo funciona</Link>
            </nav>
            <div className="header-actions">
              <Link className="admin-link" href="/admin">Admin</Link>
              <Link className="button button-dark button-small" href="/nova">
                <span className="sparkle">✦</span> Hablar con Nova
              </Link>
            </div>
          </div>
        </header>
        <main>{children}</main>
        <footer className="site-footer">
          <div className="shell footer-inner">
            <div className="footer-brand">
              <Logo light />
              <p>{siteConfig.footer.about}</p>
            </div>
            <div className="footer-column">
              <strong>Explora</strong>
              <Link href="/productos">Catálogo</Link>
              <Link href="/nova">Habla con Nova</Link>
              <Link href="/#como-funciona">Cómo funciona</Link>
            </div>
            <div className="footer-column">
              <strong>Contacto</strong>
              <a href={`mailto:${siteConfig.contacts.email}`}>{siteConfig.contacts.email}</a>
              <a href={getWhatsAppUrl()} target="_blank" rel="noreferrer">WhatsApp · {siteConfig.contacts.phoneLabel}</a>
              <a href={`mailto:${siteConfig.contacts.supportEmail}`}>Soporte</a>
            </div>
            <div className="footer-column footer-about">
              <strong>Sobre nosotros</strong>
              <p>Una experiencia clara para descubrir el hardware que te acompaña a crear, jugar y crecer.</p>
            </div>
            <p className="footer-note">{siteConfig.footer.copyright}</p>
          </div>
        </footer>
      </body>
    </html>
  );
}
