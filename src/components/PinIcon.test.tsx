// @vitest-environment jsdom
import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { PinIcon } from "./PinIcon";

describe("PinIcon", () => {
  it("switches between outlined and filled states", () => {
    const view = render(<PinIcon pinned={false} />);
    expect(view.getByTestId("pin-icon-outline")).toBeTruthy();
    expect(view.getByTestId("pin-icon-outline").querySelector("path")?.getAttribute("fill")).toBe("none");

    view.rerender(<PinIcon pinned />);
    expect(view.getByTestId("pin-icon-filled").querySelector("path")?.getAttribute("fill")).toBe("currentColor");
  });
});
