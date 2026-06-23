import "./index.css";

import { extname } from "path";

import { client as apiClient, definitions as apiDefinitions } from "@mcman/api";
import * as serverCfg from "@mcman/serversetterupper/src/index";

import React, {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type JSX,
} from "react";
import {
  BrowserRouter,
  Routes,
  Route,
  Link,
  useParams,
  useNavigate,
  useLocation,
  Navigate,
  useSearchParams,
  type To,
  parsePath,
} from "react-router-dom";
import { CheckCircle2, Loader2 } from "lucide-react";
import { z } from "zod/mini";
import MiniSearch from "minisearch";
import { CrockfordBase32 } from "crockford-base32";
import mime from "mime-types";
// ui
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { TextEditor } from "./TextComponentEditor";
import { Switch } from "@/components/ui/switch";
import { NumberInput } from "@/components/numberInput";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import FileUpload from "@/components/fileInput";
import XTerm, { useXTerm } from "@/components/xterm";
import { Terminal } from "@xterm/xterm";
import { toast } from "sonner";

// ---------------------------
// API CONTEXT
// ---------------------------

type ApiContextType = { api: apiClient.ApiClient };
const ApiContext = createContext<ApiContextType | null>(null);

class StatedApiClient extends apiClient.ApiClient {
  #auth: AuthState;
  #setAuth: (state: AuthState) => void;
  constructor(
    config: apiClient.ClientConfig,
    auth: AuthState,
    setAuth: (state: AuthState) => void,
  ) {
    super(config);
    this.#setAuth = setAuth;
    this.#auth = auth;
  }
  override setToken(token: string): void {
    const newAuth = structuredClone(this.#auth);
    newAuth.token = token;
    this.#auth = newAuth;
    this.#setAuth(newAuth);

    super.setToken(token);
  }
  override setRefreshToken(token: string): void {
    const newAuth = structuredClone(this.#auth);
    newAuth.refreshToken = token;
    this.#auth = newAuth;
    this.#setAuth(newAuth);

    super.setRefreshToken(token);
  }
  override throwApiError(error: string) {
    toast.error(error);
    throw new Error(error);
  }
}

export const ApiProvider: React.FC<{ children: React.ReactNode }> = ({
  children,
}) => {
  const { auth, setAuth } = useAuth();

  const api = useMemo(() => {
    const client = new StatedApiClient(
      {
        baseUrl: new URL("/", window.location.href).href.replace(/\/$/m, ""),
        token: auth.token,
        refreshToken: auth.refreshToken,
      },
      auth,
      setAuth,
    );

    return client;
  }, [auth]);

  return <ApiContext.Provider value={{ api }}>{children}</ApiContext.Provider>;
};

export const useApi = () => {
  const ctx = useContext(ApiContext);
  if (!ctx) throw new Error("useApi must be used inside ApiProvider");
  return ctx.api;
};

// ---------------------------
// AUTH
// ---------------------------

type AuthState = {
  token?: string;
  refreshToken?: string;
  username?: string;
};

const AuthContext = createContext<{
  auth: AuthState;
  setAuth: (a: AuthState) => void;
} | null>(null);

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({
  children,
}) => {
  const [auth, setAuthState] = useState<AuthState>(() => {
    const raw = localStorage.getItem("auth");
    return raw ? JSON.parse(raw) : {};
  });

  const setAuth = (a: AuthState) => {
    setAuthState(a);
    localStorage.setItem("auth", JSON.stringify(a));
  };

  return (
    <AuthContext.Provider value={{ auth, setAuth }}>
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used inside AuthProvider");
  return ctx;
};

// ---------------------------
// AUTH GUARD
// ---------------------------

const RequireAuth: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { auth } = useAuth();
  const location = useLocation();

  if (!auth.token) {
    return (
      <Navigate
        to={`/login?next=${encodeURIComponent(location.pathname)}`}
        replace
      />
    );
  }

  return <>{children}</>;
};

// ---------------------------
// FIELD ROW
// ---------------------------

const FieldRow = ({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) => (
  <div className="flex items-center gap-3">
    <div className="w-32 text-sm font-medium text-muted-foreground bg-muted px-2 py-1 rounded-md">
      {label}
    </div>
    <div className="flex-1">{children}</div>
  </div>
);

// ---------------------------
// ACCOUNT MENU
// ---------------------------
const AccountMenu = () => {
  const api = useApi();
  const { auth, setAuth } = useAuth();
  const nav = useNavigate();

  const [open, setOpen] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

  const logout = () => {
    setAuth({});
    nav("/login");
  };

  const deleteAccount = async () => {
    await api.account.delete(auth.username!, { password: "" });
    setAuth({});
    nav("/register");
  };

  return (
    <div className="relative">
      <Button variant="outline" className="" onClick={() => setOpen((v) => !v)}>
        Account
      </Button>

      <div
        className={`
          absolute right-0 mt-2 w-48
          bg-background border rounded-md shadow-md p-2 z-50
          transition-all duration-150 origin-top
          ${open ? "opacity-100 scale-100" : "opacity-0 scale-95 pointer-events-none"}
        `}
      >
        <Button
          className="w-full justify-start"
          variant="ghost"
          onClick={logout}
        >
          Logout
        </Button>

        <Button
          className="w-full justify-start text-red-500"
          variant="ghost"
          onClick={() => setConfirmDelete(true)}
        >
          Delete Account
        </Button>
      </div>

      {/* Confirm delete dialog */}
      <Dialog open={confirmDelete} onOpenChange={setConfirmDelete}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete Account?</DialogTitle>
          </DialogHeader>

          <p className="text-sm text-muted-foreground">
            This action cannot be undone.
          </p>

          <div className="flex justify-end gap-2 mt-4">
            <Button variant="ghost" onClick={() => setConfirmDelete(false)}>
              Cancel
            </Button>
            <Button variant="destructive" onClick={deleteAccount}>
              Delete
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
};
// ---------------------------
// LOGIN
// ---------------------------

const Login = () => {
  const api = useApi();
  const { setAuth } = useAuth();
  const nav = useNavigate();
  const location = useLocation();

  const params = new URLSearchParams(location.search);
  const next = params.get("next") || "/dashboard/servers";

  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");

  const login = async () => {
    const res = await api.account.getToken(username, {
      password,
    });
    setAuth({ username, token: res.token, refreshToken: res.refreshToken });
    nav(next);
  };

  return (
    <div className="flex items-center justify-center h-screen bg-muted text-foreground">
      <Card className="w-[380px]">
        <CardHeader>
          <CardTitle>Login</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <Input
            placeholder="Username"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
          />
          <Input
            placeholder="Password"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
          <Button className="w-full" onClick={login}>
            Login
          </Button>
          <Link
            className="text-sm text-muted-foreground hover:text-foreground"
            to={`/register?next=${encodeURIComponent(next)}`}
          >
            Sign up
          </Link>
        </CardContent>
      </Card>
    </div>
  );
};

const Register = () => {
  const api = useApi();
  const nav = useNavigate();
  const location = useLocation();

  const params = new URLSearchParams(location.search);
  const next = params.get("next") || "/login";

  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");

  return (
    <div className="flex items-center justify-center h-screen bg-muted text-foreground">
      <Card className="w-[380px]">
        <CardHeader>
          <CardTitle>Register</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <Input
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            placeholder="Username"
          />
          <Input
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="Password"
            type="password"
          />

          <Button
            className="w-full"
            onClick={async () => {
              await api.account.create({ username, password });
              nav(`/login?next=${encodeURIComponent(next)}`);
            }}
          >
            Create Account
          </Button>

          <Link
            className="text-sm text-muted-foreground hover:text-foreground"
            to={`/login?next=${encodeURIComponent(next)}`}
          >
            Login
          </Link>
        </CardContent>
      </Card>
    </div>
  );
};

// ---------------------------
// SIDEBAR
// ---------------------------

const SidebarLayout: React.FC<{ children: React.ReactNode }> = ({
  children,
}) => {
  return (
    <div className="min-h-screen flex bg-background">
      <aside className="w-64 border-r bg-muted/40 p-4 space-y-4">
        <div className="text-lg font-bold">MC Server Manager</div>

        <nav className="flex flex-col gap-2">
          <Link
            className="text-sm text-muted-foreground hover:text-foreground transition-colors"
            to="/dashboard/servers"
          >
            My Servers
          </Link>

          <Link
            className="text-sm text-muted-foreground hover:text-foreground transition-colors"
            to="/dashboard/all-servers"
          >
            Search Servers
          </Link>
        </nav>

        <AccountMenu />
      </aside>

      <main className="flex-1">{children}</main>
    </div>
  );
};

// ---------------------------
// CREATE SERVER MODAL
// ---------------------------

const CreateServerModal = ({ onCreated }: { onCreated: () => void }) => {
  const versionManifestPromise = useMemo(() => {
    return fetch(
      "https://launchermeta.mojang.com/mc/game/version_manifest_v2.json",
    ).then((value) => value.json());
  }, []);
  const api = useApi();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");

  const create = async () => {
    const versionManifest = await versionManifestPromise;
    await api.server.create({
      configuration: {
        name,

        // TODO: Make this use the ServerDetail UI
        configuration: {
          connections: { maximumPlayers: 20 },
          enableCommandBlock: false,
          gameplay: {
            difficulty: "normal",
            gamemode: { defaultGamemode: "survival", forced: false },
            enablePvp: true,
            hardcore: false,
            keepInventory: false,
            spawning: {
              spawnAnimals: true,
              spawnMonsters: true,
              spawnNpcs: true,
            },
          },
          motd: {
            segments: [
              {
                data: "A minecraft server",
                formatting: {
                  color: { red: 255, blue: 255, green: 255 },
                  bold: false,
                  italic: false,
                  obfuscated: false,
                  strikethrough: false,
                  underline: false,
                },
              },
            ],
          },
          world: {
            level: { type: "minecraft:normal", options: {} },
          },
          // permissions: [],
        },
        type: "vanilla",
        // @ts-ignore
        version: versionManifest.latest.release as string,
        public: true,
        enabled: false,
      },
    });

    setOpen(false);
    setName("");
    onCreated();
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button>Create Server</Button>
      </DialogTrigger>

      <DialogContent className="text-foreground dark">
        <DialogHeader>
          <DialogTitle>Create Server</DialogTitle>
        </DialogHeader>

        <FieldRow label="Name">
          <Input value={name} onChange={(e) => setName(e.target.value)} />
        </FieldRow>

        <Button className="w-full mt-4" onClick={create}>
          Create
        </Button>
      </DialogContent>
    </Dialog>
  );
};

// ---------------------------
// SERVER LIST (MiniSearch + Infinite Scroll)
// ---------------------------

const PAGE_SIZE = 10;

const ServerCard = ({
  serverInformation,
  ...props
}: React.ComponentProps<typeof Card> & {
  serverInformation: apiDefinitions.ManagementTypes.ServerInformation;
}) => {
  return (
    <Card {...props}>
      <CardContent className="py-4">
        <p className="font-semibold">{serverInformation.configuration.name}</p>
        <p className="text-xs text-muted-foreground">
          {serverInformation.configuration.version}
        </p>
        <div className="flex justify-between py-4">
          <span className="text-s text-muted-foreground text-bold">
            {serverInformation.information.players.length}/
            {
              serverInformation.configuration.configuration.connections
                .maximumPlayers
            }
          </span>
          <span className="text-xs text-muted-foreground text-bold">
            {serverInformation.configuration.version}
          </span>
        </div>
      </CardContent>
    </Card>
  );
};

const ServerList = () => {
  const api = useApi();
  const { auth } = useAuth();

  const [servers, setServers] = useState<
    apiDefinitions.ManagementTypes.ServerInformation[]
  >([]);
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);
  const [query, setQuery] = useState("");

  const miniSearch = useMemo(() => {
    const ms = new MiniSearch({
      fields: ["name"],
      storeFields: ["id"],
    });
    return ms;
  }, []);

  const load = async () => {
    const res = await api.server.list({
      owners: [api.getUsername()],
    });

    setServers(res.servers);
  };

  // Reload every time auth changes
  useEffect(() => {
    load();
  }, [auth.username]);

  useEffect(() => {
    miniSearch.removeAll();
    miniSearch.addAll(
      servers.map((s) => ({
        id: s.information.id,
        name: s.configuration.name,
      })),
    );
  }, [servers]);

  const filtered =
    query.trim().length > 0
      ? miniSearch
          .search(query)
          .map((r) => servers.find((s) => s.information.id === r.id))
      : servers;

  const visible = filtered.slice(0, visibleCount);

  const loaderRef = useRef<HTMLDivElement | null>(null);

  // This was AI slop, not sure if this is necessary but it does not hurt anything so whatever
  useEffect(() => {
    const obs = new IntersectionObserver((entries) => {
      if (entries[0].isIntersecting) {
        setVisibleCount((v) => v + PAGE_SIZE);
      }
    });

    if (loaderRef.current) obs.observe(loaderRef.current);

    return () => obs.disconnect();
  }, []);

  return (
    <div className="p-6 space-y-4">
      <div className="flex justify-between">
        <h1 className="text-2xl font-bold">Servers</h1>
        <CreateServerModal onCreated={load} />
      </div>

      <Input
        className="text-muted-foreground placeholder:text-muted-foreground"
        placeholder="Search servers..."
        value={query}
        onChange={(e) => setQuery(e.target.value)}
      />

      <div className="grid gap-4">
        {visible.map((s: any) => (
          <Link to={`/dashboard/servers/${s!.information.id}`}>
            <ServerCard
              key={s!.information.id}
              serverInformation={s!}
            ></ServerCard>
          </Link>
          /* <Card key={s!.information.id}>
            <CardContent className="flex justify-between py-4">
              <div>
                <p className="font-semibold text-l">{s!.configuration.name}</p>
                <div className="flex justify-between py-4">
                  <span className="text-s text-muted-foreground text-bold">
                    {s!.configuration.version}
                  </span>
                  <span className="text-s text-muted-foreground text-bold">
                    {s!.information.players.length}/
                    {s!.configuration.maxPlayers}
                  </span>
                </div>
              </div>

              <Link to={`/dashboard/servers/${s!.information.id}`}>
                <Button variant="outline">Manage</Button>
              </Link>
            </CardContent>
          </Card> */
        ))}
      </div>

      <div ref={loaderRef} className="h-10" />
    </div>
  );
};

// ---------------------------
// ALL SERVERS (MiniSearch + Infinite Scroll)
// ---------------------------

const AllServers = ({
  linkBase = "/dashboard/servers",
  onlyEnabled = false,
}: {
  linkBase?: To;
  onlyEnabled?: boolean;
}) => {
  const baseLink =
    typeof linkBase === "string" ? parsePath(linkBase) : linkBase;
  const api = useApi();
  const { auth } = useAuth();

  const [servers, setServers] = useState<
    apiDefinitions.ManagementTypes.ServerInformation[]
  >([]);
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);
  const [query, setQuery] = useState("");

  const miniSearch = useMemo(() => {
    return new MiniSearch({
      fields: ["name"],
      storeFields: ["id"],
    });
  }, []);

  const load = async () => {
    const res = await api.server.list({});

    setServers(
      onlyEnabled
        ? res.servers.filter((v) => v.configuration.enabled)
        : res.servers,
    );
  };

  // Reload every time auth changes
  useEffect(() => {
    load();
  }, [auth.username]);

  useEffect(() => {
    miniSearch.removeAll();
    miniSearch.addAll(
      servers.map((s) => ({
        id: s.information.id,
        name: s.configuration.name,
      })),
    );
  }, [servers]);

  const filtered = query.trim()
    ? miniSearch
        .search(query)
        .map((r) => servers.find((s) => s.information.id === r.id))
    : servers;

  const visible = filtered.slice(0, visibleCount);

  const loaderRef = useRef<HTMLDivElement | null>(null);

  // This was AI slop, not sure if this is necessary but it does not hurt anything so whatever
  useEffect(() => {
    const obs = new IntersectionObserver((e) => {
      if (e[0].isIntersecting) {
        setVisibleCount((v) => v + PAGE_SIZE);
      }
    });

    if (loaderRef.current) obs.observe(loaderRef.current);

    return () => obs.disconnect();
  }, []);

  return (
    <div className="p-6 space-y-4">
      <h1 className="text-2xl font-bold">Search All Servers</h1>

      <Input
        placeholder="Search all servers..."
        value={query}
        onChange={(e) => setQuery(e.target.value)}
      />

      <div className="grid gap-4">
        {visible.map((s) => (
          <Link
            to={{
              ...baseLink,
              pathname: `${baseLink.pathname}/${s!.information.id}`,
            }}
          >
            <ServerCard
              key={s!.information.id}
              serverInformation={s!}
            ></ServerCard>
          </Link>
        ))}
      </div>

      <div ref={loaderRef} className="h-10" />
    </div>
  );
};

// ---------------------------
// SERVER DETAIL
// ---------------------------

const configGroups = [
  "Metadata",
  "Server configuration",
  "Player list",
  "Terminal",
  "Danger zone",
] as const;
const savableConfigGroups: (typeof configGroups)[number][] = [
  "Metadata",
  "Server configuration",
];

namespace Rendering {
  interface RenderInstructionBase {
    name: string;
    type: string;
    default: unknown;
  }

  export interface DefineAreaRenderInstruction extends RenderInstructionBase {
    type: "defineArea";
    default: boolean;
  }
  export interface ArrayRenderInstruction extends RenderInstructionBase {
    type: "array";
    default: unknown[];
  }

  export interface BooleanRenderInstruction extends RenderInstructionBase {
    type: "bool";
    default: boolean;
  }
  export interface NumberRenderInstruction extends RenderInstructionBase {
    type: "number";
    default: number;
    min: number;
    max: number;
  }
  export interface StringRenderInstruction extends RenderInstructionBase {
    type: "string";
    default: string;
  }
  export interface Vec3RenderInstruction extends RenderInstructionBase {
    type: "vec3";
    default: [number, number, number];
  }

  export interface TextComponentRenderInstruction extends RenderInstructionBase {
    type: "textComponent";
    default: serverCfg.configuration.textComponent.TextComponent[];
  }
  export interface FileRenderInstruction extends RenderInstructionBase {
    type: "file";
    default: undefined;
    pathName: string;
  }

  export type ImplicitRenderingInstruction = FileRenderInstruction;

  export type DirectRenderInstruction =
    | ArrayRenderInstruction
    | DefineAreaRenderInstruction
    | BooleanRenderInstruction
    | NumberRenderInstruction
    | StringRenderInstruction
    | Vec3RenderInstruction
    | TextComponentRenderInstruction
    | FileRenderInstruction;

  export type AnyRenderInstruction =
    | ImplicitRenderingInstruction
    | DirectRenderInstruction;
}

const renderInstructions: Record<string, Rendering.AnyRenderInstruction> = {
  "motd.segments": {
    name: "Message of the day",
    type: "textComponent",
    default: [
      {
        data: "My minecraft server!",
        formatting: {
          color: { red: 255, green: 255, blue: 255 },
          bold: false,
          italic: false,
          obfuscated: false,
          strikethrough: false,
          underline: false,
        },
      },
    ],
  },
  "connections.maximumPlayers": {
    name: "Maximum players",
    type: "number",
    min: 0,
    max: 100,
    default: 20,
  },
  resourcePack: {
    name: "Enable resource pack",
    type: "defineArea",
    default: false,
  },
  "resourcePack._implicit_": {
    name: "Resource pack",
    type: "file",
    default: undefined,
    pathName: apiDefinitions.BucketDefinitions.resourcePackName,
  },
  "resourcePack.promptMessage": {
    name: "Resource pack prompt",
    type: "textComponent",
    default: [
      {
        data: "This server has a custom resource pack",
        formatting: {
          color: { red: 255, green: 255, blue: 255 },
          bold: false,
          italic: false,
          obfuscated: false,
          strikethrough: false,
          underline: false,
        },
      },
    ],
  },
  "resourcePack.required": {
    name: "Require resource pack",
    type: "bool",
    default: false,
  },
  "gameplay.gamemode.defaultGamemode": {
    name: "Default game mode",
    type: "string",
    default: "survival",
  },
  "gameplay.gamemode.forced": {
    name: "Force game mode",
    type: "bool",
    default: false,
  },

  "gameplay.difficulty": {
    name: "Difficulty",
    type: "string",
    default: "normal",
  },
  "gameplay.hardcore": {
    name: "Enable hardcore mode",
    type: "bool",
    default: false,
  },
  "gameplay.spawning.spawnAnimals": {
    name: "Spawn animals",
    type: "bool",
    default: true,
  },
  "gameplay.spawning.spawnMonsters": {
    name: "Spawn monsters",
    type: "bool",
    default: true,
  },
  "gameplay.spawning.spawnNpcs": {
    name: "Spawn npcs",
    type: "bool",
    default: true,
  },
  "gameplay.keepInventory": {
    name: "Keep inventory on death",
    type: "bool",
    default: false,
  },
  "gameplay.enablePvp": {
    name: "Allow player vs player combat",
    type: "bool",
    default: true,
  },

  "world._implicit_": {
    name: "World file",
    type: "file",
    default: undefined,
    pathName: apiDefinitions.BucketDefinitions.worldName,
  },
  "world.seed": { name: "World seed", type: "string", default: "" },
  "world.level.type": { name: "World type", type: "string", default: "" },

  spawnPoint: { name: "World spawn", type: "vec3", default: [0, 0, 0] }, // This option will not be used in vanilla minecraft with only the server.properties handler

  enableCommandBlock: {
    name: "Enable command block",
    type: "bool",
    default: false,
  },
  // Permissions
  /*permissions: {
    name: "Player permissions",
    type: "array",
    default: [],
  },
  "permissions.bypassMaximumPlayers": {
    name: "Bypass player limit",
    type: "bool",
    default: false,
  },
  "permissions.vanillaPermissionLevel": {
    name: "Permission level",
    type: "number",
    default: 0,
    min: 0,
    max: 4,
  },*/
};

function renderCombinedMappings(
  mappings: ReturnType<
    typeof serverCfg.handlers.handlers.MappingsZodInterop.combineMappings
  >,
  chain: string[],
) {
  type ElementsType = {
    chain: string[];
    item:
      | Exclude<
          Rendering.AnyRenderInstruction,
          Rendering.DefineAreaRenderInstruction
        >
      | (Rendering.DefineAreaRenderInstruction & { children: ElementsType })
      | (Rendering.ArrayRenderInstruction & { childrenType: ElementsType })
      | { name: string; type: "option"; choices: string[]; default: string };
  }[];
  const elements: ElementsType = [];
  const itemDef = mappings._zod.def;
  if (itemDef.type === "default") {
    // Do nothing as defaulted items should not have options to change them
  } else {
    const fullChain = chain.join(".");
    if (
      itemDef.type === "union" &&
      (itemDef as z.ZodMiniUnion["_zod"]["def"]).options.every(
        (value) => value._zod.def.type === "literal",
      )
    ) {
      // If it only accepts literal values
      if (fullChain in renderInstructions) {
        const item = renderInstructions[fullChain]!;
        elements.push({
          chain,
          item: {
            name: item.name,
            type: "option",
            // UNSAFE
            default: item.default as string,
            choices: (itemDef as z.ZodMiniUnion["_zod"]["def"]).options
              .map((v) =>
                (v as z.ZodMiniLiteral)._zod.def.values.map((v) =>
                  v!.toString(),
                ),
              )
              .flat(1),
          },
        });
        console.log(elements);
      } else {
        // Do nothing
      }
    } else {
      // Render the child keys of the zod schema
      function handleOther() {
        const newElements: ElementsType = [];
        if (fullChain + "._implicit_" in renderInstructions) {
          const item = renderInstructions[fullChain + "._implicit_"]!;
          newElements.push({
            chain,
            item: item as Rendering.ImplicitRenderingInstruction,
          });
        }
        if (itemDef.type === "object") {
          const castedDef = itemDef as z.ZodMiniObject["_zod"]["def"];
          for (const [key, value] of Object.entries(castedDef.shape)) {
            newElements.push(...renderCombinedMappings(value, [...chain, key]));
          }
        } else if (itemDef.type === "tuple") {
          const castedDef = itemDef as z.ZodMiniTuple["_zod"]["def"];
          for (let index = 0; index < castedDef.items.length; index++) {
            const element = castedDef.items[index]!;
            newElements.push(
              ...renderCombinedMappings(element, [...chain, index.toString()]),
            );
          }
        } else {
          // The method of handling is unknown
        }
        return newElements;
      }
      if (fullChain in renderInstructions) {
        const item = renderInstructions[fullChain]!;
        if (item.type === "defineArea") {
          elements.push({ chain, item: { ...item, children: handleOther() } });
        } else if (item.type === "array") {
          if (itemDef.type !== "array") {
            throw new Error(
              `Got wrong item def type. Expected array but got ${itemDef.type}`,
            );
          }
          const elementType = (itemDef as z.ZodMiniArray["_zod"]["def"])[
            "element"
          ];
          elements.push({
            chain,
            item: {
              ...item,
              childrenType: renderCombinedMappings(elementType, chain),
            },
          });
        } else {
          elements.push({ chain, item });
        }
      } else {
        elements.push(...handleOther());
      }
    }
  }
  return elements;
}

function chainBase(
  object: Record<string, unknown>,
  chain: string[],
  defaultValue: { enable: boolean; value: unknown } = {
    enable: false,
    value: undefined,
  },
):
  | { type: "normal"; key: string; ref: Record<string, unknown> }
  | { type: "break"; key: undefined; ref: unknown } {
  let ref = object;
  for (const key of chain.slice(0, -1)) {
    if (key in ref) {
      const item = ref[key];
      if (item !== null && typeof item === "object") {
        ref = item as Record<string, unknown>;
      } else {
        throw new Error(
          `Got type ${item === "null" ? "null" : typeof item} but expected type "object"`,
        );
      }
    } else {
      if (defaultValue.enable) {
        return { type: "break", key: undefined, ref: defaultValue.value };
      } else {
        throw new Error(`Missing key ${key} in object`);
      }
    }
  }
  const key = chain[chain.length - 1]!;
  return { type: "normal", key, ref };
}

function getChain(
  object: Record<string, unknown>,
  chain: string[],
  defaultValue: { enable: boolean; value: unknown } = {
    enable: false,
    value: undefined,
  },
) {
  const { type, key, ref } = chainBase(object, chain, defaultValue);
  if (type === "break") {
    return ref;
  }
  if (key in ref) {
    const item = ref[key];
    return item;
  } else {
    if (defaultValue.enable) {
      return defaultValue.value;
    } else {
      throw new Error(`Missing key ${key} in object`);
    }
  }
}

function setChain(
  object: Record<string, unknown>,
  chain: string[],
  value: unknown,
) {
  const { type, key, ref } = chainBase(object, chain, {
    enable: false,
    value: undefined,
  });
  if (type === "break") {
    throw new Error("This should not happen");
  }

  if (ref !== null && typeof ref === "object") {
    // @ts-ignore
    ref[key] = value;
  } else {
    throw new Error(
      `Got type ${ref === "null" ? "null" : typeof ref} but expected type "object"`,
    );
  }
}

const ToggleableArea = ({
  children,
  defaultChecked,
  onCheckedChange,
  wrapSwitch = (item) => item,
  ...props
}: React.ComponentProps<"div"> & {
  onCheckedChange?: (checked: boolean) => void;
  wrapSwitch?: (switchElement: JSX.Element) => JSX.Element;
}) => {
  const [checked, setChecked] = useState<boolean>(defaultChecked ?? true);
  return (
    <div {...props}>
      {wrapSwitch(
        <Switch
          defaultChecked={defaultChecked ?? true}
          onCheckedChange={(checked) => {
            setChecked(checked);
            onCheckedChange && onCheckedChange(checked);
          }}
        ></Switch>,
      )}
      <div hidden={!checked}>{children}</div>
    </div>
  );
};

const XTermRemoteTty = ({
  api,
  auth,
  id,
}: {
  api: apiClient.ApiClient;
  auth: AuthState;
  id: string;
}) => {
  const dataStateRef = useRef<Awaited<
    ReturnType<typeof api.server.remoteTty>
  > | null>(null);
  const instanceRef = useRef<Terminal | null>(null);
  const chunks: (Uint8Array | string)[] = [];

  useEffect(() => {
    let socket: WebSocket | undefined;
    let canceled: boolean = false;
    const remoteTtyPromise = api.server.remoteTty(id, {});
    remoteTtyPromise.then((value) => {
      if (canceled) {
        value.socket.close();
      } else {
        socket = value.socket;
        value.setListener((data) => {
          chunks.push(data);
          if (instanceRef.current !== null) {
            instanceRef.current.write(data);
          }
        });
        socket.addEventListener(
          "close",
          () => {
            console.log("CLOSED");
            dataStateRef.current = null;
          },
          { once: true },
        );
        dataStateRef.current = value;
      }
    });
    return () => {
      console.log("CANCELING");
      if (socket === undefined) {
        canceled = true;
      } else {
        socket.close();
      }
    };
  }, [id]);
  const terminal = useMemo(
    () => (
      <XTerm
        listeners={{
          onData: (data) => {
            if (dataStateRef.current !== null) {
              dataStateRef.current.socket.send(data);
            }
          },
        }}
        options={{
          ...apiDefinitions.ApiTypes.ServerManagement.ServerTty.TtyTypes
            .terminalSize,
        }}
        instanceRef={instanceRef}
      />
    ),
    [],
  );
  useEffect(() => {
    if (instanceRef.current !== null) {
      console.log(chunks);
      for (const line of chunks) {
        instanceRef.current.write(line);
      }
    }
  }, [instanceRef]);
  return terminal;
};

const ServerConfigurationInternal = ({
  rendered,
  initialData,
  api,
  auth,
  id,
}: {
  rendered: ReturnType<typeof renderCombinedMappings>;
  initialData: Awaited<
    ReturnType<typeof apiClient.ApiClient.prototype.server.getConfig>
  >;
  api: apiClient.ApiClient;
  auth: AuthState;
  id: string;
}) => {
  const [config, setConfig] =
    useState<apiDefinitions.ManagementTypes.ServerConfiguration>(
      structuredClone(initialData.information.configuration),
    );
  const [fileUploads, setFileUploads] = useState<Record<string, File>>({});
  const [activeGroup, setActiveGroup] = useState<(typeof configGroups)[number]>(
    configGroups[0],
  );

  const save = () =>
    toast
      .promise(
        async () => {
          console.log(config);
          const savePromises: Promise<void>[] = [];
          savePromises.push(
            api.server
              .updateConfig(id!, {
                configuration: config,
              })
              .then(() => {}),
          );
          for (const [name, file] of Object.entries(fileUploads)) {
            savePromises.push(
              (async () => {
                const { url } = await api.server.filePresign(id!, {
                  mimeType: file.type,
                  name,
                  type: "upload",
                } as any);
                const response = await fetch(url, {
                  method: "PUT",
                  headers: { "Content-Type": file.type },
                  body: file,
                });
                if (!response.ok) {
                  throw new Error(
                    `Response is not ok: got ${response.status} ${response.statusText}`,
                  );
                }
              })(),
            );
          }
          setFileUploads({});
          await Promise.all(savePromises);
        },
        {
          loading: "Saving...",
          success: (data) => `Saved successfully`,
          error: "Error",
        },
      )
      .unwrap();

  const elements = useMemo(() => {
    function buildUi(
      rendered: ReturnType<typeof renderCombinedMappings>,
      configValue: Record<string, unknown>,
    ) {
      const elements = [];
      for (const renderedItem of rendered) {
        const chain = ["configuration", ...renderedItem.chain];
        let gotItem = getChain(configValue, chain, {
          enable: true,
          value: undefined,
        });
        if (gotItem === undefined) {
          if (renderedItem.item.type === "defineArea") {
          } else if (renderedItem.item.type === "file") {
          } else {
            const item = structuredClone(renderedItem.item.default);
            setChain(configValue, chain, item);
            gotItem = item;
          }
        }
        if (renderedItem.item.type === "bool") {
          elements.push(
            <FieldRow label={renderedItem.item.name}>
              <Switch
                defaultChecked={gotItem as boolean}
                onCheckedChange={(value) => setChain(configValue, chain, value)}
              />
            </FieldRow>,
          );
        } else if (renderedItem.item.type === "textComponent") {
          elements.push(
            <FieldRow label={renderedItem.item.name}>
              <TextEditor
                initial={
                  gotItem as serverCfg.configuration.textComponent.TextComponent[]
                }
                onChange={(value) => setChain(configValue, chain, value)}
              />
            </FieldRow>,
          );
        } else if (renderedItem.item.type === "number") {
          elements.push(
            <FieldRow label={renderedItem.item.name}>
              <NumberInput
                defaultValue={gotItem as number}
                min={renderedItem.item.min}
                max={renderedItem.item.max}
                onValueChange={(value) => setChain(configValue, chain, value)}
              />
            </FieldRow>,
          );
        } else if (renderedItem.item.type === "file") {
          let file: File | null = null;
          const pathName = (
            renderedItem.item as Rendering.FileRenderInstruction
          ).pathName;
          const mimeType =
            mime.lookup(pathName) ||
            (pathName.endsWith(".tar.zst") ? "application/zstd" : undefined) ||
            "application/octet-stream";
          const mimeExtensions = mime.extensions[mimeType] || [
            extname(pathName),
          ];
          //const [file, setFile] = useState<File | null>(null);
          elements.push(
            <FieldRow label={renderedItem.item.name}>
              <Button
                variant="outline"
                onClick={async () => {
                  // Safe, at least until filePresign changes the api
                  const { url } = await api.server.filePresign(id!, {
                    type: "download",
                    name: pathName,
                  } as any);
                  const a = document.createElement("a");
                  a.href = url;
                  document.body.appendChild(a);
                  a.click();
                  document.body.removeChild(a);
                }}
              >
                Download
              </Button>
              <Dialog>
                <DialogTrigger asChild>
                  <Button variant="outline">Upload</Button>
                </DialogTrigger>
                <DialogContent>
                  <DialogHeader>
                    <DialogTitle>
                      Upload file for field {renderedItem.item.name}
                    </DialogTitle>
                  </DialogHeader>

                  <p className="text-sm text-muted-foreground">
                    The file will be added once this configuration is saved
                  </p>

                  <FileUpload
                    layout="vertical"
                    uploadMode="single"
                    maxSize={4 * 1024 * 1024 * 1024} // 4 GiB max. This should be enforced on the server too.
                    onFilesUploaded={(files) => {
                      if (files.length > 0) {
                        // setFile(files[0]!);
                        file = files[0]!;
                      } else {
                        // setFile(null);
                        file = null;
                      }
                    }}
                    acceptedFileTypes={{
                      [mimeType]: mimeExtensions,
                    }}
                    otherText={"No larger than 4 GiB"}
                  ></FileUpload>
                  <div className="flex justify-end gap-2 mt-4">
                    <DialogClose asChild>
                      <Button variant="ghost">Cancel</Button>
                    </DialogClose>
                    <DialogClose asChild>
                      <Button
                        variant="default"
                        onClick={() => {
                          if (file !== null) {
                            setFileUploads({
                              ...fileUploads,
                              [pathName]: file,
                            });
                          }
                        }}
                      >
                        Upload
                      </Button>
                    </DialogClose>
                  </div>
                </DialogContent>
              </Dialog>
            </FieldRow>,
          );
        } else if (renderedItem.item.type === "string") {
          elements.push(
            <FieldRow label={renderedItem.item.name}>
              <Input
                type="text"
                defaultValue={gotItem as string}
                onChange={(e) => setChain(configValue, chain, e.target.value)}
              />
            </FieldRow>,
          );
        } else if (renderedItem.item.type === "vec3") {
          const usingInitial = gotItem as [number, number, number];
          const state = usingInitial.slice();
          elements.push(
            <FieldRow label={renderedItem.item.name}>
              <NumberInput
                defaultValue={usingInitial[0]}
                min={-Infinity}
                max={Infinity}
                onValueChange={(value) => {
                  state[0] = value!;
                  setChain(configValue, chain, state);
                }}
              />
              <NumberInput
                defaultValue={usingInitial[1]}
                min={-Infinity}
                max={Infinity}
                onValueChange={(value) => {
                  state[1] = value!;
                  setChain(configValue, chain, state);
                }}
              />
              <NumberInput
                defaultValue={usingInitial[2]}
                min={-Infinity}
                max={Infinity}
                onValueChange={(value) => {
                  state[2] = value!;
                  setChain(configValue, chain, state);
                }}
              />
            </FieldRow>,
          );
        } else if (renderedItem.item.type === "option") {
          elements.push(
            <FieldRow label={renderedItem.item.name}>
              <Select
                defaultValue={gotItem as string}
                onValueChange={(value) => setChain(configValue, chain, value)}
              >
                <SelectTrigger className="w-full max-w-48">
                  <SelectValue placeholder="Select a value" />
                </SelectTrigger>
                <SelectContent>
                  <SelectGroup>
                    {renderedItem.item.choices.map((value) => (
                      <SelectItem value={value}>{value}</SelectItem>
                    ))}
                  </SelectGroup>
                </SelectContent>
              </Select>
            </FieldRow>,
          );
        } else if (renderedItem.item.type === "defineArea") {
          const subConfig = {};
          const subConfigItem = structuredClone(gotItem) ?? {};
          {
            let ref: any = subConfig;
            for (const key of chain.slice(0, -1)) {
              ref[key] = {};
              ref = ref[key];
            }
            ref[chain[chain.length - 1]!] = subConfigItem;
          }

          setChain(
            configValue,
            chain,
            gotItem !== undefined ? subConfigItem : undefined,
          );
          // This expects that setChain does not clone the input value
          elements.push(
            <ToggleableArea
              defaultChecked={gotItem !== undefined}
              onCheckedChange={(checked) => {
                setChain(
                  configValue,
                  chain,
                  checked ? subConfigItem : undefined,
                );
              }}
              wrapSwitch={(switchElement) => (
                <FieldRow label={renderedItem.item.name}>
                  {switchElement}
                </FieldRow>
              )}
            >
              {buildUi(renderedItem.item.children, subConfig)}
            </ToggleableArea>,
          );
        } else if (renderedItem.item.type === "array") {
          throw new Error(
            "Not supported as I am too lazy to make the UI for this",
          );
        } else {
          throw new Error(
            // @ts-ignore
            `Unknown rendered item type ${renderedItem.item.type}`,
          );
        }
      }
      return elements;
    }
    return buildUi(rendered, config);
  }, [rendered]);

  const [confirmDelete, setConfirmDelete] = useState<boolean>(false);

  const navigate = useNavigate();

  return (
    <div className="p-6 grid grid-cols-[220px_1fr] gap-6">
      <Card>
        <CardContent className="space-y-2 pt-4">
          {configGroups.map((g) => (
            <Button
              key={g}
              variant={activeGroup === g ? "default" : "ghost"}
              className="w-full justify-start"
              onClick={() => setActiveGroup(g)}
            >
              {g}
            </Button>
          ))}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{activeGroup}</CardTitle>
        </CardHeader>

        <CardContent>
          {activeGroup === "Metadata" && (
            <div className="space-y-3">
              <FieldRow label="Enabled">
                <Switch
                  defaultChecked={config.enabled}
                  onCheckedChange={(value) =>
                    setConfig({ ...config, enabled: value })
                  }
                />
              </FieldRow>
              <FieldRow label="Public server">
                <Switch
                  defaultChecked={config.public}
                  onCheckedChange={(value) =>
                    setConfig({ ...config, public: value })
                  }
                />
              </FieldRow>
              <FieldRow label="Name">
                <Input
                  value={config.name}
                  onChange={(e) =>
                    setConfig({ ...config, name: e.target.value })
                  }
                />
              </FieldRow>
              <FieldRow label="Version">
                <Input
                  value={config.version}
                  onChange={(e) =>
                    setConfig({ ...config, version: e.target.value })
                  }
                />
              </FieldRow>
            </div>
          )}

          {activeGroup === "Server configuration" && (
            <div className="space-y-3">{elements}</div>
          )}

          {activeGroup === "Player list" && (
            <div className="space-y-3">
              <p className="font-xl font-bold">Active players</p>
              <div className="space-y-2">
                {initialData.information.information.players.map((p) => (
                  <div
                    key={serverCfg.handlers.stringifyUuid(p.uuid)}
                    className="flex justify-between py-2"
                  >
                    <span>{p.username}</span>
                    <span className="text-xs text-muted-foreground">
                      {serverCfg.handlers.stringifyUuid(p.uuid)}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {activeGroup === "Terminal" && (
            <div className="space-y-3">
              <XTermRemoteTty api={api} auth={auth} id={id} />
            </div>
          )}

          {activeGroup === "Danger zone" && (
            <div className="space-y-3">
              <Button
                variant="destructive"
                onClick={() => setConfirmDelete(true)}
              >
                Delete server
              </Button>
              {/* Confirm delete dialog */}
              <Dialog open={confirmDelete} onOpenChange={setConfirmDelete}>
                <DialogContent>
                  <DialogHeader>
                    <DialogTitle>Delete Server?</DialogTitle>
                  </DialogHeader>

                  <p className="text-sm text-muted-foreground">
                    This action cannot be undone.
                  </p>

                  <div className="flex justify-end gap-2 mt-4">
                    <Button
                      variant="ghost"
                      onClick={() => setConfirmDelete(false)}
                    >
                      Cancel
                    </Button>
                    <Button
                      variant="destructive"
                      onClick={() =>
                        (async () => {
                          await api.server.delete(id, {});
                          setConfirmDelete(false);
                          navigate({ pathname: "/dashboard/servers" });
                        })()
                      }
                    >
                      Delete
                    </Button>
                  </div>
                </DialogContent>
              </Dialog>
            </div>
          )}

          {...savableConfigGroups.includes(activeGroup)
            ? [
                <Separator className="my-4" />,
                <Button onClick={save}>Save Changes</Button>,
              ]
            : []}
        </CardContent>
      </Card>
    </div>
  );
};
const ServerDetail = () => {
  const { id } = useParams();
  const api = useApi();
  const { auth } = useAuth();

  // Once support for choosing your minecraft server type is added, this will need to be edited
  const { rendered } = useMemo(() => {
    const vanillaGroup = new serverCfg.handlers.handlers.HandlerGroup([
      serverCfg.handlers.vanilla.BasicVanillaHandler,
    ]);

    const handled = vanillaGroup.getHandled();

    const requiredSchema = apiDefinitions.removeZodObjectItemsRecursive(
      serverCfg.handlers.handlers.MappingsZodInterop.combineMappings(
        serverCfg.configuration.GameServerConfiguration,
        handled,
      ) as z.ZodMiniObject,
      apiDefinitions.ManagedServerParameters,
    );

    const rendered = renderCombinedMappings(requiredSchema, []);

    return { handled, requiredSchema, rendered };
  }, []);

  const initialConfigPromise = useMemo(() => {
    return api.server.getConfig(id!, {});
  }, [id]);

  const [initialConfig, setInitialConfig] = useState<Awaited<
    typeof initialConfigPromise
  > | null>(null);

  useEffect(() => {
    setInitialConfig(null);
    let callback = (value: Awaited<typeof initialConfigPromise>) =>
      setInitialConfig(value);
    initialConfigPromise.then((value) => callback(value));
    return () => {
      callback = () => {};
    };
  }, [initialConfigPromise]);

  if (initialConfig === null || !id) {
    return <div className="p-6">Loading...</div>;
  } else {
    return (
      <ServerConfigurationInternal
        rendered={rendered}
        initialData={initialConfig}
        api={api}
        auth={auth}
        id={id}
      />
    );
  }
};

// ---------------------------
// SERVER AUTHENTICATION
// ---------------------------

const ServerAuthLander = () => {
  const [searchParams] = useSearchParams();
  const token = searchParams.get("token");
  if (token === null) {
    throw new Error("Missing required search parameters");
  }
  let fixedToken: string;
  try {
    fixedToken = CrockfordBase32.encode(
      CrockfordBase32.decode(token, { asNumber: false }),
    );
  } catch (e) {
    throw new Error("Invalid token");
  }
  searchParams.set("token", fixedToken);
  return (
    /*<Link
      to={{
        pathname: "/serverAuth/search",
        search: `?${searchParams.toString()}`,
      }}
      className="text-xl"
    >
      Search for servers
    </Link>*/
    <Navigate
      to={{
        pathname: "/serverAuth/search",
        search: `?${searchParams.toString()}`,
      }}
      replace
    />
  );
};

const ServerAuthCallback = () => {
  const { id } = useParams();
  if (id === undefined) {
    throw new Error("Missing required route parameters");
  }
  const [searchParams] = useSearchParams();
  const token = searchParams.get("token");
  if (token === null) {
    throw new Error("Missing required search parameters");
  }
  const api = useApi();
  const connectionPromise = useMemo(
    () =>
      api.serverAuth.connect({
        connectionToken: token,
        id,
      }),
    [token],
  );

  const [status, setStatus] = useState<"loading" | "loaded">("loading");

  // Set state automatically
  useEffect(() => {
    let mounted = true;

    connectionPromise.then(() => {
      if (!mounted) return;

      setStatus("loaded");
    });

    return () => {
      mounted = false;
    };
  }, [connectionPromise]);

  return (
    <div className="fixed inset-0 flex items-center justify-center bg-background">
      <div className="flex flex-col items-center gap-6 text-center">
        {status === "loading" && (
          <>
            <Loader2 className="h-10 w-10 animate-spin text-muted-foreground" />
            <div className="space-y-2">
              <h1 className="text-lg font-semibold">Sending switch request</h1>
              <p className="text-sm text-muted-foreground">
                Connecting to the server and switching your Minecraft session…
              </p>
            </div>
          </>
        )}

        {status === "loaded" && (
          <>
            <CheckCircle2 className="h-10 w-10 text-green-500" />
            <div className="space-y-2">
              <h1 className="text-lg font-semibold">Switch complete</h1>
              <p className="text-sm text-muted-foreground">
                You can return to Minecraft now.
              </p>
            </div>
          </>
        )}
      </div>
    </div>
  );
};

// ---------------------------
// ROUTES
// ---------------------------

const Dashboard = () => (
  <RequireAuth>
    <SidebarLayout>
      <Routes>
        <Route path="/servers" element={<ServerList />} />
        <Route path="/servers/:id" element={<ServerDetail />} />
        <Route
          path="/all-servers"
          element={<AllServers onlyEnabled={true} />}
        />
      </Routes>
    </SidebarLayout>
  </RequireAuth>
);

const ServerAuth = () => (
  <Routes>
    <Route path="/lander" element={<ServerAuthLander />} />
    <Route
      path="/search"
      element={
        <RequireAuth>
          <AllServers
            linkBase={{
              pathname: "/serverAuth/callback",
              search: `?${useSearchParams()[0].toString()}`,
            }}
            onlyEnabled={true}
          ></AllServers>
        </RequireAuth>
      }
    />
    <Route path="/callback/:id" element={<ServerAuthCallback />} />
  </Routes>
);
// ---------------------------
// APP ROOT
// ---------------------------

export const App = () => (
  <div className="text-foreground dark">
    <AuthProvider>
      <ApiProvider>
        <BrowserRouter>
          <Routes>
            {/*Redirect to dashboard. TODO: Add a home page here*/}
            <Route path="/" element={<Navigate to="/dashboard" replace />} />
            {/*Authentication routes */}
            <Route path="/login" element={<Login />} />
            <Route path="/register" element={<Register />} />
            {/* Server authentication */}
            <Route path="/serverAuth/*" element={<ServerAuth />} />
            {/* Dashboard routes */}
            <Route path="/dashboard/*" element={<Dashboard />} />
          </Routes>
        </BrowserRouter>
      </ApiProvider>
    </AuthProvider>
  </div>
);
