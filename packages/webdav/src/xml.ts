import { SaxesParser } from "saxes";

// Request bodies are parsed with saxes, which expands no entities but the five predefined ones and
// fetches nothing. A document type declaration is refused outright, and limits on size, depth and
// element count keep a hostile body from exhausting the Worker (PRD §12).

export const DAV = "DAV:";

export interface XmlAttribute {
  readonly ns: string;
  readonly local: string;
  readonly value: string;
}

export interface XmlElement {
  readonly ns: string;
  readonly local: string;
  readonly attributes: readonly XmlAttribute[];
  readonly children: readonly XmlNode[];
}

export type XmlNode = XmlElement | string;

export const XML_LIMITS = { bytes: 1024 * 1024, depth: 64, elements: 20_000 } as const;

export class XmlError extends Error {}

interface Building {
  ns: string;
  local: string;
  attributes: XmlAttribute[];
  children: XmlNode[];
}

/** Parses one XML document. Throws XmlError on malformed input or a limit. */
export const parseXml = (text: string): XmlElement => {
  if (text.length > XML_LIMITS.bytes) throw new XmlError("body too large");
  const parser = new SaxesParser({ xmlns: true, position: false });
  const stack: Building[] = [];
  let root: Building | undefined;
  let elements = 0;
  let failure: string | undefined;

  parser.on("error", (error) => {
    failure ??= error.message;
  });
  parser.on("doctype", () => {
    failure ??= "document type declarations are not allowed";
  });
  parser.on("opentag", (tag) => {
    elements += 1;
    if (elements > XML_LIMITS.elements || stack.length >= XML_LIMITS.depth) {
      failure ??= "document too complex";
      return;
    }
    const element: Building = {
      ns: tag.uri,
      local: tag.local,
      attributes: Object.values(tag.attributes)
        .filter((a) => a.prefix !== "xmlns" && a.name !== "xmlns")
        .map((a) => ({ ns: a.uri, local: a.local, value: a.value })),
      children: [],
    };
    const parent = stack.at(-1);
    if (parent) parent.children.push(element);
    else root = element;
    stack.push(element);
  });
  parser.on("closetag", () => {
    stack.pop();
  });
  const onText = (content: string) => {
    const parent = stack.at(-1);
    if (parent) parent.children.push(content);
  };
  parser.on("text", onText);
  parser.on("cdata", onText);

  try {
    parser.write(text).close();
  } catch (error) {
    failure ??= error instanceof Error ? error.message : "malformed XML";
  }
  if (failure !== undefined || !root) throw new XmlError(failure ?? "no root element");
  return root;
};

export const isElement = (node: XmlNode): node is XmlElement => typeof node !== "string";

export const childElements = (element: XmlElement): XmlElement[] =>
  element.children.filter(isElement);

export const findChild = (element: XmlElement, ns: string, local: string) =>
  childElements(element).find((child) => child.ns === ns && child.local === local);

export const textOf = (element: XmlElement): string =>
  element.children.map((child) => (isElement(child) ? textOf(child) : child)).join("");

/** Clark notation: `{namespace}local`. */
export const clark = (ns: string, local: string) => `{${ns}}${local}`;

export const parseClark = (name: string): { ns: string; local: string } => {
  const close = name.indexOf("}");
  return { ns: name.slice(1, close), local: name.slice(close + 1) };
};

export const escapeText = (text: string): string =>
  text.replace(/[&<>]/g, (c) => (c === "&" ? "&amp;" : c === "<" ? "&lt;" : "&gt;"));

export const escapeAttribute = (text: string): string =>
  escapeText(text)
    .replace(/"/g, "&quot;")
    .replace(/\r/g, "&#13;")
    .replace(/\n/g, "&#10;")
    .replace(/\t/g, "&#9;");

/**
 * Serializes an element so that it stands alone: it declares its own default namespace, and each
 * descendant declares its namespace where it differs from its parent's. `inheritedDefault` is the
 * default namespace in scope where the element is written.
 */
export const serializeElement = (element: XmlElement, inheritedDefault = ""): string => {
  let declarations =
    element.ns === inheritedDefault ? "" : ` xmlns="${escapeAttribute(element.ns)}"`;
  let attributes = "";
  element.attributes.forEach((attribute, index) => {
    if (attribute.ns === "") {
      attributes += ` ${attribute.local}="${escapeAttribute(attribute.value)}"`;
    } else {
      declarations += ` xmlns:a${index}="${escapeAttribute(attribute.ns)}"`;
      attributes += ` a${index}:${attribute.local}="${escapeAttribute(attribute.value)}"`;
    }
  });
  const inner = element.children
    .map((child) => (isElement(child) ? serializeElement(child, element.ns) : escapeText(child)))
    .join("");
  const open = `${element.local}${declarations}${attributes}`;
  return inner === "" ? `<${open}/>` : `<${open}>${inner}</${element.local}>`;
};
