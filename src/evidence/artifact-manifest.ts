import type {
  ArtifactFileIdentity,
  ArtifactFileRole,
} from "./types.js";

const WEIGHT_EXTENSIONS = [
  ".safetensors",
  ".bin",
  ".pt",
  ".pth",
  ".ckpt",
  ".gguf",
];

const TOKENIZER_NAMES = new Set([
  "tokenizer.json",
  "tokenizer_config.json",
  "special_tokens_map.json",
  "vocab.json",
  "vocab.txt",
  "merges.txt",
  "spiece.model",
  "tokenizer.model",
]);

const CONFIG_NAMES = new Set([
  "config.json",
  "generation_config.json",
  "preprocessor_config.json",
  "processor_config.json",
]);

const LICENSE_NAMES = new Set([
  "license",
  "license.md",
  "license.txt",
  "copying",
  "copying.md",
  "copying.txt",
]);

export function classifyArtifactFile(path: string): ArtifactFileRole {
  const normalized = path.replaceAll("\\", "/");
  const lower = normalized.toLowerCase();
  const base = lower.split("/").at(-1) ?? lower;

  if (base === "readme.md") return "MODEL_CARD";
  if (LICENSE_NAMES.has(base)) return "LICENSE";
  if (CONFIG_NAMES.has(base)) return "CONFIG";
  if (TOKENIZER_NAMES.has(base)) return "TOKENIZER";

  if (
    lower.endsWith(".py") ||
    lower.startsWith("custom_generate/") ||
    lower.includes("/custom_generate/")
  ) {
    return "MODEL_CODE";
  }

  if (WEIGHT_EXTENSIONS.some((extension) => lower.endsWith(extension))) {
    return "WEIGHT";
  }

  return "OTHER";
}

export function relevantTextEvidencePath(path: string): boolean {
  const role = classifyArtifactFile(path);
  return (
    role === "MODEL_CARD" ||
    role === "LICENSE" ||
    role === "CONFIG" ||
    path.toLowerCase().endsWith("tokenizer_config.json")
  );
}

export function normalizeArtifactManifest(
  files: readonly ArtifactFileIdentity[],
): ArtifactFileIdentity[] {
  return [...files]
    .map((file) => ({
      ...file,
      path: file.path.replaceAll("\\", "/"),
    }))
    .sort((a, b) => a.path.localeCompare(b.path));
}
