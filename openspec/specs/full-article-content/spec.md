# Full Article Content Specification

## Purpose


Let readers retrieve and retain readable source-page content for feed articles, first manually and then automatically on opening, while preserving feed content and native-client compatibility.

## Requirements


### Requirement: Owned article content fetching
The web API SHALL accept a content-fetch request for an authenticated user's existing feed entry and fetch only that entry's stored HTTP(S) article URL. It SHALL support entries ingested before this feature and feed-backed Read Later views through the same underlying entry. Missing and foreign entries SHALL return not found without outbound fetching. Off-feed URL items SHALL retain their existing extraction behavior.

#### Scenario: Existing article and Read Later alias
- **WHEN** an owner requests full content for an existing entry and later opens its feed-backed Read Later item
- **THEN** both views use the same persisted extraction result

#### Scenario: Unauthorized source
- **WHEN** a caller supplies a foreign or missing entry identifier
- **THEN** the service returns not found without fetching any URL

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

### Requirement: Durable content and original preservation
A successful fetch SHALL persist sanitized readable HTML, its final source URL, and retrieval time independently of the original feed body. For enabled subscriptions that meet the short-body policy, web readers SHALL prefer the stored full body and provide an accessible way to view the original feed body and return without refetching. Success SHALL survive reload and SHALL NOT expire automatically. Fetching SHALL NOT change entry identity, title, author, publication/crawl/save timestamps, ordering, article state, or existing splash images. Google Reader responses SHALL continue to serve original feed content without feature metadata. The enabled subscription preference and existing short-body policy SHALL govern preference for stored full content; an opted-out feed SHALL display its original body directly while retaining extracted content for reuse after re-enabling.

#### Scenario: Reload and native-client sync
- **WHEN** a reader reloads a short article on an enabled subscription after successful extraction and a native client synchronizes that entry
- **THEN** the web reader displays stored full content and the native client receives unchanged original feed content

#### Scenario: View original
- **WHEN** the reader switches between full content and original feed content for a short article on an enabled subscription
- **THEN** both remain available without additional source-page requests

### Requirement: Safe failures and bounded retries
Network errors, unreadable pages, unsupported content, oversized bodies, and empty sanitized results SHALL preserve original content and SHALL NOT be recorded as success. Failure SHALL expose a safe actionable message and retry eligibility. Automatic attempts SHALL wait at least 15 minutes after a failed attempt; explicit retry SHALL wait at least 30 seconds. Reopening, remounting, or switching views SHALL NOT bypass these limits. A successful result SHALL be reused without a new fetch. Overlapping requests for one user's entry SHALL perform at most one active fetch; abandoned attempts SHALL become retryable within 60 seconds. Deleted entries SHALL NOT be recreated by late completion.

#### Scenario: Extraction failure
- **WHEN** extraction finds no readable body
- **THEN** the original body or original-site link remains available with failure feedback and bounded retry

#### Scenario: Concurrent opens
- **WHEN** two tabs request the same owned entry concurrently
- **THEN** one fetch runs and both tabs can resolve its persisted outcome

#### Scenario: Source removed during request
- **WHEN** the entry is deleted while fetching
- **THEN** completion does not recreate the entry or attach content to another entry

### Requirement: Bounded public fetching
Fetching SHALL reject URL credentials, unsupported schemes, and non-public destinations, including at redirects and the actual connection destination. It SHALL forward no caller credentials or cookies, follow at most five redirects, enforce a 10-second total network deadline including resolution and body reading, reject bodies exceeding 2 MiB, and limit stored HTML to 500,000 characters without persisting truncated malformed markup. Only HTML/XHTML responses with a nonempty sanitized readable body SHALL succeed. Client cancellation SHALL NOT imply persisted success. Requests SHALL be limited to 30 new fetch attempts per user per rolling hour, with cached results and pending-status reads excluded.

#### Scenario: Unsafe redirect
- **WHEN** the source redirects to a private address or changes DNS resolution to a non-public connection destination
- **THEN** fetching is rejected without contacting that destination

#### Scenario: Fetch budget exceeded
- **WHEN** response bytes, elapsed network time, redirect count, or the user's attempt budget exceeds its limit
- **THEN** fetching stops with actionable failure or rate-limit feedback and original content is preserved

### Requirement: Reader content tabs and loading feedback
The reader SHALL use Mantine outline tabs labeled Fetched article and Original for fetchable feed articles. Short bodies with cached full content and automatically eligible short bodies SHALL initially select Fetched article. Bodies at or above the threshold SHALL show original feed content without tabs or fetch/retry controls, even if a cached extracted copy exists. The fetched view SHALL display an accessible loading indicator from the initial automatically eligible render through pending extraction without briefly rendering the original body. Original SHALL remain selectable while fetching. Manual retry through these controls SHALL be available only for short bodies, subject to existing cooldowns. Switching cached views SHALL NOT refetch. Opted-out feeds SHALL show only original feed content without tabs, pending extraction feedback, or fetch/retry controls, regardless of cached or in-flight extraction state.

#### Scenario: Initial automatic loading
- **WHEN** a short feed article on an enabled subscription opens and extraction has not completed
- **THEN** Fetched article is selected and shows a loading indicator without flashing feed text
- **AND** selecting Original exposes retained feed content during loading

#### Scenario: Longer article with an older extracted copy
- **WHEN** a reader opens a body at or above the threshold that already has extracted content
- **THEN** original feed content is displayed and neither tabs nor fetch/retry actions are offered

### Requirement: Reader and image integration
Fetched links and image URLs SHALL resolve relative to the final fetched page URL before storage and sanitization. Full-content images SHALL support existing image-save controls with server-side source authorization against retained owned content. Merely fetching content SHALL NOT save images or change hero thumbnails. Content updates SHALL reconcile detail, list, Saved article, and Read Later caches without overwriting concurrent read/star state or replacing another open article. Controls SHALL support keyboard and touch, announce pending/error state, and avoid automatic focus movement.

#### Scenario: Redirected relative image
- **WHEN** fetched content contains a relative image after a redirect and the reader saves it
- **THEN** the correct absolute image URL is displayed and authorized against that user's stored article content

#### Scenario: Navigate during fetch
- **WHEN** the reader opens another article before the request completes
- **THEN** the result updates its own article cache without replacing the current reader or its state

### Requirement: Two-stage acceptance
This change SHALL remain incomplete after the manual milestone. Completion SHALL require automatic-on-open acceptance, unchanged Google Reader conformance, and end-to-end verification of cached success, failure cooldown, concurrent opens, source deletion, and feed-backed Read Later behavior.

#### Scenario: Manual milestone delivered
- **WHEN** manual fetching passes its checks but automatic-on-open is absent
- **THEN** the overall change remains open with the automatic milestone outstanding

### Requirement: Disabled subscriptions prevent new extraction
The content API SHALL enforce the owned subscription's preference for both automatic and manual requests. A disabled request SHALL return 200 with original-body projection and disabled eligibility, without initiating extraction, allocating an attempt, or consuming fetch budget. Missing and foreign entry IDs SHALL still return 404 before any outbound work.

#### Scenario: Direct requests cannot bypass opt-out
- **WHEN** either trigger is posted for an owned entry on a disabled subscription
- **THEN** the response contains original content with disabled eligibility and no new attempt or budget use

#### Scenario: Existing result or pending attempt
- **WHEN** fetching is disabled after a successful extraction or while an admitted extraction is running
- **THEN** the reader displays original content without tabs or retry controls
- **AND** retained or late results do not restore fetched display while the preference is disabled

#### Scenario: Re-enable with stored success
- **WHEN** fetching is re-enabled for a short feed article with a retained successful extraction
- **THEN** the reader can reuse the stored result without another extraction or budget charge

#### Scenario: Consistent reader entry points
- **WHEN** the same opted-out article opens from a feed, Saved, a deep link, keyboard navigation, or feed-backed Read Later
- **THEN** each view displays original content without fetching
- **AND** off-feed URL items retain their existing extraction behavior

### Requirement: Short displayed bodies offer a prominent publisher link
A reader displaying fewer than 500 readable characters SHALL show a centered, filled primary-color link button labeled “View full post…” below the body and above navigation controls, when a valid HTTP(S) article URL is available. It SHALL open the stored article URL in a new tab and retain the existing corner link. Loading alone SHALL NOT show the button.

#### Scenario: Short original content on an opted-out feed
- **WHEN** an opted-out article displays a short or empty original body and has a valid article URL
- **THEN** View full post… appears below that body and opens its publisher page

#### Scenario: Body selection and extraction fallback
- **WHEN** the reader switches between Original and Fetched article or shows original content after an extraction failure
- **THEN** button visibility uses the body actually displayed, independently of the fetching preference
- **AND** a displayed body at exactly 500 readable characters or longer hides the button

#### Scenario: Normalize readable text
- **WHEN** displayed HTML contains entities, markup, images, script/style/template text, block boundaries, or Unicode
- **THEN** the button applies the same readable-text normalization and Unicode character counting as automatic-fetch classification

#### Scenario: Pending extraction
- **WHEN** Fetched article displays only a loading indicator
- **THEN** no below-content button is displayed
- **AND** choosing Original displays the button if that original body qualifies

#### Scenario: URL and accessibility
- **WHEN** the article URL is missing, malformed, contains credentials, or uses a non-HTTP(S) scheme
- **THEN** no View full post… button appears
- **AND** for a valid URL the button supports keyboard and touch, uses the active primary theme color in light and dark modes, and opens without granting opener access
