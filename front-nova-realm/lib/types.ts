export type ProductType =
  | "PREBUILT_PC"
  | "CPU"
  | "GPU"
  | "RAM"
  | "MOTHERBOARD"
  | "STORAGE"
  | "PSU"
  | "CASE"
  | "COOLING"
  | "MONITOR"
  | "KEYBOARD"
  | "MOUSE"
  | "HEADSET";
export type PeripheralType = "MONITOR" | "KEYBOARD" | "MOUSE" | "HEADSET";
export type ShoppingIntent = "PREBUILT_PC" | "CUSTOM_PC" | "UPGRADE_PC" | "COMPONENT" | "PC_WITH_PERIPHERALS";
export type BuilderMode = "GUIDED" | "AUTO";
export interface BuilderFlow {
  mode: BuilderMode;
  currentStep: ProductType | "PERIPHERALS" | "ASSEMBLY" | "DONE";
  currentStepLabel: string;
  completedSteps: ProductType[];
  progress: number;
  totalSteps: number;
}

export interface Product {
  id: number;
  name: string;
  slug: string;
  description: string;
  price: number;
  stock: number;
  imageUrl: string;
  active: boolean;
  type: ProductType;
  cpu: string | null;
  gpu: string | null;
  ramGb: number | null;
  storageGb: number | null;
  vramGb: number | null;
  cpuScore: number | null;
  gpuScore: number | null;
  productivityScore: number | null;
  upgradeabilityScore: number | null;
  features: string[];
  technicalSpecs: Record<string, string | number | boolean>;
  createdAt: string;
  updatedAt: string;
}

export interface Workload {
  id: number;
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

export interface RecommendationFilters {
  budgetMax?: number;
  budgetPreferred?: number;
  resolution?: "1080p" | "1440p" | "4k";
  targetFps?: number;
  workloads: Array<{ slug: string; importance: number }>;
  preferences?: { futureUpgrade?: boolean };
}

export interface WorkloadScore {
  slug: string;
  workload: string;
  score: number;
  cpuFit: number;
  gpuFit: number;
  ramFit: number;
  vramFit: number;
  storageFit: number;
}

export interface Recommendation {
  category: "BEST_MATCH" | "BEST_VALUE" | "BUDGET_OPTION" | "PREMIUM_OPTION";
  categoryLabel: string;
  product: Product;
  fitScore: number;
  performanceFit: number;
  budgetFit: number;
  valueFit: number;
  upgradeabilityFit: number;
  workloadScores: WorkloadScore[];
  strengths: string[];
  weaknesses: string[];
}

export interface ChatResponse {
  message: string;
  needsMoreInformation: boolean;
  filters: RecommendationFilters | null;
  recommendations: Recommendation[];
  shoppingIntent?: ShoppingIntent;
  componentRecommendations?: Product[];
  componentType?: string;
  currentPc?: { cpu: string | null; gpu: string | null; ramGb: number | null };
  upgradeRecommendations?: Product[];
  peripheralRecommendations?: Product[];
  build?: BuildSummary;
  actions?: AssistantAction[];
  quickActions?: string[];
  warnings?: string[];
  upgradeAnalysis?: UpgradeAnalysis;
  flow?: BuilderFlow;
}

export interface BuildSummary {
  products: Product[];
  components: Product[];
  peripherals: Product[];
  subtotal: number;
  assembly: number;
  total: number;
  budgetRemaining: number | null;
  assemblyEnabled: boolean;
  warnings: string[];
  compatibilityIssues?: CompatibilityIssue[];
  compatible: boolean;
}

export interface CompatibilityIssue {
  code: string;
  severity: "INFO" | "WARNING" | "ERROR";
  message: string;
}

export interface AssistantAction {
  action: string;
  productId?: number;
  productSlug?: string;
  componentType?: ProductType;
  label?: string;
}

export interface UpgradeAnalysis {
  currentPc: { cpu: string | null; gpu: string | null; ramGb: number | null };
  goal: string;
  detectedScores: { cpu: number | null; gpu: number | null; ramGb: number | null };
  priority: ProductType;
  bestFirstUpgrade: Product | null;
  bestValue: Product | null;
  premium: Product | null;
  noNeedToChange: string;
  recommendations: Product[];
}
