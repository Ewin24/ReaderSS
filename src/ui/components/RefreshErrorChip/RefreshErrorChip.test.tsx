import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/preact";
import { RefreshErrorChip } from "./RefreshErrorChip";

describe("RefreshErrorChip", () => {
  it("renders the failing feed's title and its specific error message", () => {
    render(<RefreshErrorChip feedTitle="Example Blog" errorMessage="example.com did not respond within 10s" />);

    expect(screen.getByText("Example Blog")).toBeInTheDocument();
    expect(screen.getByText(/did not respond within 10s/)).toBeInTheDocument();
  });

  it("announces itself immediately via role=\"alert\"", () => {
    render(<RefreshErrorChip feedTitle="Example Blog" errorMessage="feed returned 404" />);

    // feed-fetching spec, "Refresh failure is visible, never silent": a
    // per-feed refresh failure is urgent enough to announce immediately
    // (role="alert"). This test pins ONLY this component's own role. The
    // planned comparison against a passive, already-known offline state
    // (Slice 7's OfflineBanner, expected to use role="status" instead) is
    // NOT assertable here -- OfflineBanner does not exist yet -- and is
    // tracked as a Slice 7 task instead of implied by this test's name
    // (Finding 4, Slice 6 correction round).
    expect(screen.getByRole("alert")).toBeInTheDocument();
  });

  it("renders one chip per distinct feed error when multiple are shown side by side", () => {
    render(
      <>
        <RefreshErrorChip feedTitle="Feed A" errorMessage="timed out" />
        <RefreshErrorChip feedTitle="Feed B" errorMessage="returned 404" />
      </>,
    );

    expect(screen.getAllByRole("alert")).toHaveLength(2);
    expect(screen.getByText("Feed A")).toBeInTheDocument();
    expect(screen.getByText("Feed B")).toBeInTheDocument();
  });
});
