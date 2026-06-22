export const gamemodes = [
  "adventure",
  "spectator",
  "survival",
  "creative",
] as const;
export const difficulties = ["peaceful", "easy", "normal", "hard"] as const;
export const proxySchemes = {
  secure: ["bungeeguard", "velocity"],
  insecure: ["bungeecord"],
} as const;
