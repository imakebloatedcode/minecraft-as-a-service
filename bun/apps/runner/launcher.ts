import { join } from "path";
import { unpackBundledJar, unpackFatJar } from "./serverSetup";
import { mkdtemp, rm, readFile, exists, writeFile, mkdir } from "fs/promises";
import { Readable } from "stream";
import { pipeline } from "stream/promises";
import { createWriteStream } from "fs";

const cwd = process.cwd();

export const minecraftExtractBase =
  process.env.EXTRACT_BASE ?? join(cwd, "mcData");

const mcTmp = join(minecraftExtractBase, "tmp");

const assetsDirectory = join(minecraftExtractBase, "assets");
const dbFile = join(minecraftExtractBase, "db.json");

namespace Types {
  export type VersionType = "release" | "snapshot" | "old_beta" | "old_alpha";
  export interface VersionInfo {
    id: string;
    type: VersionType;
    url: string;
    time: string;
    releaseTime: string;
    sha1: string;
    complianceLevel: 0 | 1;
  }
  export interface VersionManifestV2 {
    latest: {
      release: string;
      snapshot: string;
    };
    versions: VersionInfo[];
  }
}
class VersionManifestCache {
  lastDownloadTime: number = 0;
  #cached: Types.VersionManifestV2 | undefined;
  constructor() {}
  async get() {
    const cacheTime = 5 * 60 * 1000; // 5 minutes
    if (
      this.lastDownloadTime + cacheTime > Date.now() &&
      this.#cached !== undefined
    ) {
      // Cache is not expired
      return this.#cached;
    } else {
      const response = await fetch(
        "https://launchermeta.mojang.com/mc/game/version_manifest_v2.json",
      );
      if (!response.ok) {
        throw new Error(
          `Got status code ${response.status} ${response.statusText} when downloading the minecraft version index`,
        );
      }
      this.#cached = (await response.json()) as Types.VersionManifestV2;
      this.lastDownloadTime = Date.now();
      return this.#cached!;
    }
  }
}

export class Lock {
  #queue: (() => void)[];
  #locked: boolean = false;
  constructor() {
    this.#queue = [];
  }
  acquire() {
    if (this.#locked) {
      return new Promise<void>((resolve) => this.#queue.push(resolve));
    } else {
      this.#locked = true;
      return Promise.resolve();
    }
  }
  release() {
    if (this.#queue.length === 0) {
      this.#locked = false;
    } else {
      this.#queue.shift()!();
    }
  }
}

const versionManifestCache = new VersionManifestCache();
let fatJarVersions: string[] | undefined;

async function isFatJar(version: string) {
  if (fatJarVersions) {
    return fatJarVersions.includes(version);
  } else {
    const versions = await versionManifestCache.get();
    fatJarVersions = versions.versions
      .slice(versions.versions.findIndex((value) => value.id === "21w39a"))
      .map((v) => v.id);
  }
}

const downloadLock = new Lock();

export interface LaunchInfo {
  classpath: string[];
  jarPath: string;
  mainClass: string;
  javaMajorVersion: number;
}

async function downloadVersion(
  version: string,
  useLock: boolean = true,
  transformJar?: (inPath: string, tempDir: string) => string | Promise<string>,
): Promise<LaunchInfo> {
  if (useLock) {
    await downloadLock.acquire();
  }
  // Initialize layout
  if (!(await exists(minecraftExtractBase))) {
    await mkdir(minecraftExtractBase);
  }
  if (!(await exists(assetsDirectory))) {
    await mkdir(assetsDirectory);
  }
  if (!(await exists(mcTmp))) {
    await mkdir(mcTmp);
  }
  // Code
  const versions = await versionManifestCache.get();
  const versionInfoIdx = versions.versions.findIndex(
    (item) => item.id === version,
  );
  if (versionInfoIdx === -1) {
    throw new Error(`Version ${version} not found`);
  }
  const versionData = versions.versions[versionInfoIdx]!;

  const tempPath = await mkdtemp(join(mcTmp, "data-"));

  try {
    const jarPath = join(tempPath, "server.jar");
    let javaMajorVersion: number;
    {
      let serverDownloadUrl: string;
      {
        const manifest = await fetch(versionData.url);
        if (manifest.ok) {
          const data = (await manifest.json()) as any;
          serverDownloadUrl = data.downloads.server.url;
          javaMajorVersion = data.javaVersion.majorVersion;
        } else {
          throw new Error(
            `Got status code ${manifest.status} ${manifest.statusText} when requesting url ${versionData.url} to download version ${version}`,
          );
        }
      }

      const response = await fetch(serverDownloadUrl);
      if (response.ok) {
        if (!response.body) {
          throw new Error("Expected response body");
        }
        const stream = Readable.fromWeb(response.body);
        await pipeline(stream, createWriteStream(jarPath));
      } else {
        throw new Error(
          `Got status code ${response.status} ${response.statusText} when requesting url ${versionData.url} to download version ${version}`,
        );
      }
    }

    let useJarPath: string;
    if (transformJar) {
      useJarPath = await transformJar(jarPath, tempPath);
    } else {
      useJarPath = jarPath;
    }
    const isFat = await isFatJar(version);

    let info: LaunchInfo;
    if (isFat) {
      info = {
        ...(await unpackFatJar(useJarPath, assetsDirectory)),
        javaMajorVersion,
      };
    } else {
      info = {
        ...(await unpackBundledJar(useJarPath, tempPath, assetsDirectory)),
        javaMajorVersion,
      };
    }

    const db = (await exists(dbFile))
      ? JSON.parse((await readFile(dbFile)).toString())
      : { versions: {} };

    // Assume db is valid
    db.versions[version] = info;

    await writeFile(dbFile, JSON.stringify(db));

    return info;
  } finally {
    try {
      if (useLock) {
        downloadLock.release();
      }
    } finally {
      await rm(tempPath, { recursive: true, force: true });
    }
  }
}

async function tryUseDb(version: string) {
  if (await exists(dbFile)) {
    const db = JSON.parse((await readFile(dbFile)).toString());
    if (version in db.versions) {
      return db.versions[version];
    }
  }
}

export async function launchInfo(
  version: string,
  transformJar?: (inPath: string, tempDir: string) => string | Promise<string>,
): Promise<LaunchInfo> {
  {
    const tryResult = await tryUseDb(version);
    if (tryResult !== undefined) {
      return tryResult;
    }
  }

  await downloadLock.acquire();
  try {
    {
      const tryResult = await tryUseDb(version);
      if (tryResult !== undefined) {
        return tryResult;
      }
    }
    // The await is required because of the lock
    return await downloadVersion(version, false, transformJar);
  } finally {
    downloadLock.release();
  }
}
