# Geostats project instructions

## Geocaching access

- Geostats will not have approved Geocaching API partner access. Treat this as a permanent product constraint.
- Implement all Geocaching features without partner API credentials, consumer keys, or partner OAuth. Do not propose API partner approval as a prerequisite or add a partner-only implementation.
- Use user-provided GPX/Pocket Query files, existing GSAK imports, and the user's own signed-in Geocaching browser session through the browser helper or an on-device browser capture.
- Keep browser credentials and session cookies on the user's device. Do not send them to the Geostats server or use a shared server account to access listings on behalf of other users.
- A GC code can identify and open a cache, or look up data already available to that user in Geostats. If the server lacks the listing, guide the user through browser capture or file import. Never claim that a code alone gives the server access to signed-in or Premium content.
- Respect the user's actual access. Do not bypass sign-in, membership restrictions, or bot challenges, and never invent missing coordinates or puzzle text.
- Preserve existing solutions, notes, clues, and attempts when importing the same cache again.
