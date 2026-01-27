# Change: Fix Token Statistics

## Why
Currently, `tokenCount` for user messages is hardcoded to `0` in the frontend, leading to incorrect statistics in the admin panel where only assistant tokens are counted.

## What Changes
- Update `ChatApp.tsx` to correctly calculate or pass the token count for user messages.
- Ensure the backend receives and stores the correct token count for user messages.

## Impact
- Affected specs: `chat`
- Affected code: `src/components/chat/ChatApp.tsx`
