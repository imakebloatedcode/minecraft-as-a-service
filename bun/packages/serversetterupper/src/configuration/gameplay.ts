import { z } from "zod/mini";

export const GamemodeConfiguration = z.object({
  defaultGamemode: z.string(),
  forced: z.boolean(),
});
export type GamemodeConfiguration = z.infer<typeof GamemodeConfiguration>;

export const SpawnConfig = z.object({
  spawnAnimals: z.boolean(),
  spawnMonsters: z.boolean(),
  spawnNpcs: z.boolean(),
});
export type SpawnConfig = z.infer<typeof SpawnConfig>;

export const Gameplay = z.object({
  gamemode: GamemodeConfiguration,
  spawning: SpawnConfig,
  difficulty: z.string(),
  hardcore: z.boolean(),
  keepInventory: z.boolean(),
  enablePvp: z.boolean(),
});
export type Gameplay = z.infer<typeof Gameplay>;
