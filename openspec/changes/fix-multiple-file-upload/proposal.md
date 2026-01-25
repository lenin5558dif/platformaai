# Change: Fix Multiple File Upload in Chat

## Why
The file input in the chat interface allows selecting multiple files, but currently only processes the first one. This limits the user's ability to share multiple documents or images simultaneously.

## What Changes
- Update the `onChange` handler in `ChatApp.tsx` to iterate over `e.target.files`.
- Implement a loop or queue to handle upload for each selected file.
- Ensure all selected files are processed and added to the chat.

## Impact
- Affected specs: `chat`
- Affected code: `src/components/chat/ChatApp.tsx`
