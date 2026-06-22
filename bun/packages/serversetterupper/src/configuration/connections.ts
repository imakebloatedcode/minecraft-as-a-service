import { z } from "zod/mini";

export const Connections = z.object({
  maximumPlayers: z.union([z.uint32(), z.literal(-1)]), // -1 for no limit
  onlineMode: z.boolean(),
});
export type Connections = z.infer<typeof Connections>;
