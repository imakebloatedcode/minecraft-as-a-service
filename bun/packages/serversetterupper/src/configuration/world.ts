import { z } from "zod/mini";
import { File } from "../downloading";

export const BaseLevel = z.object({ type: z.string(), options: z.any() });
export type BaseLevel = z.infer<typeof BaseLevel>;

export const NormalLevel = z.extend(BaseLevel, {
  type: z.literal("minecraft:normal"),
  options: z.undefined(),
});
export type NormalLevel = z.infer<typeof NormalLevel>;

export const FlatLevel = z.extend(BaseLevel, {
  type: z.literal("minecraft:flat"),
  options: z.object({
    biome: z.string(),
    layers: z.array(z.object({ block: z.string(), height: z.number() })),
  }),
});
export type FlatLevel = z.infer<typeof FlatLevel>;

export const LargeBiomesLevel = z.extend(BaseLevel, {
  type: z.literal("minecraft:large_biomes"),
  options: z.undefined(),
});
export type LargeBiomesLevel = z.infer<typeof LargeBiomesLevel>;

export const AmplifiedLevel = z.extend(BaseLevel, {
  type: z.literal("minecraft:amplified"),
  options: z.undefined(),
});
export type AmplifiedLevel = z.infer<typeof AmplifiedLevel>;

export const SingleBiomeLevel = z.extend(BaseLevel, {
  type: z.literal("minecraft:single_biome_surface"),
  options: z.undefined(),
});
export type SingleBiomeLevel = z.infer<typeof SingleBiomeLevel>;

export const VanillaLevel = z.union([
  NormalLevel,
  FlatLevel,
  LargeBiomesLevel,
  AmplifiedLevel,
  SingleBiomeLevel,
]);
export type VanillaLevel = z.infer<typeof VanillaLevel>;

export const WorldOptions = z.object({
  data: File.UncheckedFile,
  seed: z.optional(z.string()),
  level: BaseLevel,
});
export type WorldOptions = z.infer<typeof WorldOptions>;
