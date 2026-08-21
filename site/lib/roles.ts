// Mirrors config/roles.json's judges/generators — hardcoded rather than
// imported, same reason brief-form.tsx hardcodes CANVAS_FORMATS instead of
// importing src/syndicate/canvas.js: Vercel's Root Directory is `site`, so
// nothing outside this folder is guaranteed to exist in the deployed build.
// If config/roles.json changes, this needs a matching edit by hand.
export type Judge = {
  id: string;
  name: string;
  color: string;
  rounds: number[];
};

export type Generator = {
  id: string;
  name: string;
  color: string;
  vendor: string;
};

export const JUDGES: Judge[] = [
  { id: "architect", name: "Ford", color: "#1a4fd0", rounds: [1, 2, 3, 4, 5] },
  { id: "old-master", name: "Arnold", color: "#7a5aa8", rounds: [3, 4, 5] },
  { id: "gallerist", name: "Maeve", color: "#c2265a", rounds: [1, 2, 3, 4, 5] },
  { id: "child", name: "Angela", color: "#1f8a5a", rounds: [4, 5] },
];

export const GENERATORS: Generator[] = [
  { id: "gen-tight", name: "Bernard", color: "#1c2a4a", vendor: "anthropic" },
  { id: "gen-loose", name: "Dolores", color: "#b8461c", vendor: "xai" },
  { id: "gen-quiet", name: "Akecheta", color: "#4a4238", vendor: "anthropic" },
  { id: "gen-colour", name: "Akane", color: "#c9902e", vendor: "xai" },
  { id: "gen-soften", name: "Clementine", color: "#d68aa8", vendor: "openai" },
  { id: "gen-grain", name: "Felix", color: "#6b5230", vendor: "openai" },
];

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
