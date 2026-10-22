import type { ToolCall } from "@toonflow/tools-scaffold/runtime";

export type ToolFrameState = {
  tool: ToolCall;
  directory?: string;
  canvas?: { id: string; labels: Record<string, string> };
  appearance: { dark: boolean; fontSize: string; variables: Record<string, string>; locale?: typeof import("@toonflow/i18n/elementPlus").elementLocales.en };
};

export type ToolFrameRequest = { type: "request"; id: number; action: string; data?: unknown };
