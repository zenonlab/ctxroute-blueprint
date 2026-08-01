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
