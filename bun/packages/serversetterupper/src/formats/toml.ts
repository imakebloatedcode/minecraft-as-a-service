import { stringify, type TomlTable } from "smol-toml";
export function dumpStructure(value: TomlTable) {
  return stringify(value);
}
