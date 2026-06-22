export type PropertiesType = Record<string, string>;

function escape(
  data: string,
  key: boolean,
  escapeUnicode: boolean = true,
): string {
  const directEscapes = ("\\=:#!" + (key ? " " : "")).split("");
  const indirectEscapes = new Map([
    ["\f", "\\f"],
    ["\n", "\\n"],
    ["\r", "\\r"],
    ["\t", "\\t"],
  ]);
  const str: string[][] = [];
  for (const line of data.split("\n")) {
    const data = [];
    const chars = line.split("");

    let index = 0;
    if (chars[0] === "\n") {
      index++;
      data.push("\\n");
    }

    for (; index < chars.length; index++) {
      const char = chars[index]!;
      const charCode = char.charCodeAt(0)!;
      if (escapeUnicode && (charCode < 0x0020 || charCode > 0x007e)) {
        data.push("\\u" + charCode.toString(16).padStart(4, "0"));
      } else if (directEscapes.includes(char)) {
        data.push("\\" + char);
      } else if (indirectEscapes.has(char)) {
        data.push(indirectEscapes.get(char)!);
      } else {
        data.push(char);
      }
    }
    str.push(data);
  }
  return str.flat(1).join("");
}

export function dumpStructure(value: Record<string, string>) {
  return Object.entries(value)
    .map(([key, value]) => [escape(key, true), escape(value, false)])
    .map((v) => v.join("="))
    .join("\n");
}
