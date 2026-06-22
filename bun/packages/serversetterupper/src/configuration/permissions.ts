import { z } from "zod/mini";
import { PlayerSpecifier } from "./playerFiltering";

export const PlayerPermission = z.object({
  player: PlayerSpecifier,
  permissions: z.object({
    bypassMaximumPlayers: z.boolean(),
    vanillaPermissionLevel: z.optional(z.number()),
  }),
});
export type PlayerPermission = z.infer<typeof PlayerPermission>;
