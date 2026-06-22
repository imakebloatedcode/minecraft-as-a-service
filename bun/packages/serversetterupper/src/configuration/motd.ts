import { z, type infer as zInfer } from "zod/mini";
import { TextComponent } from "./textComponent";

export const Motd = z.object({ segments: z.array(TextComponent) });
export type Motd = zInfer<typeof Motd>;
