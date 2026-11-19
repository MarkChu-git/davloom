import { describe, expect, it } from "vitest";
import { foreignSecrets } from "./workflow-secrets";

describe("foreignSecrets", () => {
  it("allows GITHUB_TOKEN in any case and spelling", () => {
    expect(
      foreignSecrets(
        "env:\n  A: ${{ secrets.GITHUB_TOKEN }}\n  B: ${{ secrets.github_token }}\n  C: ${{ secrets['GITHUB_TOKEN'] }}\n  D: ${{ secrets . GITHUB_TOKEN }}\n",
      ),
    ).toEqual([]);
  });

  it.each([
    ["a property", "env:\n  T: ${{ secrets.CLOUDFLARE_API_TOKEN }}\n", ["CLOUDFLARE_API_TOKEN"]],
    ["an index", "env:\n  T: ${{ secrets['NPM_TOKEN'] }}\n", ["NPM_TOKEN"]],
    ["a space before the dot", "env:\n  T: ${{ secrets .NPM_TOKEN }}\n", ["NPM_TOKEN"]],
    ["a space after the dot", "env:\n  T: ${{ secrets. NPM_TOKEN }}\n", ["NPM_TOKEN"]],
    ["a space before the index", "env:\n  T: ${{ secrets ['NPM_TOKEN'] }}\n", ["NPM_TOKEN"]],
    ["an index from the matrix", "env:\n  T: ${{ secrets[matrix.name] }}\n", ["secrets"]],
    [
      "an index built by format",
      "env:\n  T: ${{ secrets[format('{0}_TOKEN', matrix.env)] }}\n",
      ["secrets"],
    ],
    ["the whole context", "run: echo '${{ toJSON(secrets) }}'\n", ["secrets"]],
    [
      "secrets: inherit",
      "jobs:\n  call:\n    uses: ./.github/workflows/x.yml\n    secrets: inherit\n",
      ["inherit"],
    ],
    [
      "a shell comment, which GitHub still expands",
      "run: |\n  # ${{ secrets.TOKEN }}\n",
      ["TOKEN"],
    ],
  ])("names a secret read through %s", (_, text, expected) => {
    expect(foreignSecrets(text)).toEqual(expected);
  });

  it("ignores the word secrets outside an expression", () => {
    const text =
      "- name: Scan the commits for secrets\n  run: cat config/secrets.txt # see secrets.toml\n";
    expect(foreignSecrets(text)).toEqual([]);
  });

  it("ignores a job named secrets and its outputs", () => {
    const text =
      "jobs:\n  secrets:\n    runs-on: ubuntu-24.04\n  next:\n    needs: secrets\n    if: ${{ needs.secrets.result == 'success' }}\n";
    expect(foreignSecrets(text)).toEqual([]);
  });

  it("names each secret once", () => {
    expect(
      foreignSecrets("a: ${{ secrets.X }}\nb: ${{ secrets.X }}\nc: ${{ secrets.Y }}\n"),
    ).toEqual(["X", "Y"]);
  });
});
