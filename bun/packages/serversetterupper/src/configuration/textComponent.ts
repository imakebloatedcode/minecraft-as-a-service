import { z, type infer as zInfer } from "zod/mini";

export const RGB = z.object({
  red: z.number(),
  blue: z.number(),
  green: z.number(),
});
export type RGB = zInfer<typeof RGB>;

export const TextFormatting = z.object({
  color: RGB,
  bold: z.boolean(),
  italic: z.boolean(),
  obfuscated: z.boolean(),
  strikethrough: z.boolean(),
  underline: z.boolean(),
});
export type TextFormatting = zInfer<typeof TextFormatting>;

export const TextComponent = z.object({
  data: z.string(),
  formatting: TextFormatting,
});
export type TextComponent = zInfer<typeof TextComponent>;
