export type ModelInfo = {
  id: string;
  label: string;
  provider: "local" | "anthropic" | "openai" | "google";
  providerLabel: string;
  context: string;
  inputPrice: string;   // per 1M tokens, "" = zdarma
  outputPrice: string;
  useCase: string;
  speed: 1 | 2 | 3 | 4 | 5;    // 1 = pomalý, 5 = rychlý
  quality: 1 | 2 | 3 | 4 | 5;
  czech: 1 | 2 | 3 | 4 | 5;
  note?: string;
};

export const CHAT_MODELS: ModelInfo[] = [
  // ─── Lokální ──────────────────────────────────────────────────────────────
  {
    id: "evo-executor",
    label: "qwen2.5:72b",
    provider: "local",
    providerLabel: "Ollama",
    context: "128k",
    inputPrice: "zdarma",
    outputPrice: "zdarma",
    useCase: "Výchozí lokální model — agenti, kód, analýzy",
    speed: 3,
    quality: 4,
    czech: 3,
  },
  {
    id: "evo-chat",
    label: "llama3.3:70b",
    provider: "local",
    providerLabel: "Ollama",
    context: "128k",
    inputPrice: "zdarma",
    outputPrice: "zdarma",
    useCase: "Konverzace, delší texty — nejlepší lokální čeština",
    speed: 3,
    quality: 4,
    czech: 4,
    note: "stahuje se",
  },
  {
    id: "evo-planner",
    label: "deepseek-r1:32b",
    provider: "local",
    providerLabel: "Ollama",
    context: "64k",
    inputPrice: "zdarma",
    outputPrice: "zdarma",
    useCase: "Reasoning, plánování, matematika — přemýšlí nahlas",
    speed: 2,
    quality: 4,
    czech: 3,
  },
  // ─── Anthropic ────────────────────────────────────────────────────────────
  {
    id: "claude-haiku",
    label: "Claude Haiku 4.5",
    provider: "anthropic",
    providerLabel: "Anthropic",
    context: "200k",
    inputPrice: "$0.80",
    outputPrice: "$4",
    useCase: "Rychlé odpovědi, shrnutí, klasifikace za nízkou cenu",
    speed: 5,
    quality: 4,
    czech: 4,
  },
  {
    id: "claude-sonnet",
    label: "Claude Sonnet 4.6",
    provider: "anthropic",
    providerLabel: "Anthropic",
    context: "200k",
    inputPrice: "$3",
    outputPrice: "$15",
    useCase: "Nejlepší poměr cena/výkon — výchozí pro cloud",
    speed: 4,
    quality: 5,
    czech: 5,
  },
  {
    id: "claude-opus",
    label: "Claude Opus 4.6",
    provider: "anthropic",
    providerLabel: "Anthropic",
    context: "200k",
    inputPrice: "$15",
    outputPrice: "$75",
    useCase: "Nejnáročnější úkoly, dlouhé dokumenty, hluboká analýza",
    speed: 3,
    quality: 5,
    czech: 5,
  },
  // ─── Google ───────────────────────────────────────────────────────────────
  {
    id: "gemini-2.0-flash",
    label: "Gemini 2.0 Flash",
    provider: "google",
    providerLabel: "Google",
    context: "1M",
    inputPrice: "$0.10",
    outputPrice: "$0.40",
    useCase: "Rychlý a levný — ideální pro delší kontexty",
    speed: 5,
    quality: 3,
    czech: 3,
  },
  {
    id: "gemini-2.5-pro",
    label: "Gemini 2.5 Pro",
    provider: "google",
    providerLabel: "Google",
    context: "1M",
    inputPrice: "$1.25",
    outputPrice: "$10",
    useCase: "Nejschopnější Gemini — obrovský kontext, multimodální",
    speed: 3,
    quality: 5,
    czech: 4,
  },
];

export const DEFAULT_MODEL_KEY = "evo-default-chat-model";
export const FALLBACK_MODEL = "evo-executor";

export function getDefaultModel(): string {
  if (typeof window === "undefined") return FALLBACK_MODEL;
  return localStorage.getItem(DEFAULT_MODEL_KEY) ?? FALLBACK_MODEL;
}

export function setDefaultModel(modelId: string): void {
  localStorage.setItem(DEFAULT_MODEL_KEY, modelId);
}

export function getModelInfo(id: string): ModelInfo | undefined {
  return CHAT_MODELS.find((m) => m.id === id);
}
