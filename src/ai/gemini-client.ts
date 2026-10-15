// Shared Gemini client and model settings. Everything that talks to the LLM lives in src/ai/;
// nothing in this folder reads or writes the database.
import { GoogleGenAI, ThinkingLevel, type ThinkingConfig } from "@google/genai";

import { env } from "../config/env.js";

export const gemini = new GoogleGenAI({ apiKey: env.GEMINI_API_KEY });

export const GEMINI_MODEL = env.GEMINI_MODEL;

// Extraction needs little reasoning, and thinking adds latency. Gemini 2.x models take a token
// budget; 3.x models take a level instead.
export const thinkingConfig: ThinkingConfig = GEMINI_MODEL.startsWith("gemini-2")
  ? { thinkingBudget: 0 }
  : { thinkingLevel: ThinkingLevel.LOW };
