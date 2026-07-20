import { describe, expect, it } from "vitest";
import { GENERATED_WATCH_IGNORES } from "../../vite.config";

describe("Vite development watcher", () => {
  it("ignores generated native build and test output", () => {
    expect(GENERATED_WATCH_IGNORES).toEqual(expect.arrayContaining([
      "**/src-tauri/target/**",
      "**/.cargo-target-validation/**",
      "**/.e2e-target/**",
      "**/e2e-results/**",
      "**/logs/**",
    ]));
  });
});
