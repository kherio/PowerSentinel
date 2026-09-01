// Shared by both backends and by api.js, so a caller catching an error
// from either transport gets the exact same class - not two identically-
// named but distinct classes (which would break any future
// `instanceof` check even though nothing in the app currently does one).
export class XbsApiError extends Error {}
