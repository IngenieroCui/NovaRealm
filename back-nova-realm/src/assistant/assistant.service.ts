import { BadRequestException, Injectable } from '@nestjs/common';
import { AiService } from '../ai/ai.service';
import { RecommendationsService } from '../recommendations/recommendations.service';
import { WorkloadsService } from '../workloads/workloads.service';
import { ChatRequestDto, CompareRequestDto } from './assistant.dto';
import { AssistantContextDto, ShoppingIntent } from './assistant.dto';
import { BuilderService } from '../builder/builder.service';
import { Product, ProductType } from '../catalog/product.types';
import { CatalogService } from '../catalog/catalog.service';

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
    const intent = [ShoppingIntent.COMPONENT, ShoppingIntent.UPGRADE_PC].includes(detectedIntent)
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
      const componentResult = await this.builder.recommendComponents({ componentType, itemSlugs: [], budgetMax: intent.filters?.budgetMax ?? this.extractBudget(input.message), preference: /potente|mejor|premium/i.test(input.message) ? 'powerful' : /barat|econom/i.test(input.message) ? 'cheaper' : undefined });
      return { message: contextProduct ? `Estás viendo ${contextProduct.name}. Estas alternativas pueden servirte como comparación.` : componentResult.recommendations.length ? 'Estas son las opciones disponibles que mejor encajan.' : 'Necesito ajustar presupuesto o disponibilidad para encontrar una opción.', needsMoreInformation: false, shoppingIntent, componentType, currentProduct: contextProduct, filters: intent.filters ?? null, recommendations: [], componentRecommendations: componentResult.recommendations, quickActions: ['Más barato', 'Más potente', 'Compararlos', 'Consultar disponibilidad'], warnings: componentResult.warnings };
    }
    if (shoppingIntent === ShoppingIntent.COMPONENT) {
      return { message: '¿Qué componente buscas: GPU, CPU, RAM, almacenamiento o monitor?', needsMoreInformation: true, shoppingIntent, filters: intent.filters ?? null, recommendations: [], quickActions: ['GPU', 'CPU', 'RAM', 'Monitor'] };
    }
    if (shoppingIntent === ShoppingIntent.CUSTOM_PC) {
      const budgetMax = intent.filters?.budgetMax ?? this.extractBudget(input.message);
      const build = input.context?.buildSlugs?.length
        ? await this.builder.summarize({ itemSlugs: input.context.buildSlugs, budgetMax, assembly: false })
        : budgetMax
          ? await this.builder.autoBuild({ budgetMax, workloadSlugs: intent.filters?.workloads.map((item) => item.slug), assembly: false })
          : await this.builder.summarize({ itemSlugs: [], budgetMax, assembly: false });
      const alternatives = componentType ? await this.builder.recommendComponents({ componentType, itemSlugs: input.context?.buildSlugs ?? [], budgetMax: build.budgetRemaining && build.budgetRemaining > 0 ? build.budgetRemaining : undefined, preference: /potente|mejor/i.test(input.message) ? 'powerful' : /barat|econom/i.test(input.message) ? 'cheaper' : undefined }) : null;
      return { message: alternatives?.recommendations.length ? `Estas son alternativas compatibles para ${componentType}.` : build.products.length ? 'Listo: armé una base compatible con tu presupuesto. Puedes ajustar cualquier pieza.' : 'Dime el presupuesto y el uso; con eso te propongo los componentes compatibles.', needsMoreInformation: !budgetMax, shoppingIntent, filters: intent.filters ?? null, recommendations: [], componentRecommendations: alternatives?.recommendations, build, quickActions: ['Abrir configurador', 'Recomendar CPU', 'Recomendar GPU', 'Hacerlo más barato', 'Agregar ensamble'] };
    }
    if (shoppingIntent === ShoppingIntent.UPGRADE_PC) {
      const currentPc = this.extractCurrentPc(input.message);
      const upgrade = await this.builder.analyzeUpgrade({ ...currentPc, goal: this.extractUpgradeGoal(input.message), budgetMax: intent.filters?.budgetMax ?? this.extractBudget(input.message) });
      return { message: upgrade.bestFirstUpgrade ? `Para ${upgrade.goal}, yo empezaría por ${upgrade.priority === ProductType.GPU ? 'la GPU' : 'el procesador'}. ${upgrade.noNeedToChange}` : 'Puedo analizarlo, pero necesito identificar al menos tu CPU o GPU actual.', needsMoreInformation: !currentPc.cpu && !currentPc.gpu, shoppingIntent, currentPc, upgradeAnalysis: upgrade, filters: intent.filters ?? null, recommendations: [], upgradeRecommendations: upgrade.recommendations, quickActions: ['Ver opciones baratas', 'Comparar', 'Abrir configurador'] };
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
    const ram = normalized.match(/(\d+)\s*gb(?:\s*(?:de\s*)?(?:ram|memoria))?/)?.[1];
    return { cpu: message.match(/(?:ryzen|intel)[^,.?]*/i)?.[0]?.trim() ?? null, gpu: message.match(/(?:rtx|gtx|radeon|rx)[^,.?]*/i)?.[0]?.trim() ?? null, ramGb: ram ? Number(ram) : null };
  }

  private extractUpgradeGoal(message: string) {
    const match = message.match(/(?:quiero|para|busco)\s+([^?.!]+)/i);
    return (match?.[1] ?? message).trim().slice(0, 120) || 'mejor rendimiento general';
  }

  private extractBudget(message: string) {
    const million = this.normalize(message).match(/(\d+(?:[.,]\d+)?)\s*(?:millones?|m)\b/);
    if (million) return Math.round(Number(million[1].replace(',', '.')) * 1_000_000);
    const explicit = message.match(/(?:\$|cop\s*)([\d.,]{6,})/i)?.[1];
    return explicit ? Number(explicit.replace(/[.,]/g, '')) : undefined;
  }

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
