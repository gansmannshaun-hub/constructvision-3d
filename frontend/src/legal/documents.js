// Versioned legal text for the Atlas Construction app.
// To force a re-acceptance: bump the version string AND update the corresponding
// `lastUpdated` and body. The backend reads CURRENT_TERMS_VERSION /
// CURRENT_PRIVACY_VERSION from this file via the /api/legal/current endpoint.

export const CURRENT_TERMS_VERSION = "2026-02-01";
export const CURRENT_PRIVACY_VERSION = "2026-02-01";

export const TERMS_OF_SERVICE = {
  version: CURRENT_TERMS_VERSION,
  lastUpdated: "February 1, 2026",
  title: "Terms of Service",
  body: `
# Terms of Service

**Last updated: February 1, 2026**

Welcome to **Atlas Construction** ("Gonzo ai Solutions","Atlas", "we", "us", "our"). These Terms of Service ("Terms") govern your access to and use of the Atlas Construction software-as-a-service platform (the "Service"), accessible at app-gonzo.com and any related domains. By creating an account or using the Service, you ("User", "you") agree to be bound by these Terms.

## 1. Eligibility & Accounts
1.1 You must be at least 18 years old and capable of forming a binding contract to use the Service.
1.2 You agree to provide accurate, current, and complete information during registration and to keep your account credentials secure. You are responsible for all activity under your account.
1.3 One person, one account. Accounts are non-transferable. Sharing login credentials is prohibited.

## 2. The Service
2.1 Atlas provides cloud-based construction management tools, including but not limited to: blueprint analysis, 2D CAD editing, 3D rendering and landscape visualization, takeoff generation, AIA G702/G703 pay application drafts, project collaboration, field execution logging, and AI-assisted estimation.
2.2 The Service is provided **as-is** and **as-available**. We may modify, suspend, or discontinue any feature at any time with reasonable notice.
2.3 AI-generated outputs (material extractions, code-compliance checks, schedule suggestions, building-height estimates, etc.) are **estimates only** and **must be independently verified by a qualified professional** before use in any binding bid, contract, permit application, or construction activity.

## 3. Subscription, Billing & Refunds
3.1 Paid plans are billed monthly through **Stripe**. Your subscription auto-renews until cancelled.
3.2 Prices are listed in U.S. Dollars and may change with 30 days' notice.
3.3 You may cancel any time from the Billing page. Cancellation stops future renewals; refunds for partial periods are not provided unless required by law.
3.4 Purchasable add-ons (additional projects, AI generations, etc.) are one-time and non-refundable.

## 4. User Content & Intellectual Property
4.1 **Your data is yours.** You retain all rights to documents, drawings, photos, and other content you upload ("User Content").
4.2 You grant Atlas a worldwide, non-exclusive, royalty-free license to host, process, and display your User Content **solely to operate the Service for you**.
4.3 You represent that you have all necessary rights to the User Content you upload and that it does not infringe any third-party rights.
4.4 **Atlas IP.** The Service software, code, design, trademarks, and logos are owned by Gonzo ai Solutions. These Terms do not transfer any IP rights to you.

## 5. Acceptable Use
You may NOT:
- Reverse-engineer, decompile, or attempt to extract the source code of the Service
- Use the Service to upload illegal, infringing, defamatory, or harassing content
- Resell, sublicense, or operate the Service as a managed service for third parties
- Use automated tools to scrape data or generate excessive load
- Misrepresent your identity, your firm, or AI-generated outputs to third parties (e.g., presenting an AI takeoff as professionally surveyed work)
- Circumvent usage limits or rate limits

## 6. Third-Party Services
Atlas integrates with third-party services including **Stripe** (payments), **Google Maps & Elevation API** (mapping/terrain), **OpenAI** (AI processing), **Resend** (email delivery), and other providers. Your use of those features is also subject to those providers' terms. Atlas is not responsible for outages or actions of third-party providers.

## 7. Termination
7.1 You may delete your account at any time from Settings.
7.2 We may suspend or terminate your access immediately for violation of these Terms, non-payment, or fraudulent / unlawful activity.
7.3 Upon termination, you may export your data within 30 days. After 30 days we may delete it.

## 8. Disclaimers
THE SERVICE IS PROVIDED "AS IS" WITHOUT WARRANTIES OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING WITHOUT LIMITATION WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE, AND NON-INFRINGEMENT. Atlas does not warrant that AI-generated outputs are accurate, complete, code-compliant, or suitable for permit submission or construction.

## 9. Limitation of Liability
TO THE MAXIMUM EXTENT PERMITTED BY LAW, Gonzo ai Solutions,ATLAS, ITS OFFICERS, EMPLOYEES, AND AFFILIATES SHALL NOT BE LIABLE FOR ANY INDIRECT, INCIDENTAL, SPECIAL, CONSEQUENTIAL, OR PUNITIVE DAMAGES, OR ANY LOSS OF PROFITS OR REVENUE, ARISING FROM YOUR USE OF THE SERVICE. OUR TOTAL CUMULATIVE LIABILITY SHALL NOT EXCEED THE GREATER OF (A) US $100 OR (B) THE FEES YOU PAID US IN THE 12 MONTHS PRECEDING THE CLAIM.

## 10. Indemnification
You agree to indemnify and hold Atlas, Gonzo ai Solutions, harmless from any claims, damages, or expenses arising from your User Content, your use of the Service, or your violation of these Terms.

## 11. Governing Law & Disputes
These Terms are governed by the laws of the State of Missouri, United States, without regard to conflict-of-laws principles. Any dispute shall be resolved by binding arbitration in Jefferson City, Missouri administered by the American Arbitration Association under its Commercial Arbitration Rules, except that either party may seek injunctive relief in court to protect intellectual property.

## 12. Changes to These Terms
We may update these Terms from time to time. When we do, we will bump the version number and require you to re-accept on next login. Continued use of the Service after acceptance constitutes agreement.

## 13. Contact
Questions about these Terms? Contact us through the in-app **Support** chat or email **gonzo.ai.labs@gmail.com**.
`,
};

export const PRIVACY_POLICY = {
  version: CURRENT_PRIVACY_VERSION,
  lastUpdated: "February 1, 2026",
  title: "Privacy & Data Use Policy",
  body: `
# Privacy & Data Use Policy

**Last updated: February 1, 2026**

This Policy explains what data Atlas Construction collects, how we use it, who we share it with, and the choices you have.

## 1. What We Collect

### Account Information
- Email address, name, company, password (stored as a one-way hash, never in plaintext)
- Subscription tier and billing identifiers from Stripe (we do **not** store credit card numbers; Stripe handles them directly)

### Project & Usage Data
- Project metadata (name, address, site location lat/lng)
- Documents you upload (blueprints, PDFs, photos)
- Materials, blueprints, bids, daily logs, pay-apps, and support messages you create
- AI prompts and responses generated on your behalf
- Application logs (which features you use, error reports) to improve the Service

### Technical Data
- IP address, browser, device type (for security and analytics)
- Cookies and similar technologies (see Section 6)

## 2. How We Use It
- To operate the Service: render dashboards, run AI extractions, generate documents, process payments
- To send transactional and support emails (account verification, billing receipts, support replies, optional daily digest)
- To improve and secure the Service (debugging, fraud detection, abuse prevention)
- To comply with legal obligations (tax records, lawful requests from authorities)
- **We do NOT sell your data. We do NOT train external AI models on your User Content.**

## 3. AI Processing
When you use AI features (PDF extraction, code-compliance check, AI CAD generation, building-height estimation, etc.):
- Your uploads or prompts are sent to **OpenAI's API** and processed under OpenAI's enterprise data terms.
- OpenAI does **not** retain or train on data submitted via API calls (per OpenAI's stated policy as of the date of this document).
- AI outputs are stored in your project for your access.

## 4. Third Parties We Share With
We share data **only with service providers** strictly necessary to operate the Service:
| Provider | Purpose | Data Shared |
|---|---|---|
| Stripe | Payment processing | Email, billing address, subscription metadata |
| OpenAI | AI feature processing | Document images, AI prompts |
| Google Maps & Elevation API | Mapping, terrain, geocoding | Site coordinates |
| Resend | Transactional email | Email address, message content |
| MongoDB Atlas | Database hosting | All persistent application data |
| Hosting/Infra (Emergent Kubernetes) | Application hosting | All application data in transit |

We do not sell or rent personal data to third parties for advertising.

## 5. Data Retention
- Active accounts: data retained for the life of the account
- Deleted accounts: User Content deleted within 30 days; backup snapshots purged within 90 days
- Billing records retained 7 years for tax/legal compliance
- Application logs retained 90 days

## 6. Cookies
We use first-party cookies and localStorage to:
- Keep you signed in (JWT token)
- Remember UI preferences
- Measure feature usage (no third-party advertising trackers)

You may clear cookies at any time, but you will be signed out.

## 7. Your Rights
You have the right to:
- **Access** your data (export from Settings)
- **Correct** inaccurate data (edit in-app or contact support)
- **Delete** your account and associated data (Settings → Delete Account or via Support)
- **Restrict** or object to certain processing
- **Portability**: receive your data in a machine-readable format

To exercise any right, use the in-app **Support** chat or email **gonzo.ai.labs@gmail.com**. We will respond within 30 days.

If you are in the EU/EEA/UK, you may also lodge a complaint with your supervisory authority.
If you are in California (CCPA/CPRA), you may request the categories of personal information collected and to whom it was disclosed in the past 12 months.

## 8. Children's Privacy
The Service is not directed to children under 13 (or 16 in the EU). We do not knowingly collect data from children.

## 9. Security
We use industry-standard safeguards: TLS in transit, encryption at rest, password hashing, role-based access controls, and least-privilege internal access. No system is 100% secure; please use a strong unique password.

## 10. International Transfers
Atlas may process data in the United States. By using the Service you consent to such transfers. Where required, we rely on Standard Contractual Clauses or equivalent safeguards.

## 11. Changes to This Policy
We may update this Policy. When we make material changes, we will bump the version and require you to re-accept on next login.

## 12. Contact
Questions or requests? Use the in-app **Support** chat or email **gonzo.ai.labs@gmail.com**.
`,
};
