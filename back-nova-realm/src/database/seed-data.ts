export interface ProductSeed {
  name: string;
  slug: string;
  description: string;
  price: number;
  stock: number;
  imageUrl: string;
  active: boolean;
  type: string;
  cpu?: string;
  gpu?: string;
  ramGb?: number;
  storageGb?: number;
  vramGb?: number;
  cpuScore?: number;
  gpuScore?: number;
  productivityScore?: number;
  upgradeabilityScore?: number;
  features?: string[];
  technicalSpecs?: Record<string, string | number | boolean | string[]>;
}

export interface WorkloadSeed {
  slug: string;
  name: string;
  type: string;
  description: string;
  cpuWeight: number;
  gpuWeight: number;
  ramWeight: number;
  storageWeight: number;
  vramWeight: number;
  minimumCpuScore: number;
  recommendedCpuScore: number;
  minimumGpuScore: number;
  recommendedGpuScore: number;
  minimumRamGb: number;
  recommendedRamGb: number;
  minimumVramGb: number;
  recommendedVramGb: number;
}

const pc = (
  name: string,
  slug: string,
  price: number,
  stock: number,
  cpu: string,
  gpu: string,
  ramGb: number,
  storageGb: number,
  vramGb: number,
  cpuScore: number,
  gpuScore: number,
  productivityScore: number,
  upgradeabilityScore: number,
  imageUrl: string,
): ProductSeed => ({
  name,
  slug,
  description: `${name} es un equipo equilibrado para jugar y crear, ensamblado con componentes estándar y datos de rendimiento mantenibles.`,
  price,
  stock,
  imageUrl,
  active: true,
  type: 'PREBUILT_PC',
  cpu,
  gpu,
  ramGb,
  storageGb,
  vramGb,
  cpuScore,
  gpuScore,
  productivityScore,
  upgradeabilityScore,
  features: [
    'SSD NVMe',
    'Wi-Fi y Bluetooth',
    'Windows 11 listo para configurar',
    'Garantía de 12 meses',
  ],
});

const FALLBACK_IMAGE_BY_TYPE: Record<string, string> = {
  CPU: '/products/fallback/cpu.svg',
  GPU: '/products/fallback/gpu.svg',
  RAM: '/products/fallback/ram.svg',
  MOTHERBOARD: '/products/fallback/motherboard.svg',
  STORAGE: '/products/fallback/storage.svg',
  PSU: '/products/fallback/psu.svg',
  COOLING: '/products/fallback/cooling.svg',
  CASE: '/products/fallback/case.svg',
  MONITOR: '/products/fallback/peripheral.svg',
  KEYBOARD: '/products/fallback/peripheral.svg',
  MOUSE: '/products/fallback/peripheral.svg',
  HEADSET: '/products/fallback/peripheral.svg',
};

export function imageForProductType(type: string): string {
  return (
    FALLBACK_IMAGE_BY_TYPE[type.toUpperCase()] ??
    '/products/fallback/peripheral.svg'
  );
}

type ComponentSpecs = NonNullable<ProductSeed['technicalSpecs']>;

function formatCapacity(capacityGb: number): string {
  if (capacityGb >= 1000 && capacityGb % 1000 === 0)
    return `${capacityGb / 1000} TB`;
  return `${capacityGb} GB`;
}

export function descriptionForComponent(
  name: string,
  type: string,
  specs: ComponentSpecs,
): string {
  if (type === 'CPU') {
    const graphics =
      specs.integratedGraphics === true ? ' Incluye gráficos integrados.' : '';
    return `Procesador de ${specs.cores ?? 0} núcleos y ${specs.threads ?? 0} hilos para equipos de uso general.${graphics} Usa socket ${specs.socket ?? 'compatible'}.`;
  }
  if (type === 'MOTHERBOARD') {
    const wifiText = specs.wifi === true ? ' con Wi-Fi integrado' : '';
    return `Motherboard ${specs.socket ?? 'moderna'} para memoria ${specs.ramType ?? 'compatible'}${wifiText}, en formato ${specs.formFactor ?? 'estándar'} y preparada para actualizaciones futuras.`;
  }
  if (type === 'RAM') {
    return `Memoria de ${specs.capacityGb ?? 0} GB ${specs.ramType ?? ''} a ${specs.speed ?? 0} MT/s para multitarea y uso diario.`;
  }
  if (type === 'GPU') {
    return `Tarjeta gráfica con ${specs.vramGb ?? 0} GB de VRAM para gaming y cargas aceleradas por GPU.`;
  }
  if (type === 'STORAGE') {
    const generation = specs.generation ? ` Gen${specs.generation}` : '';
    return `SSD ${specs.interface ?? 'de almacenamiento'}${generation} de ${formatCapacity(Number(specs.capacityGb ?? 0))} para sistema, aplicaciones y archivos con acceso rápido.`;
  }
  if (type === 'PSU') {
    return `Fuente de ${specs.wattage ?? 0} W con certificación ${specs.efficiency ?? '80+ Bronze'} para alimentar componentes con estabilidad.`;
  }
  if (type === 'COOLING') {
    return `Refrigeración para procesadores de gama media con capacidad térmica de ${specs.maxTdpW ?? 0} W y montaje sencillo.`;
  }
  if (type === 'CASE') {
    const formFactors = Array.isArray(specs.supportedFormFactors)
      ? specs.supportedFormFactors.join(', ')
      : 'configuraciones estándar';
    return `Chasis con flujo de aire y soporte para formatos ${formFactors}, pensado para mantener un montaje ordenado y actualizable.`;
  }
  return `${name} es un componente seleccionado para ampliar una estación NovaRealm equilibrada y fácil de mantener.`;
}

const component = (
  name: string,
  slug: string,
  type: string,
  price: number,
  stock: number,
  score?: number,
): ProductSeed => ({
  name,
  slug,
  type,
  price,
  stock,
  active: true,
  imageUrl: imageForProductType(type),
  description: descriptionForComponent(
    name,
    type,
    specsForComponent(name, type),
  ),
  cpu: type === 'CPU' ? name : undefined,
  gpu: type === 'GPU' ? name : undefined,
  ramGb:
    type === 'RAM' ? Number(name.match(/(\d+)\s*GB/i)?.[1] ?? 0) : undefined,
  storageGb:
    type === 'STORAGE'
      ? Number(name.match(/(\d+)\s*TB/i)?.[1] ?? 0) * 1000 ||
        Number(name.match(/(\d+)\s*GB/i)?.[1] ?? 0)
      : undefined,
  vramGb:
    type === 'GPU' ? Number(name.match(/(\d+)\s*GB/i)?.[1] ?? 0) : undefined,
  cpuScore: type === 'CPU' ? score : undefined,
  gpuScore: type === 'GPU' ? score : undefined,
  technicalSpecs: specsForComponent(name, type),
  features: ['Precio en COP', 'Stock administrable'],
});

function specsForComponent(
  name: string,
  type: string,
): Record<string, string | number | boolean | string[]> {
  const normalized = name.toLowerCase();
  if (type === 'CPU') {
    const socket =
      normalized.includes('7950') ||
      normalized.includes('7800') ||
      normalized.includes('ryzen 7 7') ||
      normalized.includes('ryzen 5 7')
        ? 'AM5'
        : normalized.includes('ryzen')
          ? 'AM4'
          : 'LGA1700';
    const cores = normalized.includes('7950')
      ? 16
      : normalized.includes('7800') || normalized.includes('7700')
        ? 8
        : normalized.includes('i5-14')
          ? 10
          : normalized.includes('i5-12') || normalized.includes('ryzen 5')
            ? 6
            : 4;
    const integratedGraphics =
      normalized.includes('ryzen 5 5600g') ||
      /^amd ryzen [579] [78]\d{3}/.test(normalized);
    return {
      socket,
      cores,
      threads: cores * 2,
      integratedGraphics,
      tdpW: normalized.includes('7950')
        ? 170
        : normalized.includes('7800') || normalized.includes('7700')
          ? 105
          : 65,
      performanceTier:
        cores >= 12
          ? 'enthusiast'
          : cores >= 8
            ? 'high'
            : cores >= 6
              ? 'mid'
              : 'entry',
    };
  }
  if (type === 'GPU') {
    const tdpW = normalized.includes('4080')
      ? 320
      : normalized.includes('4070') || normalized.includes('7800')
        ? 250
        : normalized.includes('7700')
          ? 245
          : 160;
    return {
      vramGb: Number(normalized.match(/(\d+)\s*gb/)?.[1] ?? 8),
      tdpW,
      recommendedPsuWatts: tdpW >= 300 ? 750 : tdpW >= 240 ? 650 : 550,
    };
  }
  if (type === 'RAM')
    return {
      ramType: normalized.includes('ddr5') ? 'DDR5' : 'DDR4',
      capacityGb: Number(normalized.match(/(\d+)\s*gb/)?.[1] ?? 16),
      speed: Number(normalized.match(/(\d{4})/)?.[1] ?? 3200),
    };
  if (type === 'PSU')
    return {
      wattage: Number(normalized.match(/(\d+)\s*w/)?.[1] ?? 650),
      efficiency: normalized.includes('platinum')
        ? '80+ Platinum'
        : normalized.includes('gold')
          ? '80+ Gold'
          : '80+ Bronze',
    };
  if (type === 'MOTHERBOARD') {
    const socket =
      normalized.includes('b650') || normalized.includes('x670')
        ? 'AM5'
        : normalized.includes('b760') ||
            normalized.includes('z790') ||
            normalized.includes('h610')
          ? 'LGA1700'
          : 'AM4';
    return {
      socket,
      ramType:
        normalized.includes('b650') ||
        normalized.includes('x670') ||
        normalized.includes('b760') ||
        normalized.includes('z790')
          ? 'DDR5'
          : 'DDR4',
      formFactor: normalized.includes('creator') ? 'ATX' : 'MATX',
      wifi: normalized.includes('wi-fi') || normalized.includes('wifi'),
    };
  }
  if (type === 'STORAGE') {
    const capacityGb =
      Number(normalized.match(/(\d+)\s*tb/)?.[1] ?? 0) * 1000 ||
      Number(normalized.match(/(\d+)\s*gb/)?.[1] ?? 0);
    return {
      interface: normalized.includes('sata')
        ? 'SATA'
        : normalized.includes('nvme')
          ? 'NVME'
          : 'UNKNOWN',
      ...(normalized.includes('gen4') ? { generation: 4 } : {}),
      capacityGb,
    };
  }
  if (type === 'COOLING') {
    return {
      supportedSockets: ['AM4', 'AM5', 'LGA1700'],
      maxTdpW: normalized.includes('360')
        ? 280
        : normalized.includes('240')
          ? 220
          : normalized.includes('dual')
            ? 180
            : normalized.includes('tower')
              ? 150
              : 95,
    };
  }
  if (type === 'CASE')
    return normalized.includes('compact')
      ? { supportedFormFactors: ['MATX', 'ITX'] }
      : {};
  return {};
}

function descriptionForPeripheral(
  name: string,
  type: string,
  features: string[],
  specs: Record<string, string | number | boolean | string[]>,
): string {
  const featureText = features.join(' ').toLowerCase();
  if (type === 'MONITOR') {
    return `Monitor de ${specs.sizeInches ?? 0} pulgadas con resolución ${specs.resolution ?? 'FHD'} y ${specs.refreshRate ?? specs.refreshHz ?? 60} Hz, pensado para trabajo y entretenimiento.`;
  }
  if (type === 'KEYBOARD') {
    const mechanical =
      specs.mechanical === true || featureText.includes('mecánico')
        ? 'mecánico'
        : 'de membrana';
    const layout = specs.size ?? specs.layout ?? 'formato completo';
    return `Teclado ${mechanical} de ${layout}, diseñado para escritura cómoda, atajos diarios y una estación de trabajo ordenada.`;
  }
  if (type === 'MOUSE') {
    const wireless =
      specs.wireless === true || featureText.includes('inalámbrico');
    const weight = specs.weight ? ` de ${specs.weight} g` : '';
    return `Mouse ${wireless ? 'inalámbrico' : 'cableado'}${weight} con sensor óptico para navegación precisa, productividad y sesiones de juego prolongadas.`;
  }
  if (type === 'HEADSET') {
    const wireless =
      specs.wireless === true || featureText.includes('inalámbrico');
    const microphone =
      specs.microphone === true || featureText.includes('micrófono');
    return `Headset ${wireless ? 'inalámbrico' : 'cableado'} con ${microphone ? 'micrófono integrado' : 'audio inmersivo'}, cómodo para llamadas, juegos y contenido multimedia.`;
  }
  return `${name} complementa una estación NovaRealm con controles prácticos y una experiencia de uso cómoda.`;
}

const peripheral = (
  name: string,
  slug: string,
  type: string,
  price: number,
  features: string[],
  technicalSpecs: Record<string, string | number | boolean | string[]>,
): ProductSeed => {
  const monitorSpecs: Record<string, string | number | boolean> =
    type === 'MONITOR'
      ? {
          sizeInches: Number(
            name.match(/(\d+)\s*(?:pulgadas|\")?/i)?.[1] ?? 24,
          ),
          panelType: 'IPS',
        }
      : {};
  const mergedSpecs = { ...monitorSpecs, ...technicalSpecs };
  if (
    type === 'MONITOR' &&
    mergedSpecs.refreshRate === undefined &&
    mergedSpecs.refreshHz !== undefined
  ) {
    mergedSpecs.refreshRate = mergedSpecs.refreshHz;
  }
  if (type === 'KEYBOARD' && mergedSpecs.mechanical === undefined) {
    mergedSpecs.mechanical = features.some((feature) =>
      /mecánico/i.test(feature),
    );
  }
  if (type === 'MOUSE' && mergedSpecs.wireless === undefined) {
    mergedSpecs.wireless = features.some((feature) =>
      /inalámbrico/i.test(feature),
    );
  }
  if (type === 'HEADSET' && mergedSpecs.microphone === undefined) {
    mergedSpecs.microphone = features.some((feature) =>
      /micrófono/i.test(feature),
    );
  }
  return {
    name,
    slug,
    type,
    price,
    stock: 8,
    active: true,
    imageUrl: imageForProductType(type),
    description: descriptionForPeripheral(name, type, features, mergedSpecs),
    features,
    technicalSpecs: mergedSpecs,
  };
};

export const PRODUCT_SEEDS: ProductSeed[] = [
  pc(
    'Nova Spark S1',
    'nova-spark-s1',
    2490000,
    8,
    'Intel Core i3-12100F',
    'Radeon RX 6600',
    16,
    512,
    8,
    58,
    59,
    53,
    66,
    '/products/pc-cyan.svg',
  ),
  pc(
    'Nova Pulse P2',
    'nova-pulse-p2',
    2790000,
    6,
    'AMD Ryzen 5 5500',
    'GeForce RTX 3050',
    16,
    512,
    8,
    61,
    55,
    57,
    68,
    '/products/pc-violet.svg',
  ),
  pc(
    'Nova Vector V3',
    'nova-vector-v3',
    2990000,
    9,
    'AMD Ryzen 5 5600',
    'Radeon RX 7600',
    16,
    1000,
    8,
    66,
    72,
    62,
    72,
    '/products/pc-orange.svg',
  ),
  pc(
    'Nova Core C3',
    'nova-core-c3',
    3190000,
    5,
    'Intel Core i5-12400F',
    'GeForce RTX 3060 12 GB',
    16,
    1000,
    12,
    68,
    69,
    66,
    70,
    '/products/pc-cyan.svg',
  ),
  pc(
    'Nova Arena A4',
    'nova-arena-a4',
    3490000,
    12,
    'AMD Ryzen 5 5600X',
    'GeForce RTX 4060',
    16,
    1000,
    8,
    69,
    77,
    68,
    73,
    '/products/pc-violet.svg',
  ),
  pc(
    'Nova Strike S4',
    'nova-strike-s4',
    3690000,
    4,
    'Intel Core i5-13400F',
    'Radeon RX 7600 XT',
    32,
    1000,
    16,
    75,
    79,
    76,
    75,
    '/products/pc-orange.svg',
  ),
  pc(
    'Nova Flux F5',
    'nova-flux-f5',
    3890000,
    7,
    'AMD Ryzen 5 7600',
    'GeForce RTX 4060',
    32,
    1000,
    8,
    77,
    77,
    77,
    88,
    '/products/pc-cyan.svg',
  ),
  pc(
    'Nova Rift R5',
    'nova-rift-r5',
    4190000,
    5,
    'Intel Core i5-14400F',
    'GeForce RTX 4060 Ti 8 GB',
    32,
    1000,
    8,
    78,
    84,
    80,
    78,
    '/products/pc-violet.svg',
  ),
  pc(
    'Nova Forge F6',
    'nova-forge-f6',
    4490000,
    6,
    'AMD Ryzen 7 7700',
    'Radeon RX 7700 XT',
    32,
    1000,
    12,
    84,
    87,
    85,
    90,
    '/products/pc-orange.svg',
  ),
  pc(
    'Nova Shadow S6',
    'nova-shadow-s6',
    4790000,
    3,
    'Intel Core i5-14600KF',
    'GeForce RTX 4060 Ti 16 GB',
    32,
    2000,
    16,
    86,
    85,
    87,
    82,
    '/products/pc-cyan.svg',
  ),
  pc(
    'Nova Horizon H7',
    'nova-horizon-h7',
    5190000,
    7,
    'AMD Ryzen 7 7700',
    'GeForce RTX 4070',
    32,
    2000,
    12,
    84,
    91,
    88,
    91,
    '/products/pc-violet.svg',
  ),
  pc(
    'Nova Creator K7',
    'nova-creator-k7',
    5590000,
    4,
    'Intel Core i7-13700',
    'GeForce RTX 4070',
    64,
    2000,
    12,
    91,
    91,
    94,
    78,
    '/products/pc-orange.svg',
  ),
  pc(
    'Nova Eclipse E8',
    'nova-eclipse-e8',
    5990000,
    5,
    'AMD Ryzen 7 7800X3D',
    'Radeon RX 7800 XT',
    32,
    2000,
    16,
    91,
    92,
    90,
    89,
    '/products/pc-cyan.svg',
  ),
  pc(
    'Nova Studio S8',
    'nova-studio-s8',
    6490000,
    2,
    'AMD Ryzen 9 7900',
    'GeForce RTX 4070 Super',
    64,
    2000,
    12,
    94,
    94,
    97,
    91,
    '/products/pc-violet.svg',
  ),
  pc(
    'Nova Zenith Z9',
    'nova-zenith-z9',
    6990000,
    3,
    'Intel Core i7-14700KF',
    'GeForce RTX 4070 Ti Super',
    64,
    2000,
    16,
    96,
    97,
    98,
    84,
    '/products/pc-orange.svg',
  ),
  pc(
    'Nova Titan T9',
    'nova-titan-t9',
    7790000,
    2,
    'AMD Ryzen 9 7950X',
    'GeForce RTX 4080 Super',
    64,
    4000,
    16,
    100,
    100,
    100,
    92,
    '/products/pc-cyan.svg',
  ),
  pc(
    'Nova Compact Q4',
    'nova-compact-q4',
    3590000,
    4,
    'AMD Ryzen 5 7600',
    'Radeon RX 7600',
    32,
    1000,
    8,
    77,
    72,
    75,
    62,
    '/products/pc-violet.svg',
  ),
  pc(
    'Nova Work W6',
    'nova-work-w6',
    4690000,
    5,
    'AMD Ryzen 9 5900X',
    'GeForce RTX 3060 12 GB',
    64,
    2000,
    12,
    90,
    69,
    92,
    70,
    '/products/pc-orange.svg',
  ),

  component(
    'Intel Core i3-12100F',
    'intel-core-i3-12100f',
    'CPU',
    399000,
    15,
    58,
  ),
  component('AMD Ryzen 5 5500', 'amd-ryzen-5-5500', 'CPU', 419000, 18, 61),
  component('AMD Ryzen 5 5600', 'amd-ryzen-5-5600', 'CPU', 529000, 12, 66),
  component('AMD Ryzen 5 5600G', 'amd-ryzen-5-5600g', 'CPU', 499000, 14, 64),
  component(
    'Intel Core i5-12400F',
    'intel-core-i5-12400f',
    'CPU',
    649000,
    11,
    68,
  ),
  component('AMD Ryzen 5 7600', 'amd-ryzen-5-7600', 'CPU', 849000, 9, 77),
  component(
    'Intel Core i5-14400F',
    'intel-core-i5-14400f',
    'CPU',
    999000,
    8,
    78,
  ),
  component('AMD Ryzen 7 7700', 'amd-ryzen-7-7700', 'CPU', 1299000, 6, 84),
  component(
    'Intel Core i5-14600KF',
    'intel-core-i5-14600kf',
    'CPU',
    1399000,
    5,
    86,
  ),
  component(
    'AMD Ryzen 7 7800X3D',
    'amd-ryzen-7-7800x3d',
    'CPU',
    1799000,
    4,
    91,
  ),
  component('AMD Ryzen 9 7950X', 'amd-ryzen-9-7950x', 'CPU', 2399000, 3, 100),

  component('Radeon RX 6600 8 GB', 'radeon-rx-6600', 'GPU', 899000, 8, 59),
  component('GeForce RTX 3050 8 GB', 'geforce-rtx-3050', 'GPU', 999000, 7, 55),
  component(
    'GeForce RTX 3060 12 GB',
    'geforce-rtx-3060',
    'GPU',
    1299000,
    6,
    69,
  ),
  component('Radeon RX 7600 8 GB', 'radeon-rx-7600', 'GPU', 1399000, 10, 72),
  component('GeForce RTX 4060 8 GB', 'geforce-rtx-4060', 'GPU', 1599000, 9, 77),
  component(
    'Radeon RX 7600 XT 16 GB',
    'radeon-rx-7600-xt',
    'GPU',
    1799000,
    5,
    79,
  ),
  component(
    'GeForce RTX 4060 Ti 8 GB',
    'geforce-rtx-4060-ti',
    'GPU',
    2099000,
    7,
    84,
  ),
  component(
    'Radeon RX 7700 XT 12 GB',
    'radeon-rx-7700-xt',
    'GPU',
    2299000,
    5,
    87,
  ),
  component(
    'GeForce RTX 4070 12 GB',
    'geforce-rtx-4070',
    'GPU',
    2799000,
    4,
    91,
  ),
  component(
    'Radeon RX 7800 XT 16 GB',
    'radeon-rx-7800-xt',
    'GPU',
    2899000,
    4,
    92,
  ),
  component(
    'GeForce RTX 4070 Super 12 GB',
    'geforce-rtx-4070-super',
    'GPU',
    3299000,
    3,
    94,
  ),
  component(
    'GeForce RTX 4080 Super 16 GB',
    'geforce-rtx-4080-super',
    'GPU',
    5199000,
    2,
    100,
  ),

  component('Memoria DDR4 16 GB 3200', 'ram-ddr4-16-3200', 'RAM', 189000, 25),
  component('Memoria DDR4 32 GB 3200', 'ram-ddr4-32-3200', 'RAM', 339000, 19),
  component('Memoria DDR5 32 GB 6000', 'ram-ddr5-32-6000', 'RAM', 489000, 14),
  component('Memoria DDR5 64 GB 6000', 'ram-ddr5-64-6000', 'RAM', 899000, 7),
  component('Memoria DDR4 8 GB 3200', 'ram-ddr4-8-3200', 'RAM', 109000, 18),
  component('Memoria DDR4 64 GB 3200', 'ram-ddr4-64-3200', 'RAM', 599000, 9),
  component('Memoria DDR5 16 GB 5200', 'ram-ddr5-16-5200', 'RAM', 279000, 16),
  component('Memoria DDR5 32 GB 5200', 'ram-ddr5-32-5200', 'RAM', 449000, 13),
  component('Memoria DDR5 96 GB 6000', 'ram-ddr5-96-6000', 'RAM', 1299000, 5),
  component('SSD NVMe 1 TB', 'ssd-nvme-1tb', 'STORAGE', 289000, 21),
  component('SSD NVMe 2 TB', 'ssd-nvme-2tb', 'STORAGE', 499000, 12),
  component('SSD NVMe 500 GB', 'ssd-nvme-500gb', 'STORAGE', 179000, 20),
  component('SSD NVMe 4 TB', 'ssd-nvme-4tb', 'STORAGE', 899000, 6),
  component('SSD SATA 1 TB', 'ssd-sata-1tb', 'STORAGE', 239000, 14),
  component('SSD NVMe Gen4 1 TB', 'ssd-nvme-gen4-1tb', 'STORAGE', 359000, 15),
  component('SSD NVMe Gen4 2 TB', 'ssd-nvme-gen4-2tb', 'STORAGE', 599000, 10),
  component('Fuente 750 W 80+ Gold', 'psu-750w-gold', 'PSU', 419000, 11),
  component('Fuente 550 W 80+ Bronze', 'psu-550w-bronze', 'PSU', 249000, 14),
  component('Fuente 650 W 80+ Bronze', 'psu-650w-bronze', 'PSU', 299000, 16),
  component('Fuente 850 W 80+ Gold', 'psu-850w-gold', 'PSU', 579000, 8),
  component('Fuente 1000 W 80+ Gold', 'psu-1000w-gold', 'PSU', 749000, 5),
  component(
    'Fuente 1200 W 80+ Platinum',
    'psu-1200w-platinum',
    'PSU',
    1099000,
    3,
  ),
  component('Fuente 450 W 80+ Bronze', 'psu-450w-bronze', 'PSU', 199000, 15),
  component('Fuente 750 W 80+ Bronze', 'psu-750w-bronze', 'PSU', 359000, 12),
  component('Board B650 Wi-Fi', 'board-b650-wifi', 'MOTHERBOARD', 749000, 8),
  component(
    'Board B550 DDR4 Wi-Fi',
    'board-b550-ddr4-wifi',
    'MOTHERBOARD',
    599000,
    8,
  ),
  component('Board A520 DDR4', 'board-a520-ddr4', 'MOTHERBOARD', 399000, 12),
  component(
    'Board X670 DDR5 Wi-Fi',
    'board-x670-ddr5-wifi',
    'MOTHERBOARD',
    1199000,
    5,
  ),
  component(
    'Board B760 DDR5 Wi-Fi',
    'board-b760-ddr5-wifi',
    'MOTHERBOARD',
    799000,
    7,
  ),
  component(
    'Board Z790 DDR5 Creator',
    'board-z790-ddr5-creator',
    'MOTHERBOARD',
    1399000,
    4,
  ),
  component('Board H610 DDR4', 'board-h610-ddr4', 'MOTHERBOARD', 369000, 10),
  component('Chasis Nova Airflow', 'case-nova-airflow', 'CASE', 329000, 10),
  component('Chasis Nova Compact', 'case-nova-compact', 'CASE', 279000, 9),
  component('Chasis Nova Glass', 'case-nova-glass', 'CASE', 449000, 8),
  component('Chasis Nova Mesh XL', 'case-nova-mesh-xl', 'CASE', 529000, 6),
  component('Chasis Nova Silent', 'case-nova-silent', 'CASE', 399000, 7),
  component('Chasis Nova Studio', 'case-nova-studio', 'CASE', 649000, 4),
  component(
    'Refrigeración Nova Tower',
    'cooling-nova-tower',
    'COOLING',
    219000,
    12,
  ),
  component(
    'Refrigeración Nova Basic',
    'cooling-nova-basic',
    'COOLING',
    129000,
    14,
  ),
  component(
    'Refrigeración Nova Dual Fan',
    'cooling-nova-dual-fan',
    'COOLING',
    329000,
    10,
  ),
  component(
    'Refrigeración Nova Liquid 240',
    'cooling-nova-liquid-240',
    'COOLING',
    499000,
    7,
  ),
  component(
    'Refrigeración Nova Liquid 360',
    'cooling-nova-liquid-360',
    'COOLING',
    699000,
    4,
  ),
  peripheral(
    'Monitor Nova 24 FHD 240 Hz',
    'monitor-nova-24-240hz',
    'MONITOR',
    899000,
    ['24 pulgadas', '1080p', '240 Hz'],
    { refreshHz: 240, resolution: '1080p' },
  ),
  peripheral(
    'Monitor Nova 27 QHD 165 Hz',
    'monitor-nova-27-165hz',
    'MONITOR',
    1199000,
    ['27 pulgadas', '1440p', '165 Hz'],
    { refreshHz: 165, resolution: '1440p' },
  ),
  peripheral(
    'Monitor Nova 27 4K Creator',
    'monitor-nova-27-4k',
    'MONITOR',
    1699000,
    ['27 pulgadas', '4K', '60 Hz'],
    { refreshHz: 60, resolution: '4k' },
  ),
  peripheral(
    'Monitor Nova 32 QHD 180 Hz',
    'monitor-nova-32-180hz',
    'MONITOR',
    1499000,
    ['32 pulgadas', '1440p', '180 Hz'],
    { refreshHz: 180, resolution: '1440p' },
  ),
  peripheral(
    'Monitor Nova 27 FHD 144 Hz',
    'monitor-nova-27-144hz',
    'MONITOR',
    799000,
    ['27 pulgadas', '1080p', '144 Hz'],
    { refreshHz: 144, resolution: '1080p', panelType: 'IPS', sizeInches: 27 },
  ),
  peripheral(
    'Monitor Nova 24 QHD 165 Hz',
    'monitor-nova-24-qhd-165hz',
    'MONITOR',
    1099000,
    ['24 pulgadas', '1440p', '165 Hz'],
    { refreshHz: 165, resolution: '1440p', panelType: 'IPS', sizeInches: 24 },
  ),
  peripheral(
    'Teclado Nova Mech 60',
    'teclado-nova-mech-60',
    'KEYBOARD',
    249000,
    ['Mecánico', 'Formato 60%', 'RGB'],
    { layout: '60%' },
  ),
  peripheral(
    'Teclado Nova Mech TKL',
    'teclado-nova-mech-tkl',
    'KEYBOARD',
    329000,
    ['Mecánico', 'TKL', 'RGB'],
    { layout: 'TKL' },
  ),
  peripheral(
    'Teclado Nova Office',
    'teclado-nova-office',
    'KEYBOARD',
    129000,
    ['Membrana', 'Silencioso'],
    { layout: 'full' },
  ),
  peripheral(
    'Teclado Nova Creator',
    'teclado-nova-creator',
    'KEYBOARD',
    449000,
    ['Mecánico', 'Full size', 'USB-C'],
    { layout: 'full' },
  ),
  peripheral(
    'Teclado Nova Mech 75',
    'teclado-nova-mech-75',
    'KEYBOARD',
    369000,
    ['Mecánico', '75%', 'Switch lineal'],
    { layout: '75%', mechanical: true, switchType: 'lineal', size: '75%' },
  ),
  peripheral(
    'Teclado Nova Silent TKL',
    'teclado-nova-silent-tkl',
    'KEYBOARD',
    399000,
    ['Mecánico', 'TKL', 'Switch silencioso'],
    { layout: 'TKL', mechanical: true, switchType: 'silencioso', size: 'TKL' },
  ),
  peripheral(
    'Mouse Nova Swift 8K',
    'mouse-nova-swift-8k',
    'MOUSE',
    279000,
    ['8K polling', 'Sensor óptico', 'Ligero'],
    { dpi: 26000 },
  ),
  peripheral(
    'Mouse Nova Aim',
    'mouse-nova-aim',
    'MOUSE',
    189000,
    ['Sensor óptico', 'Ergonómico'],
    { dpi: 12000 },
  ),
  peripheral(
    'Mouse Nova Office',
    'mouse-nova-office',
    'MOUSE',
    79000,
    ['Inalámbrico', 'Silencioso'],
    { dpi: 2400 },
  ),
  peripheral(
    'Mouse Nova Pro Wireless',
    'mouse-nova-pro-wireless',
    'MOUSE',
    399000,
    ['Inalámbrico', 'Sensor óptico', 'RGB'],
    { dpi: 30000 },
  ),
  peripheral(
    'Mouse Nova Feather',
    'mouse-nova-feather',
    'MOUSE',
    299000,
    ['Inalámbrico', '62 gramos', 'Sensor óptico'],
    { wireless: true, weight: 62, sensorTier: 'alto' },
  ),
  peripheral(
    'Mouse Nova Mini',
    'mouse-nova-mini',
    'MOUSE',
    149000,
    ['Cableado', 'Ligero', 'Sensor óptico'],
    { wireless: false, weight: 58, sensorTier: 'medio' },
  ),
  peripheral(
    'Headset Nova Arena',
    'headset-nova-arena',
    'HEADSET',
    249000,
    ['7.1 virtual', 'Micrófono extraíble'],
    { wireless: false },
  ),
  peripheral(
    'Headset Nova Air',
    'headset-nova-air',
    'HEADSET',
    399000,
    ['Inalámbrico', 'Micrófono'],
    { wireless: true },
  ),
  peripheral(
    'Headset Nova Studio',
    'headset-nova-studio',
    'HEADSET',
    549000,
    ['Audio detallado', 'Micrófono'],
    { wireless: false },
  ),
  peripheral(
    'Headset Nova Lite',
    'headset-nova-lite',
    'HEADSET',
    159000,
    ['Estéreo', 'Micrófono flexible'],
    { wireless: false },
  ),
  peripheral(
    'Headset Nova Pro Wireless',
    'headset-nova-pro-wireless',
    'HEADSET',
    649000,
    ['Inalámbrico', 'Micrófono desmontable', '7.1'],
    { wireless: true, microphone: true },
  ),
];

const wl = (
  slug: string,
  name: string,
  type: string,
  weights: [number, number, number, number, number],
  requirements: [
    number,
    number,
    number,
    number,
    number,
    number,
    number,
    number,
  ],
  description: string,
): WorkloadSeed => ({
  slug,
  name,
  type,
  description,
  cpuWeight: weights[0],
  gpuWeight: weights[1],
  ramWeight: weights[2],
  storageWeight: weights[3],
  vramWeight: weights[4],
  minimumCpuScore: requirements[0],
  recommendedCpuScore: requirements[1],
  minimumGpuScore: requirements[2],
  recommendedGpuScore: requirements[3],
  minimumRamGb: requirements[4],
  recommendedRamGb: requirements[5],
  minimumVramGb: requirements[6],
  recommendedVramGb: requirements[7],
});

export const WORKLOAD_SEEDS: WorkloadSeed[] = [
  wl(
    'valorant',
    'Valorant',
    'GAME',
    [0.45, 0.35, 0.1, 0.05, 0.05],
    [45, 65, 40, 60, 8, 16, 4, 6],
    'Competitivo de altos FPS, sensible al procesador.',
  ),
  wl(
    'league-of-legends',
    'League of Legends',
    'GAME',
    [0.45, 0.3, 0.15, 0.05, 0.05],
    [35, 55, 30, 50, 8, 16, 2, 4],
    'MOBA ligero que prioriza estabilidad y CPU.',
  ),
  wl(
    'fortnite',
    'Fortnite',
    'GAME',
    [0.3, 0.48, 0.1, 0.04, 0.08],
    [45, 65, 45, 70, 8, 16, 4, 8],
    'Battle royale con carga gráfica variable.',
  ),
  wl(
    'warzone',
    'Call of Duty: Warzone',
    'GAME',
    [0.28, 0.48, 0.1, 0.04, 0.1],
    [55, 75, 58, 82, 16, 32, 6, 10],
    'Battle royale exigente en CPU, GPU y VRAM.',
  ),
  wl(
    'cyberpunk-2077',
    'Cyberpunk 2077',
    'GAME',
    [0.18, 0.55, 0.08, 0.04, 0.15],
    [55, 72, 60, 88, 16, 32, 6, 12],
    'Juego AAA con alta exigencia gráfica.',
  ),
  wl(
    'minecraft',
    'Minecraft',
    'GAME',
    [0.5, 0.25, 0.15, 0.05, 0.05],
    [38, 62, 30, 55, 8, 16, 2, 6],
    'Escala con CPU, memoria y mods.',
  ),
  wl(
    'gta-v',
    'Grand Theft Auto V',
    'GAME',
    [0.3, 0.45, 0.12, 0.05, 0.08],
    [42, 62, 42, 66, 8, 16, 4, 6],
    'Mundo abierto equilibrado entre CPU y GPU.',
  ),
  wl(
    'apex-legends',
    'Apex Legends',
    'GAME',
    [0.3, 0.48, 0.1, 0.04, 0.08],
    [48, 68, 48, 72, 8, 16, 4, 8],
    'Shooter competitivo para tasas de refresco altas.',
  ),
  wl(
    'blender',
    'Blender',
    'CREATIVE',
    [0.25, 0.42, 0.16, 0.05, 0.12],
    [55, 85, 55, 88, 16, 32, 6, 12],
    'Modelado, render y simulación 3D.',
  ),
  wl(
    'adobe-premiere',
    'Adobe Premiere Pro',
    'CREATIVE',
    [0.36, 0.25, 0.2, 0.12, 0.07],
    [55, 85, 45, 75, 16, 32, 4, 8],
    'Edición de video y exportación.',
  ),
  wl(
    'davinci-resolve',
    'DaVinci Resolve',
    'CREATIVE',
    [0.22, 0.38, 0.2, 0.08, 0.12],
    [55, 82, 55, 86, 16, 32, 6, 12],
    'Edición y color con alta aceleración de GPU.',
  ),
  wl(
    'autocad',
    'AutoCAD',
    'PROFESSIONAL',
    [0.45, 0.2, 0.2, 0.1, 0.05],
    [50, 75, 35, 60, 16, 32, 4, 6],
    'Diseño CAD principalmente sensible al CPU.',
  ),
  wl(
    'revit',
    'Autodesk Revit',
    'PROFESSIONAL',
    [0.42, 0.18, 0.27, 0.08, 0.05],
    [55, 82, 35, 62, 16, 32, 4, 6],
    'Modelado BIM intensivo en CPU y memoria.',
  ),
  wl(
    'solidworks',
    'SolidWorks',
    'PROFESSIONAL',
    [0.42, 0.25, 0.2, 0.08, 0.05],
    [55, 82, 45, 68, 16, 32, 4, 8],
    'CAD 3D y simulación de ingeniería.',
  ),
  wl(
    'ofimatica-basica',
    'Ofimática básica (Excel, Word y correo)',
    'PROFESSIONAL',
    [0.3, 0.03, 0.35, 0.25, 0.07],
    [30, 50, 10, 25, 8, 16, 1, 2],
    'Excel, Word, presentaciones, correo y navegación con varias pestañas.',
  ),
  wl(
    'unity',
    'Unity',
    'DEVELOPMENT',
    [0.3, 0.3, 0.23, 0.1, 0.07],
    [50, 78, 45, 72, 16, 32, 4, 8],
    'Desarrollo de juegos y compilación.',
  ),
  wl(
    'unreal-engine',
    'Unreal Engine',
    'DEVELOPMENT',
    [0.27, 0.35, 0.2, 0.08, 0.1],
    [58, 86, 58, 86, 16, 32, 6, 12],
    'Desarrollo 3D exigente y compilación de shaders.',
  ),
  wl(
    'programacion',
    'Programación / Visual Studio',
    'DEVELOPMENT',
    [0.43, 0.08, 0.32, 0.14, 0.03],
    [40, 72, 25, 45, 8, 32, 2, 4],
    'IDEs, compilación y multitarea.',
  ),
  wl(
    'docker',
    'Docker',
    'DEVELOPMENT',
    [0.36, 0.04, 0.44, 0.14, 0.02],
    [48, 78, 20, 35, 16, 32, 2, 4],
    'Contenedores y servicios locales simultáneos.',
  ),
  wl(
    'maquinas-virtuales',
    'Máquinas virtuales',
    'DEVELOPMENT',
    [0.36, 0.03, 0.48, 0.11, 0.02],
    [55, 85, 20, 35, 16, 64, 2, 4],
    'Virtualización intensiva en núcleos y memoria.',
  ),
  wl(
    'ia-local',
    'IA local',
    'AI',
    [0.18, 0.35, 0.18, 0.05, 0.24],
    [55, 85, 50, 90, 16, 64, 8, 16],
    'Ejecución local de modelos, sensible a GPU y VRAM.',
  ),
];
