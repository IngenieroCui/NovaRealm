# Arquitectura de NovaRealm

[Presentación](../README.md). Fuentes: `master` en `a961158` y `portfolio-demo` en `95f6d3`, módulos NestJS, clientes de datos y proveedores de IA. Las referencias locales describen el código común; las diferencias de demo se indican expresamente.

## Componentes

```text
Next.js → API NestJS
           ├─ Catalog / Workloads → libSQL (Turso o archivo local)
           ├─ Recommendations → filtros + fitScore sobre catálogo
           ├─ Builder → compatibilidad de componentes
           ├─ Assistant → AiService → Ollama | Cloudflare Workers AI
           └─ AdminGuard → administración → Cloudinary opcional
```

`front-nova-realm` presenta catálogo, configurador y conversación. `back-nova-realm/src/app.module.ts` ensambla módulos por dominio. El backend mantiene la autoridad sobre productos y puntuaciones; el modelo interpreta y explica criterios y resultados, sin convertir una recomendación inventada por el modelo en un producto del catálogo.

El cliente `@libsql/client` admite `DATABASE_URL` remota o archivo local. Sin URL local puede usar `DATABASE_PATH`; en Vercel se exige URL explícita para evitar persistencia en un sistema efímero. La inicialización crea/ajusta el esquema mediante el servicio existente y el seed carga catálogo demo en una base vacía e incorpora workloads ausentes sin sobrescribir los cambios administrativos descritos en el código.

## Flujo y control de acceso

La web envía filtros o mensajes al backend. El asistente conserva criterios de la conversación, solicita interpretación al proveedor y coordina la consulta del catálogo. El recomendador y el configurador aplican sus reglas sobre datos disponibles. La respuesta vuelve a Next.js para representar productos y explicación.

La administración usa `AdminGuard` y un `ADMIN_API_KEY` privado. No equivale a un sistema multiusuario con registro y roles. Nunca expongas esa clave mediante `NEXT_PUBLIC_*`. Cloudinary usa credenciales privadas en el servidor; el nombre público de la nube no equivale al secreto de API.

## Proveedor configurado frente a disponibilidad

`src/ai/ai.service.ts` selecciona `AI_PROVIDER`. La plantilla usa `ollama`; la ausencia de variable selecciona `cloudflare` en Vercel y `ollama` fuera de Vercel. Los proveedores se implementan en `src/ai/ollama-ai.provider.ts` y `src/ai/cloudflare-ai.provider.ts`.

| Proveedor | Requisitos |
| --- | --- |
| Ollama | Servicio accesible, `OLLAMA_BASE_URL`, modelo `OLLAMA_MODEL` (plantilla: `qwen3.5:4b`) y timeout |
| Cloudflare | `CLOUDFLARE_ACCOUNT_ID`, `CLOUDFLARE_API_TOKEN` privado, `CLOUDFLARE_AI_MODEL` (plantilla: `@cf/meta/llama-3.1-8b-instruct`) y timeout |

El modelo debe admitir mensajes; la interpretación estructurada depende de su salida. `95f6d3` mejora la comunicación de fallos y el tratamiento de respuestas en la rama demo. La presencia del adaptador o una variable de selección no acredita credenciales válidas, cuota ni inferencia funcional en producción.

## Configuración y operación

| Entorno | Variables |
| --- | --- |
| Backend/red | `PORT` (3001 local), `FRONTEND_URL` (CORS; admite orígenes separados por coma) |
| Datos | `DATABASE_URL`, `DATABASE_AUTH_TOKEN` privado para Turso; `DATABASE_PATH` como compatibilidad local |
| Administración | `ADMIN_API_KEY` privado |
| Imágenes | `CLOUDINARY_CLOUD_NAME`, `CLOUDINARY_API_KEY`, `CLOUDINARY_API_SECRET`, carpeta de carga |
| Frontend | `NEXT_PUBLIC_API_URL`; contacto, soporte, WhatsApp y nombre público de Cloudinary según plantilla |

Las plantillas no deben sustituirse por archivos con credenciales versionadas. `NEXT_PUBLIC_API_URL` se incorpora durante el build. El backend y el frontend se alojan como proyectos separados con raíces `back-nova-realm` y `front-nova-realm`; el backend incluye entradas en `api/`. Turso aporta persistencia externa y el proveedor debe ser accesible desde el servidor.

Para preparar una base propia, configura una URL `file:./data/novarealm.db` local o una URL Turso con su token privado y ejecuta `npm run db:seed` desde el backend. El comando escribe datos; no debe probarse contra una base ajena o productiva. Este sprint no ejecutó seeders ni desplegó proyectos.

## Demo, cambios y atribución

`portfolio-demo` parte del código de `master` y añade `256ce18` (preparación de demo y dependencias) y `95f6d3` (errores de proveedor y respuestas). `NEXT_PUBLIC_DEMO_MODE=true` identifica datos ficticios y desactiva enlaces comerciales salientes en esa rama. La configuración privada del entorno desplegado no se verificó aquí.

El historial mantiene commits de Andrecodev y Juan David Reyes Cure. Las contribuciones de demo de Juan David se identifican por esos commits, sin reasignar los anteriores. El cambio documental conserva dos documentos principales y concentra aquí las instrucciones antes dispersas en la presentación.

## Dependencias, límites y mejoras

La conversación depende de disponibilidad, formato y latencia del proveedor; catálogo y recomendaciones tienen su propia lógica. Las imágenes dependen de Cloudinary cuando se activa la carga. La administración por clave requiere distribución privada; una evolución futura podría incorporar cuentas y permisos, sin afirmar que ya existen. Faltan verificaciones actuales de IA desplegada, cuotas, operación comercial y rendimiento real. Las pruebas existentes permanecen y no se ejecutaron en este sprint.
