import { MongoClient, type WithId } from "mongodb";
import * as dockerode from "dockerode";
import * as path from "node:path";
import { definitions as apiDefinitions } from "@mcman/api";
import { mkdir, writeFile } from "node:fs/promises";
import { dns, RedisClient, S3Client } from "bun";
import EventEmitter from "node:events";
import {
  encode as messagepackEncode,
  decode as messagepackDecode,
} from "msgpackr";
import * as cbase32 from "crockford-base32";
import { launchInfo, Lock, minecraftExtractBase } from "./launcher";
import { handlers, configuration } from "@mcman/serversetterupper/src/index";
import * as tar from "tar-fs";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { pipeline } from "node:stream/promises";
import * as zlib from "zlib";
import { docker } from "./docker";
import { rm } from "node:fs/promises";
import { copyFile } from "node:fs/promises";
import { PassThrough } from "node:stream";
import { FIFO } from "./fifo";
import { lookup } from "minecraftstatuspinger";

// Connection URL
const mongoUrl = process.env.DATABASE_URI ?? "mongodb://localhost:27017";
const redisUrl = process.env.REDIS_URI ?? "redis://localhost:6379";
const webUrl = process.env.WEB_URL ?? "http://127.0.0.1";
const publicS3Url =
  process.env.PUBLIC_S3_ENDPOINT ??
  process.env.PUBLIC_AWS_ENDPOINT ??
  process.env.S3_ENDPOINT ??
  process.env.AWS_ENDPOINT ??
  "http://localhost:9000";

const helperJarsDirectory =
  process.env.HELPER_JARS_DIRECTORY ?? "./java/helperJars";

// This is the the runner hostname, NOT the web server hostname
const serverHostname = process.env.SERVER_HOSTNAME ?? "127.0.0.1";
const dockerHostname = process.env.DOCKER_HOSTNAME ?? "127.0.0.1";

const mongoClient = new MongoClient(mongoUrl);
const redisClient = new RedisClient(redisUrl);
const s3Client = new S3Client();

// Database Name
const dbName = "minecraftManager";

const imageName = "docker.io/eclipse-temurin";
const minecraftPort = "25565/tcp";

const supportedJavaVersions = [25, 21, 17, 11, 8];

const debounceMap = new Map<string, NodeJS.Timeout>();
function debounceResource(
  id: string,
  callback: () => void,
  timeout: number = 5000,
) {
  if (debounceMap.has(id)) {
    clearTimeout(debounceMap.get(id)!);
  }
  debounceMap.set(id, setTimeout(callback, timeout));
}
function clearDebounce(id: string) {
  if (debounceMap.has(id)) {
    clearTimeout(debounceMap.get(id)!);
    debounceMap.delete(id);
  }
}

async function pullImage(image: string) {
  const imageDownload = await docker.pull(image);

  return new Promise((resolve, reject) => {
    docker.modem.followProgress(imageDownload, (err, output) => {
      if (err) return reject(err);
      resolve(output);
    });
  });
}

const littleEndian = false;

async function mainCode() {
  await mongoClient.connect();
  await redisClient.connect();
  console.log("Connected to databases");
  const redisSubClient = await redisClient.duplicate();
  {
    const messageListeners = new EventEmitter<{
      message: [Uint8Array];
      messageFrame: [Uint8Array];
    }>();
    redisSubClient.subscribe("proxyCommand", (message) => {
      const decoded = Uint8Array.fromBase64(message);
      messageListeners.emit("message", decoded);
      {
        const joinedFrame = new ArrayBuffer(4 + decoded.length);
        const frameView = new DataView(joinedFrame);
        const frameU8 = new Uint8Array(joinedFrame);
        frameView.setUint32(0, decoded.length, littleEndian);

        frameU8.set(decoded, 4);

        messageListeners.emit("messageFrame", frameU8);
      }
    });
    {
      const port = 61966;
      // We can't use a http server here because we need bidirectional communication. Also: framed binary protocols are fun!
      async function handleFrame(
        socket: Bun.Socket<unknown>,
        data: Uint8Array,
      ) {
        const decoded: apiDefinitions.JavaCommunicationTypes.Proxy.Response.Response =
          messagepackDecode(data);
        if (decoded.type === "playerConnection") {
          const key: apiDefinitions.RedisTypes.ServerStatus.Key = `serverStatus:${decoded.serverUuid}`;
          // WARNING: this can have a race condition with other handlers for the key, but this seems unavoidable.
          const redisValue = await redisClient.getBuffer(key);
          if (redisValue === null) {
            console.warn(
              `Proxy server said user connected to server ${decoded.serverUuid} which has no status`,
            );
          } else {
            const decodedRedis: apiDefinitions.RedisTypes.ServerStatus.Value =
              messagepackDecode(redisValue);
            decodedRedis.players.push({
              uuid: Array.from(
                Uint8Array.fromHex(decoded.userUuid.replaceAll("-", "")),
              ) as apiDefinitions.RedisTypes.ServerStatus.Value["players"][number]["uuid"],
              username: decoded.username,
            });
            const encodedRedis = messagepackEncode(decodedRedis);
            await redisClient.set(key, encodedRedis);
            await redisClient.publish(`mutate:${key}`, encodedRedis.toBase64());
          }
        } else if (decoded.type === "playerDisconnection") {
          const key: apiDefinitions.RedisTypes.ServerStatus.Key = `serverStatus:${decoded.serverUuid}`;
          // WARNING: this can have a race condition with other handlers for the key, but this seems unavoidable.
          const redisValue = await redisClient.getBuffer(key);
          if (redisValue === null) {
            console.warn(
              `Proxy server said user connected to server ${decoded.serverUuid} which has no status`,
            );
          } else {
            const decodedRedis: apiDefinitions.RedisTypes.ServerStatus.Value =
              messagepackDecode(redisValue);
            // We do this by uuid instead of username for safety
            // Also this is slow but this is good enough
            decodedRedis.players = decodedRedis.players.filter(
              (value) =>
                value.uuid.map((v) => v.toString(16)).join("") !==
                decoded.userUuid.replaceAll("-", ""),
            );
            const encodedRedis = messagepackEncode(decodedRedis);
            await redisClient.set(key, encodedRedis);
            await redisClient.publish(`mutate:${key}`, encodedRedis.toBase64());
          }
        } else {
          // @ts-ignore
          console.warn(`Unknown event type ${decoded.type}`);
        }
      }

      const server = Bun.listen<{
        fifo: FIFO;
        framing: { frameSize: number } | undefined;
        cleanup: () => void;
      }>({
        hostname: "0.0.0.0",
        port,

        socket: {
          open(socket) {
            const listener = (message: Uint8Array) => {
              socket.write(message);
            };
            messageListeners.on("messageFrame", listener);
            socket.data = {
              fifo: new FIFO(),
              framing: undefined,
              cleanup: () => {
                messageListeners.off("messageFrame", listener);
              },
            };
          },

          data(socket, chunk) {
            const state = socket.data;
            socket.data.fifo.write(chunk);

            while (true) {
              if (state.framing === undefined) {
                if (state.fifo.length >= 4) {
                  const data = state.fifo.read(4, false);
                  const view = new DataView(
                    data.buffer,
                    data.byteOffset,
                    data.byteLength,
                  );
                  state.framing = {
                    frameSize: view.getUint32(0, littleEndian),
                  };
                } else {
                  break;
                }
              } else {
                if (state.fifo.length >= state.framing.frameSize) {
                  const data = state.fifo.read(state.framing.frameSize);
                  state.framing = undefined;
                  // Full chunk is present
                  handleFrame(socket, data);
                } else {
                  break;
                }
              }
            }
          },

          close(socket) {
            socket.data.cleanup();
          },

          error(_, error) {
            console.error(error);
          },
        },
      });
    }
    // Expose to all interfaces for support for the docker compose setup
    const server = Bun.serve({
      routes: {
        "/_status": function (req) {
          return new Response("OK");
        },
        "/api/serverRoute/token": {
          async GET(req) {
            // Lifetime is in seconds, entropy is in bytes
            const tokenConfig = { lifetime: 5 * 60, entropy: 7 };
            const data = Object.fromEntries(
              new URL(req.url).searchParams.entries(),
            );

            const userUuid = data.uuid as string;

            // In bytes
            const tokenEncoded = cbase32.CrockfordBase32.encode(
              crypto.getRandomValues(Buffer.allocUnsafe(tokenConfig.entropy)),
            );
            const tokenLifetime = tokenConfig.lifetime;
            const expiresTime =
              BigInt(Date.now()) + BigInt(tokenLifetime * 1000);
            await redisClient.setex(
              "srt:" + tokenEncoded,
              tokenLifetime,
              messagepackEncode({
                issued: BigInt(Date.now()),
                expires: expiresTime,
                userUuid,
              }),
            );
            return new Response(
              messagepackEncode({
                loginUrl: `${webUrl}/serverAuth/lander?token=${encodeURIComponent(tokenEncoded)}`,
                timeout: expiresTime,
              }),
              { headers: { "Content-Type": "application/vnd.msgpack" } },
            );
          },
        },
      },

      fetch(req) {
        return new Response("Not Found", { status: 404 });
      },
      port: 80,
    });
  }
  {
    for (const version of supportedJavaVersions) {
      await pullImage(imageByVersion(version));
    }

    const db = mongoClient.db(dbName);

    // ServerConfigAll
    const serversCollection = db.collection("servers");

    const runningContainers = new Map<
      string,
      {
        container: dockerode.Container;
        tasks: Set<() => void>;
        cleanup: (destructive: boolean) => Promise<void>;
      }
    >();
    function taskWrap(
      callback: () => void | Promise<void>,
      intervalSeconds: number,
    ) {
      let i = 0;
      return () => {
        i = (i + 1) % intervalSeconds;
        if (i === 0) {
          callback();
        }
      };
    }

    const tempDir = process.env.DATA_TEMPDIR ?? tmpdir();

    /**
     * Set a server's state to suspended in the db
     * @param serverId The server id
     * @param suspended If the server is suspended
     * @returns If the operation succeeded
     */
    async function setServerSuspendedDb(
      serverId: apiDefinitions.ManagementTypes.ServerUUID,
      suspended: boolean,
    ): Promise<boolean> {
      return (
        (
          await serversCollection.updateOne(
            {
              "information.id": serverId,
            },
            {
              $set: {
                "information.suspended": suspended,
              },
            },
          )
        ).matchedCount !== 0
      );
    }
    async function createContainer(
      item: apiDefinitions.DatabaseTypes.ServerEntry,
    ) {
      if (!item.configuration.enabled) {
        throw new Error("Can not create a disabled container");
      }
      console.log(`Starting minecraft server id ${item.information.id}`);
      const launchInformation = await launchInfo(
        item.configuration.version,
        async (inPath, copyToTemporaryDirectory) => {
          const versionName = "1.0.0";
          const temporaryDir = await mkdtemp(path.join(tempDir, "build-"));

          const inDirectory = path.join(temporaryDir, "in");
          await mkdir(inDirectory);
          const putJarPath = path.join(inDirectory, versionName + ".jar");
          const outputJarPath = path.join(
            temporaryDir,
            "out",
            versionName + ".jar",
          );

          await copyFile(inPath, putJarPath);

          const mntHelperJars = "/helperJars";

          try {
            const container = await docker.createContainer({
              Image: imageByVersion(25),
              HostConfig: {
                Mounts: [
                  {
                    Type: "bind",
                    Source: temporaryDir,
                    Target: "/data",
                    ReadOnly: false,
                  },
                  {
                    Type: "bind",
                    Source: helperJarsDirectory,
                    Target: mntHelperJars,
                    ReadOnly: false,
                  },
                ],
                AutoRemove: true,
              },
              // TODO: fancy jvm flags
              Cmd: [
                "java",
                "-jar",
                path.join(mntHelperJars, "VanillaCord.jar"),
                versionName,
              ],
              WorkingDir: "/data",
            });
            await container.start();

            const logStream = await container.logs({
              follow: true,
              stdout: true,
              stderr: true,
              timestamps: false,
            });

            // pipe directly to terminal stdout
            container.modem.demuxStream(
              logStream,
              process.stdout,
              process.stderr,
            );

            await container.wait();

            const newPath = path.join(copyToTemporaryDirectory, "patched.jar");
            await copyFile(outputJarPath, newPath);
            return newPath;
          } finally {
            await rm(temporaryDir, { force: true, recursive: true });
          }
        },
      );
      const s3Base = `servers/${item.information.id}`;

      const partialConfig = item.configuration.configuration;
      const fullConfig: configuration.GameServerConfiguration = {
        ...partialConfig,
        bind: { ip: { address: "0.0.0.0", version: 4 }, port: 25565 },
        connections: { ...partialConfig.connections, onlineMode: true },
        resourcePack: partialConfig.resourcePack
          ? {
              ...partialConfig.resourcePack,
              source: {
                url: s3Client.presign(
                  `${s3Base}/${apiDefinitions.BucketDefinitions.resourcePackName}`,
                  // Expires in 1 year
                  {
                    expiresIn: 365 * 24 * 60 * 60,
                    method: "GET",
                    endpoint: publicS3Url,
                  },
                ),
              },
            }
          : undefined,
        world: { ...partialConfig.world, data: { path: ["world"] } },
        acceptTransfers: false,
        filtering: {},
        proxyScheme: { type: "bungeecord" },
        permissions: [],
      };
      const generatedConfigurationFiles = new handlers.handlers.HandlerGroup([
        handlers.vanilla.BasicVanillaHandler,
        {
          handles: [
            [
              "proxyScheme",
              "type",
              { handles: ["bungeecord", "bungeeguard", "velocity"] },
            ],
            ["proxyScheme", "secrets"],
          ],
          type: "game",
          items: [
            {
              path: ["vanillacord.txt"],
              outputFormat: (data: Record<string, string[]>) => {
                return Object.entries(data)
                  .flatMap(([key, value]) => value.map((v) => `${key}=${v}`))
                  .join("\n");
              },
              handler: (data) => {
                return {
                  version: ["2.0"],
                  forwarding:
                    data.proxyScheme !== undefined
                      ? [data.proxyScheme.type]
                      : [""],
                  // NOT A TYPO, this is what vanillacord expects
                  seecret:
                    data.proxyScheme !== undefined &&
                    "secrets" in data.proxyScheme
                      ? data.proxyScheme.secrets
                      : [],
                };
              },
            },
          ],
        } as handlers.handlers.Handler<"game">,
      ]).handle(fullConfig);

      const serverId = item.information.id;

      const dataVolumeTmp = await mkdtemp(path.join(tempDir, "minecraft-"));

      const worldS3 = s3Client.file(
        `${s3Base}/${apiDefinitions.BucketDefinitions.worldName}`,
        { type: "application/zstd" },
      );
      if (await worldS3.exists()) {
        await pipeline(
          worldS3.stream(),
          new zlib.ZstdDecompress(),
          tar.extract(dataVolumeTmp),
        );
      }

      {
        // Write config to data volume
        for (const [
          pathSegments,
          fileContents,
        ] of generatedConfigurationFiles.entries()) {
          await writeFile(
            path.join(dataVolumeTmp, ...pathSegments),
            fileContents,
          );
        }
        // @ts-ignore
        const [{ address: serverIp }] = await dns.lookup(serverHostname);
        // @ts-ignore
        const [{ address: dockerIp }] = await dns.lookup(dockerHostname);

        const mountServerDownloadPathBase = "/minecraft";
        const container = await docker.createContainer({
          Image: imageByVersion(launchInformation.javaMajorVersion),
          HostConfig: {
            Mounts: [
              {
                Type: "bind",
                Source: dataVolumeTmp,
                Target: "/data",
                ReadOnly: false,
              },
              {
                Type: "bind",
                Source: minecraftExtractBase,
                Target: mountServerDownloadPathBase,
                ReadOnly: true,
              },
            ],
            AutoRemove: true,
            PublishAllPorts: true,
            ExtraHosts: ["runner:" + serverIp],
          },
          ExposedPorts: {
            [minecraftPort]: {},
          },

          // TODO: fancy jvm flags
          Cmd: [
            "java",
            "-classpath",
            launchInformation.classpath
              .map((value) =>
                path.join(mountServerDownloadPathBase, "assets", value),
              )
              .join(":"),
            launchInformation.mainClass,
            "--nogui",
          ],
          WorkingDir: "/data",
          Tty: true,
          AttachStdin: true,
          AttachStdout: true,
          AttachStderr: true,
          OpenStdin: true,
        });
        await container.start();
        const unsubscribeList: string[] = [];
        {
          const ttyMuxedStream = await container.attach({
            stream: true,
            stdout: true,
            stderr: true,
            stdin: true,
          });

          const terminalSize =
            apiDefinitions.ApiTypes.ServerManagement.ServerTty.TtyTypes
              .terminalSize;

          await container.resize({
            w: terminalSize.rows,
            h: terminalSize.rows,
          });

          const stdOutputsStream = new PassThrough();

          container.modem.demuxStream(
            ttyMuxedStream,
            stdOutputsStream,
            stdOutputsStream,
          );

          let history: Buffer[] = [];

          const inputStreamName: apiDefinitions.RedisTypes.RemoteTty.InputKey = `tty-i:${item.information.id}`;
          const outputStreamName: apiDefinitions.RedisTypes.RemoteTty.OutputKey = `tty-o:${item.information.id}`;
          const refs = new Set<number>();
          redisSubClient.subscribe(inputStreamName, (message) => {
            const controlMessage: apiDefinitions.RedisTypes.RemoteTty.RemoteTtyRequest =
              messagepackDecode(Uint8Array.fromBase64(message));
            if (controlMessage.type === "sub") {
              refs.add(controlMessage.id);
            } else if (controlMessage.type === "unsub") {
              refs.delete(controlMessage.id);
            } else if (controlMessage.type === "dmp") {
              const joinedHistory = Buffer.concat(history);
              history = [joinedHistory];
              const response: apiDefinitions.RedisTypes.RemoteTty.Dmp.Response =
                {
                  type: "dmp",
                  id: controlMessage.id,
                  history: joinedHistory,
                };
              redisClient.publish(
                outputStreamName,
                messagepackEncode(response).toBase64(),
              );
            } else if (controlMessage.type === "scnk") {
              ttyMuxedStream.write(controlMessage.data);
            } else {
              console.error(
                // @ts-ignore
                `Unknown control message type ${controlMessage.type} on control stream`,
              );
            }
          });
          unsubscribeList.push(inputStreamName);
          stdOutputsStream.on("data", (chunk) => {
            history.push(chunk);
            if (history.length > 80) {
              history = [Buffer.concat(history)];
            }
            if (refs.size > 0) {
              const message: apiDefinitions.RedisTypes.RemoteTty.ReceiveData.Response =
                { type: "gcnk", data: chunk };
              redisClient.publish(
                outputStreamName,
                messagepackEncode(message).toBase64(),
              );
            }
          });
        }
        const inspected = await container.inspect();
        const ports = inspected.NetworkSettings.Ports[minecraftPort];
        const saveLock = new Lock();
        async function save() {
          await saveLock.acquire();
          console.log(`Saving minecraft server id ${item.information.id}`);
          const write = worldS3.writer({
            partSize: 10 * 1024 * 1024, // 10MB parts
            queueSize: 4, // Upload 4 parts in parallel
            retry: 3, // Retry failed parts
          });
          await pipeline(
            tar.pack(dataVolumeTmp),
            new zlib.ZstdCompress(),
            async function (source) {
              for await (const chunk of source) {
                write.write(chunk);
              }
            },
          );
          await write.end();
          saveLock.release();
          console.log(`Saved minecraft server id ${item.information.id}`);
        }
        const serverStatus: apiDefinitions.RedisTypes.ServerStatus.Value = {
          ip: dockerIp,
          port: Number(ports![0]!.HostPort),
          players: [],
        };
        {
          const key: apiDefinitions.RedisTypes.ServerStatus.Key = `serverStatus:${serverId}`;
          await redisClient.set(key, messagepackEncode(serverStatus));

          {
            const debounceKey = `serverShutdown:${serverId}`;
            function handleZero() {
              debounceResource(
                debounceKey,
                async () => {
                  // Suspend server. There is no clean way of keeping the database/server status exactly aligned when this is happening, but oh well.
                  if (!setServerSuspendedDb(serverId, true)) {
                    console.warn(
                      "Failed to update the suspended property in the database. Cancelling suspend. (item not found)",
                    );
                  } else {
                    await stopContainer(serverId, false);
                  }
                },
                5 * 60 * 1000,
              );
            }
            // There are initially 0 players
            handleZero();
            // Watch player list
            unsubscribeList.push(`mutate:${key}`);
            redisSubClient.subscribe(`mutate:${key}`, (encodedData) => {
              const decoded: apiDefinitions.RedisTypes.ServerStatus.Value =
                messagepackDecode(Uint8Array.fromBase64(encodedData));
              const numPlayers = decoded.players.length;

              // Timeout is 5 minutes
              if (numPlayers === 0) {
                handleZero();
              } else {
                clearDebounce(debounceKey);
              }
            });
          }
        }
        // Tasks are run once every 5 s
        runningContainers.set(serverId, {
          container,
          tasks: new Set([taskWrap(save, 2 * 60)]),
          cleanup: async (destructive) => {
            for (const itemName of unsubscribeList) {
              try {
                await redisSubClient.unsubscribe(itemName);
              } catch (e) {
                console.error(e);
              }
            }
            console.log(`Stopping minecraft server id ${item.information.id}`);
            try {
              if (!destructive) {
                await save();
              }
            } finally {
              await rm(dataVolumeTmp, { recursive: true, force: true });
            }
            console.log(`Stopped minecraft server id ${item.information.id}`);
          },
        });
        return {
          healthcheck: async () => {
            try {
              await lookup({
                host: serverStatus.ip,
                port: serverStatus.port,
                timeout: 1000,
                protocolVersion: 769,
                throwOnParseError: false,
                SRVLookup: false,
                JSONParse: true,
              });

              return true;
            } catch {
              return false;
            }
          },
        };
      }
    }
    async function stopContainer(id: string, destructive: boolean = false) {
      if (runningContainers.has(id)) {
        console.log(`Stopping server id ${id}`);
        const container = runningContainers.get(id)!;
        runningContainers.delete(id);
        try {
          await container.container.stop();
          await container.cleanup(destructive);
        } catch (e) {
          console.warn(e);
        }
      }
    }
    for await (const _item of serversCollection.find({})) {
      const item = _item as WithId<apiDefinitions.DatabaseTypes.ServerEntry>;
      try {
        if (await setServerSuspendedDb(item.information.id, true)) {
          console.warn("Suspended server id " + item.information.id);
        } else {
          console.log("Failed to suspend server id " + item.information.id);
        }
      } catch (e) {
        console.error(e);
      }
    }
    const checkInterval = setInterval(() => {
      // Run callbacks
      for (const [, { tasks }] of runningContainers) {
        for (const task of tasks) {
          task();
        }
      }
    }, 1000);

    function respondTx(txid: number) {
      const message: apiDefinitions.RedisTypes.ConfirmedRpc.Output.Output = {
        txid,
      };
      return redisClient
        .publish(
          apiDefinitions.RedisTypes.ConfirmedRpc.Output.key,
          messagepackEncode(message).toBase64(),
        )
        .then(() => {});
    }
    {
      const key: apiDefinitions.RedisTypes.ServerRunControl.Key = "src-i";
      redisSubClient.subscribe(key, async (message) => {
        const decoded: apiDefinitions.RedisTypes.ServerRunControl.Value =
          messagepackDecode(Uint8Array.fromBase64(message));
        if (decoded.type === "start") {
          if (runningContainers.has(decoded.item.information.id)) {
            console.warn("Can not start a running server");
          } else {
            await setServerSuspendedDb(decoded.item.information.id, false);
            const result = await createContainer(decoded.item);
            while (!(await result.healthcheck())) {
              await new Promise((r) => setTimeout(r, 1000));
            }
          }
        } else if (decoded.type === "stop") {
          if (!runningContainers.has(decoded.item.information.id)) {
            console.warn("Can not stop a non-running server");
          } else {
            await stopContainer(
              decoded.item.information.id,
              decoded.destructive,
            );
          }
        }
        await respondTx(decoded.txid);
      });
    }
    return {
      terminate: async () => {
        clearInterval(checkInterval);
        await Promise.all(
          Array.from(runningContainers.keys()).map((id) =>
            stopContainer(id).catch(console.error),
          ),
        );
      },
    };
  }
}

function imageByVersion(version: number) {
  return imageName + ":" + version.toString() + "-jre";
}
const controller = mainCode();
process.addListener("SIGTERM", () => {
  controller.then((v) => v.terminate());
});
