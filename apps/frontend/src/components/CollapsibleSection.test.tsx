import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { CollapsibleSection } from "./CollapsibleSection";

const render = (open: boolean) =>
  renderToStaticMarkup(
    <CollapsibleSection id="updates" title="Updates" summary="Update available · 1.3.0" open={open} onToggle={() => {}}>
      <button type="button">Update to 1.3.0</button>
    </CollapsibleSection>,
  );

describe("CollapsibleSection", () => {
  // Regression: 1.2.0 disabled the Updates header while an update was
  // available, so the card could not be opened by tapping it.
  it("never disables its header", () => {
    for (const open of [true, false]) {
      const html = render(open);
      expect(html).not.toContain("aria-disabled");
      expect(html).not.toMatch(/<button[^>]*disabled/);
      expect(html).toContain(`aria-expanded="${open}"`);
    }
  });
  it("hides the panel with the hidden attribute only while collapsed", () => {
    expect(render(false)).toMatch(/role="region"[^>]*hidden=""/);
    expect(render(true)).not.toMatch(/role="region"[^>]*hidden/);
    expect(render(true)).toContain("Update to 1.3.0");
  });
});
