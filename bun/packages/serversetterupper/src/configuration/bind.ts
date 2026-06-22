import { z } from "zod/mini";

export const IPAddressBase = z.object({
  version: z.number(),
  address: z.string(),
});
export type IPAddressBase = z.infer<typeof IPAddressBase>;

export const IPv4 = z.extend(IPAddressBase, {
  version: z.literal(4),
  address: z.ipv4(),
});
export type IPv4 = z.infer<typeof IPv4>;

export const IPv6 = z.extend(IPAddressBase, {
  version: z.literal(6),
  address: z.ipv6(),
});
export type IPv6 = z.infer<typeof IPv6>;

export const IpAddress = z.union([IPv4, IPv6]);
export type IpAddress = z.infer<typeof IpAddress>;

export const BindSpecifier = z.object({ ip: IpAddress, port: z.number() });
export type BindSpecifier = z.infer<typeof BindSpecifier>;
