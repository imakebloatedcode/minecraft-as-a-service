import { z } from "zod/mini";
import { configuration } from "@mcman/serversetterupper/src/index";

export type Expand<T> = { [K in keyof T]: T[K] };

export const ManagedServerParameters = {
  // These are configured internally
  bind: true,
  management: true,
  proxyScheme: true,
  resourcePack: { source: true },
  world: { data: true },
  // These conflict with or just won't effect the server setup
  connections: { onlineMode: true },
  acceptTransfers: true, // This can be eventually allowed but would require some work (it would have to be via the proxy and a custom plugin)
  // These are configured in game
  permissions: true,
  filtering: true,
} as const;

type ManagedPropertiesRecord = {
  [K in string]: true | ManagedPropertiesRecord;
};

type RemoveZodObjectItemsRecursive<
  T extends z.ZodMiniObject,
  R extends ManagedPropertiesRecord,
> =
  T extends z.ZodMiniObject<infer Shape>
    ? z.ZodMiniObject<
        {
          [K in keyof Shape]: K extends keyof R
            ? R[K] extends ManagedPropertiesRecord
              ? Shape[K] extends z.ZodMiniObject
                ? RemoveZodObjectItemsRecursive<Shape[K], R[K]>
                : Shape[K] extends z.ZodMiniOptional<
                      infer I extends z.ZodMiniObject
                    >
                  ? z.ZodMiniOptional<RemoveZodObjectItemsRecursive<I, R[K]>>
                  : never // Type mismatch, but we can't throw an error for just so just give never
              : never
            : Shape[K];
        } extends infer Result
          ? // Hacky but works
            {
              [K2 in {
                [K in keyof Result]: Result[K] extends never ? never : K;
              }[keyof Result]]: Result[K2];
            }
          : never
      >
    : never;
export function removeZodObjectItemsRecursive<
  T extends z.ZodMiniObject,
  R extends ManagedPropertiesRecord,
>(object: T, record: R): RemoveZodObjectItemsRecursive<T, R> {
  const newShape: Record<string, unknown> = {};
  for (const [key, type] of Object.entries(object._zod.def.shape)) {
    if (key in record) {
      const recordItem = record[key]!;
      if (recordItem === true) {
        // This means delete item
      } else {
        const def = (type as z.ZodMiniType)._zod.def;
        if (def.type === "object") {
          newShape[key] = removeZodObjectItemsRecursive(
            type as z.ZodMiniObject,
            recordItem,
          );
        } else if (
          def.type === "optional" &&
          (def as z.ZodMiniOptional["_zod"]["def"]).innerType._zod.def.type ===
            "object"
        ) {
          const innerItem = (def as z.ZodMiniOptional["_zod"]["def"])
            .innerType as z.ZodMiniObject;
          newShape[key] = z.optional(
            removeZodObjectItemsRecursive(innerItem, recordItem),
          );
        } else {
          throw new Error(
            "Type mismatch: delete asks to delete children of a non-object",
          );
        }
      }
    } else {
      newShape[key] = type;
    }
  }
  return z.object(newShape) as RemoveZodObjectItemsRecursive<T, R>;
}

export const LegalServerOptions = removeZodObjectItemsRecursive(
  configuration.GameServerConfiguration,
  ManagedServerParameters,
);

export namespace BucketDefinitions {
  export const worldName = "world.tar.zst";
  export const resourcePackName = "resourcePack.zip";
}

// Types
export namespace ManagementTypes {
  export const serverUUID = z.uuidv7();
  export type ServerUUID = string;
  export const Player = configuration.playerFiltering.PlayerSpecifier;
  export type Player = z.infer<typeof Player>;

  export const ServerConfiguration = z.object({
    name: z.string(),

    configuration: LegalServerOptions,

    // Allow limbo server
    type: z.union([z.literal("vanilla"), z.literal("limbo")]),
    version: z.string(),
    public: z.boolean(),
    enabled: z.boolean(),
  });
  export type ServerConfiguration = z.infer<typeof ServerConfiguration>;
  export const ImmutableServerInformation = z.object({
    id: serverUUID,
    owner: z.string(),
  });
  export type ImmutableServerInformation = z.infer<
    typeof ImmutableServerInformation
  >;
  export const ReadonlyServerInformation = z.extend(
    ImmutableServerInformation,
    {
      players: z.array(Player),
    },
  );
  export type ReadonlyServerInformation = z.infer<
    typeof ReadonlyServerInformation
  >;
  export const ServerInformation = z.object({
    configuration: ServerConfiguration,
    information: ReadonlyServerInformation,
  });
  export type ServerInformation = z.infer<typeof ServerInformation>;
}
export namespace DatabaseTypes {
  export const ServerEntry = z.object({
    configuration: ManagementTypes.ServerConfiguration,
    information: z.extend(ManagementTypes.ImmutableServerInformation, {
      suspended: z.boolean(),
    }),
  });
  export type ServerEntry = z.infer<typeof ServerEntry>;
  export const UserEntry = z.object({
    username: z.string(),
    passwordHash: z.string(),
  });
  export type UserEntry = z.infer<typeof UserEntry>;
}
export namespace ApiTypes {
  export namespace BaseTypes {
    // /api/*
    // For requests where authorization is never needed
    export const UnauthorizedApiRequest = z.object({});
    export type UnauthorizedApiRequest = z.infer<typeof UnauthorizedApiRequest>;
    // For requests where authorization allows additional response content
    export const ApiRequest = z.extend(UnauthorizedApiRequest, {
      token: z.optional(z.jwt()),
    });
    export type ApiRequest = z.infer<typeof ApiRequest>;
    // For requests where authorization is required
    export const AuthorizedApiRequest = z.extend(ApiRequest, {
      token: z.jwt(),
    });
    export type AuthorizedApiRequest = z.infer<typeof AuthorizedApiRequest>;
    export enum ErrorMessages {
      // AUTHENTICATION
      // I.e invalid jwt
      "providedAuthInvalid" = "Authorization invalid",
      // I.e no jwt
      "requiresAuth" = "Authorization is required",
      // I.e user missing permissions
      "unauthorized" = "Authorization too narrow",
      // RESOURCE
      // I.e unknown server id
      "unknownId" = "Identified resource could not be found",
      "duplicateId" = "Resource already exists",
    }
    export const SuccessfulApiResponse = z.object({});
    export type SuccessfulApiResponse = z.infer<typeof SuccessfulApiResponse>;
    export const FailedApiResponse = z.object({ errorMessage: z.string() });
    export type FailedApiResponse = z.infer<typeof FailedApiResponse>;
  }
  // /api/proxies
  export namespace ProxyApis {
    export namespace McInfo {
      // GET /api/proxies/mcInfo/:username
      export const Request = z.extend(BaseTypes.UnauthorizedApiRequest, {
        username: z.string(),
      });
      export type Request = z.infer<typeof Request>;
      export const Response = z.extend(BaseTypes.SuccessfulApiResponse, {
        uuid: configuration.playerFiltering.Uuidv4,
        username: z.string(),
      });
      export type Response = z.infer<typeof Response>;
    }
  }
  // /api/server and /api/query/servers
  export namespace ServerManagement {
    // POST /api/query/servers
    export namespace ServerListQuery {
      export const Request = z.extend(BaseTypes.ApiRequest, {
        owners: z.optional(z.array(z.string())),
      });
      export type Request = z.infer<typeof Request>;
      export const Response = z.extend(BaseTypes.SuccessfulApiResponse, {
        servers: z.array(ManagementTypes.ServerInformation),
      });
      export type Response = z.infer<typeof Response>;
    }

    // POST /api/server
    export namespace ServerCreate {
      export const Request = z.extend(BaseTypes.AuthorizedApiRequest, {
        configuration: ManagementTypes.ServerConfiguration,
      });
      export type Request = z.infer<typeof Request>;
      export const Response = z.extend(BaseTypes.SuccessfulApiResponse, {
        id: ManagementTypes.serverUUID,
      });
      export type Response = z.infer<typeof Response>;
    }

    // GET /api/server/:id/config?token=...
    export namespace ServerConfigQuery {
      export const Request = z.extend(BaseTypes.ApiRequest, {});
      export type Request = z.infer<typeof Request>;
      export const Response = z.extend(BaseTypes.SuccessfulApiResponse, {
        information: ManagementTypes.ServerInformation,
      });
      export type Response = z.infer<typeof Response>;
    }

    // POST /api/server/:id/presign
    export namespace ServerFilePresignRequest {
      export const Request = z.union([
        z.extend(BaseTypes.AuthorizedApiRequest, {
          name: z.string(),
          mimeType: z.string(),
          type: z.literal("upload"),
        }),
        z.extend(BaseTypes.AuthorizedApiRequest, {
          name: z.string(),
          type: z.literal("download"),
        }),
      ]);
      export type Request = z.infer<typeof Request>;
      export const Response = z.extend(BaseTypes.SuccessfulApiResponse, {
        url: z.url(),
      });
      export type Response = z.infer<typeof Response>;
    }

    // GET /api/server/:id/tty
    export namespace ServerTty {
      export const Request = z.extend(BaseTypes.AuthorizedApiRequest, {});
      export type Request = z.infer<typeof Request>;

      export namespace TtyTypes {
        export const terminalSize = {
          cols: 80,
          rows: 24,
        };
      }
      // The response is a stream. This is the first message which establishes the previous state or an error if present. This is json encoded.
      export const Response = z.extend(BaseTypes.SuccessfulApiResponse, {});
      export type Response = z.infer<typeof Response>;
    }
    // POST /api/server/:id/config
    export namespace ServerConfig {
      export const Request = z.extend(BaseTypes.AuthorizedApiRequest, {
        configuration: ManagementTypes.ServerConfiguration,
      });
      export type Request = z.infer<typeof Request>;
      export const Response = z.extend(BaseTypes.SuccessfulApiResponse, {});
      export type Response = z.infer<typeof Response>;
    }

    // DELETE /api/server/:id?token=
    export namespace ServerDelete {
      export const Request = z.extend(BaseTypes.AuthorizedApiRequest, {});
      export type Request = z.infer<typeof Request>;
      export const Response = z.extend(BaseTypes.SuccessfulApiResponse, {});
      export type Response = z.infer<typeof Response>;
    }
  }
  export namespace Tokens {
    // GET /api/tokens/refresh?token=...
    export namespace RefreshToken {
      export const Request = z.extend(BaseTypes.AuthorizedApiRequest, {});
      export type Request = z.infer<typeof Request>;
      export const Response = z.extend(BaseTypes.SuccessfulApiResponse, {
        token: z.jwt(),
        refreshToken: z.jwt(),
      });
      export type Response = z.infer<typeof Response>;
    }
  }
  // /api/account
  export namespace Account {
    // POST /api/account
    export namespace Create {
      export const Request = z.extend(BaseTypes.UnauthorizedApiRequest, {
        username: z.string(),
        password: z.string(),
      });
      export type Request = z.infer<typeof Request>;
      export const Response = z.extend(BaseTypes.SuccessfulApiResponse, {});
      export type Response = z.infer<typeof Response>;
    }
    // GET /api/account/:username/token?password=...
    export namespace GetToken {
      export const Request = z.extend(BaseTypes.UnauthorizedApiRequest, {
        password: z.string(),
      });
      export type Request = z.infer<typeof Request>;
      export const Response = z.extend(Tokens.RefreshToken.Response, {});
      export type Response = z.infer<typeof Response>;
    }
    // DELETE /api/account/:username?password=...
    export namespace Delete {
      // Uname ^/password because a token should not be able to delete an account
      export const Request = z.extend(BaseTypes.UnauthorizedApiRequest, {
        password: z.string(),
      });
      export type Request = z.infer<typeof Request>;
      export const Response = z.extend(BaseTypes.SuccessfulApiResponse, {});
      export type Response = z.infer<typeof Response>;
    }
  }
  // Server connection authentication endpoints
  export namespace ServerConnectionAuth {
    // POST /api/serverAuth/connect
    export namespace Connect {
      export const Request = z.extend(BaseTypes.ApiRequest, {
        connectionToken: z.string(),
        id: ManagementTypes.serverUUID,
      });
      export type Request = z.infer<typeof Request>;
      export const Response = z.extend(BaseTypes.SuccessfulApiResponse, {});
      export type Response = z.infer<typeof Response>;
    }
  }
}

export namespace JavaCommunicationTypes {
  export namespace Proxy {
    // Base types
    export namespace BaseTypes {
      export const BaseCommunication = z.object({
        type: z.string(),
      });
      export type BaseCommunication = z.infer<typeof BaseCommunication>;
      export const PlayerAction = z.extend(BaseCommunication, {
        userUuid: z.uuidv4(),
      });
      export type PlayerAction = z.infer<typeof PlayerAction>;
      export const PlayerActionExtended = z.extend(PlayerAction, {
        username: z.string(),
      });
      export type PlayerActionExtended = z.infer<typeof PlayerActionExtended>;
    }
    export namespace Request {
      // Sent types
      export const Kick = z.extend(BaseTypes.PlayerAction, {
        type: z.literal("kick"),
        // Minecraft text component
        message: z.string(),
      });
      export type Kick = z.infer<typeof Kick>;
      export const Switch = z.extend(BaseTypes.PlayerAction, {
        type: z.literal("switch"),
        serverUuid: ManagementTypes.serverUUID,
        ip: z.union([z.ipv4(), z.ipv6()]),
        port: z.number(),
      });
      export type Switch = z.infer<typeof Switch>;
    }
    export namespace Response {
      // Received types
      export const PlayerConnection = z.extend(BaseTypes.PlayerActionExtended, {
        type: z.literal("playerConnection"),
        serverUuid: ManagementTypes.serverUUID,
      });
      export type PlayerConnection = z.infer<typeof PlayerConnection>;
      export const PlayerDisconnection = z.extend(
        BaseTypes.PlayerActionExtended,
        {
          type: z.literal("playerDisconnection"),
          serverUuid: ManagementTypes.serverUUID,
        },
      );
      export type PlayerDisconnection = z.infer<typeof PlayerDisconnection>;

      export const Response = z.union([PlayerConnection, PlayerDisconnection]);
      export type Response = z.infer<typeof Response>;
    }
  }
  export namespace Limbo {
    export namespace ServerRoute {
      export const Request = z.extend(
        ApiTypes.BaseTypes.UnauthorizedApiRequest,
        {
          uuid: z.uuidv4(),
        },
      );
      export type Request = z.infer<typeof Request>;
      export const Response = z.extend(
        ApiTypes.BaseTypes.SuccessfulApiResponse,
        {
          loginUrl: z.string(),
          timeout: z.uint64(),
        },
      );
      export type Response = z.infer<typeof Response>;
    }
  }
}

export namespace RedisTypes {
  export namespace ConfirmedRpc {
    export const Input = z.object({ txid: z.number() });
    export type Input = z.infer<typeof Input>;

    export namespace Output {
      export const key = "rpc-c";
      export const Output = z.object({ txid: z.number() });
      export type Output = z.infer<typeof Output>;
    }
  }
  export namespace ServerConnectionAuthToken {
    export type Key = `srt:${string}`;
    export const Value = z.object({
      issued: z.uint64(),
      expires: z.uint64(),
      userUuid: z.uuidv4(),
    });
    export type Value = z.infer<typeof Value>;
  }
  export namespace ProxyControl {
    export type Key = "proxyCommand";
    export const Value = z.union([
      JavaCommunicationTypes.Proxy.Request.Kick,
      JavaCommunicationTypes.Proxy.Request.Switch,
    ]);
    export type Value = z.infer<typeof Value>;
  }
  // Server start control
  export namespace ServerRunControl {
    export type Key = `src-i`;
    export const Value = z.extend(ConfirmedRpc.Input, {
      type: z.union([z.literal("start"), z.literal("stop")]),
      item: DatabaseTypes.ServerEntry,
      destructive: z.boolean(),
    });
    export type Value = z.infer<typeof Value>;
  }
  // Server info
  export namespace ServerStatus {
    export type Key = `serverStatus:${ManagementTypes.ServerUUID}`;
    export const Value = z.object({
      ip: z.union([z.ipv4(), z.ipv6()]),
      port: z.number(),
      players: z.array(ManagementTypes.Player),
    });
    export type Value = z.infer<typeof Value>;
  }
  // Tty
  export namespace RemoteTty {
    export type InputKey = `tty-i:${ManagementTypes.ServerUUID}`;
    export type OutputKey = `tty-o:${ManagementTypes.ServerUUID}`;

    export namespace Sub {
      export interface Request {
        type: "sub";
        id: number;
      }
    }
    export namespace UnSub {
      export interface Request {
        type: "unsub";
        id: number;
      }
    }
    export namespace Dmp {
      export interface Request {
        type: "dmp";
        id: number;
      }
      export interface Response {
        type: "dmp";
        id: number;
        history: Uint8Array;
      }
    }
    // Data to the running container "stdin"
    export namespace SendData {
      export interface Request {
        type: "scnk";
        data: Uint8Array;
      }
    }
    // Data from the running container "stdout" / "stderr"
    export namespace ReceiveData {
      export interface Response {
        type: "gcnk";
        data: Uint8Array;
      }
    }
    export type RemoteTtyRequest =
      | Sub.Request
      | UnSub.Request
      | Dmp.Request
      | SendData.Request;
    export type RemoteTtyResponse = Dmp.Response | ReceiveData.Response;
  }
}
export type OptionalProperty<
  T extends Record<any, any>,
  P extends keyof T,
> = Expand<Omit<T, P> & Partial<Pick<T, P>>>;
export type OptionalToken<T extends Record<any, any> & { token?: string }> =
  OptionalProperty<T, "token">;
