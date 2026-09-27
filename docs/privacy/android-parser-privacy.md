# Android parser privacy — Phase 7 sandbox

Current app does not request/read/send/receive SMS, read inbox/contacts, register an SMS
receiver or collect phone number, IMEI, serial, advertising ID or hardware identifiers.
Stable identity is EkPay-issued opaque UUID after pairing, not a device fingerprint.
Only synthetic TEST_ transaction/sender references, integer BDT amounts, fixture hashes
and synthetic timestamps are allowed. No real customer/payment/provider messages.

Signed heartbeat sends app version/protocol only; optional safe Android/model/locale/
timezone support exists on backend but not collected by this app. Queue normalized facts
encrypted at rest, operational state minimized; no raw inbox/message/note upload. Tokens
ephemeral UI/request memory and cleared, no persistence/analytics. No third-party analytics
or crash-upload SDK. Diagnostics sanitized/default logging off; screenshots blocked.

No commercial privacy/legal approval implied. Future SMS/notification access would require
narrow justified consent, Android/store policy assessment, provider/merchant authorization,
retention/deletion/dispute/legal review and a separate approved phase. Entire inbox upload,
unrelated messages and unnecessary identifiers remain prohibited. This is a technical
development statement, not finalized commercial terms or legal advice.
