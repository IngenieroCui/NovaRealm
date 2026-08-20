/**
 * Punto único para cambiar los datos públicos de NovaRealm.
 * Las variables NEXT_PUBLIC_* pueden sustituir estos valores al desplegar.
 */
const cloudName = process.env.NEXT_PUBLIC_CLOUDINARY_CLOUD_NAME?.trim() ?? "";

export const siteConfig = {
  brand: "NovaRealm",
  tagline: "Tecnología pensada para tu próximo nivel.",
  contacts: {
    email: process.env.NEXT_PUBLIC_CONTACT_EMAIL?.trim() || "hola@novarealm.co",
    supportEmail: process.env.NEXT_PUBLIC_SUPPORT_EMAIL?.trim() || "soporte@novarealm.co",
    whatsapp: process.env.NEXT_PUBLIC_WHATSAPP_NUMBER?.replace(/\D/g, "") || "573001234567",
    phoneLabel: process.env.NEXT_PUBLIC_PHONE_LABEL?.trim() || "+57 300 123 4567",
  },
  cloudinary: {
    cloudName,
    uploadFolder: "novarealm/products",
  },
  assets: {
    productFallback: "/products/component.svg",
    pcFallback: "/products/pc-cyan.svg",
  },
  footer: {
    about: "Te ayudamos a elegir hardware con criterios claros, útiles y humanos.",
    copyright: `© ${new Date().getFullYear()} NovaRealm. Todos los derechos reservados.`,
  },
} as const;

/**
 * Acepta URL normal, una ruta local o un identificador `cloudinary:carpeta/imagen`.
 * Ejemplo: cloudinary:novarealm/products/pc-gamer
 */
export function getProductImageSource(imageUrl: string | null | undefined, isPc = false) {
  const fallback = isPc ? siteConfig.assets.pcFallback : siteConfig.assets.productFallback;
  const source = imageUrl?.trim();

  if (!source) return fallback;
  if (!source.startsWith("cloudinary:")) return source;

  const publicId = source.slice("cloudinary:".length).replace(/^\/+/, "");
  if (!publicId || !siteConfig.cloudinary.cloudName) return fallback;

  return `https://res.cloudinary.com/${siteConfig.cloudinary.cloudName}/image/upload/f_auto,q_auto/${publicId}`;
}

export function getWhatsAppUrl(message = "Hola, quiero información sobre NovaRealm.") {
  return `https://wa.me/${siteConfig.contacts.whatsapp}?text=${encodeURIComponent(message)}`;
}
