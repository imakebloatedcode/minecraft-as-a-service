// This is a universal (not specific to a single server) configuration format for minecraft servers. (does not support all minecraft servers)

import { z } from "zod/mini";
import { BindSpecifier } from "./bind";
import { Connections } from "./connections";
import { Gameplay } from "./gameplay";
import { ManagementConfig } from "./management";
import { Motd } from "./motd";
import { PlayerFiltering } from "./playerFiltering";
import { ProxyConfiguration, ProxyScheme } from "./proxy";
import { ResourcePackOptions } from "./resourcePacks";
import { WorldOptions } from "./world";
import { ZodArrayGenerate } from "../downloading";
import { PlayerPermission } from "./permissions";

export * as bind from "./bind";
export * as connections from "./connections";
export * as gameplay from "./gameplay";
export * as management from "./management";
export * as motd from "./motd";
export * as playerFiltering from "./playerFiltering";
export * as proxy from "./proxy";
export * as resourcePack from "./resourcePacks";
export * as textComponent from "./textComponent";
export * as world from "./world";

export const ServerConfigurationBase = z.object({
  bind: BindSpecifier,
  motd: Motd,
  management: z.optional(ManagementConfig),
  connections: Connections,
  acceptTransfers: z.boolean(),
  filtering: PlayerFiltering,
  permissions: z.array(PlayerPermission),
});

export type ServerConfigurationBase = z.infer<typeof ServerConfigurationBase>;

export const GameServerConfiguration = z.extend(ServerConfigurationBase, {
  resourcePack: z.optional(ResourcePackOptions),
  gameplay: Gameplay,
  proxyScheme: z.optional(ProxyScheme.ProxyScheme),
  world: WorldOptions,
  spawnPoint: z.optional(ZodArrayGenerate(3, () => z.number())),
  enableCommandBlock: z.boolean(),
});
export type GameServerConfiguration = z.infer<typeof GameServerConfiguration>;

export const ProxyServerConfiguration = z.extend(ServerConfigurationBase, {
  proxies: ProxyConfiguration,
  defaultServer: z.uuidv4(),
});
export type ProxyServerConfiguration = z.infer<typeof ProxyServerConfiguration>;
