# Spec Delta

## Purpose

Defines the resource ceiling of the project's test suite, so several agents or terminals can run it on the same machine at once without exhausting memory.

## ADDED Requirements

### Requirement: Bounded test concurrency
`npm test` SHALL run at most 4 test files at once by default, whatever the machine's CPU count. A developer SHALL be able to change the limit for one run with an environment variable.

#### Scenario: Many-core machine
- **WHEN** `npm test` runs on a 24-thread PC with no override
- **THEN** no more than 4 test files run at the same time

#### Scenario: Override for a quick run
- **WHEN** a developer runs `npm test` with the concurrency variable set to 8
- **THEN** up to 8 test files run at once
