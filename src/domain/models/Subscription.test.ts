import { describe, expect, it } from "vitest";
import { createSubscription } from "./Subscription";

describe("createSubscription", () => {
  it("builds a subscription record matching subscriptions.json's shape", () => {
    const subscription = createSubscription({
      id: "https://example.com/feed.xml",
      url: "https://example.com/feed.xml",
      title: "Example",
      folder: "News",
      addedAt: "2026-08-19T10:00:00.000Z",
    });

    expect(subscription).toEqual({
      id: "https://example.com/feed.xml",
      url: "https://example.com/feed.xml",
      title: "Example",
      folder: "News",
      addedAt: "2026-08-19T10:00:00.000Z",
    });
  });

  it("defaults folder to null when omitted", () => {
    const subscription = createSubscription({
      id: "https://other.example/feed.xml",
      url: "https://other.example/feed.xml",
      title: "Other",
      addedAt: "2026-08-19T11:00:00.000Z",
    });

    expect(subscription.folder).toBeNull();
  });
});
