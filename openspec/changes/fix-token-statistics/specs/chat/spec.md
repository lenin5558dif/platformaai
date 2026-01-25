## ADDED Requirements
### Requirement: Token Usage Tracking
The system SHALL track token usage for both user and assistant messages.

#### Scenario: User message token count
- **WHEN** a user sends a message
- **THEN** the system calculates the token count for the message
- **AND** the token count is stored with the message

#### Scenario: Assistant message token count
- **WHEN** the assistant generates a response
- **THEN** the system calculates the token count for the response
- **AND** the token count is stored with the message
