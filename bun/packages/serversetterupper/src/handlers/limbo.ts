import type { RGB, TextComponent } from "../configuration/textComponent";
import type { GameServerConfiguration } from "../configuration/index";
import type { properties } from "../formats/index";
import { dumpStructure as propDumpStructure } from "../formats/properties";
import {
  formatChatComponent,
  hexColor,
  hexNum,
  pathJoin,
  stringifyByteArray,
  toKeyval,
} from "./_";
import type { Handler } from "./handlers";
import { formatWhitelistConfiguration } from "./vanilla";
import { dumpStructure as jsonDumpStructure } from "../formats/json";
import { proxySchemes } from "../support";
import type { ProxyScheme } from "../configuration/proxy";

export function formatConfiguration(
  configuration: GameServerConfiguration,
): properties.PropertiesType {
  const levelName = "world";
  return toKeyval({
    // Connections
    "max-players": configuration.connections.maximumPlayers,
    // Bind location
    "server-ip": configuration.bind.ip.address,
    "server-port": configuration.bind.port,
    // Proxy support
    "bungee-guard": configuration.proxyScheme
      ? configuration.proxyScheme.type === "bungeeguard"
      : false,
    bungeecord: configuration.proxyScheme
      ? configuration.proxyScheme.type === "bungeecord"
      : false,
    "velocity-modern": configuration.proxyScheme
      ? configuration.proxyScheme.type === "velocity"
      : false,
    "forwarding-secrets":
      configuration.proxyScheme &&
      proxySchemes.secure.includes(configuration.proxyScheme.type as any)
        ? (
            configuration.proxyScheme as ProxyScheme.SecuredProxyScheme
          ).secrets.join(";")
        : "",
    // World
    "level-name": levelName + ";" + pathJoin(configuration.world.data.path),
    "world-spawn":
      levelName +
      ";" +
      // Sadly, the spawnPoint is optional so we have to default to 0;0;0 because many servers default anyway
      (configuration.spawnPoint !== undefined
        ? configuration.spawnPoint.map((v) => v.toString()).join(";")
        : "0;0;0") +
      ";-90;0",
    // Gameplay
    "default-gamemode": configuration.gameplay.gamemode.defaultGamemode,
    // Messages
    motd: JSON.stringify(formatChatComponent(configuration.motd.segments)),
    "resource-pack-prompt": configuration.resourcePack
      ? JSON.stringify(
          formatChatComponent(configuration.resourcePack.promptMessage),
        )
      : "",
    // Resource pack
    "resource-pack": configuration.resourcePack
      ? configuration.resourcePack.source.url
      : "",
    "resource-pack-sha1":
      configuration.resourcePack && "hash" in configuration.resourcePack.source
        ? stringifyByteArray(configuration.resourcePack.source.hash.data)
        : "",
    "required-resource-pack": configuration.resourcePack
      ? configuration.resourcePack.required
      : false,
    // Filtering
    "enforce-whitelist": configuration.filtering.allow !== undefined,
    // Misc
    "allow-chat": true,
    "allow-flight": false,
    "tab-header": "",
    "tab-footer": "",
    "ticks-per-second": 5,
    version: "Limbo!",
    "view-distance": 6,
  });
}

export const LimboHandler: Handler<"game"> = {
  type: "game",
  items: [
    {
      handler: formatConfiguration,
      outputFormat: propDumpStructure,
      path: ["server.properties"],
    },
    {
      handler: formatWhitelistConfiguration,
      outputFormat: jsonDumpStructure,
      path: ["whitelist.json"],
    },
  ],
  handles: [
    // Connections
    ["connections", "maximumPlayers"],
    ["connections", "onlineMode", { handles: [false] }], // This server is always in offline mode
    // Bind location
    ["bind", "ip"],
    ["bind", "port"],
    // Proxy support
    [
      "proxyScheme",
      "type",
      { handles: ["bungeeguard", "bungeecord", "velocity"] },
    ],
    ["proxyScheme", "secrets"],
    ["acceptTransfers", { handles: [false] }],
    // World
    ["world", "data", "path"],
    ["world", "level"],
    ["world", "seed"],
    ["spawnPoint"],
    // Gameplay
    [
      "gameplay",
      "gamemode",
      "defaultGamemode",
      { handles: ["survival", "creative", "adventure", "spectator"] },
    ],
    ["gameplay", "gamemode", "forced", { handles: [false] }],
    // Gameplay - irrelevant options
    ["gameplay", "spawning", "spawnAnimals", { handles: [false] }],
    ["gameplay", "spawning", "spawnMonsters", { handles: [false] }],
    ["gameplay", "spawning", "spawnNpcs", { handles: [false] }],
    ["gameplay", "difficulty", { handles: ["normal"] }],
    // These are because all player data is deleted and each player gets their own world
    ["gameplay", "hardcore", { handles: [false] }],
    ["gameplay", "enablePvp", { handles: [false] }],
    ["gameplay", "keepInventory", { handles: [false] }],

    // Messages
    ["motd"],
    ["resourcePack", "promptMessage"],
    // Resource pack
    ["resourcePack", "required"],
    ["resourcePack", "source", "url"],
    ["resourcePack", "source", "hash"],
    // Filtering
    ["filtering", "allow", "players"],
    // Misc
    ["enableCommandBlock", { handles: [false] }],
    // Permissions
    ["permissions", "player"],
    [
      "permissions",
      "permissions",
      "bypassMaximumPlayers",
      { handles: [false] },
    ],
    // There might be a way to support this one, so TODO: support that
    ["permissions", "permissions", "vanillaPermissionLevel", { handles: [0] }],
  ],
};
