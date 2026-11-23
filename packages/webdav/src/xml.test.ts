import { describe, expect, it } from "vitest";
import {
  childElements,
  clark,
  DAV,
  escapeAttribute,
  escapeText,
  findChild,
  parseClark,
  parseXml,
  serializeElement,
  textOf,
  XML_LIMITS,
  XML_NAMESPACE,
  XmlError,
  type XmlElement,
} from "./xml";

const element = (
  ns: string,
  local: string,
  children: XmlElement["children"] = [],
  attributes: XmlElement["attributes"] = [],
): XmlElement => ({ ns, local, attributes, children });

// A document of exactly `length` characters, of `depth` nested elements, or of `count` elements.
const fill = (length: number) => `<a>${" ".repeat(length - "<a></a>".length)}</a>`;
const nest = (depth: number) => `${"<a>".repeat(depth)}${"</a>".repeat(depth)}`;
const flat = (count: number) => `<r>${"<a/>".repeat(count - 1)}</r>`;

describe("parseXml", () => {
  it("resolves element and attribute namespaces and drops the declarations", () => {
    const root = parseXml(
      '<D:prop xmlns:D="DAV:" xmlns="urn:default" xmlns:p="urn:p" p:a="1" b="2"><x/><D:y/></D:prop>',
    );
    expect(root).toEqual(
      element(
        DAV,
        "prop",
        [element("urn:default", "x"), element(DAV, "y")],
        [
          { ns: "urn:p", local: "a", value: "1" },
          // An unprefixed attribute is in no namespace (Namespaces in XML 1.0, §6.2).
          { ns: "", local: "b", value: "2" },
        ],
      ),
    );
  });

  it("keeps text and CDATA sections as text", () => {
    const root = parseXml("<a>one<![CDATA[<two> & ]]>&lt;three&gt;</a>");
    expect(textOf(root)).toBe("one<two> & <three>");
  });

  it.each([
    ["mismatched tags", "<a><b></a>"],
    ["an unclosed root", "<a>"],
    ["two roots", "<a/><b/>"],
    ["text outside the root", "text"],
    ["an undefined entity", "<a>&foo;</a>"],
    ["no root", ""],
    ["only a declaration", '<?xml version="1.0"?>'],
  ])("refuses %s", (_, text) => {
    expect(() => parseXml(text)).toThrow(XmlError);
  });

  it("refuses a document type declaration", () => {
    expect(() => parseXml('<!DOCTYPE a [<!ENTITY e "x">]><a>&e;</a>')).toThrow(
      new XmlError("document type declarations are not allowed"),
    );
  });

  it("accepts a body of exactly the byte limit and refuses one byte more", () => {
    expect(parseXml(fill(XML_LIMITS.bytes)).local).toBe("a");
    expect(() => parseXml(fill(XML_LIMITS.bytes + 1))).toThrow(new XmlError("body too large"));
  });

  it("accepts the depth limit and refuses one level more", () => {
    expect(parseXml(nest(XML_LIMITS.depth)).local).toBe("a");
    expect(() => parseXml(nest(XML_LIMITS.depth + 1))).toThrow(
      new XmlError("document too complex"),
    );
  });

  it("accepts the element limit and refuses one element more", () => {
    expect(parseXml(flat(XML_LIMITS.elements)).children).toHaveLength(XML_LIMITS.elements - 1);
    expect(() => parseXml(flat(XML_LIMITS.elements + 1))).toThrow(
      new XmlError("document too complex"),
    );
  });
});

describe("element helpers", () => {
  const root = parseXml('<a xmlns="urn:a" xmlns:b="urn:b">x<b:c>y<d>z</d></b:c><c/>w</a>');

  it("childElements skips text", () => {
    expect(childElements(root).map((child) => clark(child.ns, child.local))).toEqual([
      "{urn:b}c",
      "{urn:a}c",
    ]);
  });

  it("findChild matches namespace and local name together", () => {
    expect(findChild(root, "urn:a", "c")).toEqual(element("urn:a", "c"));
    expect(findChild(root, "urn:b", "c")?.ns).toBe("urn:b");
    expect(findChild(root, "urn:a", "d")).toBeUndefined();
    expect(findChild(root, "urn:x", "c")).toBeUndefined();
  });

  it("textOf joins the text of every descendant in document order", () => {
    expect(textOf(root)).toBe("xyzw");
  });

  it.each([
    ["DAV:", "getetag", "{DAV:}getetag"],
    ["urn:x:y", "a", "{urn:x:y}a"],
    ["", "plain", "{}plain"],
  ])("clark(%j, %j) is %j and parses back", (ns, local, name) => {
    expect(clark(ns, local)).toBe(name);
    expect(parseClark(name)).toEqual({ ns, local });
  });
});

describe("escaping", () => {
  // Character data may not hold a literal & or < (XML 1.0 §2.4); an XML parser reads the escaped
  // text back unchanged.
  it.each(["a & b", "<tag>", "x > y", "&amp;", "]]>", "plain", "中文 😀"])(
    "escapeText(%j) reads back unchanged",
    (text) => {
      const escaped = escapeText(text);
      expect(escaped).not.toMatch(/[<]|&(?!amp;|lt;|gt;)/);
      expect(textOf(parseXml(`<a>${escaped}</a>`))).toBe(text);
    },
  );

  it("escapes the three markup characters as the predefined entities", () => {
    expect(escapeText(`&<>"'`)).toBe(`&amp;&lt;&gt;"'`);
  });

  // Attribute-value normalization turns a literal tab, line feed or carriage return into a space,
  // so only character references keep them (XML 1.0 §3.3.3).
  it.each([`say "hi"`, "a\tb", "a\nb", "a\rb", "a\r\nb", "<&>", "'single'"])(
    "escapeAttribute(%j) reads back unchanged in a double-quoted attribute",
    (value) => {
      const root = parseXml(`<a v="${escapeAttribute(value)}"/>`);
      expect(root.attributes).toEqual([{ ns: "", local: "v", value }]);
    },
  );
});

describe("serializeElement", () => {
  it("writes an element in no namespace without a declaration", () => {
    expect(serializeElement(element("", "a"))).toBe("<a/>");
  });

  it("declares the default namespace once and again only where it changes", () => {
    const tree = element("urn:a", "a", [element("urn:a", "b"), element("urn:c", "c", ["t"])]);
    expect(serializeElement(tree)).toBe('<a xmlns="urn:a"><b/><c xmlns="urn:c">t</c></a>');
    expect(serializeElement(tree, "urn:a")).toBe('<a><b/><c xmlns="urn:c">t</c></a>');
  });

  it("writes xml: attributes without declaring the xml prefix", () => {
    const tree = element("urn:a", "a", ["x"], [{ ns: XML_NAMESPACE, local: "lang", value: "en" }]);
    expect(serializeElement(tree)).toBe('<a xmlns="urn:a" xml:lang="en">x</a>');
  });

  it.each<[string, XmlElement]>([
    ["an element in no namespace", element("", "a", ["text & <more>"])],
    [
      "nested namespaces with attributes",
      element(
        "urn:a",
        "a",
        [element("urn:b", "b", ["x"], [{ ns: "", local: "id", value: '1 "q"\t' }]), "tail"],
        [
          { ns: "urn:p", local: "p", value: "v" },
          { ns: "urn:q", local: "q", value: "w" },
          { ns: XML_NAMESPACE, local: "lang", value: "de" },
        ],
      ),
    ],
    ["a child back in no namespace", element("urn:a", "a", [element("", "b", ["y"])])],
  ])("parses back to the same tree: %s", (_, tree) => {
    expect(parseXml(serializeElement(tree))).toEqual(tree);
  });
});
