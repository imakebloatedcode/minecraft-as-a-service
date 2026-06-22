import { open } from "yauzl-promise";
import { exists, mkdir, rename } from "fs/promises";
import { pipeline } from "stream/promises";
import { createReadStream, createWriteStream } from "fs";
import type { Readable } from "stream";
import { createHash } from "crypto";
import { dirname, join } from "path";

async function readStream(stream: Readable) {
  const chunks: Buffer[] = [];
  for await (const chunk of stream) {
    chunks.push(chunk);
  }
  return Buffer.concat(chunks as unknown as Uint8Array[]);
}

function unpad(str: string, startsWith: string) {
  let stringIdx = 0;
  while (str.startsWith(startsWith, stringIdx)) {
    stringIdx += startsWith.length;
  }
  return str.slice(stringIdx);
}

// On version 26.1.2 somehow this triggers issues with the precompiled regex (no line.trim in the version that had that issue)
const librariesListRegex = () =>
  /^(?<hash>[a-z0-9]*)\s*(?<group>[^\s:]*):(?<artifact>[^\s:]*):((?<architecture>[^\s:]*):)?(?<version>[^\s:]*)\s*(?<path>.*)$/gm;
function parseLibrariesList(content: string) {
  const result: {
    hash: string;
    group: string;
    artifact: string;
    version: string;
    path: string;
  }[] = [];
  for (const line of content.split("\n")) {
    if (line.trim() === "") {
      continue;
    }
    const matches = librariesListRegex().exec(line);
    if (matches !== null) {
      // Safe
      result.push(matches.groups as any);
    } else {
      throw new Error(`Failed to parse line ${line}`);
    }
  }
  return result;
}
const versionsListRegex = () =>
  /^(?<hash>[a-z0-9]*)\s*(?<version>[^\s:]*)\s*(?<path>.*)$/gm;
function parseVersionsList(content: string) {
  const result: {
    hash: string;
    version: string;
    path: string;
  }[] = [];
  for (const line of content.split("\n")) {
    const matches = versionsListRegex().exec(line);
    if (matches !== null) {
      // Safe
      result.push(matches.groups as any);
    }
  }
  return result;
}

export async function unpackBundledJar(
  path: string,
  unpackTempPath: string,
  outputDirectory: string,
) {
  const extractList = ["META-INF/versions/", "META-INF/libraries/"];
  const zip = await open(path, { decodeStrings: true });

  let librariesList: ReturnType<typeof parseLibrariesList> | undefined;
  let versionsList: ReturnType<typeof parseVersionsList> | undefined;
  let mainClass: string | undefined;
  let classpath: string[] | undefined;
  try {
    for await (const entry of zip) {
      const fileName = unpad(entry.filename as string, "/");

      if (extractList.findIndex((value) => fileName.startsWith(value)) !== -1) {
        if (!(entry.filename as string).endsWith("/")) {
          const path = `${unpackTempPath}/${entry!.filename}`;
          if (!(await exists(dirname(path)))) {
            await mkdir(dirname(path), { recursive: true });
          }
          const readStream = await entry.openReadStream({});
          const writeStream = createWriteStream(path);
          await pipeline(readStream, writeStream);
        }
      } else if (fileName === "META-INF/libraries.list") {
        const data = (
          await readStream(await entry.openReadStream({}))
        ).toString();
        const parsed = parseLibrariesList(data);

        librariesList = parsed;
      } else if (fileName === "META-INF/versions.list") {
        const data = (
          await readStream(await entry.openReadStream({}))
        ).toString();
        const parsed = parseVersionsList(data);

        versionsList = parsed;
      } else if (fileName === "META-INF/main-class") {
        const data = (
          await readStream(await entry.openReadStream({}))
        ).toString();
        mainClass = data;
      } else if (fileName === "META-INF/classpath-joined") {
        const data = (
          await readStream(await entry.openReadStream({}))
        ).toString();
        classpath = data.split(";");
      } else {
        // Unhandled file, ignore it
      }
    }
  } finally {
    await zip.close();
  }

  // Verification
  if (librariesList === undefined) {
    throw new Error("Missing libraries list");
  }
  if (versionsList === undefined) {
    throw new Error("Missing versions list");
  }
  if (mainClass === undefined) {
    throw new Error("Missing main class pointer");
  }
  if (classpath === undefined) {
    throw new Error("Missing classpath list");
  }

  // Main
  {
    const getDataTasks: Promise<{
      type: "library" | "other";
      hash: Uint8Array;
      path: string;
      jarPath: string;
    }>[] = [];
    for (const { hash, path } of librariesList) {
      const jarPath = `META-INF/libraries/${path}`;
      const fullPath = `${unpackTempPath}/${jarPath}`;
      getDataTasks.push(
        (async () => {
          const hasher = createHash("sha256");
          const assetMapHasher = createHash("sha512");

          for await (const chunk of createReadStream(fullPath)) {
            hasher.update(chunk);
            assetMapHasher.update(chunk);
          }
          const gotHash = hasher.digest().toString("hex");
          if (hash !== gotHash) {
            throw new Error(
              `Hash mismatch on library at path ${path} in jar, got ${gotHash} but expected ${hash}`,
            );
          }

          return {
            type: "library",
            hash: assetMapHasher.digest() as unknown as Uint8Array,
            path: fullPath,
            jarPath: jarPath,
          };
        })(),
      );
    }
    for (const { hash, path } of versionsList) {
      const jarPath = `META-INF/versions/${path}`;
      const fullPath = `${unpackTempPath}/${jarPath}`;
      getDataTasks.push(
        (async () => {
          const hasher = createHash("sha256");
          const assetMapHasher = createHash("sha512");

          for await (const chunk of createReadStream(fullPath)) {
            hasher.update(chunk);
            assetMapHasher.update(chunk);
          }
          const gotHash = hasher.digest().toString("hex");
          if (hash !== gotHash) {
            throw new Error(
              `Hash mismatch on library at path ${path} in jar, got ${gotHash} but expected ${hash}`,
            );
          }

          return {
            type: "library",
            hash: assetMapHasher.digest() as unknown as Uint8Array,
            path: fullPath,
            jarPath: jarPath,
          };
        })(),
      );
    }

    const fileMeta = await Promise.all(getDataTasks);

    // Jar-internal -> relative to hash store
    const fileLocationMap: Record<string, string> = {};
    // Move files
    for (const file of fileMeta) {
      const fileStringifiedHash = file.hash.toHex();
      const directoryName = fileStringifiedHash.slice(0, 2);
      const fileName = fileStringifiedHash.slice(2);

      const fullDirectoryPath = join(outputDirectory, directoryName);
      if (!(await exists(fullDirectoryPath))) {
        await mkdir(fullDirectoryPath);
      }

      const fullPath = join(fullDirectoryPath, fileName);
      // Safe to run async from this point on, but not too much of a point
      // The files should be identical, so don't overwrite
      if (!(await exists(fullPath))) {
        await rename(file.path, fullPath);
      }

      fileLocationMap[file.jarPath] = join(directoryName, fileName);
    }

    // Generate mapped classpath
    const newClasspath = classpath.map((value) => {
      const jarPath = `META-INF/${value}`;
      const gotItem = fileLocationMap[jarPath];
      if (gotItem === undefined) {
        throw new Error(`Failed to locate library ${jarPath}`);
      }
      return gotItem;
    });

    const newJarPath =
      fileLocationMap["META-INF/versions/" + versionsList[0]!.path];
    if (!newJarPath) {
      throw new Error(`Failed to locate version ${versionsList[0]!.version}`);
    }

    return { classpath: newClasspath, jarPath: newJarPath, mainClass };
  }
}

export async function unpackFatJar(path: string, outputDirectory: string) {
  const assetMapHasher = createHash("sha512");
  for await (const chunk of createReadStream(path)) {
    assetMapHasher.update(chunk);
  }
  const fileStringifiedHash = assetMapHasher.digest().toHex();
  const directoryName = fileStringifiedHash.slice(0, 2);
  const fileName = fileStringifiedHash.slice(2);

  const fullDirectoryPath = join(outputDirectory, directoryName);
  if (!(await exists(fullDirectoryPath))) {
    await mkdir(fullDirectoryPath);
  }

  const fullPath = join(fullDirectoryPath, fileName);

  if (!(await exists(fullPath))) {
    await rename(path, fullPath);
  }

  return {
    classpath: [],
    jarPath: join(directoryName, fileName),
    // I hope all old minecraft versions use this
    mainClass: "net.minecraft.server.MinecraftServer",
  };
}
