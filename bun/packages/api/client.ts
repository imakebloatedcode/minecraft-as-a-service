import { z } from "zod/mini";
import { ApiTypes, ManagementTypes, type OptionalToken } from "./definitions";

type HttpMethod = "GET" | "POST" | "DELETE";

export interface ClientConfig {
  baseUrl: string;
  token?: string;
  refreshToken?: string;
  // The number of seconds to refresh the token early
  refreshSkewSeconds?: number;
}

interface JwtPayload {
  exp?: number; // seconds since epoch
}

function decodeJwt(token: string): JwtPayload | null {
  try {
    const payload = token.split(".")[1];
    if (!payload) return null;

    const base64 = payload.replace(/-/g, "+").replace(/_/g, "/");
    const json = atob(base64);
    return JSON.parse(json);
  } catch {
    return null;
  }
}

function isExpired(token: string, skewSeconds = 30): boolean {
  const payload = decodeJwt(token);
  if (!payload?.exp) return true;

  const now = Math.floor(Date.now() / 1000);
  return payload.exp <= now + skewSeconds;
}

export class ApiClient {
  private baseUrl: string;
  private token?: string;
  private refreshToken?: string;
  private refreshSkewSeconds: number;

  private refreshPromise: Promise<void> | null = null;

  constructor(config: ClientConfig) {
    this.baseUrl = config.baseUrl;
    this.token = config.token;
    this.refreshToken = config.refreshToken;
    this.refreshSkewSeconds = config.refreshSkewSeconds ?? 30;
  }

  setToken(token: string) {
    this.token = token;
  }

  setRefreshToken(token: string) {
    this.refreshToken = token;
  }

  getUsername() {
    if (!this.token) throw new Error("No token available");
    const decoded = decodeJwt(this.token);
    if (!(decoded as any)?.username) {
      throw new Error("Bad token");
    }
    return (decoded as any).username as string;
  }

  private async getToken<O extends boolean>(
    optional: O,
  ): Promise<string | (O extends true ? undefined : never)> {
    if (this.token) {
      const expired = isExpired(this.token, this.refreshSkewSeconds);

      if (!expired) {
        return this.token;
      }
    }

    if (!this.refreshToken) {
      if (optional) {
        // @ts-ignore
        return undefined;
      } else {
        throw new Error(
          "Missing both token and refresh token, can not continue",
        );
      }
    }

    if (!this.refreshPromise) {
      this.refreshPromise = this.tokens
        .refresh(this.refreshToken!)
        .then((value) => {
          this.setToken(value.token);
          this.setRefreshToken(value.refreshToken);
        })
        .catch((err) => {
          // If refresh fails, clear tokens
          this.token = undefined;
          this.refreshToken = undefined;
          throw err;
        })
        .finally(() => {
          this.refreshPromise = null;
        });
    }

    await this.refreshPromise;

    return this.token!;
  }

  throwApiError(errorText: string) {
    throw new Error(errorText);
  }

  // --------------------------
  // CORE REQUEST
  // --------------------------
  // TODO: CLEAN UP
  private async request<
    TResponse extends
      | z.ZodMiniObject
      | z.ZodMiniUnion<readonly z.ZodMiniObject[]>,
    TBody extends z.ZodMiniObject | z.ZodMiniUnion<readonly z.ZodMiniObject[]>,
  >(
    method: HttpMethod,
    path: string,
    type: {
      request: TBody;
      response: TResponse;
    },
    options: {
      body: OptionalToken<z.infer<TBody>>;
    },
  ): Promise<z.infer<TResponse>> {
    if (!("token" in options.body)) {
      // Check if a token is expected, and if so add it
      const tokenStatus = (() => {
        if (type.request._zod.def.type === "union") {
          const hasPossibleTokenItems = type.request._zod.def.options.map(
            (v) => [
              "token" in v._zod.def.shape,
              v._zod.def.shape["token"]!._zod.def.type === "optional",
            ],
          );
          if (hasPossibleTokenItems.every((v) => v[0] === true)) {
            return [true, hasPossibleTokenItems.every((v) => v[1] === true)];
          } else if (hasPossibleTokenItems.every((v) => v[0] === false)) {
            return [false, false];
          } else {
            throw new Error(
              `Inconsistent token support for api endpoint. Can not continue with automatic token adding`,
            );
          }
        } else {
          return [
            "token" in type.request._zod.def.shape,
            type.request._zod.def.shape["token"]!._zod.def.type === "optional",
          ];
        }
      })();
      if (tokenStatus[0]!) {
        const token = await this.getToken(tokenStatus[1]!);
        // FIX THIS SECTION -- START
        options.body ??= {} as any;
        (options.body as any).token = token;
        // FIX THIS SECTION -- END
      }
    }

    const requestBody = type.request.parse((options?.body ?? {}) as any);

    const url = new URL(this.baseUrl + path);
    const isUrlEncoded = method !== "POST";
    const fetchHeaders: Record<string, string> = {};
    const fetchOptions: RequestInit = { headers: fetchHeaders, method };

    if (isUrlEncoded) {
      for (const [k, v] of Object.entries(requestBody as any)) {
        if (v !== undefined) url.searchParams.append(k, String(v));
      }
      fetchHeaders["Content-Type"] = "application/x-www-form-urlencoded";
    } else {
      fetchOptions["body"] = JSON.stringify(requestBody);
      fetchHeaders["Content-Type"] = "application/json";
    }

    const res = await fetch(url.toString(), fetchOptions);

    const data = (
      res.ok ? type.response : ApiTypes.BaseTypes.FailedApiResponse
    ).parse(await res.json());

    if (!res.ok) {
      // @ts-ignore
      this.throwApiError(data?.errorMessage ?? "API Error");
    }

    return data as z.infer<TResponse>;
  }

  // =========================
  // PROXY API
  // =========================
  proxy = {
    mcInfo: (body: OptionalToken<ApiTypes.ProxyApis.McInfo.Request>) =>
      this.request(
        "GET",
        "/api/account",
        {
          request: ApiTypes.ProxyApis.McInfo.Request,
          response: ApiTypes.ProxyApis.McInfo.Response,
        },
        {
          body,
        },
      ),
  };
  // =========================
  // ACCOUNT API
  // =========================
  account = {
    create: (body: OptionalToken<ApiTypes.Account.Create.Request>) =>
      this.request(
        "POST",
        "/api/account",
        {
          request: ApiTypes.Account.Create.Request,
          response: ApiTypes.Account.Create.Response,
        },
        {
          body,
        },
      ),

    getToken: (
      username: string,
      body: OptionalToken<ApiTypes.Account.GetToken.Request>,
    ) =>
      this.request(
        "GET",
        `/api/account/${username}/token`,
        {
          request: ApiTypes.Account.GetToken.Request,
          response: ApiTypes.Account.GetToken.Response,
        },
        {
          body,
        },
      ),

    delete: (
      username: string,
      body: OptionalToken<ApiTypes.Account.Delete.Request>,
    ) =>
      this.request(
        "DELETE",
        `/api/account/${username}`,
        {
          request: ApiTypes.Account.Delete.Request,
          response: ApiTypes.Account.Delete.Response,
        },
        {
          body,
        },
      ),
  };

  // =========================
  // SERVER API
  // =========================
  server = {
    list: (
      body: OptionalToken<ApiTypes.ServerManagement.ServerListQuery.Request>,
    ) =>
      this.request(
        "POST",
        "/api/query/servers",
        {
          request: ApiTypes.ServerManagement.ServerListQuery.Request,
          response: ApiTypes.ServerManagement.ServerListQuery.Response,
        },
        { body },
      ),

    filePresign: (
      id: ManagementTypes.ServerUUID,
      body: OptionalToken<ApiTypes.ServerManagement.ServerFilePresignRequest.Request>,
    ) =>
      this.request(
        "POST",
        `/api/server/${id}/presign`,
        {
          request: ApiTypes.ServerManagement.ServerFilePresignRequest.Request,
          response: ApiTypes.ServerManagement.ServerFilePresignRequest.Response,
        },
        { body },
      ),
    remoteTty: async (
      id: ManagementTypes.ServerUUID,
      body: OptionalToken<ApiTypes.ServerManagement.ServerTty.Request>,
    ): Promise<{
      handshake: ApiTypes.ServerManagement.ServerTty.Response;
      socket: WebSocket;
      setListener: (listener: (data: Uint8Array | string) => void) => void;
    }> => {
      const connectionUrl = new URL(`/api/server/${id}/tty`, this.baseUrl);
      connectionUrl.searchParams.set(
        "token",
        "token" in body && body.token !== undefined
          ? body.token
          : await this.getToken(false),
      );
      const websocketConnection = new WebSocket(connectionUrl);
      websocketConnection.binaryType = "arraybuffer";
      let listener: ((data: Uint8Array | string) => void) | undefined;
      let backlog: (Uint8Array | string)[] = [];
      return new Promise((resolve) => {
        let gotHandshake = false;
        websocketConnection.addEventListener("message", (event) => {
          if (!gotHandshake) {
            gotHandshake = true;
            if (typeof event.data === "string") {
              const responseData = JSON.parse(event.data);
              if ("errorMessage" in responseData) {
                this.throwApiError(responseData.errorMessage);
              }
              const parsed =
                ApiTypes.ServerManagement.ServerTty.Response.parse(
                  responseData,
                );

              resolve({
                handshake: parsed,
                socket: websocketConnection,
                setListener: (newListener) => {
                  if (backlog.length > 0) {
                    for (const item of backlog) {
                      newListener(item);
                    }
                    backlog = [];
                  }
                  listener = newListener;
                },
              });
            } else {
              throw new Error(
                `Expected a string for the handshake packet of the remote tty`,
              );
            }
          } else {
            const value =
              typeof event.data === "string"
                ? event.data
                : new Uint8Array(event.data);
            if (listener) {
              listener(value);
            } else {
              backlog.push(value);
            }
          }
        });
        websocketConnection.addEventListener("close", (event) => {
          if (!gotHandshake) {
            throw new Error(
              "Premature close of remote tty: handshake packet was not sent",
            );
          }
        });
      });
    },
    create: (
      body: OptionalToken<ApiTypes.ServerManagement.ServerCreate.Request>,
    ) =>
      this.request(
        "POST",
        "/api/server",
        {
          request: ApiTypes.ServerManagement.ServerCreate.Request,
          response: ApiTypes.ServerManagement.ServerCreate.Response,
        },
        {
          body,
        },
      ),

    getConfig: (
      id: ManagementTypes.ServerUUID,
      body: OptionalToken<ApiTypes.ServerManagement.ServerConfigQuery.Request>,
    ) =>
      this.request(
        "GET",
        `/api/server/${id}/config`,
        {
          request: ApiTypes.ServerManagement.ServerConfigQuery.Request,
          response: ApiTypes.ServerManagement.ServerConfigQuery.Response,
        },
        { body },
      ),

    updateConfig: (
      id: ManagementTypes.ServerUUID,
      body: OptionalToken<ApiTypes.ServerManagement.ServerConfig.Request>,
    ) =>
      this.request(
        "POST",
        `/api/server/${id}/config`,
        {
          request: ApiTypes.ServerManagement.ServerConfig.Request,
          response: ApiTypes.ServerManagement.ServerConfig.Response,
        },
        {
          body,
        },
      ),

    delete: (
      id: ManagementTypes.ServerUUID,
      body: OptionalToken<ApiTypes.ServerManagement.ServerDelete.Request>,
    ) =>
      this.request(
        "DELETE",
        `/api/server/${id}`,
        {
          request: ApiTypes.ServerManagement.ServerDelete.Request,
          response: ApiTypes.ServerManagement.ServerDelete.Response,
        },
        { body },
      ),
  };

  // =========================
  // TOKENS API
  // =========================
  tokens = {
    refresh: (token: string) =>
      this.request(
        "GET",
        "/api/tokens/refresh",
        {
          request: ApiTypes.Tokens.RefreshToken.Request,
          response: ApiTypes.Tokens.RefreshToken.Response,
        },
        {
          body: {
            token,
          },
        },
      ),
  };
  serverAuth = {
    connect: (
      body: OptionalToken<ApiTypes.ServerConnectionAuth.Connect.Request>,
    ) =>
      this.request(
        "POST",
        "/api/serverAuth/connect",
        {
          request: ApiTypes.ServerConnectionAuth.Connect.Request,
          response: ApiTypes.ServerConnectionAuth.Connect.Response,
        },
        { body },
      ),
  };
}
