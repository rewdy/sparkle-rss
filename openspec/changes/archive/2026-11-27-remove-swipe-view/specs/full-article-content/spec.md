# Spec Delta

## MODIFIED Requirements

### Requirement: Manual milestone and automatic completion
The first milestone SHALL provide an accessible Load full article control for eligible entries without requiring teaser classification. Before this change is complete, opening an eligible article's reading pane SHALL automatically request content only when its original feed body contains fewer than 500 readable text characters, no successful result exists, and retry is eligible. The threshold SHALL be a named constant that can be tuned in one place. Counting SHALL ignore markup and non-content script/style/template text, decode entities, separate block text, normalize whitespace, trim, and count Unicode characters. Empty text SHALL qualify; text exactly at or above the threshold SHALL NOT trigger automatic fetching. The service SHALL enforce the same rule for automatic API requests without consuming fetch budget when skipped. The reader SHALL NOT offer manual fetching for bodies at or above the threshold; it SHALL show original feed content directly, hide both tabs and all fetch/retry actions, and ignore any older fetched copy for display. Direct links, keyboard article navigation, and feed-backed Read Later opens SHALL behave consistently. List and Cards rendering, prefetching, scrolling without opening the reading pane, and GET requests SHALL NOT trigger extraction. Entries without a valid article URL SHALL offer the existing feed body without a fetch control. Automatic-on-open and manual reader fetching SHALL additionally require the owning subscription's full-article-fetch preference to be enabled. A disabled preference SHALL take precedence over short-body eligibility.

#### Scenario: Manual first milestone
- **WHEN** a reader activates Load full article
- **THEN** the reader sees pending feedback while the original body remains available

#### Scenario: Automatic final milestone
- **WHEN** a reader opens an eligible article through a deep link or keyboard navigation
- **THEN** fetching begins automatically without requiring the manual control

#### Scenario: Long feed body
- **WHEN** the original feed text is exactly 500 characters or longer
- **THEN** opening the article does not initiate automatic extraction
- **AND** the reader shows only original feed content without tabs or a fetch action

#### Scenario: Markup does not inflate summary length
- **WHEN** a short summary contains extensive markup or long image URLs
- **THEN** only its normalized readable text determines automatic eligibility

#### Scenario: Stream browsing
- **WHEN** a reader loads a page of articles or scrolls List or Cards without opening a reading pane
- **THEN** no full-content requests are initiated
