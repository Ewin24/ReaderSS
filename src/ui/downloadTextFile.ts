/**
 * Hands the browser a generated text file to save.
 *
 * There is no "save file" API available here that does not involve the DOM:
 * the app has no server to POST to and no File System Access permission, so a
 * Blob URL behind a synthetic `<a download>` click is the mechanism. It is
 * kept in this one module so the containers that use it stay free of DOM
 * plumbing.
 *
 * `revokeObjectURL` runs immediately after the click: the download has
 * already been handed to the browser by then, and NOT revoking leaks the blob
 * for the lifetime of the document.
 */
export interface DownloadTextFileInput {
  readonly filename: string;
  readonly text: string;
  readonly mimeType: string;
}

export function downloadTextFile({ filename, text, mimeType }: DownloadTextFileInput): void {
  const blob = new Blob([text], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");

  anchor.href = url;
  anchor.download = filename;
  // Kept out of the layout: appending is required for the click to count as a
  // user-initiated download in every engine, but it must never be visible.
  anchor.style.display = "none";
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}
