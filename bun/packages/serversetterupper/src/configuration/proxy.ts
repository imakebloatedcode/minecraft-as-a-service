import { BindSpecifier } from "./bind";
import { proxySchemes } from "../support/index";
import { z, ZodMiniLiteral } from "zod/mini";

type LiteralAble = string | number | bigint | boolean;
type UnReadonlyArray<T extends readonly unknown[]> = T extends readonly [
  ...infer V,
]
  ? V
  : never;
type ZLiteralize<
  S extends LiteralAble[],
  R extends ZodMiniLiteral[] = [],
> = S extends [infer I extends LiteralAble, ...infer Rest extends LiteralAble[]]
  ? ZLiteralize<Rest, [...R, ZodMiniLiteral<I>]>
  : R;
// We specify the available proxy schemes externally
export namespace ProxyScheme {
  export const BaseScheme = z.object({ type: z.string() });
  export type BaseScheme = z.infer<typeof BaseScheme>;

  export const SecuredProxyScheme = z.extend(BaseScheme, {
    type: z.union(
      proxySchemes.secure.map((v) => z.literal(v)) as ZLiteralize<
        UnReadonlyArray<typeof proxySchemes.secure>
      >,
    ),
    secrets: z.array(z.string()),
  });
  export type SecuredProxyScheme = z.infer<typeof SecuredProxyScheme>;

  export const InsecureProxyScheme = z.extend(BaseScheme, {
    type: z.union(
      proxySchemes.insecure.map((v) => z.literal(v)) as ZLiteralize<
        UnReadonlyArray<typeof proxySchemes.insecure>
      >,
    ),
  });
  export type InsecureProxyScheme = z.infer<typeof InsecureProxyScheme>;

  export const ProxyScheme = z.union([SecuredProxyScheme, InsecureProxyScheme]);
  export type ProxyScheme = z.infer<typeof ProxyScheme>;
}

export const ProxyConfiguration = z.object({
  servers: z.record(z.uuidv4(), BindSpecifier), // UUIDv4 because sometimes there are server names you can't use and a uuidv4 is a safe bet
  scheme: ProxyScheme.ProxyScheme,
});
export type ProxyConfiguration = z.infer<typeof ProxyConfiguration>;
