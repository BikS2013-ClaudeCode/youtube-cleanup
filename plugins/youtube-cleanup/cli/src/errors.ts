/**
 * Raised when a required configuration setting is absent from every tier of the
 * resolution chain. Per project policy there are NO fallback defaults for
 * configuration: a missing setting is an error, never a silently substituted value.
 */
export class ConfigurationError extends Error {
  override readonly name = 'ConfigurationError';
}

/** Raised when the tool cannot attach to, or drive, the target Chrome instance. */
export class BrowserError extends Error {
  override readonly name = 'BrowserError';
}

/** Raised when the YouTube page is not in the state the tool requires. */
export class YouTubeStateError extends Error {
  override readonly name = 'YouTubeStateError';
}
