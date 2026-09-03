import { AiService, InterpretedIntent } from './ai.service';
import { Workload } from '../workloads/workload.types';

const officeWorkload = {
  slug: 'ofimatica-basica',
  name: 'Ofimática básica (Excel, Word y correo)',
} as Workload;

describe('AiService', () => {
  const service = new AiService({} as any, {} as any);

  it('prioriza ofimática cuando el usuario menciona Excel y Word', () => {
    const intent: InterpretedIntent = {
      needsMoreInformation: false,
      filters: {
        budgetMax: 3_000_000,
        workloads: [{ slug: 'programacion', importance: 1 }],
      },
    };

    const result = (service as any).applyExplicitOfficeIntent(
      'Trabajo con Excel, Word y cosas básicas.',
      intent,
      undefined,
      [officeWorkload],
      [{ role: 'user', content: 'Tengo 3 millones de presupuesto.' }],
    ) as InterpretedIntent;

    expect(result).toMatchObject({
      needsMoreInformation: false,
      filters: {
        budgetMax: 3_000_000,
        workloads: [{ slug: 'ofimatica-basica', importance: 1 }],
      },
    });
  });

  it('no descarta programación cuando se menciona junto a Excel', () => {
    const intent: InterpretedIntent = {
      needsMoreInformation: false,
      filters: {
        budgetMax: 3_000_000,
        workloads: [{ slug: 'programacion', importance: 1 }],
      },
    };

    const result = (service as any).applyExplicitOfficeIntent(
      'Uso Excel y también programo en Visual Studio.',
      intent,
      undefined,
      [officeWorkload],
      [],
    ) as InterpretedIntent;

    expect(result).toBe(intent);
  });

  it('pide presupuesto en vez de aceptar uno inventado por el modelo', () => {
    const intent: InterpretedIntent = {
      needsMoreInformation: false,
      filters: {
        budgetMax: 5_000_000,
        workloads: [{ slug: 'programacion', importance: 1 }],
      },
    };

    const result = (service as any).applyExplicitOfficeIntent(
      'Solo uso Excel y Word para tareas básicas.',
      intent,
      undefined,
      [officeWorkload],
      [],
    ) as InterpretedIntent;

    expect(result).toMatchObject({
      needsMoreInformation: true,
      filters: { workloads: [{ slug: 'ofimatica-basica', importance: 1 }] },
    });
    expect(result.filters?.budgetMax).toBeUndefined();
  });

  it('valida todas las preferencias permitidas y descarta campos arbitrarios', () => {
    const result = (service as any).validateCriteria({
      preferences: {
        futureUpgrade: true,
        wifiRequired: false,
        peripheralsNeeded: true,
        valuePriority: true,
        multitaskingLevel: 'HEAVY',
        inferredPreference: true,
      },
    }, [officeWorkload]);
    expect(result.preferences).toEqual({
      futureUpgrade: true,
      wifiRequired: false,
      peripheralsNeeded: true,
      valuePriority: true,
      multitaskingLevel: 'HEAVY',
    });
  });

  it('keeps preference extraction only when the last message has evidence', () => {
    const turn = {
      shoppingIntent: undefined,
      intentChanged: false,
      intentConfidence: 0,
      extracted: { preferences: { wifiRequired: true, valuePriority: true, multitaskingLevel: 'HEAVY' } },
      missingFields: [],
      nextQuestionPurpose: null,
      reply: 'Respuesta',
    };
    expect((service as any).sanitizeExplicitPreferences('Solo uso Wi-Fi y Docker; no quiero gastar porque sí.', turn).extracted.preferences).toEqual({ wifiRequired: true, valuePriority: true, multitaskingLevel: 'HEAVY' });
    expect((service as any).sanitizeExplicitPreferences('Quiero un computador.', turn).extracted.preferences).toBeUndefined();
  });
});
