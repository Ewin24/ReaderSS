/**
 * Port over "now" (`clock.now()` is used throughout the write-path for
 * `toggleRead`/`toggleStar`/`stateMerge`). Keeping every call
 * site injected rather than calling `Date.now()`/`new Date()` directly keeps
 * services deterministically testable and matches `domain/**`'s zero-import
 * purity constraint (`ClockPort` is consumed by `services/**`, never by
 * `domain/**` itself).
 */
export interface ClockPort {
  /** Returns the current instant as an ISO 8601 string. */
  now(): string;
}
