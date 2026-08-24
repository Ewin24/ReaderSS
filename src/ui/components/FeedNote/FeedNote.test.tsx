import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/preact";
import { FeedNote, type FeedNoteProps } from "./FeedNote";

const base: FeedNoteProps = {
  feedTitle: "Ars Technica",
  note: null,
  saving: false,
  errorMessage: null,
  onSave: vi.fn(),
};

function renderNote(overrides: Partial<FeedNoteProps> = {}) {
  return render(<FeedNote {...base} {...overrides} />);
}

describe("FeedNote", () => {
  it("renders nothing at all when no feed is selected", () => {
    const { container } = renderNote({ feedTitle: null });

    // `container.innerHTML` is not used even to READ: the repo-wide sink ban
    // matches the property name itself, and a test is not a reason to weaken it.
    expect(container.firstChild).toBeNull();
  });

  it("offers to add a note, naming the feed, when there is none", () => {
    renderNote();

    expect(
      screen.getByRole("button", { name: /add a note about ars technica/i }),
    ).toBeInTheDocument();
    // No edit box until asked for: this row sits above the reading list.
    expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
  });

  it("shows an existing note as text, with an edit control", () => {
    renderNote({ note: "Long-form only. Skip the deal posts." });

    expect(screen.getByText("Long-form only. Skip the deal posts.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /edit note/i })).toBeInTheDocument();
    expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
  });

  it("opens an editor seeded with the current note", () => {
    renderNote({ note: "existing text" });

    fireEvent.click(screen.getByRole("button", { name: /edit note/i }));

    expect(screen.getByRole("textbox")).toHaveValue("existing text");
  });

  it("emits the typed note on save", () => {
    const onSave = vi.fn();
    renderNote({ onSave });

    fireEvent.click(screen.getByRole("button", { name: /add a note/i }));
    fireEvent.input(screen.getByRole("textbox"), { target: { value: "my reason" } });
    fireEvent.click(screen.getByRole("button", { name: /save note/i }));

    expect(onSave).toHaveBeenCalledWith("my reason");
  });

  it("emits an empty string when the note is cleared, so it can be removed", () => {
    const onSave = vi.fn();
    renderNote({ note: "to be deleted", onSave });

    fireEvent.click(screen.getByRole("button", { name: /edit note/i }));
    fireEvent.input(screen.getByRole("textbox"), { target: { value: "" } });
    fireEvent.click(screen.getByRole("button", { name: /save note/i }));

    expect(onSave).toHaveBeenCalledWith("");
  });

  it("discards the draft on cancel and shows the unchanged note again", () => {
    const onSave = vi.fn();
    renderNote({ note: "original", onSave });

    fireEvent.click(screen.getByRole("button", { name: /edit note/i }));
    fireEvent.input(screen.getByRole("textbox"), { target: { value: "scribbled over" } });
    fireEvent.click(screen.getByRole("button", { name: /cancel/i }));

    expect(onSave).not.toHaveBeenCalled();
    expect(screen.getByText("original")).toBeInTheDocument();
    expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
  });

  it("disables the editor and its controls while saving", () => {
    renderNote({ note: "text", saving: true });

    fireEvent.click(screen.getByRole("button", { name: /edit note/i }));

    expect(screen.getByRole("textbox")).toBeDisabled();
    expect(screen.getByRole("button", { name: /saving/i })).toBeDisabled();
  });

  it("closes the editor and re-seeds the draft when the selected feed changes", () => {
    // The regression this guards: a draft left open while switching feeds
    // would appear to belong to the newly selected feed.
    const { rerender } = renderNote({ note: "note for A", feedTitle: "Feed A" });
    fireEvent.click(screen.getByRole("button", { name: /edit note/i }));
    fireEvent.input(screen.getByRole("textbox"), { target: { value: "half-written" } });

    rerender(<FeedNote {...base} feedTitle="Feed B" note="note for B" />);

    expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
    expect(screen.getByText("note for B")).toBeInTheDocument();
  });

  it("announces a save failure", () => {
    renderNote({ errorMessage: "The note could not be saved (quota exceeded)." });

    expect(screen.getByRole("alert")).toHaveTextContent(/could not be saved/i);
  });

  it("labels its region with the feed it belongs to", () => {
    renderNote();

    expect(screen.getByRole("region", { name: /notes for ars technica/i })).toBeInTheDocument();
  });

  it("says where the note ends up", () => {
    renderNote();

    fireEvent.click(screen.getByRole("button", { name: /add a note/i }));

    expect(screen.getByText(/exported in your opml/i)).toBeInTheDocument();
  });
});
