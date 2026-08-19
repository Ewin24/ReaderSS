export interface Subscription {
  id: string;
  url: string;
  title: string;
  folder: string | null;
  addedAt: string;
}

export interface CreateSubscriptionInput {
  id: string;
  url: string;
  title: string;
  folder?: string | null;
  addedAt: string;
}

export function createSubscription(input: CreateSubscriptionInput): Subscription {
  return {
    id: input.id,
    url: input.url,
    title: input.title,
    folder: input.folder ?? null,
    addedAt: input.addedAt,
  };
}
