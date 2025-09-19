declare const process: { env?: Record<string, string | undefined> }

// Allow NodeNext-style ESM specifiers that end with .js to resolve to .ts sources at type-time
declare module '../lib/*.js'
declare module './*.js'
