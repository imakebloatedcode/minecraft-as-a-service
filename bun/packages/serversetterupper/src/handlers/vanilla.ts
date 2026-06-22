import type { GameServerConfiguration } from "../configuration/index";
import type { properties } from "../formats";
import {
  formatChatComponent,
  formatTextComponentVanilla,
  makeMinecraftDate,
  pathJoin,
  stringifyByteArray,
  stringifyUuid,
  toKeyval,
} from "./_";
import type { Handler } from "./handlers";
import { dumpStructure as propDumpStructure } from "../formats/properties";
import { dumpStructure as jsonDumpStructure } from "../formats/json";

/*
accepts-transfers=false
allow-flight=false
allow-nether=true
broadcast-console-to-ops=true
broadcast-rcon-to-ops=true
bug-report-link=
difficulty=easy
enable-code-of-conduct=false
enable-command-block=false
enable-jmx-monitoring=false
enable-query=false
enable-rcon=true
enable-status=true
enforce-secure-profile=true
enforce-whitelist=false
entity-broadcast-range-percentage=100
force-gamemode=false
function-permission-level=2
gamemode=survival
generate-structures=true
generator-settings={}
hardcore=false
hide-online-players=false
initial-disabled-packs=
initial-enabled-packs=vanilla
level-name=world
level-seed=
level-type=minecraft\:normal
log-ips=true
management-server-allowed-origins=
management-server-enabled=false
management-server-host=localhost
management-server-port=0
management-server-secret=S22R5xoeW3LLmIdAUNkalEnGobB0vnGa25IMGgDM
management-server-tls-enabled=true
management-server-tls-keystore=
management-server-tls-keystore-password=
max-chained-neighbor-updates=1000000
max-players=20
max-tick-time=60000
max-world-size=29999984
motd=Newer Server
network-compression-threshold=256
online-mode=false
op-permission-level=4
pause-when-empty-seconds=60
player-idle-timeout=0
prevent-proxy-connections=false
pvp=true
query.port=25565
rate-limit=0
rcon.password=31f90002c754746570646a5a
rcon.port=25575
region-file-compression=deflate
require-resource-pack=false
resource-pack=
resource-pack-id=
resource-pack-prompt=
resource-pack-sha1=
server-ip=
server-port=25565
simulation-distance=10
spawn-animals=true
spawn-monsters=true
spawn-npcs=true
spawn-protection=16
status-heartbeat-interval=0
sync-chunk-writes=true
text-filtering-config=
text-filtering-version=0
use-native-transport=true
view-distance=10
white-list=false
*/

/*
allow-flight=false
allow-nether=true
broadcast-console-to-ops=true
broadcast-rcon-to-ops=true
bug-report-link=
enable-code-of-conduct=false
enable-command-block=false
enable-jmx-monitoring=false
enable-query=false
enable-status=true
enforce-secure-profile=true
enforce-whitelist=false
entity-broadcast-range-percentage=100
function-permission-level=2
generate-structures=true
generator-settings={}
hardcore=false
hide-online-players=false
initial-disabled-packs=
initial-enabled-packs=vanilla
log-ips=true
max-chained-neighbor-updates=1000000
max-tick-time=60000
max-world-size=29999984
network-compression-threshold=256
op-permission-level=4
pause-when-empty-seconds=60
player-idle-timeout=0
prevent-proxy-connections=false
query.port=25565
rate-limit=0
region-file-compression=deflate
simulation-distance=10
spawn-protection=16
status-heartbeat-interval=0
sync-chunk-writes=true
text-filtering-config=
text-filtering-version=0
use-native-transport=true
view-distance=10
white-list=false
*/

export function formatConfiguration(
  configuration: GameServerConfiguration,
): properties.PropertiesType {
  // This mutation is a bad idea
  configuration.management ??= {};
  return toKeyval({
    // Connections
    "max-players": configuration.connections.maximumPlayers,
    "online-mode": configuration.connections.onlineMode,
    // Bind location
    "server-ip": configuration.bind.ip.address,
    "server-port": configuration.bind.port,
    // Proxy support
    "accept-transfers": configuration.acceptTransfers,
    // World
    "level-name": "world",
    "level-seed": configuration.world.seed || "",
    "level-type": configuration.world.level.type,
    "generate-structures": true,
    "generator-settings": JSON.stringify(
      configuration.world.level.options !== undefined
        ? configuration.world.level.options
        : {},
    ),
    // Management
    // Management - jsonRPC
    "management-server-allowed-origins": "",
    "management-server-enabled": configuration.management.jsonRPC !== undefined,
    /// We put in valid values if jsonRPC is not enabled because they will never be used, and minecraft might have issues with invalid values
    "management-server-host":
      configuration.management.jsonRPC !== undefined
        ? configuration.management.jsonRPC.bind.ip.address
        : "localhost",
    "management-server-port":
      configuration.management.jsonRPC !== undefined
        ? configuration.management.jsonRPC.bind.port
        : "0",
    "management-server-secret":
      configuration.management.jsonRPC !== undefined
        ? configuration.management.jsonRPC.secret
        : "",
    "management-server-tls-enabled":
      configuration.management.jsonRPC !== undefined
        ? configuration.management.jsonRPC.tls !== undefined
        : true,
    // Management - RCON
    "enable-rcon": configuration.management.rcon !== undefined,
    "rcon.port":
      configuration.management.rcon !== undefined
        ? configuration.management.rcon.bind.port
        : "",
    /// Here we use blank values if the option is not present
    "management-server-tls-keystore":
      configuration.management.jsonRPC !== undefined &&
      configuration.management.jsonRPC.tls !== undefined
        ? pathJoin(configuration.management.jsonRPC.tls.keystore.path)
        : "",
    "management-server-tls-keystore-password":
      configuration.management.jsonRPC !== undefined &&
      configuration.management.jsonRPC.tls !== undefined
        ? configuration.management.jsonRPC.tls.keystorePassword || ""
        : "",
    // Messages
    motd: formatTextComponentVanilla(configuration.motd.segments),
    "resource-pack-prompt":
      configuration.resourcePack !== undefined
        ? JSON.stringify(
            formatChatComponent(configuration.resourcePack.promptMessage),
          )
        : "{}",
    // Resource pack
    "resource-pack":
      configuration.resourcePack !== undefined
        ? configuration.resourcePack.source.url
        : "",
    "require-resource-pack":
      configuration.resourcePack !== undefined
        ? configuration.resourcePack.required
        : false,
    "resource-pack-id": "", // Optional
    "resource-pack-sha1":
      configuration.resourcePack !== undefined &&
      "hash" in configuration.resourcePack.source
        ? stringifyByteArray(configuration.resourcePack.source.hash.data)
        : "",
    // Gameplay
    // Gameplay - modes
    gamemode: configuration.gameplay.gamemode.defaultGamemode,
    "force-gamemode": configuration.gameplay.gamemode.forced,
    hardcore: configuration.gameplay.hardcore,
    difficulty: configuration.gameplay.difficulty,
    // Gameplay - spawning
    "spawn-animals": configuration.gameplay.spawning.spawnAnimals,
    "spawn-monsters": configuration.gameplay.spawning.spawnMonsters,
    "spawn-npcs": configuration.gameplay.spawning.spawnNpcs,
    // Gameplay - misc
    "enable-pvp": configuration.gameplay.enablePvp,
    // Transfers
    "accepts-transfers": configuration.acceptTransfers,
    // Filtering
    "white-list": configuration.filtering.allow !== undefined, // Requires configuring the whitelist json file in an additional handler
    "enforce-whitelist": configuration.filtering.allow !== undefined,
    // Misc
    "enable-command-block": configuration.enableCommandBlock,
    // Defaults / no configuration option for this property
    /// Good defaults
    "allow-flight": false,
    "allow-nether": true,
    "enable-query": false,
    "enable-status": true,
    "bug-report-link": "",
    "enable-jmx-monitoring": false,
    "enable-code-of-conduct": false,
    "entity-broadcast-range-percentage": 100,
    "initial-disabled-packs": "",
    "initial-enabled-packs": "vanilla",
    "hide-online-players": false,
    "query.port": 25565,
    "use-native-transport": true,
    "status-heartbeat-interval": 0, // Heartbeat for the jsonRPC management server

    /// Defaults that people might want to change
    /// Somewhat
    "view-distance": 10,
    "simulation-distance": 10,
    /// Maybe
    "broadcast-console-to-ops": true,
    "broadcast-rcon-to-ops": true,
    "enforce-secure-profile": true,
    "function-permission-level": 2,
    "log-ips": true,
    "max-chained-neighbor-updates": 1000000,
    "max-tick-time": 60000,
    "max-world-size": 29999984,
    "network-compression-threshold": 256,
    "op-permission-level": 4,
    "pause-when-empty-seconds": -1,
    "player-idle-timeout": 0,
    "prevent-proxy-connections": false,
    "rate-limit": 0,
    "region-file-compression": "deflate",
    "spawn-protection": 16,
    "sync-chunk-writes": true,
    "text-filtering-config": "",
    "text-filtering-version": 0,
  });
}

export function formatBanlistConfiguration(
  configuration: GameServerConfiguration,
): unknown {
  return configuration.filtering.disallow !== undefined
    ? configuration.filtering.disallow.players.map((value) => ({
        uuid: stringifyUuid(value.uuid),
        name: value.username,
        created: makeMinecraftDate(new Date()),
        source: "Server",
        expires: "forever",
      }))
    : [];
}

export function formatWhitelistConfiguration(
  configuration: GameServerConfiguration,
) {
  return configuration.filtering.allow !== undefined
    ? configuration.filtering.allow.players.map((value) => ({
        uuid: stringifyUuid(value.uuid),
        name: value.username,
      }))
    : [];
}

export function formatOpsJson(configuration: GameServerConfiguration) {
  return configuration.permissions.map((value) => ({
    uuid: stringifyUuid(value.player.uuid),
    name: value.player.username,
    level: value.permissions.vanillaPermissionLevel ?? 0,
    bypassesPlayerLimit: value.permissions.bypassMaximumPlayers,
  }));
}

export const BasicVanillaHandler: Handler<"game"> = {
  type: "game",
  items: [
    {
      handler: formatConfiguration,
      outputFormat: propDumpStructure,
      path: ["server.properties"],
    },
    {
      handler: () => ({ eula: "true" }),
      outputFormat: propDumpStructure,
      path: ["eula.txt"],
    },
  ],
  handles: [
    // Connections
    ["connections", "maximumPlayers"],
    ["connections", "onlineMode"],
    // Bind location
    ["bind", "ip"],
    ["bind", "port"],
    // Proxy support
    ["acceptTransfers"],
    // World
    ["world", "data", "path", { handles: [["world"]] }],
    ["world", "seed"],
    [
      "world",
      "level",
      "type",
      {
        handles: [
          "minecraft:normal",
          "minecraft:flat",
          "minecraft:large_biomes",
          "minecraft:amplified",
          "minecraft:single_biome_surface",
        ],
      },
    ],
    ["world", "level", "options"],
    // Management
    ["management", "jsonRPC"],
    ["management", "rcon"],
    // Messages
    ["motd"],
    ["resourcePack", "promptMessage"],
    // Resource pack
    ["resourcePack", "required"],
    ["resourcePack", "source", "url"],
    ["resourcePack", "source", "hash"],
    // Gameplay
    [
      "gameplay",
      "gamemode",
      "defaultGamemode",
      { handles: ["adventure", "spectator", "survival", "creative"] },
    ],
    ["gameplay", "gamemode", "forced"],
    ["gameplay", "hardcore"],
    [
      "gameplay",
      "difficulty",
      { handles: ["peaceful", "easy", "normal", "hard"] },
    ],
    // Gameplay - spawning
    ["gameplay", "spawning", "spawnAnimals"],
    ["gameplay", "spawning", "spawnMonsters"],
    ["gameplay", "spawning", "spawnNpcs"],
    // Gameplay - misc
    ["gameplay", "enablePvp"],
    ["gameplay", "keepInventory", { handles: [false] }],
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
    ["permissions", "permissions", "vanillaPermissionLevel", { handles: [0] }],
        // Filtering
    ["filtering", "allow", {"handles": [undefined]}],
    ["filtering", "disallow", {"handles": [undefined]}],
  ],
};
export const VanillaFilteringHandler: Handler<"game"> = {
  type: "game",
  items: [
    {
      handler: formatWhitelistConfiguration,
      outputFormat: jsonDumpStructure,
      path: ["whitelist.json"],
    },
    {
      handler: formatWhitelistConfiguration,
      outputFormat: jsonDumpStructure,
      path: ["banned-players.json"],
    },
  ],
  handles: [
    // Filtering
    ["filtering", "allow", "players"],
    ["filtering", "disallow", "players"],
  ],
};

export const VanillaPermissionsHandler: Handler<"game"> = {
  type: "game",
  items: [
    {
      handler: formatOpsJson,
      outputFormat: jsonDumpStructure,
      path: ["ops.json"],
    },
  ],
  handles: [
    // Permissions
    ["permissions", "player"],
    ["permissions", "permissions", "bypassMaximumPlayers"],
    ["permissions", "permissions", "vanillaPermissionLevel"],
  ],
};
