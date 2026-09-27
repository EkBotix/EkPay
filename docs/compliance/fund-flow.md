# Intended fund and data flow

DRAFT / NOT LEGAL ADVICE — Development / pre-launch.

```mermaid
flowchart LR
  Customer -->|Funds outside EkPay| Account[Merchant-owned MFS / Bank / Provider account]
  Account -.->|Future evidence only| EkPay[EkPay verification software]
  EkPay -.->|Future verification result| Merchant[Merchant system]
```

Dashed data paths are future, disabled capabilities. EkPay does not intend to custody or settle customer funds. A payment intent represents an expected amount, not receipt, transfer or settlement. No real transaction is created/tested by Phase 3.

Non-custodial or software-only architecture does not itself establish regulatory exemption. Regulatory classification must be confirmed against applicable Bangladesh law, Bangladesh Bank rules/guidance, and qualified regulatory/legal advice before commercial launch.
