import {
  Paintbrush,
  Bold,
  Italic,
  Underline,
  Strikethrough,
  Dices,
  RemoveFormatting,
} from "lucide-react";
import {
  type ComponentProps,
  useState,
  useMemo,
  type RefObject,
  useRef,
  type Ref,
} from "react";
import { HexColorPicker } from "react-colorful";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "./components/ui/popover";
import { cn } from "./lib/utils";
import { Button } from "./components/ui/button";
import * as serverCfg from "@mcman/serversetterupper/src/index";
import { useThrottledValue } from "./_";

// Add a reference for getting the state
const EditorColorPicker = ({
  onChange,
  onOpenChange,
  ...props
}: Omit<ComponentProps<typeof Popover>, "onOpenChange" | "onChange"> & {
  onChange?: (color: string) => void;
  onOpenChange?: (open: boolean, color: string) => void;
}) => {
  const [color, useColor] = useState<string>("#ffffff");
  const throttledColor = useThrottledValue(color, 100);
  const colorPicker = useMemo(
    () => (
      <HexColorPicker
        onChange={(color) => {
          useColor(color);
          onChange && onChange(color);
        }}
      />
    ),
    [],
  );
  const result = useMemo(
    () => (
      <Popover
        onOpenChange={(open) => onOpenChange && onOpenChange(open, color)}
        {...props}
      >
        <PopoverTrigger asChild>
          <Button variant="ghost" style={{ color: throttledColor }}>
            <Paintbrush />
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-80">{colorPicker}</PopoverContent>
      </Popover>
    ),
    [throttledColor, props],
  );
  return result;
};

export const TextEditor = ({
  editorRef,
  onChange,
  initial,
  className,
  ...props
}: {
  editorRef?: Ref<HTMLDivElement | null>;
  onChange?: (
    data: serverCfg.configuration.textComponent.TextComponent[],
  ) => void;
  initial?: serverCfg.configuration.textComponent.TextComponent[];
} & React.ComponentProps<"div">) => {
  const editor = useRef<HTMLDivElement | null>(null);
  const cmdExec = (name: string, args: string | undefined = undefined) => {
    document.execCommand(name, false, args);
    editor.current?.focus();
    if (onChange && editor.current) {
      onChange(divToTextComponents(editor.current));
    }
  };
  return (
    <div className={cn("items-center gap-3", className)} {...props}>
      <div className="flex items-left border rounded-t-lg bg-muted">
        <Button variant={"ghost"} onClick={() => cmdExec("bold")}>
          <Bold />
        </Button>
        <Button variant={"ghost"} onClick={() => cmdExec("italic")}>
          <Italic />
        </Button>
        <Button variant={"ghost"} onClick={() => cmdExec("underline")}>
          <Underline />
        </Button>
        <Button variant={"ghost"} onClick={() => cmdExec("strikeThrough")}>
          <Strikethrough />
        </Button>
        <Button variant={"ghost"} onClick={() => cmdExec("subscript")}>
          <Dices /> {/*Obfuscated*/}
        </Button>
        <Button variant={"ghost"} onClick={() => cmdExec("removeFormat")}>
          <RemoveFormatting />
        </Button>
        <div className="justify-end">
          <EditorColorPicker
            onOpenChange={(open, color) => {
              if (open === false) {
                cmdExec("foreColor", color);
              }
            }}
          />
        </div>
      </div>
      <div
        contentEditable
        ref={(instance) => {
          editor.current = instance;
          if (typeof editorRef === "function") {
            editorRef(instance);
          } else {
            editorRef && (editorRef.current = instance);
          }
          if (instance) {
            if (!instance.hasChildNodes() && initial) {
              instance.innerHTML = textComponentsToDiv(initial);
            }
          }
        }}
        onInput={() => {
          if (onChange && editor.current) {
            onChange(divToTextComponents(editor.current));
          }
        }}
        className="textEditor-obf-resolve text-left border-input placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-ring/50 aria-invalid:ring-destructive/20 dark:aria-invalid:ring-destructive/40 aria-invalid:border-destructive dark:bg-input/30 field-sizing-content min-h-16 w-full rounded-b-md border bg-transparent px-3 py-2 text-base shadow-xs transition-[color,box-shadow] outline-none focus-visible:ring-[3px] disabled:cursor-not-allowed disabled:opacity-50 md:text-sm"
      ></div>
    </div>
  );
};

// TODO: clean this up
type TextAst =
  | {
      type: "bold" | "italic" | "obfuscated" | "strikethrough" | "underline";
      contents: TextAst[];
    }
  | string
  | { type: "color"; contents: TextAst[]; color: `#${string}` };

function htmlToTextAst(element: HTMLElement | ChildNode) {
  const items: TextAst[] = [];
  for (const item of Array.from(element.childNodes)) {
    const nodeName = item.nodeName.toLowerCase();
    if (item instanceof Text) {
      items.push(item.textContent);
    } else if (nodeName === "b") {
      items.push({ type: "bold", contents: htmlToTextAst(item) });
    } else if (nodeName === "i") {
      items.push({ type: "italic", contents: htmlToTextAst(item) });
    } else if (nodeName === "strike") {
      items.push({ type: "strikethrough", contents: htmlToTextAst(item) });
    } else if (nodeName === "sub") {
      items.push({ type: "obfuscated", contents: htmlToTextAst(item) });
    } else if (nodeName === "u") {
      items.push({ type: "underline", contents: htmlToTextAst(item) });
    } else if (nodeName === "font") {
      items.push({
        type: "color",
        contents: htmlToTextAst(item),
        color: (item as HTMLFontElement).color as `#${string}`,
      });
    } else {
      throw new Error("Unknown node type " + item.nodeName);
    }
  }
  return items;
}

interface FlatTextAstContext {
  types: Set<"bold" | "italic" | "obfuscated" | "strikethrough" | "underline">;
  color: `#${string}`;
}
type FlatTextAst = {
  ctx: FlatTextAstContext;
  content: string;
};
function flattenTextAst(
  ast: TextAst,
  ctx: FlatTextAstContext = { color: "#ffffff", types: new Set() },
) {
  const result: FlatTextAst[] = [];
  if (typeof ast === "string") {
    result.push({ ctx, content: ast });
  } else if (ast.type === "color") {
    result.push(
      ...ast.contents
        .map((value) => flattenTextAst(value, { ...ctx, color: ast.color }))
        .flat(1),
    );
  } else {
    result.push(
      ...ast.contents
        .map((value) => {
          const types = new Set(ctx.types.values());
          types.add(ast.type);
          return flattenTextAst(value, { ...ctx, types });
        })
        .flat(1),
    );
  }
  return result;
}
function parseColor(color: string) {
  return {
    red: parseInt(color.slice(1, 3), 16),
    blue: parseInt(color.slice(3, 5), 16),
    green: parseInt(color.slice(5, 7), 16),
  };
}
export function divToTextComponents(
  element: HTMLDivElement,
): serverCfg.configuration.textComponent.TextComponent[] {
  const flatAst = htmlToTextAst(element)
    .map((v) => flattenTextAst(v))
    .flat(1);
  const items: serverCfg.configuration.textComponent.TextComponent[] = [];
  for (const item of flatAst) {
    items.push({
      data: item.content,
      formatting: {
        color: parseColor(item.ctx.color),
        bold: item.ctx.types.has("bold"),
        italic: item.ctx.types.has("italic"),
        obfuscated: item.ctx.types.has("obfuscated"),
        strikethrough: item.ctx.types.has("strikethrough"),
        underline: item.ctx.types.has("underline"),
      },
    });
  }
  return items;
}

export function hexNum(num: number) {
  return num.toString(16).padStart(2, "0");
}
export function hexColor(color: serverCfg.configuration.textComponent.RGB) {
  return hexNum(color.red) + hexNum(color.blue) + hexNum(color.green);
}

const escapeXml = (unsafe: string) =>
  unsafe.replace(
    /[<>&'"]/g,
    (c) =>
      `&${
        {
          "<": "lt",
          ">": "gt",
          "&": "amp",
          "'": "apos",
          '"': "quot",
        }[c]
      };`,
  );

export function textComponentsToDiv(
  components: serverCfg.configuration.textComponent.TextComponent[],
) {
  return components
    .map((component) => {
      const segments = [escapeXml(component.data)];
      function addTag(name: string) {
        segments.unshift(`<${name}>`);
        segments.push(`</${name}>`);
      }
      segments.unshift(`<font color=#${hexColor(component.formatting.color)}>`);
      segments.push(`</font>`);

      if (component.formatting.bold) {
        addTag("b");
      }
      if (component.formatting.italic) {
        addTag("i");
      }
      if (component.formatting.obfuscated) {
        addTag("sub");
      }
      if (component.formatting.strikethrough) {
        addTag("strike");
      }
      if (component.formatting.underline) {
        addTag("u");
      }
      return segments.join("");
    })
    .join("");
}
