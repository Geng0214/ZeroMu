/// <reference path="./types.d.ts" />

import deepSeek from "./src/language/deepSeek";
import apiMart from "./src/media/apiMart";
import meta from "./src/media/meta";
import windowsSpeech from "./src/media/windowsSpeech";

export type Provider = ProviderDefinition;
export type ProviderTools = ProviderContext["tool"];
export type AudioConvertOptions = Parameters<ProviderTools["audio"]["convert"]>[1];
export type { FfmpegFactory, FfmpegCommand } from "@toonflow/ffmpeg/types";

export const languageProviders = [deepSeek] as const;
export const mediaProviders = [apiMart, meta, windowsSpeech] as const;
