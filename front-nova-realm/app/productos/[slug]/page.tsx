import { ProductDetail } from "@/components/product-detail";

export default async function ProductDetailPage({ params }: PageProps<"/productos/[slug]">) {
  const { slug } = await params;
  return <ProductDetail slug={slug} />;
}
