import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/preact";
import { App } from "./App";

describe("App (smoke)", () => {
  it("renders the app shell", () => {
    render(<App />);

    expect(screen.getByText("ReaderSS")).toBeInTheDocument();
  });
});
