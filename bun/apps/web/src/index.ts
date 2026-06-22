import { RedisClient, S3Client, serve } from "bun";
import index from "./index.html";
import { definitions as apiDefinitions } from "@mcman/api";
import { MongoClient, type WithId, type Document, Binary } from "mongodb";
import * as jose from "jose";
import {
  encode as messagepackEncode,
  decode as messagepackDecode,
} from "msgpackr";
import EventEmitter from "node:events";

// Connection URL
const mongoUrl = process.env.DATABASE_URI ?? "mongodb://localhost:27017";
const redisUrl = process.env.REDIS_URI ?? "redis://localhost:6379";
const publicS3Url =
  process.env.PUBLIC_S3_ENDPOINT ??
  process.env.PUBLIC_AWS_ENDPOINT ??
  process.env.S3_ENDPOINT ??
  process.env.AWS_ENDPOINT ??
  "http://localhost:9000";

const mongoClient = new MongoClient(mongoUrl);
const redisClient = new RedisClient(redisUrl);
const s3Client = new S3Client({
  bucket: process.env.S3_BUCKET ?? process.env.AWS_BUCKET ?? "data",
  endpoint:
    process.env.S3_ENDPOINT ??
    process.env.AWS_ENDPOINT ??
    "http://localhost:9000",
});

// Database Name
const dbName = "minecraftManager";

const authAud = "site-authentication";
const refreshAud = "refresh-token";
const jwtAlg = "HS256";

declare function servePatched_INTERNAL<
  WebSocketData = undefined,
  R extends string = never,
>(
  options: Parameters<typeof serve<WebSocketData, R>>[0],
  _hack: WebSocketData,
): ReturnType<typeof serve<WebSocketData>>;

async function s3ClearPrefix(prefix: string) {
  const items = await s3Client.list({ prefix });
  if (items.contents) {
    const promises: Promise<void>[] = [];
    for (const item of items.contents) {
      promises.push(s3Client.delete(item.key));
    }
    await Promise.all(promises);
  }
}
function rng() {
  return crypto.getRandomValues(new Uint32Array(1))[0]!;
}
async function main() {
  await mongoClient.connect();
  await redisClient.connect();
  const redisSubClient = await redisClient.duplicate();
  console.log("Connected to databases");
  const db = mongoClient.db(dbName);

  const secrets = db.collection("secrets");
  let jwtKey = (await secrets.findOne())?.value as Uint8Array | undefined;
  if (jwtKey === undefined) {
    console.log("Generating new jwt key");
    jwtKey = crypto.getRandomValues(new Uint8Array(64));

    await secrets.insertOne({ value: jwtKey });
  }
  jwtKey = jwtKey!;
  if (jwtKey instanceof Binary) {
    jwtKey = jwtKey.buffer as Uint8Array;
  }
  // Redis helpers
  let waitResponseRpc: (txid: number) => Promise<void>;
  {
    const confirmEmitter = new EventEmitter<{ msg: [number] }>();
    await redisSubClient.subscribe(
      apiDefinitions.RedisTypes.ConfirmedRpc.Output.key,
      (message) => {
        const decoded: apiDefinitions.RedisTypes.ConfirmedRpc.Output.Output =
          messagepackDecode(Uint8Array.fromBase64(message));
        confirmEmitter.emit("msg", decoded.txid);
      },
    );
    waitResponseRpc = (txid) => {
      return new Promise((resolve) => {
        const listener = (gotTxid: number) => {
          if (txid === gotTxid) {
            confirmEmitter.removeListener("msg", listener);
            resolve();
          }
        };
        confirmEmitter.on("msg", listener);
      });
    };
  }
  async function getServerStatus(
    id: string,
  ): Promise<
    | { success: false; response: Response }
    | { success: true; data: apiDefinitions.RedisTypes.ServerStatus.Value }
  > {
    const serverKey: apiDefinitions.RedisTypes.ServerStatus.Key = `serverStatus:${id}`;
    const serverInfoResponse = await redisClient.getBuffer(serverKey);
    if (serverInfoResponse === null) {
      const response: apiDefinitions.ApiTypes.BaseTypes.FailedApiResponse = {
        errorMessage: apiDefinitions.ApiTypes.BaseTypes.ErrorMessages.unknownId,
      };
      return {
        success: false,
        response: Response.json(response, { status: 401 }),
      };
    }
    return {
      success: true,
      data: apiDefinitions.RedisTypes.ServerStatus.Value.parse(
        messagepackDecode(serverInfoResponse),
      ),
    };
  }
  // Mongodb helpers
  // {username: string}
  const usersCollection = db.collection("users");
  // ServerConfigAll
  const serversCollection = db.collection("servers");

  async function checkAuth<T extends boolean>(
    request: apiDefinitions.ApiTypes.BaseTypes.ApiRequest,
    mandatedAuth: T,
    aud = authAud,
  ): Promise<
    | { success: false; response: Response }
    | { success: true; data: jose.JWTVerifyResult<jose.JWTPayload> }
    | (T extends true ? never : { success: true; data: undefined })
  > {
    if (request.token) {
      let jwtData: jose.JWTVerifyResult<jose.JWTPayload>;
      try {
        jwtData = await jose.jwtVerify(request.token, jwtKey!, {
          audience: aud,
        });
      } catch (e) {
        return {
          success: false,
          response: Response.json(
            {
              errorMessage:
                apiDefinitions.ApiTypes.BaseTypes.ErrorMessages
                  .providedAuthInvalid,
            },
            { status: 401 }, // 401 because of invalid credentials
          ),
        };
      }
      // The jwt contents are trusted
      return { success: true, data: jwtData };
    } else {
      if (mandatedAuth) {
        return {
          success: false,
          response: Response.json(
            {
              errorMessage:
                apiDefinitions.ApiTypes.BaseTypes.ErrorMessages.requiresAuth,
            },
            { status: 401 }, // 401 because of missing credentials
          ),
        };
      } else {
        // @ts-ignore
        return { success: true, data: undefined };
      }
    }
  }

  async function serverDatabaseEntryToApiResponse(
    databaseEntry: WithId<apiDefinitions.DatabaseTypes.ServerEntry>,
  ): Promise<apiDefinitions.ManagementTypes.ServerInformation> {
    const serverStatus = await getServerStatus(databaseEntry.information.id);
    return {
      information: {
        ...databaseEntry.information,
        players: serverStatus.success ? serverStatus.data.players : [],
      }, // TODO: Fill out the players field
      configuration: databaseEntry.configuration,
    };
  }
  async function getServerById(
    id: string,
    username: string | undefined,
    mustOwn: boolean,
  ): Promise<
    | { success: false; response: Response }
    | {
        success: true;
        databaseEntry: WithId<apiDefinitions.DatabaseTypes.ServerEntry>;
      }
  > {
    const databaseEntry = (await serversCollection.findOne({
      "information.id": id,
    })) as WithId<apiDefinitions.DatabaseTypes.ServerEntry> | null;
    if (databaseEntry === null) {
      // The server id does not exist
      const response: apiDefinitions.ApiTypes.BaseTypes.FailedApiResponse = {
        errorMessage: apiDefinitions.ApiTypes.BaseTypes.ErrorMessages.unknownId,
      };
      return {
        success: false,
        response: Response.json(response, { status: 410 }),
      }; // 410 Gone because it is unlikely the exact same id as specified in the request will be created later
    } else {
      // Allow the query only if the server is public or the user owns the server
      if (
        (!mustOwn && databaseEntry.configuration.public) ||
        databaseEntry.information.owner === username
      ) {
        return { success: true, databaseEntry };
      } else {
        const response: apiDefinitions.ApiTypes.BaseTypes.FailedApiResponse = {
          errorMessage:
            apiDefinitions.ApiTypes.BaseTypes.ErrorMessages.unauthorized,
        };
        return {
          success: false,
          response: Response.json(
            response,
            { status: 403 }, // 403 because the user is forbidden to do that action
          ),
        };
      }
    }
  }

  async function getUserData(username: string): Promise<
    | { success: false; response: Response }
    | {
        success: true;
        databaseEntry: WithId<apiDefinitions.DatabaseTypes.UserEntry>;
      }
  > {
    const query = await usersCollection.findOne({ username });
    if (query === null) {
      const response: apiDefinitions.ApiTypes.BaseTypes.FailedApiResponse = {
        errorMessage: apiDefinitions.ApiTypes.BaseTypes.ErrorMessages.unknownId,
      };
      return {
        success: false,
        response: Response.json(response, { status: 401 }), // 401 Unauthorized because the user does not exist
      };
    } else {
      return {
        success: true,
        databaseEntry: query as WithId<apiDefinitions.DatabaseTypes.UserEntry>,
      };
    }
  }

  const textDecoder = new TextDecoder();
  const textEncoder = new TextEncoder();

  type WebsocketSetup =
    | {
        type: "fail";
        sendPreClose: (string | Uint8Array)[];
        closeStatus: number;
        closeReason: string;
      }
    | {
        type: "success";
        onOpen: (ws: Bun.ServerWebSocket<WebsocketSetup>) => void;
        onMessage: (
          ws: Bun.ServerWebSocket<WebsocketSetup>,
          msg: Uint8Array | string,
        ) => void;
        onClose: (
          ws: Bun.ServerWebSocket<WebsocketSetup>,
          code: number,
          reason: string,
        ) => void;
      };
  const server = (serve as typeof servePatched_INTERNAL)(
    {
      port: 80,
      websocket: {
        open: (ws) => {
          if (ws.data.type === "fail") {
            for (const item of ws.data.sendPreClose) {
              ws.send(item);
            }
            ws.close(ws.data.closeStatus);
          } else {
            ws.data.onOpen(ws);
          }
        },
        message: (ws, msg) => {
          if (ws.data.type === "success") {
            ws.data.onMessage(ws, msg as unknown as Uint8Array);
          }
        },
        close: (ws, code, reason) => {
          if (ws.data.type === "success") {
            ws.data.onClose(ws, code, reason);
          }
        },
      },
      routes: {
        // Serve index.html for all unmatched routes.
        "/*": index,

        "/_status": function (req) {
          return new Response("OK");
        },

        "/api/*": function (req) {
          const response: apiDefinitions.ApiTypes.BaseTypes.FailedApiResponse =
            {
              errorMessage: "Api endpoint not found",
            };
          return Response.json(response, { status: 404 });
        },
        // Proxy apis
        "/api/proxies/mcInfo/:username": {
          async GET(req) {
            const { username } = req.params;
            const lowerCaseUsername = username.toLowerCase();
            const dbData = await redisClient.getBuffer(
              `mc-u2uuid:${lowerCaseUsername}`,
            );
            if (dbData !== null) {
              const type = dbData[0];
              if (type === 1) {
                let offset = 1;
                const nameLength = dbData[offset++]!;
                const name = textDecoder.decode(
                  dbData.subarray(offset, (offset += nameLength)),
                );
                const uuid = dbData.subarray(offset /*offset += 16*/); // OPT: the uuid is the last element

                const res: apiDefinitions.ApiTypes.ProxyApis.McInfo.Response = {
                  username: name,
                  uuid: Array.from(
                    uuid,
                  ) as apiDefinitions.ApiTypes.ProxyApis.McInfo.Response["uuid"],
                };

                return Response.json(res);
              } else if (type === 0) {
                const res: apiDefinitions.ApiTypes.BaseTypes.FailedApiResponse =
                  {
                    errorMessage:
                      apiDefinitions.ApiTypes.BaseTypes.ErrorMessages.unknownId,
                  };
                return Response.json(res, {
                  status: 404,
                });
              } else {
                throw new Error(`Unknown type ${type}`);
              }
            } else {
              const mojangApiRequest = await fetch(
                `https://api.mojang.com/users/profiles/minecraft/${username}`,
              );
              if (mojangApiRequest.status === 200) {
                const responseJson = await mojangApiRequest.json();
                const rawUsername = responseJson.name;
                const encodedName = textEncoder.encode(rawUsername);
                const parsedUuid = Uint8Array.fromHex(responseJson.id);

                // (exists byte) + (username framing) + (username) + (uuidv4, which is a 16 byte value)
                const uuidOffset = 1 + 1 + encodedName.length;
                const outputUint8Array = new Uint8Array(uuidOffset + 16);
                outputUint8Array[0] = 1;
                outputUint8Array[1] = encodedName.length;
                outputUint8Array.set(encodedName, 2);
                outputUint8Array.set(parsedUuid, uuidOffset);
                // Don't await this as it is not critical for the response
                redisClient.setex(
                  `mc-u2uuid:${lowerCaseUsername}`,
                  37 * 24 * 60 * 60,
                  outputUint8Array,
                ); // Expire at the end of the username change grace period (so this will never stay after someone else has someone's old username)

                const res: apiDefinitions.ApiTypes.ProxyApis.McInfo.Response = {
                  username: rawUsername,
                  uuid: Array.from(
                    parsedUuid,
                  ) as apiDefinitions.ApiTypes.ProxyApis.McInfo.Response["uuid"],
                };

                return Response.json(res);
              } else if (mojangApiRequest.status === 404) {
                redisClient.setex(
                  `mc-u2uuid:${lowerCaseUsername}`,
                  24 * 60 * 60,
                  new Uint8Array([0]),
                ); // Expire in 1 day. This will break usernames that were first looked up then registered, but how likely is that.

                const res: apiDefinitions.ApiTypes.BaseTypes.FailedApiResponse =
                  {
                    errorMessage:
                      apiDefinitions.ApiTypes.BaseTypes.ErrorMessages.unknownId,
                  };
                return Response.json(res, {
                  status: 404,
                });
              } else {
                throw new Error(
                  `Unknown api status code ${mojangApiRequest.status}`,
                );
              }
            }
          },
        },
        // Search api endpoints
        "/api/query/servers": {
          async POST(req) {
            const data =
              apiDefinitions.ApiTypes.ServerManagement.ServerListQuery.Request.parse(
                await req.json(),
              );
            const checkedAuth = await checkAuth(data, false);
            if (!checkedAuth.success) {
              return checkedAuth.response;
            }
            const username = checkedAuth.data?.payload.username as string;
            const queries = [];
            if (data.owners !== undefined) {
              queries.push({
                "information.owner": { $in: data.owners },
                "configuration.public": true,
              });
            } else {
              queries.push({ "configuration.public": true });
            }
            if (username !== undefined) {
              queries.push({
                "information.owner": username,
                "configuration.public": false,
              });
            }
            const results = (await serversCollection
              .find({ $or: queries })
              .toArray()) as WithId<apiDefinitions.DatabaseTypes.ServerEntry>[];

            const response: apiDefinitions.ApiTypes.ServerManagement.ServerListQuery.Response =
              {
                servers: await Promise.all(
                  results.map((item) => serverDatabaseEntryToApiResponse(item)),
                ),
              };
            return Response.json(response);
          },
        },
        // Server management REST api
        "/api/server": {
          // Create a server
          async POST(req) {
            const data =
              apiDefinitions.ApiTypes.ServerManagement.ServerCreate.Request.parse(
                await req.json(),
              );
            // Check authentication
            const checkedAuth = await checkAuth(data, true);
            if (!checkedAuth.success) {
              return checkedAuth.response;
            }
            const username = checkedAuth.data?.payload.username as string;
            // Write to database
            const uuid = Bun.randomUUIDv7();
            const databaseEntry: apiDefinitions.DatabaseTypes.ServerEntry = {
              configuration: data.configuration,
              information: { id: uuid, owner: username, suspended: true },
            };
            await serversCollection.insertOne(databaseEntry);
            const response: apiDefinitions.ApiTypes.ServerManagement.ServerCreate.Response =
              {
                id: uuid,
              };
            return Response.json(response);
          },
        },
        "/api/server/:id": {
          // DELETE the server
          async DELETE(req) {
            const id = req.params.id;
            const data =
              apiDefinitions.ApiTypes.ServerManagement.ServerDelete.Request.parse(
                Object.fromEntries(new URL(req.url).searchParams.entries()),
              );
            // Check authentication
            const checkedAuth = await checkAuth(data, true);
            if (!checkedAuth.success) {
              return checkedAuth.response;
            }
            const username = checkedAuth.data.payload.username as string;
            const databaseQuery = await getServerById(id, username, true);
            if (!databaseQuery.success) {
              return databaseQuery.response;
            }
            const entry = databaseQuery.databaseEntry;
            {
              // Stop server
              const txid = rng();
              const message: apiDefinitions.RedisTypes.ServerRunControl.Value =
                { txid, item: entry, type: "stop", destructive: true };
              const key: apiDefinitions.RedisTypes.ServerRunControl.Key =
                "src-i";
              await redisClient.publish(
                key,
                messagepackEncode(message).toBase64(),
              );
              await waitResponseRpc(txid);
            }

            {
              // Delete s3 data
              await s3ClearPrefix(`servers/${id}`);
            }

            // Delete from database
            await serversCollection.deleteOne({ _id: entry._id });
            const response: apiDefinitions.ApiTypes.ServerManagement.ServerDelete.Response =
              {};
            return Response.json(response);
          },
        },
        "/api/server/:id/presign": {
          async POST(req) {
            const id = req.params.id;
            const data =
              apiDefinitions.ApiTypes.ServerManagement.ServerFilePresignRequest.Request.parse(
                await req.json(),
              );
            // Check authentication
            const checkedAuth = await checkAuth(data, true);
            if (!checkedAuth.success) {
              return checkedAuth.response;
            }
            const username = checkedAuth.data?.payload.username as string;

            // Query database
            const databaseQuery = await getServerById(id, username, true);
            if (!databaseQuery.success) {
              return databaseQuery.response;
            }

            const signedUrl = s3Client.presign(`servers/${id}/${data.name}`, {
              expiresIn: 24 * 60 * 60,
              method: data.type === "upload" ? "PUT" : "GET",
              contentEncoding: "mimeType" in data ? data.mimeType : undefined,
              endpoint: publicS3Url,
            }); // Expires in one day
            const response: apiDefinitions.ApiTypes.ServerManagement.ServerFilePresignRequest.Response =
              { url: signedUrl };
            return Response.json(response);
          },
        },
        // TTY api
        "/api/server/:id/tty": {
          GET: async (req, server) => {
            const { id } = req.params;
            const data =
              apiDefinitions.ApiTypes.ServerManagement.ServerTty.Request.parse(
                Object.fromEntries(new URL(req.url).searchParams.entries()),
              );
            // Check authentication
            const checkedAuth = await checkAuth(data, false);

            // Check server status
            const statusKey: apiDefinitions.RedisTypes.ServerStatus.Key = `serverStatus:${id}`;
            const serverStatus = await redisClient.getBuffer(statusKey);

            server.upgrade(req, {
              data: checkedAuth.success
                ? serverStatus !== null
                  ? (() => {
                      const inputKey: apiDefinitions.RedisTypes.RemoteTty.InputKey = `tty-i:${id}`;
                      const outputKey: apiDefinitions.RedisTypes.RemoteTty.OutputKey = `tty-o:${id}`;

                      const messagesEvents = new EventEmitter<{
                        data: [
                          apiDefinitions.RedisTypes.RemoteTty.RemoteTtyResponse,
                        ];
                      }>();
                      function onType<
                        T extends
                          apiDefinitions.RedisTypes.RemoteTty.RemoteTtyResponse["type"],
                      >(
                        type: T,
                        listener: (
                          data: Extract<
                            apiDefinitions.RedisTypes.RemoteTty.RemoteTtyResponse,
                            { type: T }
                          >,
                        ) => boolean,
                      ) {
                        const listenerWrapper = (
                          data: apiDefinitions.RedisTypes.RemoteTty.RemoteTtyResponse,
                        ) => {
                          if (data.type === type) {
                            if (
                              listener(
                                data as Extract<
                                  apiDefinitions.RedisTypes.RemoteTty.RemoteTtyResponse,
                                  { type: T }
                                >,
                              )
                            ) {
                              messagesEvents.off("data", listenerWrapper);
                            }
                          }
                        };
                        messagesEvents.on("data", listenerWrapper);
                      }
                      const subscriptionId = rng();
                      return {
                        type: "success",
                        onOpen: async (ws) => {
                          {
                            const id = rng();
                            onType("dmp", (data) => {
                              if (data.id === id) {
                                const sendMessage: apiDefinitions.ApiTypes.ServerManagement.ServerTty.Response =
                                  {};
                                ws.send(JSON.stringify(sendMessage));
                                ws.send(data.history);
                                return true;
                              } else {
                                return false;
                              }
                            });
                            const message: apiDefinitions.RedisTypes.RemoteTty.Dmp.Request =
                              { id, type: "dmp" };
                            await redisClient.publish(
                              inputKey,
                              messagepackEncode(message).toBase64(),
                            );
                          }
                          await redisSubClient.subscribe(
                            outputKey,
                            (message) => {
                              const decoded = messagepackDecode(
                                Uint8Array.fromBase64(message),
                              );
                              messagesEvents.emit("data", decoded);
                            },
                          );
                          {
                            const message: apiDefinitions.RedisTypes.RemoteTty.Sub.Request =
                              { type: "sub", id: subscriptionId };
                            await redisClient.publish(
                              inputKey,
                              messagepackEncode(message).toBase64(),
                            );
                          }
                          {
                            onType("gcnk", (data) => {
                              ws.send(data.data);
                              return false;
                            });
                          }
                        },
                        onMessage: async (ws, msg) => {
                          const u8Msg =
                            typeof msg === "string"
                              ? textEncoder.encode(msg)
                              : msg;
                          const message: apiDefinitions.RedisTypes.RemoteTty.SendData.Request =
                            { type: "scnk", data: u8Msg };
                          await redisClient.publish(
                            inputKey,
                            messagepackEncode(message).toBase64(),
                          );
                        },
                        onClose: async (ws, code) => {
                          try {
                            await redisSubClient.unsubscribe(outputKey);
                          } catch (e) {
                            console.error(e);
                          }
                          const message: apiDefinitions.RedisTypes.RemoteTty.UnSub.Request =
                            { type: "unsub", id: subscriptionId };
                          redisClient.publish(
                            inputKey,
                            messagepackEncode(message).toBase64(),
                          );
                        },
                      };
                    })()
                  : {
                      type: "fail",
                      sendPreClose: [
                        JSON.stringify({
                          errorMessage:
                            apiDefinitions.ApiTypes.BaseTypes.ErrorMessages
                              .unknownId,
                        } as apiDefinitions.ApiTypes.BaseTypes.FailedApiResponse),
                      ],
                      closeStatus: 1014,
                      closeReason: "Bad gateway",
                    }
                : {
                    type: "fail",
                    sendPreClose: [await checkedAuth.response.text()],
                    closeStatus: 1008,
                    closeReason: "Policy Violation",
                  },
            });
            return new Response();
          },
        },
        "/api/server/:id/config": {
          // GET the server configuration
          async GET(req) {
            const id = req.params.id;
            const data =
              apiDefinitions.ApiTypes.ServerManagement.ServerConfigQuery.Request.parse(
                Object.fromEntries(new URL(req.url).searchParams.entries()),
              );
            // Check authentication
            const checkedAuth = await checkAuth(data, false);
            if (!checkedAuth.success) {
              return checkedAuth.response;
            }
            const username = checkedAuth.data?.payload.username as string;
            // Query database
            const databaseQuery = await getServerById(id, username, false);
            if (!databaseQuery.success) {
              return databaseQuery.response;
            }

            const response: apiDefinitions.ApiTypes.ServerManagement.ServerConfigQuery.Response =
              {
                information: await serverDatabaseEntryToApiResponse(
                  databaseQuery.databaseEntry,
                ),
              };
            return Response.json(response);
          },
          // Set the server configuration
          async POST(req) {
            const id = req.params.id;
            const data =
              apiDefinitions.ApiTypes.ServerManagement.ServerConfig.Request.parse(
                await req.json(),
              );
            // Check authentication
            const checkedAuth = await checkAuth(data, true);
            if (!checkedAuth.success) {
              return checkedAuth.response;
            }
            const username = checkedAuth.data?.payload.username as string;

            // Query database
            const databaseQuery = await getServerById(id, username, true);
            if (!databaseQuery.success) {
              return databaseQuery.response;
            }

            const newDatabaseEntry: apiDefinitions.DatabaseTypes.ServerEntry = {
              configuration: data.configuration,
              information: databaseQuery.databaseEntry.information,
            };
            await serversCollection.findOneAndReplace(
              { _id: databaseQuery.databaseEntry._id },
              newDatabaseEntry,
            );
            // Restart server to apply new config
            if (!databaseQuery.databaseEntry.information.suspended) {
              (async () => {
                if (databaseQuery.databaseEntry.configuration.enabled) {
                  const key: apiDefinitions.RedisTypes.ServerRunControl.Key =
                    "src-i";
                  const txid = rng();
                  const message: apiDefinitions.RedisTypes.ServerRunControl.Value =
                    {
                      type: "stop",
                      item: newDatabaseEntry,
                      txid,
                      destructive: false,
                    };
                  await redisClient.publish(
                    key,
                    messagepackEncode(message).toBase64(),
                  );
                  await waitResponseRpc(txid);
                }
                if (newDatabaseEntry.configuration.enabled) {
                  const key: apiDefinitions.RedisTypes.ServerRunControl.Key =
                    "src-i";
                  const txid = rng();
                  const message: apiDefinitions.RedisTypes.ServerRunControl.Value =
                    {
                      type: "start",
                      item: newDatabaseEntry,
                      txid,
                      destructive: false,
                    };
                  await redisClient.publish(
                    key,
                    messagepackEncode(message).toBase64(),
                  );
                  await waitResponseRpc(txid);
                }
              })();
            }
            const response: apiDefinitions.ApiTypes.ServerManagement.ServerConfig.Response =
              {};
            return Response.json(response);
          },
        },
        // Users API
        "/api/account": {
          async POST(req) {
            const data = apiDefinitions.ApiTypes.Account.Create.Request.parse(
              await req.json(),
            );
            const { username, password } = data;
            const passwordHash = await Bun.password.hash(password);
            const userDatabaseEntry: apiDefinitions.DatabaseTypes.UserEntry = {
              username,
              passwordHash,
            };
            await usersCollection.insertOne(userDatabaseEntry);
            const response: apiDefinitions.ApiTypes.Account.Create.Response =
              {};
            return Response.json(response);
          },
        },
        "/api/account/:username/token": {
          async GET(req) {
            const username = req.params.username;
            const data = apiDefinitions.ApiTypes.Account.GetToken.Request.parse(
              Object.fromEntries(new URL(req.url).searchParams.entries()),
            );
            const databaseQuery = await getUserData(username);
            if (!databaseQuery.success) {
              return databaseQuery.response;
            }
            const passwordValid = await Bun.password.verify(
              data.password,
              databaseQuery.databaseEntry.passwordHash,
            );
            if (!passwordValid) {
              const response: apiDefinitions.ApiTypes.BaseTypes.FailedApiResponse =
                {
                  errorMessage:
                    apiDefinitions.ApiTypes.BaseTypes.ErrorMessages
                      .providedAuthInvalid,
                };
              return Response.json(response, { status: 401 });
            }
            const tokenPayload = { aud: authAud, username };
            const response: apiDefinitions.ApiTypes.Account.GetToken.Response =
              {
                token: await new jose.SignJWT(tokenPayload)
                  .setIssuedAt()
                  .setExpirationTime("24h")
                  .setProtectedHeader({ alg: jwtAlg })
                  .sign(jwtKey),
                refreshToken: await new jose.SignJWT({
                  aud: refreshAud,
                  createPayload: tokenPayload,
                })
                  .setIssuedAt()
                  .setExpirationTime("7d")
                  .setProtectedHeader({ alg: jwtAlg })
                  .sign(jwtKey),
              };
            return Response.json(response);
          },
        },
        "/api/account/:username": {
          async DELETE(req) {
            const username = req.params.username;
            const data = apiDefinitions.ApiTypes.Account.Delete.Request.parse(
              Object.fromEntries(new URL(req.url).searchParams.entries()),
            );
            const databaseQuery = await getUserData(username);
            if (!databaseQuery.success) {
              return databaseQuery.response;
            }
            const passwordValid = await Bun.password.verify(
              data.password,
              databaseQuery.databaseEntry.passwordHash,
            );
            if (!passwordValid) {
              const response: apiDefinitions.ApiTypes.BaseTypes.FailedApiResponse =
                {
                  errorMessage:
                    apiDefinitions.ApiTypes.BaseTypes.ErrorMessages
                      .providedAuthInvalid,
                };
              return Response.json(response, { status: 401 });
            }
            // Password is valid, so start purging user from the database
            // Delete all servers owned by user
            {
              const query = {
                information: { owner: username },
              };
              for await (const item of serversCollection.find(query)) {
                const itemCasted =
                  item as WithId<apiDefinitions.DatabaseTypes.ServerEntry>;
                await s3ClearPrefix(itemCasted.information.id);
              }
              await serversCollection.deleteMany(query);
            }
            // Delete user
            usersCollection.deleteOne({ _id: databaseQuery.databaseEntry._id });
            const response: apiDefinitions.ApiTypes.Account.Delete.Response =
              {};
            return Response.json(response);
          },
        },
        "/api/tokens/refresh": {
          async GET(req) {
            const data =
              apiDefinitions.ApiTypes.Tokens.RefreshToken.Request.parse(
                Object.fromEntries(new URL(req.url).searchParams.entries()),
              );

            const refreshTokenData = await checkAuth(data, true, refreshAud);
            if (!refreshTokenData.success) {
              return refreshTokenData.response;
            }
            const tokenPayload = refreshTokenData.data.payload
              .createPayload as jose.JWTPayload;
            const response: apiDefinitions.ApiTypes.Account.GetToken.Response =
              {
                token: await new jose.SignJWT(tokenPayload)
                  .setIssuedAt()
                  .setExpirationTime("24h")
                  .setProtectedHeader({ alg: jwtAlg })
                  .sign(jwtKey),
                refreshToken: await new jose.SignJWT({
                  aud: refreshAud,
                  createPayload: tokenPayload,
                })
                  .setIssuedAt()
                  .setExpirationTime("7d")
                  .setProtectedHeader({ alg: jwtAlg })
                  .sign(jwtKey),
              };
            return Response.json(response);
          },
        },
        "/api/serverAuth/connect": {
          async POST(req) {
            const data =
              apiDefinitions.ApiTypes.ServerConnectionAuth.Connect.Request.parse(
                await req.json(),
              );
            // Check authentication
            const checkedAuth = await checkAuth(data, false);
            if (!checkedAuth.success) {
              return checkedAuth.response;
            }
            // Get the data of the "server switch token"
            let unpackedTokenInfo: apiDefinitions.RedisTypes.ServerConnectionAuthToken.Value;
            const connectionTokenKey: apiDefinitions.RedisTypes.ServerConnectionAuthToken.Key = `srt:${data.connectionToken}`;
            {
              const tokenInfo = await redisClient.getBuffer(connectionTokenKey);
              if (tokenInfo === null) {
                const response: apiDefinitions.ApiTypes.BaseTypes.FailedApiResponse =
                  {
                    errorMessage:
                      apiDefinitions.ApiTypes.BaseTypes.ErrorMessages.unknownId,
                  };
                return Response.json(response, { status: 410 });
              }
              unpackedTokenInfo =
                apiDefinitions.RedisTypes.ServerConnectionAuthToken.Value.parse(
                  messagepackDecode(tokenInfo),
                );
            }
            // Invalidate the token
            await redisClient.del(connectionTokenKey);

            // Get the server from the database
            {
              let databaseEntry: apiDefinitions.DatabaseTypes.ServerEntry;
              {
                const username = checkedAuth.data?.payload.username as
                  | string
                  | undefined;
                const databaseQuery = await getServerById(
                  data.id,
                  username,
                  false,
                );
                if (databaseQuery.success === false) {
                  const response: apiDefinitions.ApiTypes.BaseTypes.FailedApiResponse =
                    {
                      errorMessage:
                        apiDefinitions.ApiTypes.BaseTypes.ErrorMessages
                          .unknownId,
                    };
                  return Response.json(response);
                } else {
                  databaseEntry = databaseQuery.databaseEntry;
                  if (databaseQuery.databaseEntry.configuration.public) {
                    // Always let the user into a public server
                  } else if (
                    checkedAuth.data &&
                    databaseQuery.databaseEntry.information.owner ===
                      (checkedAuth.data.payload.username as string)
                  ) {
                    // The user owns the server
                  } else {
                    // The user does not own the server and the server is private
                    const response: apiDefinitions.ApiTypes.BaseTypes.FailedApiResponse =
                      {
                        errorMessage: data.token
                          ? apiDefinitions.ApiTypes.BaseTypes.ErrorMessages
                              .unauthorized
                          : apiDefinitions.ApiTypes.BaseTypes.ErrorMessages
                              .requiresAuth,
                      };
                    return Response.json(response);
                  }
                }
              }
              if (databaseEntry.information.suspended) {
                const key: apiDefinitions.RedisTypes.ServerRunControl.Key =
                  "src-i";
                const txid = rng();
                const body: apiDefinitions.RedisTypes.ServerRunControl.Value = {
                  type: "start",
                  item: databaseEntry,
                  txid,
                  destructive: false,
                };
                const finishPromise = waitResponseRpc(txid);
                await redisClient.publish(
                  key,
                  messagepackEncode(body).toBase64(),
                );
                await finishPromise;
              }
            }
            // Grab server info
            const serverInfoRes = await getServerStatus(data.id);
            if (!serverInfoRes.success) {
              return serverInfoRes.response;
            }
            // Send player to server
            const parsedServerInfo = serverInfoRes.data;
            {
              const command: apiDefinitions.JavaCommunicationTypes.Proxy.Request.Switch =
                {
                  type: "switch",
                  userUuid: unpackedTokenInfo.userUuid,
                  ip: parsedServerInfo.ip,
                  port: parsedServerInfo.port,
                  serverUuid: data.id,
                };
              await redisClient.publish(
                "proxyCommand",
                messagepackEncode(command).toBase64(),
              );
            }
            const responseBody: apiDefinitions.ApiTypes.ServerConnectionAuth.Connect.Response =
              {};
            return Response.json(responseBody);
          },
        },
      },
      // Token endpoints
      development: process.env.NODE_ENV !== "production" && {
        // Enable browser hot reloading in development
        hmr: true,

        // Echo console logs from the browser to the server
        console: true,
      },
    },
    undefined as unknown as WebsocketSetup,
  );
  console.log(`🚀 Server running at ${server.url}`);
}
main();
