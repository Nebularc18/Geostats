// Single source of truth lives in @geostats/shared so every import path
// (GPX worker, GSAK connector, admin) and every checker stores and matches
// the same canonical names. Kept as a shim for existing relative imports.
export {
  cacheTypeIdentity,
  cacheTypeLabel,
  cacheTypeOptions,
  canonicalCacheTypeName,
  type CacheTypeOption
} from "@geostats/shared";
