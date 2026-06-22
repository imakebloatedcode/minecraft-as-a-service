import { z } from "zod/mini";
import { TextComponent } from "./textComponent";
import { Download } from "../downloading";

export const ResourcePackOptions = z.object({
  source: z.union([Download.UncheckedDownload, Download.Sha1CheckedDownload]),
  required: z.boolean(),
  promptMessage: z.array(TextComponent),
});
export type ResourcePackOptions = z.infer<typeof ResourcePackOptions>;
