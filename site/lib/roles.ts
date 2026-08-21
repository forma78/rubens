// Mirrors config/roles.json's judges/generators — hardcoded rather than
// imported, same reason brief-form.tsx hardcodes CANVAS_FORMATS instead of
// importing src/syndicate/canvas.js: Vercel's Root Directory is `site`, so
// nothing outside this folder is guaranteed to exist in the deployed build.
// If config/roles.json changes, this needs a matching edit by hand.
export type Judge = {
  id: string;
  name: string;
  color: string;
  vendor: string;
  /** the one model this judge actually answers on — config/roles.json */
  model: string;
};

export type Generator = {
  id: string;
  name: string;
  color: string;
  vendor: string;
};

// Six judges, two per vendor, each pinned to one model (config/roles.json,
// 2026-08-21). Listed in config order, which pairs them by vendor — the
// sidebar is meant to read as "two models per provider" at a glance.
export const JUDGES: Judge[] = [
  { id: "architect", name: "Ford", color: "#1a4fd0", vendor: "anthropic", model: "claude-opus-5" },
  { id: "gallerist", name: "Maeve", color: "#c2265a", vendor: "anthropic", model: "claude-sonnet-5" },
  { id: "old-master", name: "Arnold", color: "#7a5aa8", vendor: "xai", model: "grok-4.3" },
  { id: "colourist", name: "Hector", color: "#0d7f8f", vendor: "xai", model: "grok-4.5" },
  { id: "child", name: "Angela", color: "#1f8a5a", vendor: "openai", model: "gpt-5.6-luna" },
  { id: "inspector", name: "Stubbs", color: "#3d3f4c", vendor: "openai", model: "gpt-5.4" },
];

export const GENERATORS: Generator[] = [
  { id: "gen-tight", name: "Bernard", color: "#1c2a4a", vendor: "anthropic" },
  { id: "gen-loose", name: "Dolores", color: "#b8461c", vendor: "xai" },
  { id: "gen-quiet", name: "Akecheta", color: "#4a4238", vendor: "anthropic" },
  { id: "gen-colour", name: "Akane", color: "#c9902e", vendor: "xai" },
  { id: "gen-soften", name: "Clementine", color: "#d68aa8", vendor: "openai" },
  { id: "gen-grain", name: "Felix", color: "#6b5230", vendor: "openai" },
];

// The control group. 8 of every 32 proposals are made by mutate() alone —
// a seeded perturbation of the parent with no model in the loop at all
// (config/syndicate.json's proposalSplit.mechanical, and proposeRound's
// `source === 'mechanical'` branch). They are judged in the same tournament
// as everything else, which is the point: it is what the six generators
// have to beat. They carry no agent_id, so they used to render with an
// empty artist slot and the word "mechanical" and nothing said what they
// were. Acid yellow, dark text — it is not one of the cast.
export const SYSTEM = {
  id: "mechanical",
  name: "System",
  color: "#e1ff00",
  tag: "seeded mutation",
  detail: "control group",
};

const VENDOR_LABELS: Record<string, string> = {
  anthropic: "Anthropic",
  xai: "xAI",
  openai: "OpenAI",
  mechanical: "mechanical",
};

export function judgeById(id: string | null | undefined): Judge | undefined {
  return JUDGES.find((j) => j.id === id);
}

export function generatorById(id: string | null | undefined): Generator | undefined {
  return GENERATORS.find((g) => g.id === id);
}

export function vendorLabel(vendor: string | null | undefined): string {
  if (!vendor) return "—";
  return VENDOR_LABELS[vendor] ?? vendor;
}

export function initial(name: string): string {
  return name.charAt(0).toUpperCase();
}
