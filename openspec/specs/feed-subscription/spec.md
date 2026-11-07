# Feed Subscription Specification

## Purpose

Lets users subscribe to a discovered blog feed from a browsing bookmarklet and recover from failed subscription attempts using RSSFinder.

## Requirements

### Requirement: Users can install a deployment-specific subscribe bookmarklet
Settings SHALL offer a draggable Subscribe bookmarklet and copyable code alongside the existing Read later bookmarklet. Activation on an HTTP(S) page SHALL open a small Sparkle popup carrying the encoded current page URL and page title to the installation's own origin. The bookmarklet SHALL contain no authentication credentials and SHALL perform no subscription write on the publisher's origin.

#### Scenario: Activate the installed bookmarklet
- **WHEN** a user activates Subscribe while visiting a blog page containing query parameters and a fragment
- **THEN** Sparkle opens a small popup with the source URL and page title preserved without corrupting the popup's query parameters

#### Scenario: Existing read-later installation
- **WHEN** the user opens Settings after this feature ships
- **THEN** both bookmarklets are available and the existing Read later bookmarklet retains its behavior

### Requirement: Discovery precedes subscription confirmation
The authenticated first-party API SHALL accept a source HTTP(S) URL for discovery and return the first valid feed selected by the existing discovery behavior, including its feed URL, site URL, and nullable title. Discovery SHALL NOT create feed or subscription records or enqueue ingestion. The popup SHALL automatically discover the source, show a loading state, and then display “Subscribe to <name>?” with Cancel and Subscribe. The name SHALL use the discovered title, falling back to a nonempty page title and then the feed URL. Missing or invalid source URLs SHALL show a useful error without initiating discovery or subscription.

#### Scenario: HTML blog with a discoverable feed
- **WHEN** an authenticated user opens the popup for a blog with a valid alternate feed link
- **THEN** the popup presents the discovered feed for confirmation without changing subscriptions

#### Scenario: Direct feed URL with no title
- **WHEN** discovery succeeds for a direct feed URL without a feed title
- **THEN** confirmation uses the page title if available and otherwise the feed URL

#### Scenario: Several advertised feeds
- **WHEN** a page advertises several feed candidates
- **THEN** discovery selects the first valid feed using the current discovery order and limits

#### Scenario: Invalid popup input
- **WHEN** the popup has no source URL or a non-HTTP(S) source URL
- **THEN** it explains the invalid input and does not enable Subscribe or offer a URL-based RSSFinder link

### Requirement: Users explicitly confirm subscription choices
The popup SHALL offer an optional custom title and the authenticated user's folders, defaulting to no custom title and no folder. Only an explicit Subscribe action SHALL create the subscription, for the feed URL shown by discovery and with those choices. Cancel SHALL dismiss the popup without creating a subscription; when window closing is unavailable, it SHALL leave a cancelled state with no automatic write. Pending submission SHALL prevent repeat clicks. Successful creation SHALL show an in-place success state and a Close action, preserving the existing first-fetch behavior. An already-subscribed response SHALL show an informative state without changing that subscription's title or folder.

#### Scenario: Subscribe with title and folder
- **WHEN** the user chooses an owned folder, enters a custom title, and presses Subscribe
- **THEN** Sparkle subscribes to the confirmed feed with those choices and shows success

#### Scenario: Cancel after discovery
- **WHEN** the user presses Cancel on the confirmation
- **THEN** no subscription is created and no first fetch is enqueued

#### Scenario: Duplicate subscription
- **WHEN** the user confirms a feed they already subscribe to
- **THEN** Sparkle reports that it is already subscribed without overwriting its existing settings

#### Scenario: Repeat activation or late discovery response
- **WHEN** the popup is reused for a different source URL while a previous discovery is pending
- **THEN** only the current source's result can populate confirmation or be submitted

### Requirement: Web discovery falls back to the origin root
The subscription popup and existing web Subscribe dialog SHALL first attempt discovery at the supplied URL and its advertised feed links. If that attempt finds no valid feed or encounters an upstream fetch failure, they SHALL attempt discovery once at the supplied URL's origin root. The fallback SHALL preserve scheme, hostname including subdomain, and port, and remove path, query, fragment, and credentials. A successful first attempt SHALL take precedence. Invalid or rejected URLs SHALL NOT trigger fallback. Already-checked roots and feed candidates SHALL NOT be fetched again. The complete discovery attempt SHALL have a single 20-second deadline, with individual requests limited to ten seconds or the remaining budget, whichever is shorter. The Google Reader discovery behavior SHALL remain unchanged. Final subscription creation SHALL validate the selected feed URL without substituting an origin-root feed.

#### Scenario: Article has no feed but the homepage does
- **WHEN** discovery at `https://blog.example.com/posts/story` finds no valid feed and `https://blog.example.com/` advertises a valid feed
- **THEN** web discovery returns the homepage's discovered feed for the normal confirmation or manual subscription flow

#### Scenario: Article feed takes priority
- **WHEN** the article advertises a valid section-specific feed
- **THEN** web discovery returns that feed without requesting the origin root

#### Scenario: Preserve the exact origin
- **WHEN** discovery fails for `http://alice.example.com:8080/posts/story?view=full#comments`
- **THEN** the single fallback page is `http://alice.example.com:8080/`, with no attempt at `example.com` or a different scheme

#### Scenario: Root already checked
- **WHEN** the supplied URL is the root or its request redirects to the root and discovery fails there
- **THEN** discovery does not request that root again

#### Scenario: Article fetch fails
- **WHEN** fetching an article returns an upstream failure and time remains
- **THEN** web discovery still tries the origin root

#### Scenario: Both stages fail or time expires
- **WHEN** neither stage discovers a valid feed or the shared deadline expires
- **THEN** web discovery stops and the error state offers RSSFinder for the original supplied URL

#### Scenario: Manual web subscription uses fallback
- **WHEN** a user submits a post URL in the existing Subscribe dialog and only its origin root advertises a feed
- **THEN** the dialog subscribes to that discovered feed with the chosen title and folder through its existing single-submit flow

#### Scenario: Google Reader subscription remains unchanged
- **WHEN** a Google Reader client subscribes to a page without an advertised feed
- **THEN** its discovery follows the existing compatibility contract without the new origin-root fallback

#### Scenario: Confirmed feed becomes unavailable
- **WHEN** a feed shown in the popup becomes unavailable before Subscribe is pressed
- **THEN** creation reports failure rather than substituting a different homepage feed

### Requirement: Failed feed attempts offer RSSFinder recovery
The popup and existing Subscribe dialog SHALL display “Use RSSFinder.com” when discovery or subscription fails for a valid HTTP(S) source URL, except for authentication and already-subscribed states. The link SHALL target `https://rssfinder.app/` with a `q` parameter equal to the original attempted source URL, encoded as one query value. It SHALL open externally without discarding the Sparkle form, and Sparkle SHALL NOT contact RSSFinder automatically. Users SHALL retain a retry action; existing-dialog inputs and popup choices SHALL survive a failed subscription. An existing-dialog error and fallback link SHALL be cleared when its source URL is edited.

#### Scenario: No feed found in popup
- **WHEN** Sparkle cannot discover a feed at the captured blog URL
- **THEN** it shows failure feedback, Retry, and Use RSSFinder.com for that captured URL

#### Scenario: Existing subscribe dialog fails
- **WHEN** adding a valid blog URL in the existing Subscribe dialog fails
- **THEN** the dialog stays open with its inputs and a Use RSSFinder.com link for that attempted URL

#### Scenario: Source URL contains reserved characters
- **WHEN** a failed source URL contains `?`, `&`, `#`, or Unicode characters
- **THEN** following the fallback link sends the complete source as the single `q` value to `https://rssfinder.app/`

#### Scenario: Submission fails after discovery
- **WHEN** subscription creation fails after successful discovery
- **THEN** the popup retains confirmation choices and offers retry and RSSFinder recovery without claiming success

### Requirement: Subscription discovery remains a first-party feature
Discovery-only requests SHALL require the existing first-party authentication. Subscription writes SHALL retain user scoping and folder ownership checks. The Google Reader API behavior SHALL remain unchanged.

#### Scenario: Unauthenticated discovery
- **WHEN** a caller requests discovery without valid first-party authentication
- **THEN** the API rejects the request without running discovery

#### Scenario: Foreign folder selection
- **WHEN** a caller submits a folder belonging to another user
- **THEN** subscription creation rejects it using the existing ownership behavior
