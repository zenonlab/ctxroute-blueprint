Feature: Invariants FavLib Wave 0

  Scenario: A non-media bookmark stays in the extension
    Given a bookmark named "Documentation de jardinage"
    When the local classifier examines it
    Then it is classified as non-media
    And its readable URL is not sent to the FavLib API

  Scenario: A favorite work creates monitoring but no progress
    Given Alice favorites the work page for "Orbital Knights"
    When FavLib classifies the bookmark
    Then Alice follows "Orbital Knights"
    And Alice progress is unknown
    And the canonical work target is monitored

  Scenario: A new release does not invent progress
    Given Alice observed episode 11 of "Orbital Knights"
    And the source snapshot contains episode 11
    When the connector discovers episode 12
    Then Alice inbox contains episode 12
    And Alice observed progress remains episode 11

  Scenario: Consented contextual progress
    Given Alice favorites "Orbital Knights"
    And contextual progress is enabled for Alice device
    When Alice opens the recognized episode 12 page
    Then FavLib records observed progress episode 12 for Alice
    And FavLib does not modify Alice Chrome bookmarks

  Scenario: A public fetch is shared safely
    Given Alice and Bob follow the same public target
    And their connector version locale region and access mode are identical
    When the target becomes due
    Then the worker fetches it once
    And personal inbox events are created separately

  Scenario: A broken parser is not an empty update
    Given the previous valid snapshot contains releases
    When the connector parses the broken empty fixture
    Then the result is quarantined
    And the previous valid snapshot stays active
    And no release deletion or notification is produced

  Scenario: Equivalent releases from two sites are grouped
    Given the French and English fixtures both expose episode 12 of "Orbital Knights"
    When both connectors return a valid inspection
    Then FavLib creates one logical episode 12
    And that logical release has two distinct origins
    And neither origin changes Alice observed progress

  Scenario: A catalog alternative never adds a work by itself
    Given an authorized catalog exposes a source for "Unfavorited Knights"
    And Alice has no active favorite linked to that work
    When the source resolver receives the candidate
    Then Alice library and subscriptions remain unchanged
    And FavLib does not create or modify a Chrome bookmark

  Scenario: Alice temporarily changes source
    Given Alice prefers the French source for "Orbital Knights"
    And episode 12 also has a healthy English origin
    When Alice selects the English origin from "Sources (2)"
    Then FavLib opens that exact origin
    And Alice permanent source preference remains French
    And Alice Chrome bookmarks remain unchanged

  Scenario: A failed preferred source uses an explicit fallback
    Given Alice allows fallback for "Orbital Knights"
    And her preferred French origin is unhealthy
    And a compatible English origin is healthy
    When Alice opens episode 12
    Then FavLib proposes or opens the English fallback according to Alice setting
    And the UI identifies the source and reason for fallback
    And the fallback does not replace Alice permanent preference

  Scenario: A domain migration preserves user intent
    Given a validated alias maps an old public source URL to its new domain
    When FavLib resolves Alice preferred source
    Then it uses the new canonical target
    And it keeps an audit trail of the alias decision
    And it does not rewrite Alice Chrome bookmark

  Scenario: A public inspection cache is isolated by context
    Given two inspections share a canonical URL
    But their locale or access mode differs
    When the source cache is queried
    Then the inspections use different cache keys
    And no authenticated or private response is shared

  Scenario: A stale source cache is safely revalidated
    Given a public source snapshot is stale
    And it has an ETag from the last valid response
    When the worker revalidates the target
    Then it sends a conditional request
    And a not-modified response refreshes freshness without replacing parsed data
    And a parser failure keeps the last valid snapshot active

  Scenario: FavLib never caches third-party reading content
    When a connector inspects a supported work page
    Then FavLib may retain normalized release metadata and technical validators
    But it does not retain page HTML media files cookies or reading content

  Scenario: A localized title resolves to the canonical work
    Given the local catalog links "Les Chevaliers Orbitaux" to "orbital-knights-s1"
    When a favorite exposes that French title and compatible anime evidence
    Then FavLib links it to "orbital-knights-s1"
    And the decision records the matched alias and classifier version

  Scenario: A native manhwa title resolves through the local catalog
    Given the local catalog links "종이달의 영웅" to "paper-moon-hero"
    When a Korean source exposes that title with manga evidence
    Then FavLib links it to "paper-moon-hero"
    And it classifies its origin country as Korea without creating another work

  Scenario: An identical title stays ambiguous
    Given one anime and one manga are both titled "Reborn"
    When a candidate has no reliable type year or source evidence
    Then FavLib sends the candidate to "À vérifier"
    And it does not automatically link either work

  Scenario: An announced episode is not yet available
    Given AniList announces episode 13 of "Orbital Knights" for tomorrow
    And no valid connector snapshot contains episode 13
    When the catalog synchronization completes
    Then episode 13 appears only as scheduled in the calendar
    And no available-release notification is created

  Scenario: A connector confirms an announced episode
    Given episode 13 of "Orbital Knights" is scheduled
    When a valid source snapshot first exposes episode 13
    Then FavLib links the announcement and the release origin to one logical episode
    And each subscribed user receives one personal available-release event

  Scenario: A sequel relation does not bypass favorites
    Given "orbital-knights-s2" is a sequel of Alice favorite "orbital-knights-s1"
    When catalog synchronization discovers the sequel
    Then FavLib may display a sequel announcement on the first work
    But it does not add or subscribe Alice to "orbital-knights-s2"

  Scenario: Discovery requires an existing favorite work
    Given Alice has no active favorite for "Unfavorited Knights"
    When Alice requests source discovery for that work
    Then the API refuses the discovery
    And no candidate subscription or library item is created

  Scenario: A search result is only a hint
    Given Web search returns a page titled "Orbital Knights"
    When no compatible connector can inspect that domain
    Then the candidate state is "PENDING_CONNECTOR"
    And the page is not advertised as monitored or available

  Scenario: Strong connector evidence verifies an alternative
    Given Alice favorites "Orbital Knights"
    And an approved connector discovers the alternative fixture
    When inspection confirms external identity exact alias type and year
    Then the candidate state is "VERIFIED"
    And Alice can see the evidence and resolution reasons

  Scenario: Multiple hints merge into one canonical candidate
    Given Alice bookmark catalog links and Web search find the same public alternative
    When the connector canonicalizes all hints to one work URL and context
    Then FavLib keeps one source candidate with multiple evidence records
    And it does not merge an authenticated personal target with that public candidate

  Scenario: A title-only false positive is rejected
    Given Web search finds a similarly titled work from 1998
    And Alice favorite work is from 2026
    When the connector reports conflicting identity evidence
    Then the candidate state is "REJECTED"
    And it is never included in automatic fallback

  Scenario: Pinning an alternative creates bounded monitoring
    Given Alice has an active favorite for "Orbital Knights"
    And a public alternative is verified
    When Alice pins that alternative
    Then FavLib creates Alice user subscription for its public target
    But it does not create or modify a Chrome bookmark

  Scenario: Temporary opening does not create monitoring
    Given a verified alternative exists for Alice favorite work
    When Alice opens it once from "Sources (2)"
    Then no new user subscription or permanent preference is created

  Scenario: Removing the last favorite disables alternative monitoring
    Given Alice last active favorite anchors "Orbital Knights"
    And Alice pinned an alternative source
    When that last favorite is removed
    Then Alice library item preferences and source subscriptions are disabled
    But public catalog and source history remain available to the system

  Scenario: An incompatible audio variant is not an automatic fallback
    Given Alice allows only Japanese audio with French subtitles
    And the preferred origin is broken
    And the only healthy origin has French audio without subtitles
    When the resolver evaluates fallback
    Then it does not automatically open the French audio origin
    And the UI explains the compatibility rejection

  Scenario: A second compatible origin does not duplicate notification
    Given Alice was notified when episode 13 first became available in English
    When a second compatible origin exposes the same logical episode
    Then "Sources (N)" is updated
    And no second default available-release notification is created

  Scenario: A preferred origin can trigger an optional delayed alert
    Given Alice enabled preferred-origin alerts for French
    And Alice already received the default episode 13 alert
    When the first compatible French origin becomes available
    Then Alice receives one "PREFERRED_ORIGIN_AVAILABLE" event

  Scenario: A private source stays bound to its installation
    Given Alice extension verifies an authenticated personal source
    When Bob searches alternatives for the same work
    Then Bob never receives Alice private candidate URL evidence or availability

  Scenario: Discovery respects approved domains and budget
    Given a discovery run has six network operations and four approved domains
    When a result points to an unapproved domain or the budget is exhausted
    Then the result is rejected or deferred with a diagnostic
    And no unrestricted fetch is attempted

  Scenario: A member domain proposal requires administration
    Given Alice proposes "fixture-official.test"
    When the local administrator has not approved a connector
    Then the domain remains pending
    And no content script worker check or scheduled discovery uses it
