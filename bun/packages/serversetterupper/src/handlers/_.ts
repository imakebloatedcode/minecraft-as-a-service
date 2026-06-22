import type { textComponent } from "../configuration/index";
import type { TextComponent } from "../configuration/textComponent";
import type { ArrayGenerate } from "../downloading";
import type { properties } from "../formats";
import { join } from "path";

export function formatChatComponent(components: TextComponent[]) {
  return {
    text: "",
    extra: components.map((value) => ({
      text: value.data,
      color: "#" + hexColor(value.formatting.color),

      bold: value.formatting.bold,
      italic: value.formatting.italic,
      obfuscated: value.formatting.obfuscated,
      strikethrough: value.formatting.strikethrough,
      underline: value.formatting.underline,
    })),
  };
}

export function toKeyval(
  source: Record<string, string | number | boolean>,
): properties.PropertiesType {
  return Object.fromEntries(
    Object.entries(source).map(([k, v]) => [
      k,
      typeof v === "boolean"
        ? v
          ? "true"
          : "false"
        : typeof v === "number"
          ? v.toString()
          : v,
    ]),
  );
}

export function hexNum(num: number) {
  return num.toString(16).padStart(2, "0");
}
export function hexColor(color: textComponent.RGB) {
  return hexNum(color.red) + hexNum(color.blue) + hexNum(color.green);
}

export function stringifyByteArray(byteArray: number[]) {
  return byteArray.map((v) => hexNum(v)).join("");
}

export function stringifyUuid(uuid: ArrayGenerate<16, number>) {
  return (
    stringifyByteArray(uuid.slice(0, 4)) +
    "-" +
    stringifyByteArray(uuid.slice(4, 6)) +
    "-" +
    stringifyByteArray(uuid.slice(6, 8)) +
    "-" +
    stringifyByteArray(uuid.slice(8, 10)) +
    "-" +
    stringifyByteArray(uuid.slice(10, 16))
  );
}

export function formatTextComponentVanilla(
  components: TextComponent[],
  fmtSign = "\u00a7",
) {
  return (
    components
      .map((value) => {
        // Use the hexadecimal color
        const hex = hexColor(value.formatting.color);
        let effects = `${fmtSign}x${hex
          .split("")
          .map((v) => fmtSign + v)
          .join("")}`;
        if (value.formatting.bold) {
          effects += fmtSign + "l";
        }
        if (value.formatting.italic) {
          effects += fmtSign + "o";
        }
        if (value.formatting.obfuscated) {
          effects += fmtSign + "k";
        }
        if (value.formatting.strikethrough) {
          effects += fmtSign + "m";
        }
        if (value.formatting.underline) {
          effects += fmtSign + "n";
        }
        return effects + value.data;
      })
      // Reset effects between segments
      .join(`${fmtSign}r`)
  );
}

export function makeMinecraftDate(date: Date) {
  // This format is in base 10, padding to the maximum length for each section (we don't need to pad the year as minecraft expects it to be 4 chars long, which will be the case for a long time)
  const year = date.getFullYear().toString(10);
  // Javascript counts months starting at 0 but minecraft expects dates starting at one
  const month = (date.getMonth() + 1).toString(10).padStart(2, "0");
  const day = date.getDate().toString(10).padStart(2, "0");
  const hours = date.getHours().toString(10).padStart(2, "0");
  const minutes = date.getMinutes().toString(10).padStart(2, "0");
  const seconds = date.getSeconds().toString(10).padStart(2, "0");

  // Get timezone offset from UTC
  const offsetMinutes = date.getTimezoneOffset();
  const sign = offsetMinutes > 0 ? "-" : "+";
  const offsetHours = String(Math.floor(Math.abs(offsetMinutes) / 60)).padStart(
    2,
    "0",
  );
  const offsetMins = String(Math.abs(offsetMinutes) % 60).padStart(2, "0");
  const timezone = `${sign}${offsetHours}${offsetMins}`;

  return `${year}-${month}-${day} ${hours}:${minutes}:${seconds} ${timezone}`;
}

export function pathJoin(path: string[]) {
  return join(...path);
}
