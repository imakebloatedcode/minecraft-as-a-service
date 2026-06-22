import { z } from "zod/mini";
import { File } from "../downloading";
import { BindSpecifier } from "./bind";

export const RconConfig = z.object({
  bind: BindSpecifier,
  password: z.string(),
});
export type RconConfig = z.infer<typeof RconConfig>;

export namespace JsonRPC {
  export const TlsConfig = z.object({
    keystore: File.UncheckedFile,
    keystorePassword: z.optional(z.string()),
  });
  export type TlsConfig = z.infer<typeof TlsConfig>;

  export const JsonRPCConfig = z.object({
    bind: BindSpecifier,
    secret: z.string(),
    tls: z.optional(TlsConfig),
  });
  export type JsonRPCConfig = z.infer<typeof JsonRPCConfig>;
}

export const ManagementConfig = z.object({
  rcon: z.optional(RconConfig),
  jsonRPC: z.optional(JsonRPC.JsonRPCConfig),
});
export type ManagementConfig = z.infer<typeof ManagementConfig>;
