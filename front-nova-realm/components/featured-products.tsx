"use client";

import { useEffect, useState } from "react";
import { apiFetch } from "@/lib/api";
import type { Product } from "@/lib/types";
import { ProductCard } from "./product-card";
import { CardSkeletons } from "./loading";

export function FeaturedProducts() {
  const [products, setProducts] = useState<Product[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    apiFetch<Product[]>("/products?type=PREBUILT_PC")
      .then((items) =>
        setProducts(items.length >= 7 ? items.slice(3, 7) : items.slice(0, 4)),
      )
      .catch((reason: Error) => setError(reason.message))
      .finally(() => setLoading(false));
  }, []);

  if (loading) return <CardSkeletons />;
  if (error)
    return (
      <div className="empty-state">
        <span>!</span>
        <h3>No pudimos cargar los equipos</h3>
        <p>{error}</p>
      </div>
    );
  if (!products.length)
    return (
      <div className="empty-state">
        <span>⌕</span>
        <h3>Aún no hay equipos destacados</h3>
        <p>Agrega computadores activos al catálogo para mostrarlos aquí.</p>
      </div>
    );

  return (
    <div className="product-grid">
      {products.map((product) => (
        <ProductCard key={product.id} product={product} />
      ))}
    </div>
  );
}
