/**
 * A do-nothing `OpmlCodecPort` for tests that must satisfy the `Services`
 * shape but never touch OPML (every container test other than
 * `OpmlContainer.test.tsx`).
 *
 * It exists so those tests do NOT import `adapters/opml/**` just to fill a
 * field: `eslint.config.js` grants layer-zone exemptions per named file on
 * purpose, and widening that list for tests that only need a placeholder
 * would erode exactly the boundary the rule protects.
 *
 * Every method throws. A test that unexpectedly starts using OPML should fail
 * loudly rather than quietly exercise a fake that returns plausible nothing.
 */
import type { OpmlCodecPort } from "../../ports/OpmlCodecPort";

export const opmlCodecStub: OpmlCodecPort = {
  parse() {
    throw new Error("opmlCodecStub.parse was called; use the real codec in this test.");
  },
  serialize() {
    throw new Error("opmlCodecStub.serialize was called; use the real codec in this test.");
  },
};
