import Link from "next/link";

export function Logo({ light = false }: { light?: boolean }) {
  return (
    <Link className={`logo ${light ? "logo-light" : ""}`} href="/" aria-label="NovaRealm, inicio">
      <span className="logo-mark" aria-hidden="true">
        <svg viewBox="0 0 32 32">
          <path d="M16 2l3.4 9.6L29 15l-9.6 3.4L16 28l-3.4-9.6L3 15l9.6-3.4L16 2z" />
          <circle cx="24" cy="7" r="2.2" />
        </svg>
      </span>
      <span>Nova<span>Realm</span></span>
    </Link>
  );
}
