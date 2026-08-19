import { createContext } from "preact";
import { useContext } from "preact/hooks";

/**
 * `ui/components/**` may only import `domain/models` (eslint.config.js's
 * layer-zone rule) -- it must never import `ports/SanitizerPort` or
 * `adapters/security/domPurifySanitizer` directly. The context value here is
 * therefore a plain function, not the `SanitizerPort` interface: the
 * composition root (`main.tsx`, added when `SafeHtml` gets a real consumer)
 * provides `(html, cacheKey) => sanitizerPort.sanitize(html, cacheKey)`,
 * keeping this file's only dependency on Preact itself.
 */
export type SanitizeFn = (html: string, cacheKey: string) => string;

export const SanitizerContext = createContext<SanitizeFn | undefined>(undefined);

/**
 * Throws rather than silently falling back to an identity function: a
 * `SafeHtml` rendered outside a provider is a wiring bug, and returning raw
 * feed HTML unsanitized in that situation would be exactly the failure mode
 * this whole boundary exists to prevent.
 */
export function useSanitizer(): SanitizeFn {
  const sanitize = useContext(SanitizerContext);
  if (sanitize === undefined) {
    throw new Error(
      "SafeHtml was rendered outside a SanitizerContext.Provider. Refusing to render feed HTML without a sanitizer rather than silently skipping sanitization.",
    );
  }
  return sanitize;
}
