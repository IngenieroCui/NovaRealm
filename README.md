# NovaRealm

**Catálogo tecnológico y recomendaciones de equipos según las necesidades de cada usuario.**

## Problema y solución

Elegir un equipo exige comparar presupuesto, componentes y cargas de trabajo. NovaRealm combina un catálogo administrable con recomendaciones calculadas por el backend y un asistente que interpreta necesidades mediante un proveedor de IA configurable.

## Funcionalidades reales

- Catálogo de equipos/componentes y cargas de trabajo.
- Recomendaciones con `fitScore` y filtros sobre productos existentes.
- Configurador con comprobaciones de compatibilidad.
- Conversación guiada con Nova para recoger criterios y explicar opciones.
- Administración protegida de catálogo e imágenes.

## Tecnologías y arquitectura

| Componente | Tecnología |
| --- | --- |
| Interfaz | Next.js, React y TypeScript (`front-nova-realm`) |
| API | NestJS y TypeScript (`back-nova-realm`) |
| Datos | libSQL/Turso; archivo SQLite compatible en desarrollo |
| IA | Ollama o Cloudflare Workers AI, seleccionados en el backend |
| Imágenes | Integración opcional con Cloudinary |

`Next.js → API NestJS → catálogo/libSQL`; Nova interpreta la consulta, mientras las recomendaciones se calculan con los datos del catálogo.

## Ejecutar localmente

Requiere Node.js 22+, npm y Ollama si se elige ese proveedor. En cada carpeta copia `.env.example` al archivo local correspondiente (`.env` en backend, `.env.local` en frontend).

```bash
cd back-nova-realm
npm install
npm run db:seed
npm run start:dev
```

En otra terminal:

```bash
cd front-nova-realm
npm install
npm run dev
```

Usa una base local/autorizada antes de ejecutar el seed. Web: `http://localhost:3000`; API: `http://localhost:3001/api`. Con Ollama, descarga `qwen3.5:4b` y ejecuta `ollama serve`.

## Estado y límites

La rama predeterminada es `master`; la fuente de la demo desplegada es **`portfolio-demo`**. Esta última incorpora el modo demostración y ajustes de errores del proveedor (`256ce18`, `95f6d3`). No se fusiona código entre ramas en este sprint.

La plantilla configura `AI_PROVIDER=ollama`. Si no se define la variable, el selector usa Ollama localmente y Cloudflare cuando detecta Vercel. Cloudflare requiere credenciales privadas; la selección por defecto **no demuestra que la IA responda en producción**. No se verificaron las variables privadas ni una respuesta de IA desplegada durante esta revisión.

El catálogo y el cálculo de recomendaciones son distintos del servicio generativo. La disponibilidad de Nova depende del proveedor y su modelo; la rama demo contiene manejo de fallos con respuesta controlada. No se presenta el proyecto como una tienda con cobro real verificado.

## Autoría y contribuciones

El historial conserva el desarrollo registrado como **Andrecodev** y los cambios de **Juan David Reyes Cure** en la demo: `256ce18` integra su preparación y dependencias; `95f6d3` corrige errores de proveedor y el manejo de respuestas. No se atribuye exclusivamente a Juan David el historial anterior ni se identifica automáticamente un alias con una persona.

Consulta [arquitectura, proveedores y configuración](docs/ARCHITECTURE.md).
