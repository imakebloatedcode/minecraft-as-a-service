import { z } from "zod/mini";
import { ZodArrayGenerate } from "../downloading";

export const Uuidv4 = ZodArrayGenerate(16, () => z.number());
export type Uuidv4 = z.infer<typeof Uuidv4>;

export const PlayerSpecifier = z.object({
  uuid: Uuidv4,
  username: z.string(),
});
export type PlayerSpecifier = z.infer<typeof PlayerSpecifier>;

export const AllowlistOptions = z.object({ players: z.array(PlayerSpecifier) });
export type AllowlistOptions = z.infer<typeof AllowlistOptions>;

export const DisallowListOptions = z.object({
  players: z.array(PlayerSpecifier),
});
export type DisallowListOptions = z.infer<typeof DisallowListOptions>;

export const PlayerFiltering = z.object({
  /**
   * Players to allow. Undefined means all.
   */
  allow: z.optional(AllowlistOptions) /**
   * Players to not allow. Undefined means none
   */,
  disallow: z.optional(DisallowListOptions),
});
export type PlayerFiltering = z.infer<typeof PlayerFiltering>;
