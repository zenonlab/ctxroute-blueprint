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
