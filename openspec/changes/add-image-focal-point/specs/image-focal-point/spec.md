# Spec Delta

## Purpose

Detect and persist a focal point for ingested article images so the UI can anchor
image crops to the image's subject rather than the geometric center, while allowing
the entire analysis pipeline to be disabled via a single configuration constant.

## ADDED Requirements

### Requirement: Focal point detection toggle
The system SHALL expose a configuration constant (e.g. `IMAGE_FOCAL_POINT_ENABLED`)
that gates the focal point analysis pipeline. When the constant is disabled, the
system SHALL NOT perform focal point detection, SHALL NOT invoke any external
detection services or libraries, and SHALL NOT incur per-image analysis cost.

#### Scenario: Feature disabled via configuration
- **WHEN** `IMAGE_FOCAL_POINT_ENABLED` is set to false (or absent) in the
  application configuration
- **THEN** ingested images are processed exactly as before this change, with no
  focal point metadata written and no additional latency or cost

#### Scenario: Feature enabled via configuration
- **WHEN** `IMAGE_FOCAL_POINT_ENABLED` is set to true in the application configuration
- **THEN** the focal point analysis pipeline runs during image ingestion

### Requirement: Focal point persisted with media metadata
When the feature is enabled and a focal point is successfully detected for an
ingested image, the system SHALL persist the focal point coordinates (normalized
relative to the image dimensions) alongside the image's existing metadata in the
media object store. The focal point SHALL survive re-ingestion of the same image
without triggering redundant re-analysis.

#### Scenario: Image with a detectable subject
- **WHEN** an ingested image is analyzed and a focal point is identified
- **THEN** the normalized focal point coordinates are stored with the media object
- **AND** re-ingesting the same image bytes does not re-run the analysis

#### Scenario: No focal point detected
- **WHEN** the analysis pipeline runs but no confident focal point is identified
- **THEN** no focal point metadata is stored and the image remains usable with
  default center-based cropping

### Requirement: Focal point delivered to the reader
The system SHALL expose the persisted focal point coordinates to the web reader
alongside the image metadata. The reader SHALL use these coordinates to bias its
crop behavior (e.g. `object-position`) when the image is displayed in a cropped
context, and SHALL fall back to the current center-based behavior when no focal
point is available.

#### Scenario: Cropped display with a focal point
- **WHEN** the reader renders an image in a cropped context and the image has a
  stored focal point
- **THEN** the crop is biased toward the stored focal point instead of the
  geometric center

#### Scenario: Cropped display without a focal point
- **WHEN** the reader renders an image in a cropped context and no focal point is
  stored
- **THEN** the crop uses the current center-based behavior unchanged

### Requirement: Failure is best-effort and non-blocking
Focal point analysis SHALL be best-effort. A failure or timeout in the analysis
pipeline SHALL NOT prevent the image from being stored and associated with its
entry, and SHALL NOT fail the feed ingestion operation as a whole.

#### Scenario: Analysis service unavailable
- **WHEN** the focal point analysis fails or times out during image ingestion
- **THEN** the image is still stored and associated with the entry, without
  focal point metadata, and the feed refresh completes normally
