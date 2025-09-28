/**
 * Utility functions for safely handling user and trip metadata
 * Ensures metadata is always treated as a JSON object
 */

export type MetadataObject = Record<string, any>;

/**
 * Custom error class for metadata validation errors
 */
export class MetadataValidationError extends Error {
  constructor(message: string, public readonly metadata: any) {
    super(`Metadata validation error: ${message}`);
    this.name = "MetadataValidationError";
  }
}

/**
 * Safely extracts metadata as an object, throwing error if invalid
 */
export function getMetadataAsObject(metadata: any): MetadataObject {
  // Allow null/undefined (will be handled by default values in schema)
  if (metadata === null || metadata === undefined) {
    return {};
  }

  // Check if it's a valid object
  if (typeof metadata === "object" && !Array.isArray(metadata)) {
    return metadata as MetadataObject;
  }

  // Throw error for invalid metadata types
  throw new MetadataValidationError(
    `Expected metadata to be an object, but got ${typeof metadata}${
      Array.isArray(metadata) ? " (array)" : ""
    }. Value: ${JSON.stringify(metadata)}`,
    metadata
  );
}

/**
 * Safely merges new metadata with existing metadata, throwing error if invalid
 */
export function mergeMetadata(
  existingMetadata: any,
  newMetadata: Partial<MetadataObject>
): MetadataObject {
  const existing = getMetadataAsObject(existingMetadata);
  return {
    ...existing,
    ...newMetadata,
  };
}

/**
 * Type guard to check if metadata is a valid object
 */
export function isValidMetadataObject(
  metadata: any
): metadata is MetadataObject {
  return metadata && typeof metadata === "object" && !Array.isArray(metadata);
}

/**
 * Validates metadata and throws error if invalid (for use in API endpoints)
 */
export function validateMetadata(
  metadata: any,
  context: string = "metadata"
): void {
  if (metadata !== null && metadata !== undefined) {
    if (typeof metadata !== "object" || Array.isArray(metadata)) {
      throw new MetadataValidationError(
        `${context} must be an object, but got ${typeof metadata}${
          Array.isArray(metadata) ? " (array)" : ""
        }. Value: ${JSON.stringify(metadata)}`,
        metadata
      );
    }
  }
}
