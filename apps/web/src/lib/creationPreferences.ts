import { computed } from "vue";
import { settings } from "@/stores/settings";

export const audioFormats = ["mp3", "wav", "flac", "aac", "opus"];
export const creationPreferences = computed(() => {
  const value = settings.value.mediaCreationPreferences;
  const raw = value && typeof value === "object" ? value as Record<string, unknown> : {};
  return {
    imageCount: Number.isInteger(raw.imageCount) && Number(raw.imageCount) >= 1 && Number(raw.imageCount) <= 10 ? Number(raw.imageCount) : 1,
    voice: typeof raw.voice === "string" && raw.voice.trim() ? raw.voice.trim() : "alloy",
    format: typeof raw.format === "string" && audioFormats.includes(raw.format) ? raw.format : "mp3",
    speed: typeof raw.speed === "number" && raw.speed >= 0.25 && raw.speed <= 4 ? raw.speed : 1,
    streamImages: raw.streamImages === true,
    returnBase64: raw.returnBase64 === true,
    codexCli: raw.codexCli === true,
  };
});

/** 仅用于创建节点，读取旧画布与复制节点保留原参数。 */
export function newGenerationData(type: string) {
  const defaults = creationPreferences.value;
  if (type === "remote-imageNode" || type === "remote-imageGenerationNode") return { n: defaults.imageCount };
  if (type === "remote-audioNode" || type === "remote-audioGenerationNode") return { voice: defaults.voice, format: defaults.format, speed: defaults.speed };
  return {};
}
