# Apple: the Frequent Ones

Guideline numbering and wording change. Treat what follows as the durable patterns, and check
current text against the live guidelines before citing specifics.

## 2.1 — Information Needed

The most common, and usually the least serious. Nearly always one of:

- **The demo account does not work.** Expired, wrong password, or gated behind a verification code
  the reviewer cannot receive.
- **A feature is not reachable** without data the reviewer does not have.
- **Hardware they do not have** is required, with no explanation.
- **A backend service was down** during review.

Preventable almost entirely: a permanent, non-expiring review account, with steps, in the review
notes, checked before every submission.

## 4.3 — Spam

The one that surprises teams. It fires when an app looks like others already on the store — most
often for template-built apps, white-labelled products, or a portfolio of similar apps from one
account.

Hard to fix by editing, because the objection is to the app's overall distinctiveness. If you ship
multiple similar apps for different clients, this is a recurring risk and worth designing around
rather than reacting to.

## 5.1.1 — Data Collection and Storage

- Requiring registration for features that do not need an account
- Requesting data not needed for the current function
- Missing or vague purpose strings
- **No in-app account deletion** where accounts can be created — this is a hard requirement and a
  frequent rejection

Account deletion must be reachable **in the app**, not only on a website, and it must actually
delete rather than deactivate.

## 3.1.1 — In-App Purchase

Digital goods and services consumed in the app must use IAP. Linking to external payment for them is
a rejection.

The boundary is not always obvious: physical goods, and some categories of service, are outside it.
Where it is genuinely ambiguous, say so rather than asserting.

## 4.2 — Minimum Functionality

An app that is a thin wrapper around a website, or that does very little, may be rejected. A React
Native app that is mostly a `WebView` is squarely in this territory.

## 2.3 — Accurate Metadata

Screenshots must show the actual app. Descriptions must not promise what is not there. No references
to other platforms. No "beta" or "trial" language.

## 5.1.2 — Tracking

Tracking across apps requires App Tracking Transparency, before any tracking begins, with a purpose
string. Collecting the IDFA without the prompt is a rejection — and so is showing the prompt when
you do not track.

## Purpose strings

Every permission needs one, and the string is read by the reviewer:

```
✗ "We need access to your camera."
✓ "Scan a receipt to add it to an expense claim."
```

Vague strings are a rejection cause in their own right, independent of any other issue.

## Practical prevention

Most Apple rejections are avoided by four things: a working permanent demo account, honest metadata,
specific purpose strings, and an app that behaves when every permission is denied.
