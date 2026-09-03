import { AwaitingField, QuickReplyDto, ShoppingIntent } from './assistant.dto';

export function quickRepliesFor(awaiting: AwaitingField, intent?: ShoppingIntent): QuickReplyDto[] {
  if (awaiting === 'INTENT') return [
    reply('intent-prebuilt', 'Comprar PC listo', 'SET_INTENT', ShoppingIntent.PREBUILT_PC),
    reply('intent-custom', 'Armar por componentes', 'SET_INTENT', ShoppingIntent.CUSTOM_PC),
    reply('intent-upgrade', 'Mejorar mi PC', 'SET_INTENT', ShoppingIntent.UPGRADE_PC),
    reply('intent-component', 'Buscar componente', 'SET_INTENT', ShoppingIntent.COMPONENT),
  ];
  if (awaiting === 'USE') {
    return [
      reply('use-gaming', 'Gaming', 'SET_USE_PROFILE', 'GAMING'),
      reply('use-creation', 'Edición y Blender', 'SET_USE_PROFILE', 'CREATIVE'),
      reply('use-development', 'Programación / Docker', 'SET_USE_PROFILE', 'PROGRAMMING'),
      reply('use-office', 'Trabajo y estudio', 'SET_USE_PROFILE', 'OFFICE'),
    ];
  }
  if (awaiting === 'BUDGET') {
    return intent === ShoppingIntent.COMPONENT
      ? [reply('budget-500k', '$500.000', 'SET_BUDGET', 500000), reply('budget-1m', '$1 millón', 'SET_BUDGET', 1000000), reply('budget-2m', '$2 millones', 'SET_BUDGET', 2000000)]
      : [reply('budget-3m', '$3 millones', 'SET_BUDGET', 3000000), reply('budget-5m', '$5 millones', 'SET_BUDGET', 5000000), reply('budget-7m', '$7 millones', 'SET_BUDGET', 7000000)];
  }
  if (awaiting === 'CONNECTIVITY') return [
    reply('connectivity-wifi', 'Solo uso Wi-Fi', 'SET_CONNECTIVITY', 'WIFI_ONLY'),
    reply('connectivity-ethernet', 'Tengo cable Ethernet', 'SET_CONNECTIVITY', 'ETHERNET_OK'),
    reply('connectivity-unsure', 'No estoy seguro', 'SET_CONNECTIVITY', 'UNSURE'),
  ];
  if (awaiting === 'GAMING_TARGET') return [
    reply('gaming-1080p-144', '1080p · 144 Hz', 'SET_GAMING_TARGET', '1080P_144'),
    reply('gaming-1440p-144', '1440p · 144 Hz', 'SET_GAMING_TARGET', '1440P_144'),
    reply('gaming-1080p-240', '1080p · 240 Hz', 'SET_GAMING_TARGET', '1080P_240'),
    reply('gaming-unsure', 'No estoy seguro', 'SET_GAMING_TARGET', 'UNSURE'),
  ];
  if (awaiting === 'DEVELOPMENT_LOAD') return [
    reply('development-ide', 'Principalmente código / IDE', 'SET_DEVELOPMENT_LOAD', 'IDE'),
    reply('development-docker', 'Docker y servicios locales', 'SET_DEVELOPMENT_LOAD', 'DOCKER'),
    reply('development-vm', 'Máquinas virtuales', 'SET_DEVELOPMENT_LOAD', 'VM'),
    reply('development-docker-vm', 'Docker + máquinas virtuales', 'SET_DEVELOPMENT_LOAD', 'DOCKER_VM'),
  ];
  if (awaiting === 'BUILDER_MODE') return [
    reply('builder-guided', 'Guiarme paso a paso', 'SET_BUILDER_MODE', 'GUIDED'),
    reply('builder-auto', 'Recomiéndamela completa', 'SET_BUILDER_MODE', 'AUTO'),
  ];
  if (awaiting === 'PERIPHERALS') return [
    reply('peripherals-monitor', 'Solo monitor', 'SET_PERIPHERALS', 'MONITOR'),
    reply('peripherals-desk', 'Monitor + teclado + mouse', 'SET_PERIPHERALS', 'DESK'),
    reply('peripherals-full', 'Kit completo', 'SET_PERIPHERALS', 'FULL'),
    reply('peripherals-unsure', 'No estoy seguro', 'SET_PERIPHERALS', 'UNSURE'),
  ];
  return [];
}

export function upgradeGoalReplies(): QuickReplyDto[] {
  return [
    reply('upgrade-gaming', 'Mejorar juegos', 'SET_UPGRADE_GOAL', 'GAMING'),
    reply('upgrade-1440p', 'Jugar a 1440p', 'SET_UPGRADE_GOAL', 'GAMING_1440P'),
    reply('upgrade-creative', 'Edición / Blender', 'SET_UPGRADE_GOAL', 'CREATIVE'),
    reply('upgrade-development', 'Programación / VMs', 'SET_UPGRADE_GOAL', 'DEVELOPMENT'),
    reply('upgrade-general', 'PC más rápido en general', 'SET_UPGRADE_GOAL', 'GENERAL'),
  ];
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
