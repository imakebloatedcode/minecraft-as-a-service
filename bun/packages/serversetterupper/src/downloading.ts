import { z } from "zod/mini";
import type { SomeType } from "zod/v4/core";

export type ArrayGenerate<
  L extends number,
  T,
  _ extends T[] = [],
> = _["length"] extends L ? _ : ArrayGenerate<L, T, [..._, T]>;
export type NumArrayGenerate<
  L extends number,
  _ extends number[] = [],
> = _["length"] extends L ? _ : NumArrayGenerate<L, [..._, _["length"]]>;
export type Shift<T extends unknown[]> = T extends [unknown, ...infer R]
  ? R
  : never;
export const ZodArrayGenerate = <
  const L extends Shift<NumArrayGenerate<100>>[number],
  const T extends SomeType,
>(
  length: L,
  type: () => T,
) =>
  z.tuple(
    Array(length)
      .fill(null)
      .map(() => type()) as Exclude<ArrayGenerate<L, T>, []>,
  );

export namespace HashCheck {
  // The const parameter is required to make typescript give the correct number of elements in typings
  export const makeHashCheck = <
    const S extends Parameters<typeof ZodArrayGenerate>[0],
  >(
    algorithmName: string,
    size: S,
  ) =>
    z.object({
      algorithm: z.literal(algorithmName),
      data: ZodArrayGenerate(size, () => z.number()),
    });

  export const Sha1HashCheck = makeHashCheck("sha1" as const, 20);
  export type Sha1HashCheck = z.infer<typeof Sha1HashCheck>;

  export const Sha128HashCheck = makeHashCheck("sha128" as const, 16);
  export type Sha128HashCheck = z.infer<typeof Sha128HashCheck>;

  export const Sha256HashCheck = makeHashCheck("sha256" as const, 32);
  export type Sha256HashCheck = z.infer<typeof Sha256HashCheck>;

  export const Sha512HashCheck = makeHashCheck("sha512" as const, 64);
  export type Sha512HashCheck = z.infer<typeof Sha512HashCheck>;

  export const HashCheck = z.union([
    Sha1HashCheck,
    Sha128HashCheck,
    Sha256HashCheck,
    Sha512HashCheck,
  ]);
  export type HashCheck = z.infer<typeof HashCheck>;
}

export namespace Download {
  export const UncheckedDownload = z.object({ url: z.url() });
  export type UncheckedDownload = z.infer<typeof UncheckedDownload>;

  export const Sha1CheckedDownload = z.extend(UncheckedDownload, {
    hash: HashCheck.Sha1HashCheck,
  });
  export type Sha1CheckedDownload = z.infer<typeof Sha1CheckedDownload>;

  export const Sha128CheckedDownload = z.extend(UncheckedDownload, {
    hash: HashCheck.Sha128HashCheck,
  });
  export type Sha128CheckedDownload = z.infer<typeof Sha128CheckedDownload>;

  export const Sha256CheckedDownload = z.extend(UncheckedDownload, {
    hash: HashCheck.Sha256HashCheck,
  });
  export type Sha256CheckedDownload = z.infer<typeof Sha256CheckedDownload>;

  export const Sha512CheckedDownload = z.extend(UncheckedDownload, {
    hash: HashCheck.Sha512HashCheck,
  });
  export type Sha512CheckedDownload = z.infer<typeof Sha512CheckedDownload>;

  export const CheckedDownload = z.union([
    Sha1CheckedDownload,
    Sha128CheckedDownload,
    Sha256CheckedDownload,
    Sha512CheckedDownload,
  ]);
  export type CheckedDownload = z.infer<typeof CheckedDownload>;

  export const Download = z.union([UncheckedDownload, CheckedDownload]);
  export type Download = z.infer<typeof Download>;
}

export namespace File {
  export const UncheckedFile = z.object({ path: z.array(z.string()) });
  export type UncheckedFile = z.infer<typeof UncheckedFile>;

  export const CheckedFile = z.extend(UncheckedFile, {
    hash: HashCheck.HashCheck,
  });
  export type CheckedFile = z.infer<typeof CheckedFile>;

  export const File = z.union([UncheckedFile, CheckedFile]);
  export type File = z.infer<typeof File>;
}

export type DataSource = Download.Download | File.File;
