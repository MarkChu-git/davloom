import { describe, expect, it } from "vitest";
import { foreignSecrets } from "./workflow-secrets";

describe("foreignSecrets", () => {
  it("allows GITHUB_TOKEN in any case", () => {
    expect(
      foreignSecrets(
        "env:\n  GH_TOKEN: ${{ secrets.GITHUB_TOKEN }}\n  T: ${{ secrets.github_token }}\n",
      ),
    ).toEqual([]);
  });

  it.each([
    ["a property", "env:\n  T: ${{ secrets.CLOUDFLARE_API_TOKEN }}\n", ["CLOUDFLARE_API_TOKEN"]],
    ["an index", "env:\n  T: ${{ secrets['NPM_TOKEN'] }}\n", ["NPM_TOKEN"]],
    ["a condition without ${{ }}", "if: secrets.DEPLOY_KEY != ''\n", ["DEPLOY_KEY"]],
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
