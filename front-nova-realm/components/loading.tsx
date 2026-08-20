export function PageLoading({ label = "Cargando equipos" }: { label?: string }) {
  return (
    <div className="page-loading" role="status">
      <span className="loader-orbit" />
      <p>{label}…</p>
    </div>
  );
}

export function CardSkeletons({ count = 4 }: { count?: number }) {
  return (
    <div className="product-grid">
      {Array.from({ length: count }).map((_, index) => (
        <div className="card-skeleton" key={index}>
          <div className="skeleton skeleton-image" />
          <div className="skeleton skeleton-line wide" />
          <div className="skeleton skeleton-line" />
          <div className="skeleton skeleton-line short" />
        </div>
      ))}
    </div>
  );
}
