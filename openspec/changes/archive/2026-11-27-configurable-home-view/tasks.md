# Tasks

## 1. Account preference

- [x] 1.1 Validate optional `homeView` values in the authenticated `PUT /api/v1/settings` patch. Extend the existing settings integration coverage to verify valid values round-trip, unsupported values are rejected, omitted keys preserve the setting, and accounts are isolated. Document the allowed values in the web settings/data-model documentation.
- [x] 1.2 Add a Mantine Home view selector and publish successful saves to the current account's settings cache. Verify the default for missing or invalid data, a successful save and reload, and visible failure feedback with the prior selection intact.

## 2. Root navigation and sidebar

- [x] 2.1 Resolve the exact authenticated root through the settings query and replace it with the selected stream. Verify delayed settings, terminal failure, all three destinations, applicable filter and sort, explicit stream links, and browser history. Update the frontend route and preference documentation to reflect the root behavior.
- [x] 2.2 Point the Topbar logo and any other app-wide home action at `/`. Verify ordinary sign-in and invalid return destinations use home, subscription popup sign-in still resumes its workflow, and explicit All links and reader return paths retain their destinations.
- [x] 2.3 Promote the effective home link in Sidebar while retaining active state, badges, and mobile close behavior. Extend sidebar tests to verify each ordering and the immediate update after a successful settings save without navigating away from Settings.

## 3. Integration verification

- [x] 3.1 Exercise the Settings → sidebar → logo → landing flow in a browser at desktop and mobile widths. Verify a fresh session, account isolation, direct stream links, and browser Back from the new landing stream.
- [x] 3.2 Run lint, workspace typecheck, the web build, and the test suite including Google Reader conformance. Record the shipped behavior and verification in the roadmap and decision log in the implementation change.
