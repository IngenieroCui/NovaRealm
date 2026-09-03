import { AwaitingField, QuickReplyDto, ShoppingIntent } from './assistant.dto';

export function quickRepliesFor(awaiting: AwaitingField, intent?: ShoppingIntent): QuickReplyDto[] {
  if (awaiting === 'INTENT') return [
    reply('intent-prebuilt', 'Comprar PC listo', 'SET_INTENT', ShoppingIntent.PREBUILT_PC),
    reply('intent-custom', 'Armar por componentes', 'SET_INTENT', ShoppingIntent.CUSTOM_PC),
    reply('intent-upgrade', 'Mejorar mi PC', 'SET_INTENT', ShoppingIntent.UPGRADE_PC),
    reply('intent-component', 'Buscar componente', 'SET_INTENT', ShoppingIntent.COMPONENT),
  ];
  if (awaiting === 'USE') return [
    reply('use-gaming', 'Gaming', 'SET_WORKLOAD', 'gaming'),
    reply('use-creation', 'Edición y Blender', 'SET_WORKLOAD', 'blender'),
    reply('use-development', 'Programación / Docker', 'SET_WORKLOAD', 'programacion'),
    reply('use-office', 'Trabajo y estudio', 'SET_WORKLOAD', 'ofimatica-basica'),
  ];
  if (awaiting === 'BUDGET') {
    return intent === ShoppingIntent.COMPONENT
      ? [reply('budget-500k', '$500.000', 'SET_BUDGET', 500000), reply('budget-1m', '$1 millón', 'SET_BUDGET', 1000000), reply('budget-2m', '$2 millones', 'SET_BUDGET', 2000000)]
      : [reply('budget-3m', '$3 millones', 'SET_BUDGET', 3000000), reply('budget-5m', '$5 millones', 'SET_BUDGET', 5000000), reply('budget-7m', '$7 millones', 'SET_BUDGET', 7000000)];
  }
  if (awaiting === 'BUILDER_MODE') return [
    reply('builder-guided', 'Guiarme paso a paso', 'SET_BUILDER_MODE', 'GUIDED'),
    reply('builder-auto', 'Recomiéndamela completa', 'SET_BUILDER_MODE', 'AUTO'),
  ];
  return [];
}

function reply(id: string, label: string, kind: QuickReplyDto['kind'], value: string | number): QuickReplyDto {
  return { id, label, kind, value };
}

export function messageReply(id: string, label: string, value = label): QuickReplyDto {
  return { id, label, kind: 'SEND_MESSAGE', value };
}

export function builderReply(id: string, label: string, action: string): QuickReplyDto {
  return { id, label, kind: 'BUILDER_ACTION', payload: { action } };
}
