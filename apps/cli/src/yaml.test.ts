import { describe, expect, test } from "bun:test";
import fc from "fast-check";
import { toYaml, type YamlValue } from "./yaml.ts";

const roundTrip = (doc: { [k: string]: YamlValue }) => expect(Bun.YAML.parse(toYaml(doc))).toEqual(doc);

describe("toYaml", () => {
  test("reads like a person wrote it", () => {
    const out = toYaml({
      name: "Messaging across two devices",
      estimateMinutes: 10,
      steps: [
        { do: "Open #general", device: "Pixel 8" },
        { check: "Look at #general", device: "Chrome on laptop", expect: "\"hello\" appears.", verifies: ["message-arrives", "order-kept"] },
      ],
    });
    expect(out).toBe(
      [
        "name: Messaging across two devices",
        "estimateMinutes: 10",
        "steps:",
        "  - do: \"Open #general\"",
        "    device: Pixel 8",
        "  - check: \"Look at #general\"",
        "    device: Chrome on laptop",
        "    expect: \"\\\"hello\\\" appears.\"",
        "    verifies: [message-arrives, order-kept]",
        "",
      ].join("\n"),
    );
    expect(out).not.toMatch(/ $/m);
  });

  test("strings that YAML would read as something else are quoted", () => {
    for (const s of ["yes", "No", "on", "null", "~", "12", "1.5", "-3", "0x1f", ".5", "- a list?", "key: value", "a #comment", "trailing:", " padded", "[x]", "*star", "&anchor", "!tag", "%", "@at", "`tick`", "'single'"]) {
      roundTrip({ v: s });
    }
  });

  test("multi-line text is a literal block", () => {
    const out = toYaml({ expect: "First line.\nSecond line." });
    expect(out).toBe("expect: |-\n  First line.\n  Second line.\n");
    roundTrip({ expect: "First line.\nSecond line." });
    roundTrip({ expect: "Ends with a newline.\n" });
    roundTrip({ expect: "  starts indented\nthen not" });
  });

  test("any document of strings, numbers, lists and maps reads back the same", () => {
    const key = fc.stringMatching(/^[a-z][a-zA-Z]{0,8}$/);
    const leaf = fc.oneof(fc.string(), fc.integer(), fc.boolean(), fc.constant(null));
    const value: fc.Arbitrary<YamlValue> = fc.letrec((tie) => ({
      v: fc.oneof({ depthSize: "small", withCrossShrink: true }, leaf, fc.array(tie("v"), { maxLength: 4 }), fc.dictionary(key, tie("v"), { maxKeys: 4 })),
    })).v as fc.Arbitrary<YamlValue>;
    fc.assert(fc.property(fc.dictionary(key, value, { minKeys: 1, maxKeys: 5 }), (doc) => {
      expect(Bun.YAML.parse(toYaml(doc))).toEqual(doc);
    }), { numRuns: 400 });
  });
});
