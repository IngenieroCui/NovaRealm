import { BadRequestException, Injectable } from '@nestjs/common';
import { AiService } from '../ai/ai.service';
import { RecommendationsService } from '../recommendations/recommendations.service';
import { WorkloadsService } from '../workloads/workloads.service';
import { ChatRequestDto, CompareRequestDto } from './assistant.dto';
import { AssistantContextDto, ShoppingIntent } from './assistant.dto';
import { BuilderService } from '../builder/builder.service';
import { Product, ProductType } from '../catalog/product.types';
import { CatalogService } from '../catalog/catalog.service';

const WINDOWS_SPECS_COMMAND = `$cpu=(Get-CimInstance Win32_Processor).Name; $gpu=(Get-CimInstance Win32_VideoController).Name -join ', '; $ram=[math]::Round(((Get-CimInstance Win32_PhysicalMemory | Measure-Object Capacity -Sum).Sum/1GB)); $board=(Get-CimInstance Win32_BaseBoard | ForEach-Object { $_.Manufacturer + ' ' + $_.Product }) -join ', '; $disk=(Get-CimInstance Win32_DiskDrive).Model -join ', '; [pscustomobject]@{ CPU=$cpu; GPU=$gpu; RAM="$ram GB"; Motherboard=$board; Storage=$disk } | Format-List`;

const SYSTEM_INFO_GUIDE = {
  title: 'Obtener las especificaciones en Windows',
  command: WINDOWS_SPECS_COMMAND,
  steps: [
    'Haz clic derecho en Inicio y abre Terminal o PowerShell. No necesitas permisos de administrador.',
    'Copia y pega el comando, presiona Enter y espera unos segundos.',
    'Copia aquí el resultado. El comando solo lee nombres de hardware; no cambia nada ni muestra archivos personales.',
  ],
  note: 'La fuente de poder no aparece en Windows. Si luego recomendamos una GPU, te pediré mirar la etiqueta de la fuente o enviar su modelo.',
};

@Injectable()
export class AssistantService {
  constructor(
    private readonly ai: AiService,
    private readonly workloads: WorkloadsService,
    private readonly recommendations: RecommendationsService,
    private readonly builder: BuilderService,
    private readonly catalog: CatalogService,
  ) {}

  async chat(input: ChatRequestDto) {
    const contextProduct = input.context?.productSlug
      ? await this.catalog.findBySlug(input.context.productSlug).catch(() => null)
      : null;
    const analysisMessage = contextProduct
      ? `Producto que el usuario está viendo (dato verificado): ${contextProduct.name}, tipo ${contextProduct.type}, precio ${contextProduct.price}, stock ${contextProduct.stock}.\nMensaje: ${input.message}`
      : input.message;
    const componentType = this.detectComponentType(input.message, input.context);
    const detectedIntent = input.shoppingIntent ?? input.context?.shoppingIntent ?? this.detectShoppingIntent(input.message);
    const intent = detectedIntent === ShoppingIntent.UPGRADE_PC
      ? { needsMoreInformation: true, filters: input.filters }
      : await this.ai.interpret(
          analysisMessage,
          input.conversation ?? [],
          await this.workloads.findAll(),
          input.filters,
        );
    // The user-selected intent and these small deterministic cues have priority over
    // an ambiguous model classification; the model is still used for needs/filters.
    const shoppingIntent = detectedIntent;
    const currentBuild = input.context?.buildSlugs ?? [];
    const budgetMax = intent.filters?.budgetMax ?? this.extractBudget(input.message);
    if (this.isFinishRequest(input.message) && currentBuild.length) {
      const build = await this.builder.summarize({ itemSlugs: currentBuild, budgetMax, assembly: false });
      return { message: build.products.length === 1 ? 'Listo. Te dejo este producto listo para cotizar.' : 'Listo, dejamos la configuración hasta aquí. Te muestro el resumen para que la revises con calma.', needsMoreInformation: false, shoppingIntent, filters: intent.filters ?? null, recommendations: [], build, quickActions: ['Cotizar por WhatsApp', 'Cambiar una pieza', 'Agregar algo más'] };
    }
    if (input.context?.buildSlugs?.length && /ensambl|armado por novarealm/i.test(input.message)) {
      return { message: 'Valido el servicio de ensamble para tu configuración actual.', needsMoreInformation: false, shoppingIntent: ShoppingIntent.CUSTOM_PC, filters: intent.filters ?? null, recommendations: [], actions: [{ action: 'ADD_ASSEMBLY', label: 'Agregar ensamble' }], quickActions: ['Abrir configurador', 'Cotizar'] };
    }
    if (input.context?.buildSlugs?.length && /(?:reinicia|reiniciar|limpia|limpiar|borrar).*(?:config|build|seleccion)/i.test(input.message)) {
      return { message: 'Listo, puedo dejar la configuración vacía para empezar de nuevo.', needsMoreInformation: false, shoppingIntent: ShoppingIntent.CUSTOM_PC, filters: intent.filters ?? null, recommendations: [], actions: [{ action: 'CLEAR_BUILD', label: 'Reiniciar configuración' }] };
    }
    if (contextProduct && /vale la pena|me sirve|sirve para|qué opinas|que opinas/i.test(input.message)) {
      const note = contextProduct.type === ProductType.PREBUILT_PC
        ? (Number(contextProduct.gpuScore ?? 0) >= 85 ? 'Tiene un perfil fuerte para jugar y crear.' : 'Tiene un perfil equilibrado para jugar y crear sin irse al extremo.')
        : contextProduct.type === ProductType.MONITOR
          ? `Lo importante aquí es que su resolución y refresh rate coincidan con tu uso.`
          : 'La decisión depende sobre todo de su compatibilidad con el resto de tu equipo y de tu presupuesto.';
      return { message: `Sí, puedo orientarte sobre ${contextProduct.name}. ${note} Si me dices tu uso principal, te digo si lo elegiría frente a alternativas reales.`, needsMoreInformation: false, shoppingIntent, currentProduct: contextProduct, filters: intent.filters ?? null, recommendations: [], quickActions: ['Comparar similares', 'Cotizar', 'Agregar a build'] };
    }
    const wantsBuildChange = /\b(pon|agrega|añade|anade|usa|mete|cambia|reemplaza)\b/i.test(input.message);
    if (contextProduct && wantsBuildChange && input.context?.buildSlugs) {
      return {
        message: `Puedo añadir ${contextProduct.name} a tu configuración. Confirma el cambio desde la acción para validar stock y compatibilidad.`,
        needsMoreInformation: false,
        shoppingIntent: ShoppingIntent.CUSTOM_PC,
        filters: intent.filters ?? null,
        recommendations: [],
        actions: [{ action: 'REPLACE_COMPONENT', productId: contextProduct.id, productSlug: contextProduct.slug, label: `Poner ${contextProduct.name}` }],
        quickActions: ['Abrir configurador'],
      };
    }
    if (shoppingIntent === ShoppingIntent.COMPONENT && componentType) {
      if (!intent.filters?.workloads?.length) {
        return { message: `Antes de mostrarte ${this.productTypeLabel(componentType)}, cuéntame qué quieres mejorar o qué juego/programa usarás. Así no te vendo una pieza más cara de lo necesario.`, needsMoreInformation: true, shoppingIntent, componentType, filters: intent.filters ?? null, recommendations: [], quickActions: ['Gaming', 'Trabajo y estudio', 'Edición o diseño', 'Uso general'] };
      }
      if (!budgetMax) {
        return { message: `Ya entiendo el uso. ¿Cuánto te gustaría gastar como máximo en ${this.productTypeLabel(componentType)}? Un valor aproximado está bien.`, needsMoreInformation: true, shoppingIntent, componentType, filters: intent.filters ?? null, recommendations: [], quickActions: ['$500.000 COP', '$1.000.000 COP', '$2.000.000 COP'] };
      }
      const componentResult = await this.builder.recommendComponents({ componentType, itemSlugs: currentBuild, budgetMax, preference: /potente|mejor|premium/i.test(input.message) ? 'powerful' : /barat|econom/i.test(input.message) ? 'cheaper' : undefined });
      const lead = componentResult.recommendations[0];
      return { message: contextProduct ? `Estás viendo ${contextProduct.name}. Comparé alternativas disponibles dentro de tu presupuesto y compatibles con lo que ya llevas en la configuración.` : lead ? `Yo empezaría por ${lead.name}. Es la primera opción que revisaría para tu uso y presupuesto; antes de comprar, confirmemos motherboard, fuente y espacio físico si no están en tu configuración.` : 'No encontré una opción responsable dentro de ese presupuesto. Prefiero ajustar el límite contigo antes que recomendarte algo que no encaje.', needsMoreInformation: false, shoppingIntent, componentType, currentProduct: contextProduct, filters: intent.filters ?? null, recommendations: [], componentRecommendations: componentResult.recommendations, quickActions: ['Más barato', 'Más potente', 'Revisar compatibilidad', 'Hasta ahí'], warnings: componentResult.warnings, build: currentBuild.length ? await this.builder.summarize({ itemSlugs: currentBuild, budgetMax, assembly: false }) : undefined };
    }
    if (shoppingIntent === ShoppingIntent.COMPONENT) {
      return { message: '¿Qué componente buscas: GPU, CPU, RAM, almacenamiento o monitor?', needsMoreInformation: true, shoppingIntent, filters: intent.filters ?? null, recommendations: [], quickActions: ['GPU', 'CPU', 'RAM', 'Monitor'] };
    }
    if (shoppingIntent === ShoppingIntent.CUSTOM_PC) {
      if (!intent.filters?.workloads?.length) {
        return { message: intent.question ?? 'Primero quiero entender para qué la vas a usar. ¿Qué juegos, programas o tareas son los más importantes para ti?', needsMoreInformation: true, shoppingIntent, filters: intent.filters ?? null, recommendations: [], quickActions: ['Gaming', 'Edición y diseño', 'Programación', 'Trabajo y estudio'] };
      }
      if (!budgetMax) {
        return { message: 'Perfecto, ya sé qué rendimiento buscar. ¿Cuál es el presupuesto máximo para la torre? Si también necesitas monitor o periféricos, dímelo para separar bien el dinero.', needsMoreInformation: true, shoppingIntent, filters: intent.filters ?? null, recommendations: [], quickActions: ['$3 millones', '$5 millones', '$7 millones'] };
      }
      const currentSummary = currentBuild.length ? await this.builder.summarize({ itemSlugs: currentBuild, budgetMax, assembly: false }) : null;
      const wantsAuto = /(?:recomiend|elige|escoge|armala|ármala|hazla|hazlo|por mi|por mí|configuracion completa|configuración completa)/i.test(input.message);
      const wantsGuided = /(?:paso a paso|guiar|guiame|guíame|pieza por pieza)/i.test(input.message);
      if (wantsAuto && !budgetMax) return { message: 'Puedo armarla por ti. ¿Cuál es tu presupuesto máximo aproximado?', needsMoreInformation: true, shoppingIntent, filters: intent.filters ?? null, recommendations: [] };
      if (!currentBuild.length && !wantsAuto && !wantsGuided && input.context?.builderMode !== 'GUIDED') {
        return { message: 'Podemos hacerlo pieza por pieza o te propongo una configuración completa. ¿Qué prefieres?', needsMoreInformation: false, shoppingIntent, filters: intent.filters ?? null, recommendations: [], actions: [{ action: 'START_GUIDED', label: 'Guiarme paso a paso' }, { action: 'AUTO_BUILD', label: 'Recomiéndamela completa' }], flow: await this.builder.flow([], 'GUIDED') };
      }
      const build = /(?:más barato|mas barato|ahorrar|bajar el precio)/i.test(input.message) && currentSummary
        ? await this.builder.autoBuild({ budgetMax: Math.max(500000, Math.min(budgetMax ?? currentSummary.total, currentSummary.total - 300000)), assembly: false })
        : currentBuild.length
        ? await this.builder.summarize({ itemSlugs: currentBuild, budgetMax, assembly: false })
        : budgetMax
          ? await this.builder.autoBuild({ budgetMax, workloadSlugs: intent.filters?.workloads.map((item) => item.slug), assembly: false })
          : await this.builder.summarize({ itemSlugs: [], budgetMax, assembly: false });
      const nextStep = (await this.builder.flow(currentBuild, input.context?.builderMode ?? (wantsAuto ? 'AUTO' : 'GUIDED'))).currentStep;
      const requestedType = componentType ?? (nextStep === 'DONE' ? undefined : nextStep as ProductType);
      const alternatives = requestedType ? await this.builder.recommendComponents({ componentType: requestedType, itemSlugs: currentBuild, budgetMax: build.budgetRemaining && build.budgetRemaining > 0 ? build.budgetRemaining : budgetMax, preference: /potente|mejor/i.test(input.message) ? 'powerful' : /barat|econom/i.test(input.message) ? 'cheaper' : undefined }) : null;
      return { message: alternatives?.recommendations.length ? (componentType ? `Te muestro opciones compatibles para ${this.productTypeLabel(componentType)}.` : `Sigamos con ${this.productTypeLabel(requestedType as ProductType)}. Te muestro solo opciones compatibles.`) : build.products.length ? 'Listo, ya tienes una base compatible. Puedes ajustar cualquier pieza desde aquí.' : 'Dime el presupuesto y el uso; con eso te propongo los componentes compatibles.', needsMoreInformation: !budgetMax, shoppingIntent, filters: intent.filters ?? null, recommendations: [], componentRecommendations: alternatives?.recommendations, build, flow: await this.builder.flow(build.products.map((product) => product.slug), input.context?.builderMode ?? (wantsAuto ? 'AUTO' : 'GUIDED')), actions: alternatives?.recommendations.length && requestedType ? [{ action: 'AUTO_SELECT', componentType: requestedType, label: 'Que Nova elija' }] : undefined, quickActions: ['Más barato', 'Cambiar una pieza', 'Agregar periféricos', 'Agregar ensamble', 'Cotizar'] };
    }
    if (shoppingIntent === ShoppingIntent.UPGRADE_PC) {
      const currentPc = this.mergeCurrentPc(input.context?.currentPc, this.extractCurrentPc(input.message));
      const missing = [!currentPc.cpu && 'procesador', !currentPc.gpu && 'tarjeta gráfica', !currentPc.ramGb && 'memoria RAM'].filter(Boolean) as string[];
      const upgradeGoal = this.extractUpgradeGoal(input.message) ?? input.context?.upgradeGoal;
      if (missing.length) {
        return { message: `Para decirte qué vale la pena cambiar necesito ver tu equipo actual. Te dejo una forma fácil de obtenerlo; si prefieres, también puedes escribir los datos a mano. Me falta: ${missing.join(', ')}.`, needsMoreInformation: true, shoppingIntent, currentPc, upgradeGoal: upgradeGoal ?? null, systemInfoGuide: SYSTEM_INFO_GUIDE, filters: intent.filters ?? null, recommendations: [], quickActions: ['Prefiero escribirlos', '¿Dónde miro la fuente?'] };
      }
      if (!upgradeGoal) {
        return { message: 'Gracias, ya tengo la base del equipo. Ahora cuéntame qué te está molestando o qué quieres lograr: menciona juegos o programas, resolución/FPS si juegas y si notas lentitud, tirones o falta de espacio.', needsMoreInformation: true, shoppingIntent, currentPc, filters: intent.filters ?? null, recommendations: [], quickActions: ['Más FPS en juegos', 'Editar y renderizar', 'Multitarea', 'Me falta espacio'] };
      }
      if (!budgetMax) {
        return { message: `Entiendo el objetivo: ${upgradeGoal}. ¿Cuál es el máximo que invertirías ahora? Con eso separo la mejora imprescindible de la que puede esperar.`, needsMoreInformation: true, shoppingIntent, currentPc, upgradeGoal, filters: intent.filters ?? null, recommendations: [], quickActions: ['$1 millón', '$2 millones', '$3 millones'] };
      }
      const upgrade = await this.builder.analyzeUpgrade({ ...currentPc, goal: upgradeGoal, budgetMax });
      const priorityLabel = upgrade.priority === ProductType.GPU ? 'la tarjeta gráfica' : upgrade.priority === ProductType.RAM ? 'la memoria RAM' : upgrade.priority === ProductType.STORAGE ? 'el almacenamiento' : 'el procesador';
      return { message: upgrade.bestFirstUpgrade ? `Yo empezaría por ${priorityLabel}. ${upgrade.bottleneck} ${upgrade.assessment} No compraría todavía: primero revisaría las comprobaciones de compatibilidad de abajo.` : `No encontré una mejora suficientemente clara dentro de ${budgetMax} COP. Prefiero que conserves el dinero o ajustemos el objetivo antes que venderte un cambio pequeño.`, needsMoreInformation: false, shoppingIntent, currentPc, upgradeGoal, upgradeAnalysis: upgrade, filters: intent.filters ?? null, recommendations: [], upgradeRecommendations: upgrade.recommendations, quickActions: ['Ver opciones baratas', 'Cambiar presupuesto', 'Revisar compatibilidad'] };
    }
    if (intent.needsMoreInformation || !intent.filters) {
      return {
        message:
          intent.question ??
          '¿Cuál es tu presupuesto y qué programas o juegos usarás?',
        needsMoreInformation: true,
        filters: intent.filters ?? input.filters ?? null,
        recommendations: [],
        shoppingIntent,
        quickActions: ['PC completo', 'Armar por componentes', 'Mejorar mi PC', 'Buscar un componente'],
      };
    }

    const result = await this.recommendations.recommend(intent.filters);
    if (!result.recommendations.length) {
      return {
        message:
          'No encontré equipos disponibles que cumplan esos mínimos dentro del presupuesto. Podemos aumentar el presupuesto o ajustar un poco el objetivo.',
        needsMoreInformation: false,
        filters: intent.filters,
        recommendations: [], shoppingIntent, quickActions: ['Más barato', 'Más potente', 'Ajustar presupuesto'],
      };
    }
    const message = await this.ai.explainRecommendations(
      intent.filters,
      result.recommendations,
    );
    return {
      message,
      needsMoreInformation: false,
      filters: intent.filters,
      recommendations: result.recommendations,
      scoring: result.scoring,
      shoppingIntent,
      quickActions: shoppingIntent === ShoppingIntent.PC_WITH_PERIPHERALS ? ['Agregar monitor', 'Agregar teclado y mouse', 'Comprar'] : ['Más barato', 'Más potente', 'Compararlos', 'Comprar'],
      peripheralRecommendations: shoppingIntent === ShoppingIntent.PC_WITH_PERIPHERALS ? await this.builder.recommendPeripherals(Math.max(0, (intent.filters.budgetMax ?? 0) - (result.recommendations[0]?.product.price ?? 0))) : [],
    };
  }

  private detectShoppingIntent(message: string): ShoppingIntent {
    const value = this.normalize(message);
    if (/perifer|monitor|teclado|mouse|audifono|headset|240\s*hz/.test(value) && /pc|computador|equipo|monitor/.test(value)) return ShoppingIntent.PC_WITH_PERIPHERALS;
    if (/mejor|upgrade|actualizar|tengo.*(ryzen|intel|rtx|gtx|rx)/.test(value)) return ShoppingIntent.UPGRADE_PC;
    if (/armar|personaliz|componentes|por partes|configur/.test(value)) return ShoppingIntent.CUSTOM_PC;
    if (/solo|unicamente|componente|gpu|tarjeta grafica|procesador|ram|ssd|fuente/.test(value)) return ShoppingIntent.COMPONENT;
    return ShoppingIntent.PREBUILT_PC;
  }

  private detectComponentType(message: string, context?: AssistantContextDto): ProductType | undefined {
    const value = this.normalize(message);
    if (context?.selectedComponentType && Object.values(ProductType).includes(context.selectedComponentType as ProductType)) return context.selectedComponentType as ProductType;
    if (/gpu|tarjeta grafica|video/.test(value)) return ProductType.GPU;
    if (/cpu|procesador/.test(value)) return ProductType.CPU;
    if (/ram|memoria/.test(value)) return ProductType.RAM;
    if (/ssd|disco|almacenamiento/.test(value)) return ProductType.STORAGE;
    if (/fuente|psu/.test(value)) return ProductType.PSU;
    if (/monitor|240\s*hz/.test(value)) return ProductType.MONITOR;
    return undefined;
  }

  private normalize(value: string) { return value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase(); }

  private extractCurrentPc(message: string) {
    const normalized = this.normalize(message);
    const labeled = (label: string) => message.match(new RegExp(`(?:^|\\n)\\s*(?:${label})\\s*:\\s*([^\\n]+)`, 'i'))?.[1]?.trim();
    const ram = labeled('RAM')?.match(/(\d+)/)?.[1] ?? normalized.match(/(\d+)\s*gb(?:\s*(?:de\s*)?(?:ram|memoria))/)?.[1];
    const psu = normalized.match(/(?:fuente|psu)[^\d]{0,20}(\d{3,4})\s*w/)?.[1];
    return {
      cpu: labeled('CPU') ?? message.match(/(?:amd\s+)?ryzen\s+[^,\n.?]+|intel(?:\(r\))?\s+(?:core\s+)?[^,\n.?]+/i)?.[0]?.trim() ?? null,
      gpu: labeled('GPU') ?? message.match(/(?:geforce\s+)?(?:rtx|gtx)\s*[^,\n.?]+|(?:radeon\s+)?rx\s*[^,\n.?]+/i)?.[0]?.trim() ?? null,
      ramGb: ram ? Number(ram) : null,
      motherboard: labeled('Motherboard|Board|Placa') ?? null,
      storage: labeled('Storage|Almacenamiento|Disco') ?? null,
      psuW: psu ? Number(psu) : null,
    };
  }

  private extractUpgradeGoal(message: string) {
    const normalized = this.normalize(message);
    if (!/(jugar|fps|render|editar|edicion|blender|premiere|docker|virtual|multitarea|lento|tiron|espacio|almacenamiento|stream)/.test(normalized)) return undefined;
    const match = message.match(/(?:quiero|para|busco|necesito)\s+([^?.!]+)/i);
    return (match?.[1] ?? message).trim().slice(0, 160);
  }

  private mergeCurrentPc(previous: AssistantContextDto['currentPc'], next: ReturnType<AssistantService['extractCurrentPc']>) {
    return {
      cpu: next.cpu ?? previous?.cpu ?? null,
      gpu: next.gpu ?? previous?.gpu ?? null,
      ramGb: next.ramGb ?? previous?.ramGb ?? null,
      motherboard: next.motherboard ?? previous?.motherboard ?? null,
      storage: next.storage ?? previous?.storage ?? null,
      psuW: next.psuW ?? previous?.psuW ?? null,
    };
  }

  private extractBudget(message: string) {
    const million = this.normalize(message).match(/(\d+(?:[.,]\d+)?)\s*(?:millones?|m)\b/);
    if (million) return Math.round(Number(million[1].replace(',', '.')) * 1_000_000);
    const explicit = message.match(/(?:\$|cop\s*)([\d.,]{6,})/i)?.[1];
    return explicit ? Number(explicit.replace(/[.,]/g, '')) : undefined;
  }

  private isFinishRequest(message: string) { return /\b(hasta ahi|hasta ahí|eso es todo|ya|terminar|finalizar|no necesito mas|no necesito más|con eso)\b/i.test(this.normalize(message)); }

  private productTypeLabel(type: ProductType) { return ({ CPU: 'el procesador', MOTHERBOARD: 'la motherboard', RAM: 'la memoria RAM', GPU: 'la tarjeta gráfica', STORAGE: 'el almacenamiento', PSU: 'la fuente', COOLING: 'la refrigeración', CASE: 'el chasis', MONITOR: 'el monitor', KEYBOARD: 'el teclado', MOUSE: 'el mouse', HEADSET: 'el headset' } as Partial<Record<ProductType, string>>)[type] ?? 'el siguiente componente'; }

  async compare(input: CompareRequestDto) {
    const result = await this.recommendations.recommend(input.filters);
    const selected = result.recommendations.filter((item) =>
      input.slugs.includes(item.product.slug),
    );
    if (selected.length < 2) {
      throw new BadRequestException(
        'Selecciona al menos dos recomendaciones vigentes para comparar',
      );
    }
    const message = await this.ai.explainComparison(input.question, selected);
    return { message, recommendations: selected };
  }
}
